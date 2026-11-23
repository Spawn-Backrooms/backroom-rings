import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { digest, digestBytes } from '../client/codec.js';
import { decodeDeploymentIdentity } from '../client/deployment.js';
import { GATEWAY_VERSION, parseGatewayRequest } from '../client/gateway-protocol.js';
import { assertProductionEligible, decodeReleaseManifest, productionBlockers, runtimeArtifacts, type ProductionReleaseManifest } from '../client/release.js';
import { RuntimeArtifacts, validateCircuitMetadata, verifiedFile } from '../gateway-host/artifacts.js';
import { ProductionBridge, type ProductionBridgeOptions } from '../gateway-host/production.js';
import { listenLocalnetGateway, listenProductionGateway } from '../gateway-host/server.js';
import type { RingsGateway } from '../gateway-host/host.js';
import { decodeProductionGatewayConfiguration, loadProductionGatewayConfiguration } from '../gateway-host/configuration.js';
import { RuntimeOwnership } from '../reference-host/runtime-ownership.js';
import { createBuildInputs, createDeploymentProfile, verifyProgramMarkers } from '../releases/prepare.js';

async function syntheticArtifactFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'rings-production-unit-'));
  const source = join(directory, 'artifacts');
  await mkdir(source);
  const bytes = new Map<string, Buffer>();
  const file = async (path: string, value: unknown) => {
    const content = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
    await mkdir(dirname(join(source, path)), { recursive: true });
    await writeFile(join(source, path), content);
    bytes.set(path, content);
    return { path, sha256: await digestBytes(new Uint8Array(content)) };
  };
  const identity = await file('deployment/identity.json', { identityVersion: 1, mode: 'production', artifactVersion: '1.0.0', schema: 0, deployment: '1', programId: '3'.repeat(44), programDomain: 'a'.repeat(64), authoritySeed: 'backrooms_fixture', policy: 1, lessonCapacity: 96 });
  const schema = await file('deployment/schema.json', { testOnly: true });
  const circuits = {} as ProductionReleaseManifest['runtime']['circuits'];
  for (const [name, folder] of [['createRoom', 'create_room'], ['advanceRoom', 'advance_room']] as const) {
    const circuit = await file(`${folder}/circuit.xbc`, `${name}:not-a-real-circuit`);
    const provingKey = await file(`${folder}/pk.bin`, `${name}:not-a-real-key`);
    const verifyingKey = await file(`${folder}/vk.bin`, `${name}:not-a-real-key-either`);
    circuits[name] = { circuit, provingKey, verifyingKey, schema: await file(`${folder}/schema.json`, { testOnly: name }), metadata: await file(`${folder}/metadata.json`, { protocol: 'groth16', curve: 'bn254', setup_mode: 'phase2-from-ptau', production_safe: true, num_public_inputs: 1, circuit_hash: circuit.sha256, verifying_key_sha256: verifyingKey.sha256 }) };
  }
  const proverPolicy = await file('prover/policy.json', { testOnly: 'no real attestation pins' });
  const bridge = join(directory, 'bridge');
  await writeFile(bridge, '#!/usr/bin/env node\nconsole.log(JSON.stringify({production:false}));\n', { mode: 0o700 });
  const indexer = join(directory, 'indexer');
  await writeFile(indexer, 'synthetic indexer bytes');
  const bridgeSha256 = await digestBytes(new Uint8Array(await readFile(bridge)));
  const indexerSha256 = await digestBytes(new Uint8Array(await readFile(indexer)));
  const hash = 'e'.repeat(64);
  const pins = (name: keyof typeof circuits) => ({ circuitSha256: circuits[name].circuit.sha256, provingKeySha256: circuits[name].provingKey.sha256, verifyingKeySha256: circuits[name].verifyingKey.sha256 });
  const manifest = decodeReleaseManifest({
    manifestVersion: 1, protocolVersion: 'backrooms.v0', artifactVersion: '1.0.0',
    source: { upstreamCommit: 'a'.repeat(40), forkCommit: 'b'.repeat(40) }, schemaSha256: schema.sha256,
    client: { version: '1.0.0', packageIntegrity: `sha512-${'A'.repeat(86)}==` },
    circuits: { createRoom: pins('createRoom'), advanceRoom: pins('advanceRoom') },
    setup: { kind: 'ceremony', provenance: `sha256:${hash}` },
    network: { cluster: 'mainnet-beta', genesisHash: '2'.repeat(44), applicationProgramId: '3'.repeat(44), shieldedPoolProgramId: '4'.repeat(44) },
    services: { prover: { version: '1.0.0', sourceCommit: 'c'.repeat(40), binarySha256: hash, imageDigest: null }, indexer: { version: '1.0.0', sourceCommit: 'd'.repeat(40), binarySha256: indexerSha256, imageDigest: null } },
    evidence: { circuitReview: `sha256:${hash}`, programReview: `sha256:${hash}`, publicDemo: `sha256:${hash}`, nativeInference: `sha256:${hash}`, runtimePrivacy: `sha256:${hash}` },
    runtime: { identity, schema, circuits, bridgeSha256, applicationProgramSha256: hash, shieldedPoolProgramSha256: hash, tree: { address: '5'.repeat(44), id: 0 }, proverPolicy, poolProvingKeys: [{ name: 'fixture', sha256: hash }], indexer: { kind: 'supervised', binarySha256: indexerSha256, startSlot: '0' }, privacy: { applicationProving: 'trusted_bridge', poolProving: 'attested', inference: 'native_authority' } },
  });
  assert.equal(manifest.manifestVersion, 1);
  if (manifest.manifestVersion !== 1) throw new Error('fixture');
  const options: ProductionBridgeOptions = { configuration: { rpcUrl: 'https://rpc.invalid', proverUrl: 'https://prover.invalid', treeAddress: manifest.runtime.tree.address, treeId: 0, genesisHash: manifest.network.genesisHash! }, artifacts: { directory: source, bridge, indexer }, indexer: { port: 8784, databasePath: join(directory, 'photon.sqlite'), startSlot: '0' } };
  return { directory, source, bytes, manifest, options, async close() { await rm(directory, { recursive: true, force: true }); } };
}

