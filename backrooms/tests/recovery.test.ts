import assert from 'node:assert/strict';
import test from 'node:test';
import { randomHex } from '../client/codec.js';
import { PROTOCOL_VERSION } from '../client/contracts.js';
import { RingsClient } from '../client/rings-client.js';

const artifactVersion = 'backrooms.localnet.v0';

function recovered(slot = '100', contextSlot: unknown = '110') {
  const zero = '0'.repeat(64);
  return {
    protocolVersion: PROTOCOL_VERSION, operationId: 'recovery', status: 'recovered',
    checkpoint: { roomId: randomHex(), uniqueAddress: randomHex(), stateCommitment: randomHex(), revision: '0' },
    memory: { lesson: '', episodeCommitment: zero, originalResultCommitment: zero, candidateCommitment: zero, predecessorCommitment: zero, authorizationCommitment: zero },
    policy: { policyId: '1', scores: [50, 50] }, slot, contextSlot, signature: 'fixture-signature',
    seedManifestCommitment: randomHex(), fixedMembersCommitment: randomHex(), writerIdentity: 'fixture-writer', artifactVersion,
  };
}

test('a complete fresh scan recovers a checkpoint created before the requested watermark', async () => {
  const room = recovered();
  const client = new RingsClient({ request: async () => room }, artifactVersion);
  const result = await client.recover('recovery', room.checkpoint.roomId, '110');
  assert.equal(result.status, 'recovered');
  if (result.status !== 'recovered') throw new Error('expected_recovered_room');
  assert.equal(result.slot, '100');
  assert.equal(result.contextSlot, '110');
});

test('recovery requires a fresh scan watermark even when the checkpoint slot meets the request', async () => {
  const room = recovered('110', '109');
  const client = new RingsClient({ request: async () => room }, artifactVersion);
  await assert.rejects(client.recover('recovery', room.checkpoint.roomId, '110'), /indexer_below_confirmed_slot/);
});

test('a checkpoint cannot be newer than the complete recovery snapshot', async () => {
  const room = recovered('111', '110');
  const client = new RingsClient({ request: async () => room }, artifactVersion);
  await assert.rejects(client.recover('recovery', room.checkpoint.roomId, '110'), /checkpoint_after_recovery_context/);
});

test('a complete absent-state result retains its scan watermark', async () => {
  const client = new RingsClient({ request: async () => ({ protocolVersion: PROTOCOL_VERSION, operationId: 'recovery', status: 'not_found', contextSlot: '110' }) }, artifactVersion);
  assert.deepEqual(await client.recover('recovery', randomHex(), '110'), { protocolVersion: PROTOCOL_VERSION, operationId: 'recovery', status: 'not_found', contextSlot: '110' });
});

test('an absent-state result below the requested watermark is not evidence for a new genesis', async () => {
  const client = new RingsClient({ request: async () => ({ protocolVersion: PROTOCOL_VERSION, operationId: 'recovery', status: 'not_found', contextSlot: '109' }) }, artifactVersion);
  await assert.rejects(client.recover('recovery', randomHex(), '110'), /indexer_below_confirmed_slot/);
});

for (const contextSlot of [undefined, 110, '0110', '18446744073709551616']) {
  for (const status of ['recovered', 'not_found']) {
    test(`${status} rejects a noncanonical scan watermark ${String(contextSlot)}`, async () => {
      const room = { ...recovered('110'), contextSlot, status };
      const client = new RingsClient({ request: async () => room }, artifactVersion);
      await assert.rejects(client.recover('recovery', room.checkpoint.roomId, '110'), /invalid_u64/);
    });
  }
}

test('pending recovery makes no completed-scan claim', async () => {
  const pending = { protocolVersion: PROTOCOL_VERSION, operationId: 'recovery', status: 'pending' };
  const client = new RingsClient({ request: async () => pending }, artifactVersion);
  assert.deepEqual(await client.recover('recovery', randomHex(), '110'), pending);
});

test('recovery freshness compares canonical u64 values without rounding', async () => {
  const room = recovered('9007199254740992', '9007199254740993');
  const client = new RingsClient({ request: async () => room }, artifactVersion);
  assert.equal((await client.recover('recovery', room.checkpoint.roomId, '9007199254740993')).status, 'recovered');
  await assert.rejects(client.recover('recovery', room.checkpoint.roomId, '9007199254740994'), /indexer_below_confirmed_slot/);
});
