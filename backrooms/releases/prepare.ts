import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { canonicalJson, digest, digestBytes, record } from '../client/codec.js';
import { decodeDeploymentIdentity } from '../client/deployment.js';
import { decodeReleaseManifest, productionBlockers, type ProductionReleaseManifest, type RuntimeArtifact } from '../client/release.js';
import { validateCircuitMetadata } from '../gateway-host/artifacts.js';

async function measured(path: string): Promise<{ bytes: Buffer; sha256: string }> {
  if (!isAbsolute(path)) throw new Error('release_path_must_be_absolute');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.size === 0 || metadata.size > 256 * 1024 * 1024) throw new Error('release_artifact_size_invalid');
    const bytes = await file.readFile();
    if (bytes.length > 256 * 1024 * 1024) throw new Error('release_artifact_size_invalid');
    return { bytes, sha256: await digestBytes(new Uint8Array(bytes)) };
  } finally { await file.close(); }
}

async function writeNew(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${canonicalJson(value)}\n`, { flag: 'wx', mode: 0o600 });
}

export async function createDeploymentProfile(identity: unknown, directory: string): Promise<void> {
  const decoded = decodeDeploymentIdentity(identity);
  if (decoded.mode !== 'production') throw new Error('release_requires_production_identity');
  if (!isAbsolute(directory)) throw new Error('release_path_must_be_absolute');
  await mkdir(directory, { mode: 0o700 });
  await mkdir(join(directory, 'deployment'), { mode: 0o700 });
  await writeNew(join(directory, 'deployment/identity.json'), decoded);
}

async function inventory(directory: string): Promise<ProductionReleaseManifest['runtime']['circuits']> {
  const result = {} as ProductionReleaseManifest['runtime']['circuits'];
  for (const [name, folder] of [['createRoom', 'create_room'], ['advanceRoom', 'advance_room']] as const) {
    const files = {} as ProductionReleaseManifest['runtime']['circuits']['createRoom'];
    for (const [field, filename] of [['circuit', 'circuit.xbc'], ['schema', 'schema.json'], ['provingKey', 'pk.bin'], ['verifyingKey', 'vk.bin'], ['metadata', 'metadata.json']] as const) {
      const path = `${folder}/${filename}`;
      files[field] = { path, sha256: (await measured(join(directory, path))).sha256 };
    }
    validateCircuitMetadata(JSON.parse((await measured(join(directory, files.metadata.path))).bytes.toString('utf8')), files.circuit.sha256, files.verifyingKey.sha256);
    result[name] = files;
  }
  return result;
}

function verifyExport(source: string, provingKeySha256: string, verifyingKeySha256: string): void {
  if (!source.includes('pub const VERIFYINGKEY_INSECURE_TEST_SETUP: bool = false;') || source.includes('INSECURE TEST SETUP') || source.includes('insecure_test_setup\\x00true')) throw new Error('release_insecure_verifier');
  const encoded = source.match(/pub const VERIFYINGKEY_PROVING_KEY_SHA256: \[u8; 32\] = \[([^\]]+)\]/)?.[1];
  const values = encoded?.split(',').map(value => value.trim()).filter(Boolean).map(value => Number(value.replace(/u8$/, '')));
  if (!values || values.length !== 32 || values.some(value => !Number.isInteger(value) || value < 0 || value > 255) || Buffer.from(values).toString('hex') !== provingKeySha256) throw new Error('release_verifier_proving_key_mismatch');
  if (!source.includes(`pub const ZOLANA_VK_SHA256: &str = "${verifyingKeySha256}";`)) throw new Error('release_verifier_key_mismatch');
}

export function verifyProgramMarkers(bytes: Buffer, requiredProvingKeys: readonly string[]): void {
  const begin = '=======BEGIN GROTH16 VK SETUP V1=======\0';
  const end = '=======END GROTH16 VK SETUP V1=======\0';
  const text = bytes.toString('latin1');
  const found = new Set<string>();
  let cursor = 0;
  for (;;) {
    const start = text.indexOf(begin, cursor);
    if (start < 0) break;
    const stop = text.indexOf(end, start + begin.length);
    if (stop < 0 || stop - start > 4096) throw new Error('release_setup_marker_invalid');
    const fields = text.slice(start + begin.length, stop).split('\0');
    if (fields.length !== 7 || fields[0] !== 'name' || !fields[1] || fields[2] !== 'insecure_test_setup' || fields[3] !== 'false' || fields[4] !== 'proving_key_sha256' || !/^[0-9a-f]{64}$/.test(fields[5]!) || fields[6] !== '') throw new Error('release_setup_marker_insecure');
    found.add(fields[5]!);
    cursor = stop + end.length;
  }
  if (!requiredProvingKeys.every(key => found.has(key))) throw new Error('release_program_proving_key_missing');
}

export async function createBuildInputs(directory: string, provenanceFile: string): Promise<{ buildInputsSha256: string }> {
  const identityFile = await measured(join(directory, 'deployment/identity.json'));
  const identity = decodeDeploymentIdentity(JSON.parse(identityFile.bytes.toString('utf8')));
  if (identity.mode !== 'production') throw new Error('release_requires_production_identity');
  const circuits = await inventory(directory);
  const provenance = await measured(provenanceFile);
  const schema = { schemaVersion: 1, protocolVersion: 'backrooms.v0', identity, circuits: {
    createRoom: JSON.parse((await measured(join(directory, circuits.createRoom.schema.path))).bytes.toString('utf8')) as unknown,
    advanceRoom: JSON.parse((await measured(join(directory, circuits.advanceRoom.schema.path))).bytes.toString('utf8')) as unknown,
  } };
  const approvedCircuits: Record<string, unknown> = {};
  for (const [name, folder] of [['createRoom', 'create_room'], ['advanceRoom', 'advance_room']] as const) {
    const verifier = await measured(join(directory, `verifiers/${folder}.vk.rs`));
    const files = circuits[name];
    verifyExport(verifier.bytes.toString('utf8'), files.provingKey.sha256, files.verifyingKey.sha256);
    approvedCircuits[name] = { circuitSha256: files.circuit.sha256, provingKeySha256: files.provingKey.sha256, verifyingKeySha256: files.verifyingKey.sha256, verifierSourceSha256: verifier.sha256 };
  }
  await writeNew(join(directory, 'deployment/schema.json'), schema);
  const schemaFile = await measured(join(directory, 'deployment/schema.json'));
  await writeNew(join(directory, 'build-inputs.json'), { version: 1, identitySha256: identityFile.sha256, schemaSha256: schemaFile.sha256, setupProvenanceSha256: provenance.sha256, circuits: approvedCircuits });
  return { buildInputsSha256: (await measured(join(directory, 'build-inputs.json'))).sha256 };
}

export interface ReleaseCandidateOptions {
  directory: string;
  metadata: unknown;
  bridge: string;
  indexer: string;
  applicationProgram: string;
  shieldedPoolProgram: string;
  tree: { address: string; id: number };
  indexerStartSlot: string;
  approvedBuildInputsSha256: string;
}

export async function createReleaseCandidate(options: ReleaseCandidateOptions): Promise<{ manifest: ProductionReleaseManifest; candidateManifestSha256: string }> {
  const metadata = decodeReleaseManifest(options.metadata);
  const inputFile = await measured(join(options.directory, 'build-inputs.json'));
  if (inputFile.sha256 !== options.approvedBuildInputsSha256) throw new Error('release_build_inputs_not_approved');
  const inputs = record(JSON.parse(inputFile.bytes.toString('utf8')));
  const identityFile = await measured(join(options.directory, 'deployment/identity.json'));
  const identity = decodeDeploymentIdentity(JSON.parse(identityFile.bytes.toString('utf8')));
  if (identity.mode !== 'production' || inputs.identitySha256 !== identityFile.sha256) throw new Error('release_identity_mismatch');
  const circuits = await inventory(options.directory);
  const [bridge, indexer, application, pool] = await Promise.all([options.bridge, options.indexer, options.applicationProgram, options.shieldedPoolProgram].map(measured));
  const applicationKeys = [circuits.createRoom.provingKey.sha256, circuits.advanceRoom.provingKey.sha256];
  verifyProgramMarkers(application!.bytes, applicationKeys);
  verifyProgramMarkers(bridge!.bytes, applicationKeys);
  const file = async (path: string): Promise<RuntimeArtifact> => ({ path, sha256: (await measured(join(options.directory, path))).sha256 });
  const schema = await file('deployment/schema.json');
  if (schema.sha256 !== inputs.schemaSha256) throw new Error('release_schema_mismatch');
  const { stdout } = await promisify(execFile)(options.bridge, ['--identity'], { timeout: 10_000, maxBuffer: 65_536, env: { PATH: process.env.PATH } });
  const compiled = record(JSON.parse(stdout));
  if (compiled.production !== true || compiled.identitySha256 !== identityFile.sha256 || compiled.schemaSha256 !== schema.sha256 || compiled.artifactVersion !== identity.artifactVersion || compiled.programId !== identity.programId || compiled.shieldedPoolProgramId !== metadata.network.shieldedPoolProgramId) throw new Error('release_bridge_identity_mismatch');
  const compiledCircuits = record(compiled.circuits), pinnedCircuits = record(inputs.circuits);
  for (const name of ['createRoom', 'advanceRoom'] as const) {
    const actual = record(compiledCircuits[name]), pinned = record(pinnedCircuits[name]), measured = circuits[name];
    if (actual.insecureTestSetup !== false || actual.circuitSha256 !== measured.circuit.sha256 || actual.provingKeySha256 !== measured.provingKey.sha256 || actual.verifyingKeySha256 !== measured.verifyingKey.sha256 || actual.circuitSha256 !== pinned.circuitSha256 || actual.provingKeySha256 !== pinned.provingKeySha256 || actual.verifyingKeySha256 !== pinned.verifyingKeySha256) throw new Error('release_compiled_circuit_mismatch');
  }
  const pins = (files: typeof circuits.createRoom) => ({ circuitSha256: files.circuit.sha256, provingKeySha256: files.provingKey.sha256, verifyingKeySha256: files.verifyingKey.sha256 });
  const manifest = decodeReleaseManifest({
    ...metadata, manifestVersion: 1, artifactVersion: identity.artifactVersion, schemaSha256: schema.sha256,
    setup: { kind: 'ceremony', provenance: `sha256:${String(inputs.setupProvenanceSha256)}` },
    network: { ...metadata.network, applicationProgramId: identity.programId },
    circuits: { createRoom: pins(circuits.createRoom), advanceRoom: pins(circuits.advanceRoom) },
    services: { ...metadata.services, indexer: { ...metadata.services.indexer, binarySha256: indexer!.sha256 } },
    runtime: {
      identity: { path: 'deployment/identity.json', sha256: identityFile.sha256 }, schema,
      bridgeSha256: bridge!.sha256, applicationProgramSha256: application!.sha256, shieldedPoolProgramSha256: pool!.sha256,
      tree: options.tree, circuits, proverPolicy: await file('prover/policy.json'),
      poolProvingKeys: JSON.parse(await readFile(join(options.directory, 'prover/pool-keys.json'), 'utf8')) as unknown,
      indexer: { kind: 'supervised', binarySha256: indexer!.sha256, startSlot: options.indexerStartSlot },
      privacy: { applicationProving: 'trusted_bridge', poolProving: 'attested', inference: 'native_authority' },
    },
  });
  const blockers = productionBlockers(manifest);
  if (manifest.manifestVersion !== 1 || blockers.length) throw new Error(`release_candidate_blocked:${blockers.join(',')}`);
  return { manifest, candidateManifestSha256: await digest(manifest) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [operation, first, second] = process.argv.slice(2);
    if (operation === 'profile' && first && second) await createDeploymentProfile(JSON.parse(await readFile(first, 'utf8')), resolve(second));
    else if (operation === 'build-inputs' && first && second) console.log(JSON.stringify(await createBuildInputs(resolve(first), resolve(second))));
    else if (operation === 'manifest' && first && second) {
      const result = await createReleaseCandidate(JSON.parse(await readFile(first, 'utf8')) as ReleaseCandidateOptions);
      await writeNew(resolve(second), result.manifest);
      console.log(JSON.stringify({ candidateManifestSha256: result.candidateManifestSha256, approved: false }));
    } else throw new Error('usage: prepare profile <identity.json> <new-directory> | build-inputs <directory> <provenance-file> | manifest <request.json> <new-manifest.json>');
  } catch (error) { console.error(error instanceof Error ? error.message : 'release_preparation_failed'); process.exitCode = 1; }
}
