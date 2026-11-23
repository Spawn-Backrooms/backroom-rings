import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import test from 'node:test';
import { digest, digestBytes, randomHex, record } from '../client/codec.js';
import { AuthenticatedRingsGatewayClient, type GatewayEnrollment } from '../client/gateway.js';
import { RingsClient } from '../client/rings-client.js';
import { LocalnetRingsGateway, type LocalnetGatewayOptions } from '../gateway-host/host.js';
import { listenLocalnetGateway } from '../gateway-host/server.js';

const configurationPath = process.env.BACKROOM_GATEWAY_LOCALNET_CONFIG;
const executable = process.env.BACKROOM_RINGS_BRIDGE;

test('authenticated gateway creates two actual Rings rooms and advances accepted memory across restart', { skip: !configurationPath || !executable, timeout: 1_800_000 }, async () => {
  assert.ok(configurationPath && executable && isAbsolute(configurationPath) && isAbsolute(executable));
  const metadata = await stat(configurationPath);
  assert.equal(metadata.isFile() && (metadata.mode & 0o077) === 0, true, 'localnet operator config must be owner-only');
  const configuration = record(JSON.parse(await readFile(configurationPath, 'utf8')));
  const directory = await mkdtemp(join(tmpdir(), 'rings-live-gateway-'));
  const authenticationKey = crypto.getRandomValues(new Uint8Array(32));
  const oldKey = crypto.getRandomValues(new Uint8Array(32));
  const newKey = crypto.getRandomValues(new Uint8Array(32));
  const manifest = JSON.parse(await readFile(new URL('../releases/development.json', import.meta.url), 'utf8')) as unknown;
  const releaseManifestSha256 = await digest(manifest);
  const text = (key: string) => { const value = configuration[key]; assert.equal(typeof value, 'string', `missing localnet ${key}`); return value as string; };
  assert.equal(typeof configuration.treeId, 'number');
  const options: LocalnetGatewayOptions = {
    mode: 'synthetic_localnet', databasePath: join(directory, 'gateway.sqlite'), authenticationKey,
    storageKeys: { currentKeyRef: 'localnet-host-v1', keys: { 'localnet-host-v1': oldKey } },
    releaseManifest: manifest, releaseManifestSha256,
    bridge: {
      executable, binarySha256: await digestBytes(new Uint8Array(await readFile(executable))), fundingLamports: 2_000_000_000,
      configuration: {
        rpcUrl: text('rpcUrl'), indexerUrl: text('indexerUrl'), proverUrl: text('proverUrl'), treeAddress: text('treeAddress'),
        treeId: configuration.treeId as number, artifactsDirectory: text('artifactsDirectory'), genesisHash: text('genesisHash'),
        programBinarySha256: text('programBinarySha256'), shieldedPoolBinarySha256: text('shieldedPoolBinarySha256'),
      },
    },
  };
  let listener: Awaited<ReturnType<typeof listenLocalnetGateway>> | undefined;
  const open = async (storageKeys = options.storageKeys) => {
    listener = await listenLocalnetGateway(await LocalnetRingsGateway.open({ ...options, storageKeys }));
    return new AuthenticatedRingsGatewayClient({ endpoint: listener.endpoint, authenticationKey, mode: 'synthetic_localnet' });
  };
  const enrollment = (roomId: string): GatewayEnrollment => ({ scope: { ownerId: 'localnet-owner', projectId: 'localnet-project', roomId }, creationId: randomHex(), creationNonce: randomHex(), seedManifestCommitment: randomHex(), fixedMembersCommitment: randomHex(), releaseManifestSha256 });
  try {
    let client = await open();
    const a = enrollment('actual-room-a');
    const b = enrollment('actual-room-b');
    const bindingA = await client.bind(a);
    const bindingB = await client.bind(b);
    assert.notEqual(bindingA.writerIdentity, bindingB.writerIdentity);
    assert.notEqual(bindingA.keyRef, bindingB.keyRef);
    let ringsA = new RingsClient(client.transport(bindingA), bindingA.artifactVersion);
    let ringsB = new RingsClient(client.transport(bindingB), bindingB.artifactVersion);
    const create = async (rings: RingsClient, input: GatewayEnrollment) => {
      const prepared = await rings.prepareCreate('create', { creationNonce: input.creationNonce, seedManifestCommitment: input.seedManifestCommitment, fixedMembersCommitment: input.fixedMembersCommitment });
      const submission = await rings.submit(prepared);
      assert.equal(submission.status, 'confirmed');
      if (submission.status !== 'confirmed') throw new Error('live_creation_unconfirmed');
      const room = await rings.recover('recover-create', prepared.checkpoint.roomId, submission.slot);
      assert.equal(room.status, 'recovered');
      if (room.status !== 'recovered') throw new Error('live_creation_unrecovered');
      assert.deepEqual(room.checkpoint, prepared.checkpoint);
      assert.equal(room.memory.lesson, '');
      return { prepared, room };
    };
    const createdA = await create(ringsA, a);
    const createdB = await create(ringsB, b);
    assert.notEqual(createdA.room.checkpoint.roomId, createdB.room.checkpoint.roomId);
    assert.notEqual(createdA.room.checkpoint.uniqueAddress, createdB.room.checkpoint.uniqueAddress);
    assert.equal(createdA.room.writerIdentity, bindingA.writerIdentity);
    assert.equal(createdB.room.writerIdentity, bindingB.writerIdentity);
    await assert.rejects(ringsB.submit(createdA.prepared), /gateway_frame_not_retained/);
    await assert.rejects(ringsB.recover('cross-room', createdA.room.checkpoint.roomId), /gateway_room_mismatch/);
    await listener!.close();
    listener = undefined;
    client = await open({ currentKeyRef: 'localnet-host-v2', keys: { 'localnet-host-v1': oldKey, 'localnet-host-v2': newKey } });
    assert.deepEqual(await client.bind(a), bindingA);
    assert.deepEqual(await client.bind(b), bindingB);
    ringsA = new RingsClient(client.transport(bindingA), bindingA.artifactVersion);
    ringsB = new RingsClient(client.transport(bindingB), bindingB.artifactVersion);
    const restoredB = await ringsB.recover('restored-b', createdB.room.checkpoint.roomId, createdB.room.slot);
    assert.equal(restoredB.status, 'recovered');
    if (restoredB.status === 'recovered') assert.deepEqual(restoredB.checkpoint, createdB.room.checkpoint);
    const lesson = 'Use the accepted private checkpoint.';
    const advance = await ringsA.prepareAdvance('accepted-episode', {
      roomId: createdA.room.checkpoint.roomId, expectedPredecessor: createdA.room.checkpoint.stateCommitment,
      ordinal: '1', minimumConfirmedSlot: createdA.room.slot, acceptanceNonce: randomHex(), episodeCommitment: randomHex(),
      originalResultCommitment: randomHex(), candidateCommitment: randomHex(), lesson, selectedProcedure: 0, feedback: { negative: true, magnitude: 10 },
    });
    const accepted = await ringsA.submit(advance);
    assert.equal(accepted.status, 'confirmed');
    if (accepted.status !== 'confirmed') throw new Error('live_advance_unconfirmed');
    const recovered = await ringsA.recover('accepted-memory', createdA.room.checkpoint.roomId, accepted.slot);
    assert.equal(recovered.status, 'recovered');
    if (recovered.status === 'recovered') {
      assert.equal(recovered.memory.lesson, lesson);
      assert.equal(recovered.checkpoint.revision, '1');
      assert.deepEqual(recovered.policy.scores, [40, 50]);
      assert.equal(recovered.writerIdentity, bindingA.writerIdentity);
      assert.ok(BigInt(recovered.contextSlot) >= BigInt(accepted.slot));
    }
    await access(options.databasePath);
  } finally { await listener?.close(); await rm(directory, { recursive: true, force: true }); }
});