test('v1 approval binds complete inventory while metadata remains insufficient to execute', async () => {
  const f = await syntheticArtifactFixture();
  try {
    assert.deepEqual(productionBlockers(f.manifest), []);
    await assert.rejects(assertProductionEligible(f.manifest, '0'.repeat(64)), /release_not_operator_approved/);
    assert.deepEqual(await assertProductionEligible(f.manifest, await digest(f.manifest)), f.manifest);
    await assert.rejects(ProductionBridge.open(f.options, f.manifest, f.directory), /gateway_bridge_identity_mismatch/);
    const changed = structuredClone(f.manifest);
    changed.runtime.circuits.createRoom.provingKey.sha256 = 'a'.repeat(64);
    assert.ok(productionBlockers(changed).includes('createRoom.runtime_mismatch'));
    const duplicated = structuredClone(f.manifest);
    duplicated.runtime.proverPolicy.path = duplicated.runtime.identity.path;
    assert.ok(productionBlockers(duplicated).includes('runtime_artifact_path_invalid'));
    duplicated.runtime.proverPolicy.path = 'deployment/../policy.json';
    assert.ok(productionBlockers(duplicated).includes('runtime_artifact_path_invalid'));
  } finally { await f.close(); }
});

test('every measured runtime file and executable rejects replacement', async () => {
  const f = await syntheticArtifactFixture();
  try {
    for (const artifact of runtimeArtifacts(f.manifest)) {
      const path = join(f.source, artifact.path), original = await readFile(path);
      await writeFile(path, 'replaced');
      await assert.rejects(RuntimeArtifacts.stage(f.options.artifacts, f.directory, f.manifest), /gateway_artifact_digest_mismatch/, artifact.path);
      await writeFile(path, original);
    }
    for (const path of [f.options.artifacts.bridge, f.options.artifacts.indexer]) {
      const original = await readFile(path);
      await writeFile(path, 'replaced');
      await assert.rejects(RuntimeArtifacts.stage(f.options.artifacts, f.directory, f.manifest), /gateway_artifact_digest_mismatch/);
      await writeFile(path, original);
    }
  } finally { await f.close(); }
});

