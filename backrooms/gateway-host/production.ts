import { execFile } from 'node:child_process';
import { chmod, lstat, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { assertDigest, assertIdentifier, assertInteger, canonicalJson, digestBytes, record, utf8 } from '../client/codec.js';
import type { BridgeRequest } from '../client/contracts.js';
import { gatewayEndpoint } from '../client/gateway-protocol.js';
import type { ProductionReleaseManifest } from '../client/release.js';
import { ProcessRingsTransport } from '../reference-host/bridge.js';
import { protectedDirectory } from '../reference-host/records.js';
import { RuntimeOwnership } from '../reference-host/runtime-ownership.js';
import { RuntimeArtifacts, verifiedFile, type ProductionArtifactPaths } from './artifacts.js';
import { SupervisedIndexer, type SupervisedIndexerConfiguration } from './indexer.js';

export interface ProductionBridgeOptions {
  configuration: { rpcUrl: string; proverUrl: string; treeAddress: string; treeId: number; genesisHash: string };
  artifacts: ProductionArtifactPaths;
  indexer: SupervisedIndexerConfiguration;
  timeoutMs?: number;
}

export class ProductionBridge {
  private constructor(
    private readonly options: ProductionBridgeOptions,
    private readonly manifest: ProductionReleaseManifest,
    private readonly artifacts: RuntimeArtifacts,
    private readonly indexer: SupervisedIndexer,
    private readonly temporaryDirectory: string,
    private readonly indexerOwnership: RuntimeOwnership,
  ) {}

  static async open(options: ProductionBridgeOptions, manifest: ProductionReleaseManifest, temporaryDirectory: string, signal?: AbortSignal): Promise<ProductionBridge> {
    signal?.throwIfAborted();
    if ('fundingLamports' in options) throw new Error('gateway_production_airdrop_forbidden');
    const configuration = options.configuration;
    gatewayEndpoint(configuration.rpcUrl, 'production');
    gatewayEndpoint(configuration.proverUrl, 'production');
    assertIdentifier(configuration.treeAddress);
    assertIdentifier(configuration.genesisHash);
    assertInteger(configuration.treeId, 0, 65_535);
    assertInteger(options.timeoutMs ?? 600_000, 1, 3_600_000);
    if (configuration.genesisHash !== manifest.network.genesisHash) throw new Error('gateway_release_genesis_mismatch');
    if (configuration.treeAddress !== manifest.runtime.tree.address || configuration.treeId !== manifest.runtime.tree.id) throw new Error('gateway_release_tree_mismatch');
    if (options.indexer.startSlot !== manifest.runtime.indexer.startSlot) throw new Error('gateway_release_indexer_history_mismatch');
    if (!isAbsolute(temporaryDirectory)) throw new Error('gateway_artifact_path_must_be_absolute');
    const artifacts = await RuntimeArtifacts.stage(options.artifacts, temporaryDirectory, manifest);
    let indexerOwnership: RuntimeOwnership | undefined;
    let indexer: SupervisedIndexer | undefined;
    try {
      const { stdout } = await promisify(execFile)(artifacts.bridge, ['--identity'], { timeout: 10_000, maxBuffer: 65_536, env: { PATH: process.env.PATH }, ...(signal ? { signal } : {}) });
      const identity = record(JSON.parse(stdout));
      if (identity.production !== true || identity.artifactVersion !== manifest.artifactVersion || identity.identitySha256 !== manifest.runtime.identity.sha256 || identity.schemaSha256 !== manifest.runtime.schema.sha256 || identity.programId !== manifest.network.applicationProgramId || identity.shieldedPoolProgramId !== manifest.network.shieldedPoolProgramId) throw new Error('gateway_bridge_identity_mismatch');
      const circuits = record(identity.circuits);
      for (const name of ['createRoom', 'advanceRoom'] as const) {
        const compiled = record(circuits[name]), expected = manifest.circuits[name];
        if (compiled.insecureTestSetup !== false || compiled.circuitSha256 !== expected.circuitSha256 || compiled.provingKeySha256 !== expected.provingKeySha256 || compiled.verifyingKeySha256 !== expected.verifyingKeySha256) throw new Error('gateway_bridge_circuit_mismatch');
      }
      await protectedDirectory(dirname(options.indexer.databasePath));
      indexerOwnership = RuntimeOwnership.acquire(await protectedDirectory(`${options.indexer.databasePath}.runtime`));
      const identityPath = `${options.indexer.databasePath}.identity.json`;
      const identityBytes = utf8(canonicalJson({ genesisHash: manifest.network.genesisHash, poolProgramId: manifest.network.shieldedPoolProgramId, poolProgramSha256: manifest.runtime.shieldedPoolProgramSha256, startSlot: options.indexer.startSlot }));
      const exists = async (path: string) => { try { return await lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; } };
      const database = await exists(options.indexer.databasePath), retainedIdentity = await exists(identityPath);
      if (database && (!retainedIdentity || !database.isFile() || (database.mode & 0o077) !== 0)) throw new Error('gateway_indexer_database_unqualified');
      if (retainedIdentity) {
        try { await verifiedFile(identityPath, await digestBytes(identityBytes), 8192); }
        catch { throw new Error('gateway_indexer_identity_mismatch'); }
      }
      else await writeFile(identityPath, identityBytes, { flag: 'wx', mode: 0o600 });
      if (!database) await writeFile(options.indexer.databasePath, '', { flag: 'wx', mode: 0o600 });
      indexer = await SupervisedIndexer.start(artifacts.bridge, artifacts.indexer, configuration.rpcUrl, options.indexer, signal);
      const bridge = new ProductionBridge(structuredClone(options), manifest, artifacts, indexer, temporaryDirectory, indexerOwnership);
      await bridge.configured('0'.repeat(64), async configPath => {
        const { stdout } = await promisify(execFile)(artifacts.bridge, ['--check-runtime'], { timeout: options.timeoutMs ?? 600_000, maxBuffer: 65_536, env: { PATH: process.env.PATH, BACKROOM_RINGS_CONFIG: configPath }, ...(signal ? { signal } : {}) });
        if (record(JSON.parse(stdout)).verified !== true) throw new Error('gateway_runtime_unverified');
      });
      return bridge;
    } catch (error) {
      try { await indexer?.close(); }
      finally { indexerOwnership?.release(); await artifacts.close(); }
      throw error;
    }
  }

  async request(seedHex: string, request: BridgeRequest): Promise<unknown> {
    assertDigest(seedHex);
    return this.configured(seedHex, configPath => new ProcessRingsTransport(this.artifacts.bridge, configPath, this.options.timeoutMs).request(request));
  }

  private async configured<T>(seedHex: string, operation: (configPath: string) => Promise<T>): Promise<T> {
    this.indexer.assertRunning();
    const directory = await mkdtemp(join(this.temporaryDirectory, 'rings-bridge-'));
    await chmod(directory, 0o700);
    const configPath = join(directory, 'config.json');
    try {
      await writeFile(configPath, JSON.stringify({
        ...this.options.configuration,
        signerSeedHex: seedHex,
        mode: 'production',
        indexerUrl: this.indexer.endpoint,
        artifactsDirectory: this.artifacts.directory,
        programBinarySha256: this.manifest.runtime.applicationProgramSha256,
        shieldedPoolBinarySha256: this.manifest.runtime.shieldedPoolProgramSha256,
        production: this.manifest.runtime,
      }), { mode: 0o600, flag: 'wx' });
      const response = await operation(configPath);
      this.indexer.assertRunning();
      return response;
    } finally { await rm(directory, { recursive: true, force: true }); }
  }

  async close(): Promise<void> {
    try { await this.indexer.close(); }
    finally { this.indexerOwnership.release(); await this.artifacts.close(); }
  }
}
