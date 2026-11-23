import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { canonicalJson, digest, digestBytes, randomHex, utf8 } from '../client/codec.js';
import { PROTOCOL_VERSION, type AdvanceRoomInput, type PreparedTransaction } from '../client/contracts.js';
import { AuthenticatedRingsGatewayClient, type GatewayBinding, type GatewayEnrollment } from '../client/gateway.js';
import { GATEWAY_VERSION, gatewayAuthenticationKey, gatewayMac } from '../client/gateway-protocol.js';
import { RingsClient } from '../client/rings-client.js';
import { LocalnetRingsGateway, type LocalnetGatewayOptions } from '../gateway-host/host.js';
import { listenLocalnetGateway } from '../gateway-host/server.js';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'rings-gateway-'));
  const artifacts = join(directory, 'synthetic-chain');
  await mkdir(artifacts);
  const authenticationKey = crypto.getRandomValues(new Uint8Array(32));
  const oldKey = crypto.getRandomValues(new Uint8Array(32));
  const newKey = crypto.getRandomValues(new Uint8Array(32));
  const manifest = JSON.parse(await readFile(new URL('../releases/development.json', import.meta.url), 'utf8')) as unknown;
  const releaseManifestSha256 = await digest(manifest);
  const balances = new Map<string, number>();
  const airdrops: string[] = [];
  let genesis = '11111111111111111111111111111111';
  const rpc = createServer(async (request, response) => {
    let data = '';
    for await (const chunk of request) data += String(chunk);
    const { method, params, id } = JSON.parse(data) as { method: string; params: unknown[]; id: number };
    let result: unknown;
    if (method === 'getGenesisHash') result = genesis;
    else if (method === 'getBalance') result = { context: { slot: 1 }, value: balances.get(String(params[0])) ?? 0 };
    else if (method === 'requestAirdrop') { airdrops.push(String(params[0])); balances.set(String(params[0]), Number(params[1])); result = 'fixture-airdrop-signature'; }
    else throw new Error(`unexpected_fixture_rpc:${method}`);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
  });
  await new Promise<void>(resolve => rpc.listen(0, '127.0.0.1', resolve));
  const address = rpc.address();
  assert.ok(address && typeof address !== 'string');
  const endpoint = `http://127.0.0.1:${address.port}`;
  const executable = fileURLToPath(new URL('./fixtures/gateway-bridge.mjs', import.meta.url));
  const options: LocalnetGatewayOptions = {
    mode: 'synthetic_localnet', databasePath: join(directory, 'gateway.sqlite'), authenticationKey,
    storageKeys: { currentKeyRef: 'host-v1', keys: { 'host-v1': oldKey } },
    releaseManifest: manifest, releaseManifestSha256,
    bridge: {
      executable, binarySha256: await digestBytes(new Uint8Array(await readFile(executable))), fundingLamports: 100_000_000,
      configuration: { rpcUrl: endpoint, indexerUrl: endpoint, proverUrl: endpoint, treeAddress: '11111111111111111111111111111111', treeId: 0, artifactsDirectory: artifacts, genesisHash: genesis, programBinarySha256: randomHex(), shieldedPoolBinarySha256: randomHex() },
    },
  };
  let listener: Awaited<ReturnType<typeof listenLocalnetGateway>> | undefined;
  const start = async (keys = options.storageKeys) => {
    listener = await listenLocalnetGateway(await LocalnetRingsGateway.open({ ...options, storageKeys: keys }));
    return new AuthenticatedRingsGatewayClient({ endpoint: listener.endpoint, authenticationKey, mode: 'synthetic_localnet' });
  };
  const client = await start();
  return {
    directory, artifacts, options, oldKey, newKey, authenticationKey, airdrops, client,
    get endpoint() { return listener!.endpoint; },
    setGenesis(value: string) { genesis = value; },
    enrollment(roomId: string): GatewayEnrollment { return { scope: { ownerId: 'owner-1', projectId: 'project-1', roomId }, creationId: `creation/${roomId}`, creationNonce: randomHex(), seedManifestCommitment: randomHex(), fixedMembersCommitment: randomHex(), releaseManifestSha256 }; },
    rings(binding: GatewayBinding, selectedClient = client) { return new RingsClient(selectedClient.transport(binding), binding.artifactVersion); },
    async controls(value: unknown) { await writeFile(join(artifacts, 'controls.json'), JSON.stringify(value)); },
    async calls() { try { return (await readFile(join(artifacts, 'calls.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { op: string; writer: string; configPath: string }); } catch { return []; } },
    async restart(keys = options.storageKeys) { await listener!.close(); listener = undefined; return start(keys); },
    async close() { await listener?.close(); await new Promise<void>((resolve, reject) => rpc.close(error => error ? reject(error) : resolve())); await rm(directory, { recursive: true, force: true }); },
  };
}

function proposal(prepared: PreparedTransaction): AdvanceRoomInput {
  return { roomId: prepared.checkpoint.roomId, expectedPredecessor: prepared.checkpoint.stateCommitment, ordinal: '1', minimumConfirmedSlot: '101', acceptanceNonce: randomHex(), episodeCommitment: randomHex(), originalResultCommitment: randomHex(), candidateCommitment: randomHex(), lesson: 'Keep the accepted assumption.', selectedProcedure: 0, feedback: { negative: true, magnitude: 10 } };
}

test('gateway scopes independent writers, persists enrollment and frames, and recovers fresh evidence after restart', async () => {
  const f = await fixture();
  try {
    const first = f.enrollment('room-a');
    const second = f.enrollment('room-b');
    const [a, b] = await Promise.all([f.client.bind(first), f.client.bind(second)]);
    assert.notEqual(a.writerIdentity, b.writerIdentity);
    assert.notEqual(a.keyRef, b.keyRef);
    assert.deepEqual(await f.client.bind(first), a);
    const ringsA = f.rings(a);
    const ringsB = f.rings(b);
    const creation = (input: GatewayEnrollment) => ({ creationNonce: input.creationNonce, seedManifestCommitment: input.seedManifestCommitment, fixedMembersCommitment: input.fixedMembersCommitment });
    const preparedA = await ringsA.prepareCreate('create', creation(first));
    const preparedB = await ringsB.prepareCreate('create', creation(second));
    assert.notEqual(preparedA.checkpoint.roomId, preparedB.checkpoint.roomId);
    let callCount = (await f.calls()).length;
    await assert.rejects(ringsB.submit(preparedA), /gateway_frame_not_retained/);
    await assert.rejects(ringsB.recover('cross-room', preparedA.checkpoint.roomId), /gateway_room_mismatch/);
    await assert.rejects(f.client.transport({ ...a, scope: second.scope }).request({ protocolVersion: PROTOCOL_VERSION, operationId: 'cross-binding', op: 'submit', input: { transactionBase64: preparedA.transactionBase64, transactionDigest: preparedA.transactionDigest } }), /gateway_binding_mismatch/);
    assert.equal((await f.calls()).length, callCount);
    assert.equal((await ringsA.submit(preparedA)).status, 'confirmed');
    const before = await ringsA.recover('fresh-a', preparedA.checkpoint.roomId, '101');
    assert.equal(before.status, 'recovered');
    const reopened = await f.restart({ currentKeyRef: 'host-v2', keys: { 'host-v1': f.oldKey, 'host-v2': f.newKey } });
    assert.deepEqual(await reopened.bind(first), a);
    const restored = f.rings(a, reopened);
    assert.deepEqual(await restored.prepareCreate('create', creation(first)), preparedA);
    const after = await restored.recover('fresh-a', preparedA.checkpoint.roomId, '101');
    assert.equal(after.status, 'recovered');
    if (before.status !== 'recovered' || after.status !== 'recovered') throw new Error('fixture_recovery_missing');
    assert.ok(BigInt(after.contextSlot) > BigInt(before.contextSlot));
    const advance = proposal(preparedA);
    const preparedAdvance = await restored.prepareAdvance('advance', advance);
    assert.equal((await restored.submit(preparedAdvance)).status, 'confirmed');
    const accepted = await restored.recover('accepted', preparedA.checkpoint.roomId, '102');
    assert.equal(accepted.status, 'recovered');
    if (accepted.status === 'recovered') assert.equal(accepted.memory.lesson, advance.lesson);
    callCount = (await f.calls()).length;
    await assert.rejects(restored.prepareAdvance('advance', { ...advance, lesson: 'A changed lesson.' }), /gateway_preparation_conflict/);
    await assert.rejects(reopened.bind({ ...first, creationNonce: randomHex() }), /gateway_enrollment_conflict/);
    await assert.rejects(reopened.bind({ ...first, releaseManifestSha256: randomHex() }), /gateway_release_mismatch/);
    assert.equal((await f.calls()).length, callCount);
    assert.deepEqual(new Set(f.airdrops), new Set([a.writerIdentity, b.writerIdentity]));
    for (const call of await f.calls()) await assert.rejects(access(call.configPath));
    for (const name of await readdir(f.directory)) {
      if (!name.startsWith('gateway.sqlite') || name.endsWith('.runtime')) continue;
      const bytes = await readFile(join(f.directory, name));
      assert.equal(bytes.includes(Buffer.from(advance.lesson)), false);
      assert.equal(bytes.includes(Buffer.from(a.writerIdentity)), false);
      assert.equal(bytes.includes(Buffer.from(first.creationNonce)), false);
    }
  } finally { await f.close(); }
});

test('gateway authenticates exact bytes, persists replay rejection and denies caller-supplied configuration', async () => {
  const f = await fixture();
  try {
    const key = await gatewayAuthenticationKey(f.authenticationKey);
    const packet = { version: GATEWAY_VERSION, kind: 'bind', issuedAt: Date.now(), nonce: randomHex(), enrollment: f.enrollment('auth-room') };
    const send = async (value: unknown, sign = true, signedBytes?: Uint8Array<ArrayBuffer>) => {
      const body = utf8(canonicalJson(value));
      return fetch(f.endpoint, { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-backrooms-auth': sign ? await gatewayMac(key, 'request', signedBytes ?? body) : '0'.repeat(64) } });
    };
    assert.equal((await send(packet, false)).status, 401);
    assert.equal((await send({ ...packet, issuedAt: Date.now() - 60_001 })).status, 409);
    assert.equal((await send({ ...packet, configuration: { signerSeedHex: randomHex() } })).status, 409);
    assert.equal((await send({ ...packet, nonce: randomHex() }, true, utf8(canonicalJson(packet)))).status, 401);
    assert.equal((await send(packet)).status, 200);
    assert.equal((await send(packet)).status, 409);
    await f.restart();
    const replay = await send(packet);
    assert.equal(replay.status, 409);
    assert.equal((await replay.json() as { code: string }).code, 'gateway_request_replayed');
    assert.equal((await f.calls()).length, 0);
  } finally { await f.close(); }
});

test('gateway client refuses unauthenticated or cross-request responses and unsafe endpoints', async () => {
  const f = await fixture();
  try {
    assert.throws(() => new AuthenticatedRingsGatewayClient({ endpoint: f.endpoint, authenticationKey: f.authenticationKey, mode: 'production' }), /gateway_https_required/);
    assert.throws(() => new AuthenticatedRingsGatewayClient({ endpoint: 'http://example.com/v1/backrooms', authenticationKey: f.authenticationKey, mode: 'synthetic_localnet' }), /gateway_loopback_required/);
    assert.throws(() => new AuthenticatedRingsGatewayClient({ endpoint: 'https://user:password@example.com/v1/backrooms', authenticationKey: f.authenticationKey, mode: 'production' }), /invalid_gateway_endpoint/);
    const tampered = new AuthenticatedRingsGatewayClient({ endpoint: f.endpoint, authenticationKey: f.authenticationKey, mode: 'synthetic_localnet', fetch: async (input, init) => {
      const response = await fetch(input, init);
      return new Response((await response.text()).replace('owner-1', 'owner-2'), { status: response.status, headers: response.headers });
    } });
    await assert.rejects(tampered.bind(f.enrollment('tampered')), /gateway_response_unauthenticated/);
    let retained: Response | undefined;
    const crossed = new AuthenticatedRingsGatewayClient({ endpoint: f.endpoint, authenticationKey: f.authenticationKey, mode: 'synthetic_localnet', fetch: async (input, init) => {
      if (retained) return retained.clone();
      retained = await fetch(input, init);
      return retained.clone();
    } });
    const enrollment = f.enrollment('cross-response');
    await crossed.bind(enrollment);
    await assert.rejects(crossed.bind(enrollment), /gateway_response_request_mismatch/);
  } finally { await f.close(); }
});

test('missing historical custody keys and corrupt ciphertext cannot regenerate a room writer', async () => {
  const f = await fixture();
  try {
    const enrollment = f.enrollment('key-history');
    const binding = await f.client.bind(enrollment);
    let client = await f.restart({ currentKeyRef: 'host-v2', keys: { 'host-v2': f.newKey } });
    await assert.rejects(client.bind(enrollment), /gateway_historical_storage_key_missing/);
    client = await f.restart({ currentKeyRef: 'host-v2', keys: { 'host-v1': f.oldKey, 'host-v2': f.newKey } });
    assert.deepEqual(await client.bind(enrollment), binding);
    const database = new DatabaseSync(f.options.databasePath);
    database.prepare('UPDATE gateway_records SET envelope = ? WHERE record_key = ?').run('{}', `enrollment/${binding.bindingId}`);
    database.close();
    await assert.rejects(client.bind(enrollment), /gateway_operation_failed/);
    assert.equal((await f.calls()).length, 0);
  } finally { await f.close(); }
});

test('a lost preparation and reframe acknowledgment resumes exact retained frames without another proof', async () => {
  const f = await fixture();
  try {
    const enrollment = f.enrollment('lost-ack');
    const binding = await f.client.bind(enrollment);
    let lose: string | undefined = 'prepare_create';
    const unreliable = new AuthenticatedRingsGatewayClient({ endpoint: f.endpoint, authenticationKey: f.authenticationKey, mode: 'synthetic_localnet', fetch: async (input, init) => {
      const request = JSON.parse(new TextDecoder().decode(init!.body as Uint8Array)) as { request?: { op: string } };
      const response = await fetch(input, init);
      if (request.request?.op === lose) { lose = undefined; await response.arrayBuffer(); throw new Error('fixture_lost_acknowledgment'); }
      return response;
    } });
    const rings = f.rings(binding, unreliable);
    const creation = { creationNonce: enrollment.creationNonce, seedManifestCommitment: enrollment.seedManifestCommitment, fixedMembersCommitment: enrollment.fixedMembersCommitment };
    await assert.rejects(rings.prepareCreate('create', creation), /fixture_lost_acknowledgment/);
    const prepared = await rings.prepareCreate('create', creation);
    assert.equal((await f.calls()).filter(call => call.op === 'prepare_create').length, 1);
    await f.controls({ expireOriginal: true });
    assert.equal((await rings.submit(prepared)).status, 'expired');
    lose = 'reframe';
    await assert.rejects(rings.reframe(prepared), /fixture_lost_acknowledgment/);
    const client = await f.restart();
    const restored = f.rings(binding, client);
    const replacement = await restored.reframe(prepared);
    assert.equal(replacement.status, 'reframed');
    if (replacement.status !== 'reframed') throw new Error('fixture_replacement_missing');
    assert.equal((await f.calls()).filter(call => call.op === 'reframe').length, 1);
    assert.equal(replacement.parentTransactionDigest, prepared.transactionDigest);
    const next = { ...prepared, transactionBase64: replacement.transactionBase64, transactionDigest: replacement.transactionDigest };
    assert.equal((await restored.submit(next)).status, 'confirmed');
    assert.equal((await restored.submit(next)).status, 'confirmed');
    const state = JSON.parse(await readFile(join(f.artifacts, `${binding.writerIdentity}.json`), 'utf8')) as { applications: number };
    assert.equal(state.applications, 1);
    const accepted = await restored.recover('restored', prepared.checkpoint.roomId, '101');
    assert.equal(accepted.status, 'recovered');
  } finally { await f.close(); }
});

test('pending recovery and wrong recovered custody cannot authorize reframing or memory delivery', async () => {
  const f = await fixture();
  try {
    const enrollment = f.enrollment('recovery-fences');
    const binding = await f.client.bind(enrollment);
    const rings = f.rings(binding);
    const prepared = await rings.prepareCreate('create', { creationNonce: enrollment.creationNonce, seedManifestCommitment: enrollment.seedManifestCommitment, fixedMembersCommitment: enrollment.fixedMembersCommitment });
    await f.controls({ recoveryPending: true });
    await assert.rejects(rings.reframe(prepared), /gateway_recovery_pending/);
    assert.equal((await f.calls()).filter(call => call.op === 'reframe').length, 0);
    await f.controls({});
    await rings.submit(prepared);
    for (const controls of [{ wrongWriter: true }, { wrongMembership: true }]) {
      await f.controls(controls);
      await assert.rejects(rings.recover('wrong-identity', prepared.checkpoint.roomId), /gateway_recovery_binding_mismatch/);
    }
  } finally { await f.close(); }
});

test('localnet funding verifies pinned genesis and custody startup removes abandoned private process configurations', async () => {
  const f = await fixture();
  try {
    await assert.rejects(LocalnetRingsGateway.open(f.options), /private_runtime_already_owned/);
    const enrollment = f.enrollment('genesis-fence');
    const binding = await f.client.bind(enrollment);
    f.setGenesis('different-localnet');
    await assert.rejects(f.rings(binding).prepareCreate('create', { creationNonce: enrollment.creationNonce, seedManifestCommitment: enrollment.seedManifestCommitment, fixedMembersCommitment: enrollment.fixedMembersCommitment }), /gateway_localnet_genesis_mismatch/);
    assert.equal(f.airdrops.length, 0);
    assert.equal((await f.calls()).length, 0);
    const abandoned = join(`${f.options.databasePath}.runtime`, 'rings-bridge-abandoned');
    await mkdir(abandoned, { mode: 0o700 });
    await writeFile(join(abandoned, 'config.json'), JSON.stringify({ signerSeedHex: randomHex() }), { mode: 0o600 });
    await f.restart();
    await assert.rejects(access(abandoned));
    assert.deepEqual(await new AuthenticatedRingsGatewayClient({ endpoint: f.endpoint, authenticationKey: f.authenticationKey, mode: 'synthetic_localnet' }).bind(enrollment), binding);
  } finally { await f.close(); }
});