test('runtime uses retained bytes after a verified source is replaced', async () => {
  const f = await syntheticArtifactFixture();
  try {
    const retained = await RuntimeArtifacts.stage(f.options.artifacts, f.directory, f.manifest);
    try {
      for (const artifact of runtimeArtifacts(f.manifest)) {
        await writeFile(join(f.source, artifact.path), 'replacement after verification');
        assert.deepEqual(await readFile(join(retained.directory, artifact.path)), f.bytes.get(artifact.path));
      }
      await writeFile(f.options.artifacts.bridge, 'replacement executable');
      assert.notDeepEqual(await readFile(retained.bridge), await readFile(f.options.artifacts.bridge));
    } finally { await retained.close(); }
  } finally { await f.close(); }
});

test('production rejects identity swaps, insecure setup, and symlink artifact aliases', async () => {
  const f = await syntheticArtifactFixture();
  try {
    const mismatch = structuredClone(f.manifest);
    mismatch.network.applicationProgramId = '6'.repeat(44);
    await assert.rejects(RuntimeArtifacts.stage(f.options.artifacts, f.directory, mismatch), /gateway_identity_mismatch/);
    const files = f.manifest.runtime.circuits.createRoom;
    const metadata = JSON.parse(f.bytes.get(files.metadata.path)!.toString('utf8')) as Record<string, unknown>;
    for (const patch of [{ production_safe: false }, { setup_mode: 'single-party' }, { setup_mode: 'made-up-ceremony' }, { deterministic_rng_seed: 0 }, { circuit_hash: 'a'.repeat(64) }, { verifying_key_sha256: 'b'.repeat(64) }]) assert.throws(() => validateCircuitMetadata({ ...metadata, ...patch }, files.circuit.sha256, files.verifyingKey.sha256), /gateway_circuit_setup_unqualified/);
    const alias = join(f.directory, 'symlink');
    await symlink(join(f.source, files.circuit.path), alias);
    await assert.rejects(verifiedFile(alias, files.circuit.sha256));
  } finally { await f.close(); }
});

test('production denies unencrypted transport, redirected credential URLs, airdrops, wrong tree and genesis before spawn', async () => {
  const f = await syntheticArtifactFixture();
  try {
    for (const value of ['http://rpc.invalid', 'https://user:secret@rpc.invalid', 'https://rpc.invalid?api-key=secret', 'https://rpc.invalid#fragment']) {
      for (const field of ['rpcUrl', 'proverUrl'] as const) await assert.rejects(ProductionBridge.open({ ...f.options, configuration: { ...f.options.configuration, [field]: value } }, f.manifest, f.directory));
    }
    await assert.rejects(ProductionBridge.open({ ...f.options, fundingLamports: 1 } as ProductionBridgeOptions, f.manifest, f.directory), /airdrop_forbidden/);
    await assert.rejects(ProductionBridge.open({ ...f.options, configuration: { ...f.options.configuration, genesisHash: '7'.repeat(44) } }, f.manifest, f.directory), /genesis_mismatch/);
    await assert.rejects(ProductionBridge.open({ ...f.options, configuration: { ...f.options.configuration, treeId: 1 } }, f.manifest, f.directory), /tree_mismatch/);
    await assert.rejects(ProductionBridge.open({ ...f.options, indexer: { ...f.options.indexer, startSlot: '1' } }, f.manifest, f.directory), /indexer_history_mismatch/);
  } finally { await f.close(); }
});

