import { constants } from 'node:fs';
import { chmod, mkdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { digestBytes, record } from '../client/codec.js';
import { decodeDeploymentIdentity } from '../client/deployment.js';
import { runtimeArtifacts, type ProductionReleaseManifest } from '../client/release.js';

export async function verifiedFile(path: string, sha256: string, maximumBytes = 256 * 1024 * 1024): Promise<Buffer> {
  if (!isAbsolute(path)) throw new Error('gateway_artifact_path_must_be_absolute');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size === 0 || metadata.size > maximumBytes) throw new Error('gateway_artifact_size_invalid');
    const bytes = await handle.readFile();
    if (bytes.length > maximumBytes || await digestBytes(new Uint8Array(bytes)) !== sha256) throw new Error('gateway_artifact_digest_mismatch');
    return bytes;
  } finally { await handle.close(); }
}

export interface ProductionArtifactPaths {
  directory: string;
  bridge: string;
  indexer: string;
}

export function validateCircuitMetadata(value: unknown, circuitSha256: string, verifyingKeySha256: string): void {
  const metadata = record(value);
  const mode = metadata.setup_mode;
  const phase2 = typeof mode === 'string' && /^(phase2-from-ptau|phase2-from-ptau\+mpc\[[1-9][0-9]* contributors\])$/.test(mode);
  if (metadata.protocol !== 'groth16' || metadata.curve !== 'bn254' || metadata.production_safe !== true || !phase2 || metadata.deterministic_rng_seed != null || metadata.num_public_inputs !== 1 || metadata.circuit_hash !== circuitSha256 || metadata.verifying_key_sha256 !== verifyingKeySha256) throw new Error('gateway_circuit_setup_unqualified');
}

export class RuntimeArtifacts {
  private constructor(readonly directory: string, readonly bridge: string, readonly indexer: string) {}

  static async stage(source: ProductionArtifactPaths, parent: string, manifest: ProductionReleaseManifest): Promise<RuntimeArtifacts> {
    if (![source.directory, source.bridge, source.indexer, parent].every(isAbsolute)) throw new Error('gateway_artifact_path_must_be_absolute');
    const files = new Map<string, Buffer>();
    for (const artifact of runtimeArtifacts(manifest)) files.set(artifact.path, await verifiedFile(join(source.directory, artifact.path), artifact.sha256));
    const identity = decodeDeploymentIdentity(JSON.parse(files.get(manifest.runtime.identity.path)!.toString('utf8')));
    if (identity.mode !== 'production' || identity.programId !== manifest.network.applicationProgramId || identity.artifactVersion !== manifest.artifactVersion) throw new Error('gateway_identity_mismatch');
    for (const [name, directory] of [['createRoom', 'create_room'], ['advanceRoom', 'advance_room']] as const) {
      const artifacts = manifest.runtime.circuits[name];
      for (const [field, filename] of [['circuit', 'circuit.xbc'], ['schema', 'schema.json'], ['provingKey', 'pk.bin'], ['verifyingKey', 'vk.bin'], ['metadata', 'metadata.json']] as const) {
        if (artifacts[field].path !== `${directory}/${filename}`) throw new Error('gateway_circuit_layout_mismatch');
      }
      validateCircuitMetadata(JSON.parse(files.get(artifacts.metadata.path)!.toString('utf8')), artifacts.circuit.sha256, artifacts.verifyingKey.sha256);
    }
    const bridge = await verifiedFile(source.bridge, manifest.runtime.bridgeSha256);
    const indexer = await verifiedFile(source.indexer, manifest.runtime.indexer.binarySha256);
    const directory = await mkdtemp(join(parent, 'rings-runtime-'));
    await chmod(directory, 0o700);
    try {
      for (const [path, bytes] of files) {
        const target = join(directory, path);
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        await writeFile(target, bytes, { flag: 'wx', mode: 0o400 });
      }
      const bridgePath = join(directory, 'bridge'), indexerPath = join(directory, 'indexer');
      await writeFile(bridgePath, bridge, { flag: 'wx', mode: 0o500 });
      await writeFile(indexerPath, indexer, { flag: 'wx', mode: 0o500 });
      return new RuntimeArtifacts(directory, bridgePath, indexerPath);
    } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
  }

  async close(): Promise<void> { await rm(this.directory, { recursive: true, force: true }); }
}