test('production listeners require their declared TLS boundary and refuse mode confusion', async () => {
  let closed = false;
  const gateway = { mode: 'production', async fetch() { return new Response('fixture'); }, async close() { closed = true; } } as unknown as RingsGateway;
  await assert.rejects(listenLocalnetGateway(gateway), /requires_localnet/);
  await assert.rejects(listenProductionGateway({ mode: 'synthetic_localnet' } as RingsGateway, { mode: 'trusted_proxy', publicOrigin: 'https://gateway.invalid', port: 0 }), /requires_production/);
  await assert.rejects(listenProductionGateway(gateway, { mode: 'trusted_proxy', publicOrigin: 'http://gateway.invalid', port: 0 }));
  const listener = await listenProductionGateway(gateway, { mode: 'trusted_proxy', publicOrigin: 'https://gateway.invalid', port: 0 });
  assert.equal(listener.endpoint, 'https://gateway.invalid/v1/backrooms');
  const address = listener.server.address();
  assert.ok(address && typeof address !== 'string');
  assert.equal(address.address, '127.0.0.1');
  assert.equal(await (await fetch(`http://127.0.0.1:${address.port}/v1/backrooms`)).text(), 'fixture');
  await listener.close();
  assert.equal(closed, true);
});

test('release profiles preserve exact deployment inputs and refuse overwriting an existing profile', async () => {
  const f = await syntheticArtifactFixture();
  try {
    const identity: unknown = JSON.parse(f.bytes.get(f.manifest.runtime.identity.path)!.toString('utf8'));
    const output = join(f.directory, 'profile');
    await createDeploymentProfile(identity, output);
    assert.deepEqual(decodeDeploymentIdentity(JSON.parse(await readFile(join(output, 'deployment/identity.json'), 'utf8'))), identity);
    await assert.rejects(createDeploymentProfile(identity, output));
    const insecureSource = await readFile(new URL('../program/src/verifier/create_room.vk.rs', import.meta.url), 'utf8');
    await mkdir(join(f.source, 'verifiers'));
    await writeFile(join(f.source, 'verifiers/create_room.vk.rs'), insecureSource);
    const provenance = join(f.directory, 'provenance.txt');
    await writeFile(provenance, 'Unit test input, not qualified ceremony evidence.');
    await assert.rejects(createBuildInputs(f.source, provenance), /release_insecure_verifier/);
    await assert.rejects(readFile(join(f.source, 'build-inputs.json')));
  } finally { await f.close(); }
});

test('binary setup markers must cover every expected proving key and all be secure', () => {
  const key = '1'.repeat(64), other = '2'.repeat(64);
  const marker = (insecure: string, value: string) => Buffer.from(`=======BEGIN GROTH16 VK SETUP V1=======\0name\0VERIFYINGKEY\0insecure_test_setup\0${insecure}\0proving_key_sha256\0${value}\0=======END GROTH16 VK SETUP V1=======\0`);
  verifyProgramMarkers(Buffer.concat([marker('false', key), marker('false', other)]), [key, other]);
  assert.throws(() => verifyProgramMarkers(marker('true', key), [key]), /insecure/);
  assert.throws(() => verifyProgramMarkers(marker('false', key), [key, other]), /missing/);
  assert.throws(() => verifyProgramMarkers(Buffer.alloc(32), [key]), /missing/);
});

test('production rejects an indexer database from another genesis and releases failed-startup ownership', async () => {
  const f = await syntheticArtifactFixture();
  try {
    const compiled = { production: true, artifactVersion: f.manifest.artifactVersion, identitySha256: f.manifest.runtime.identity.sha256, schemaSha256: f.manifest.runtime.schema.sha256, programId: f.manifest.network.applicationProgramId, shieldedPoolProgramId: f.manifest.network.shieldedPoolProgramId, circuits: Object.fromEntries(Object.entries(f.manifest.circuits).map(([name, pins]) => [name, { ...pins, insecureTestSetup: false }])) };
    await writeFile(f.options.artifacts.bridge, `#!/usr/bin/env node\nconsole.log(${JSON.stringify(JSON.stringify(compiled))});\n`);
    f.manifest.runtime.bridgeSha256 = await digestBytes(new Uint8Array(await readFile(f.options.artifacts.bridge)));
    await writeFile(f.options.indexer.databasePath, '', { mode: 0o600 });
    await writeFile(`${f.options.indexer.databasePath}.identity.json`, JSON.stringify({ genesisHash: 'wrong-network' }), { mode: 0o600 });
    await assert.rejects(ProductionBridge.open(f.options, f.manifest, f.directory), /gateway_indexer_identity_mismatch/);
    assert.equal((await readdir(f.directory)).some(name => name.startsWith('rings-runtime-')), false);
    const ownership = RuntimeOwnership.acquire(`${f.options.indexer.databasePath}.runtime`);
    ownership.release();
    await rm(`${f.options.indexer.databasePath}.identity.json`);
    await assert.rejects(ProductionBridge.open(f.options, f.manifest, f.directory), /gateway_indexer_database_unqualified/);
    const signal = AbortSignal.abort();
    await assert.rejects(ProductionBridge.open(f.options, f.manifest, f.directory, signal), { name: 'AbortError' });
  } finally { await f.close(); }
});

test('strict owner-only production configuration resolves explicit secrets and rejects malformed inputs', async () => {
  const f = await syntheticArtifactFixture();
  try {
    const manifestPath = join(f.directory, 'release.json');
    await writeFile(manifestPath, JSON.stringify(f.manifest));
    const config = { version: 1, mode: 'production', databasePath: join(f.directory, 'gateway.sqlite'), releaseManifestFile: manifestPath, approvedManifestSha256: await digest(f.manifest), authenticationKeyEnvironment: 'RINGS_AUTH_KEY', storageKeys: { currentKeyRef: 'current', keys: { current: 'RINGS_STORAGE_KEY' } }, bridge: f.options, listener: { mode: 'trusted_proxy', port: 8783, publicOrigin: 'https://gateway.invalid' } };
    assert.deepEqual(decodeProductionGatewayConfiguration(config), config);
    for (const malformed of [{ ...config, mode: 'synthetic_localnet' }, { ...config, extra: true }, { ...config, databasePath: 'relative.sqlite' }, { ...config, authenticationKeyEnvironment: 'secret-value' }, { ...config, listener: { ...config.listener, publicOrigin: 'http://gateway.invalid' } }, { ...config, listener: { ...config.listener, publicOrigin: 'https://gateway.invalid/path' } }, { ...config, listener: { ...config.listener, host: '0.0.0.0' } }, { ...config, bridge: { ...config.bridge, fundingLamports: 1000 } }, { ...config, storageKeys: { ...config.storageKeys, currentKeyRef: 'absent' } }]) assert.throws(() => decodeProductionGatewayConfiguration(malformed));
    const configPath = join(f.directory, 'gateway.json');
    await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
    const resolved = await loadProductionGatewayConfiguration(configPath, { RINGS_AUTH_KEY: 'a'.repeat(64), RINGS_STORAGE_KEY: 'b'.repeat(64) });
    assert.equal(resolved.gateway.authenticationKey.length, 32);
    assert.equal(resolved.gateway.storageKeys.currentKeyRef, 'current');
    await assert.rejects(loadProductionGatewayConfiguration(configPath, {}), /gateway_secret_environment_invalid/);
    await chmod(configPath, 0o644);
    await assert.rejects(loadProductionGatewayConfiguration(configPath, {}), /gateway_configuration_permissions/);
    const alias = join(f.directory, 'config-alias.json');
    await symlink(configPath, alias);
    await assert.rejects(loadProductionGatewayConfiguration(alias, {}));
  } finally { await f.close(); }
});

test('malformed decimal fields return validation errors without native BigInt exceptions', async () => {
  const f = await syntheticArtifactFixture();
  try {
    const identity = JSON.parse(f.bytes.get(f.manifest.runtime.identity.path)!.toString('utf8')) as Record<string, unknown>;
    const configuration = { version: 1, mode: 'production', databasePath: join(f.directory, 'gateway.sqlite'), releaseManifestFile: join(f.directory, 'release.json'), approvedManifestSha256: await digest(f.manifest), authenticationKeyEnvironment: 'RINGS_AUTH_KEY', storageKeys: { currentKeyRef: 'current', keys: { current: 'RINGS_STORAGE_KEY' } }, bridge: f.options, listener: { mode: 'trusted_proxy', port: 8783, publicOrigin: 'https://gateway.invalid' } };
    const packet = (minimumConfirmedSlot: unknown) => ({ version: GATEWAY_VERSION, issuedAt: 0, nonce: '1'.repeat(64), kind: 'bridge', binding: { version: GATEWAY_VERSION, bindingId: '2'.repeat(64), scope: { ownerId: 'owner', projectId: 'project', roomId: 'room' }, creationId: 'creation', writerIdentity: '3'.repeat(44), keyRef: 'custody', artifactVersion: '1.0.0', releaseManifestSha256: '4'.repeat(64) }, request: { protocolVersion: 'backrooms.v0', operationId: 'recover', op: 'recover', input: { roomId: '5'.repeat(64), minimumConfirmedSlot } } });
    const validationError = (error: unknown) => error instanceof Error && error.name === 'ValiError';
    for (const value of ['abc', '', '+1', '-1', '01', '1.5', '1e3', ' 1 ', '0x10', '18446744073709551616', '9'.repeat(1000), 1, null, undefined]) {
      const manifest = { ...f.manifest, runtime: { ...f.manifest.runtime, indexer: { ...f.manifest.runtime.indexer, startSlot: value } } };
      assert.deepEqual(productionBlockers(manifest), ['invalid_manifest']);
      assert.throws(() => decodeReleaseManifest(manifest), validationError);
      assert.throws(() => decodeDeploymentIdentity({ ...identity, deployment: value }), validationError);
      assert.throws(() => decodeProductionGatewayConfiguration({ ...configuration, bridge: { ...configuration.bridge, indexer: { ...configuration.bridge.indexer, startSlot: value } } }), validationError);
      assert.throws(() => parseGatewayRequest(packet(value)), { name: 'Error', message: 'gateway_invalid_request' });
    }
    for (const value of ['0', '1', '18446744073709551615']) {
      const manifest = { ...f.manifest, runtime: { ...f.manifest.runtime, indexer: { ...f.manifest.runtime.indexer, startSlot: value } } };
      assert.deepEqual(productionBlockers(manifest), []);
      assert.equal(decodeProductionGatewayConfiguration({ ...configuration, bridge: { ...configuration.bridge, indexer: { ...configuration.bridge.indexer, startSlot: value } } }).bridge.indexer.startSlot, value);
      const decoded = parseGatewayRequest(packet(value));
      assert.equal(decoded.kind, 'bridge');
      if (decoded.kind !== 'bridge' || decoded.request.op !== 'recover') throw new Error('fixture');
      assert.equal(decoded.request.input.minimumConfirmedSlot, value);
      if (value === '0') assert.throws(() => decodeDeploymentIdentity({ ...identity, deployment: value }), validationError);
      else assert.equal(decodeDeploymentIdentity({ ...identity, deployment: value }).deployment, value);
    }
    for (const malformed of [undefined, null, {}, { ...f.manifest, runtime: null }]) assert.deepEqual(productionBlockers(malformed), ['invalid_manifest']);
  } finally { await f.close(); }
});
