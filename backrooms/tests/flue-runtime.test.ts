import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { digest, randomHex } from '../client/codec.js';
import { PROTOCOL_VERSION, type EpisodeBinding, type RecoveredRoom } from '../client/contracts.js';
import { residentIds } from '../flue/seeds.js';
import { EncryptedSqliteRecords } from '../reference-host/records.js';
import { FlueResidents } from '../reference-host/residents.js';

test('real Flue residents recover settled submissions and use an injected accepted-state fixture', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'backrooms-flue-'));
  const key = crypto.getRandomValues(new Uint8Array(32));
  const records = await EncryptedSqliteRecords.open(join(directory, 'records.sqlite'), key, 'test-host');
  const identities = await residentIds(randomHex());
  let runtime = await FlueResidents.start({ directory, records, masterKey: key, residentIds: identities });
  try {
    const zero = '0'.repeat(64);
    const roomId = randomHex();
    const room: RecoveredRoom = {
      protocolVersion: PROTOCOL_VERSION, operationId: 'injected-test-state', status: 'recovered',
      checkpoint: { roomId, uniqueAddress: randomHex(), stateCommitment: randomHex(), revision: '0' },
      memory: { lesson: '', episodeCommitment: zero, originalResultCommitment: zero, candidateCommitment: zero, predecessorCommitment: zero, authorizationCommitment: zero },
      policy: { policyId: '1', scores: [50, 50] }, slot: '1', contextSlot: '1', signature: 'test-signature',
      seedManifestCommitment: runtime.seedCommitment, fixedMembersCommitment: runtime.membershipCommitment, writerIdentity: 'test-writer', artifactVersion: 'backrooms.localnet.v0',
    };
    const binding: EpisodeBinding = { roomId, episodeId: 'first', episodeCommitment: await digest({ episode: 'first' }), predecessor: room.checkpoint, ordinal: '1', minimumConfirmedSlot: '1', residentIds: identities };
    const first = await runtime.run(binding, room);
    assert.equal(JSON.parse(first.investigator).selectedProcedure, 0);
    assert.equal(JSON.parse(first.investigator).value, 9);
    assert.deepEqual(first.proposal.feedback, { negative: true, magnitude: 10 });
    assert.equal(runtime.inferenceCalls, 4);
    await runtime.stop();
    runtime = await FlueResidents.start({ directory, records, masterKey: key, residentIds: identities });
    const recovered = await runtime.run(binding, room);
    assert.deepEqual(recovered, first);
    assert.equal(runtime.inferenceCalls, 0, 'settled Flue submissions must be recovered without another model call');
    const changedCheckpoint = { ...room.checkpoint, stateCommitment: randomHex() };
    const changedContexts: Array<{ name: string; binding: EpisodeBinding; room: RecoveredRoom }> = [
      { name: 'episode binding', binding: { ...binding, episodeCommitment: randomHex() }, room },
      { name: 'checkpoint', binding: { ...binding, predecessor: changedCheckpoint }, room: { ...room, checkpoint: changedCheckpoint } },
      { name: 'memory provenance', binding, room: { ...room, memory: { ...room.memory, candidateCommitment: randomHex() } } },
      { name: 'lesson', binding, room: { ...room, memory: { ...room.memory, lesson: 'Use a different lesson.' } } },
      { name: 'policy', binding, room: { ...room, policy: { policyId: '1', scores: [40, 50] } } },
      { name: 'writer', binding, room: { ...room, writerIdentity: 'another-writer' } },
      { name: 'checkpoint slot', binding, room: { ...room, slot: '2' } },
      { name: 'signature', binding, room: { ...room, signature: 'another-signature' } },
      { name: 'artifact', binding, room: { ...room, artifactVersion: 'another-artifact' } },
      { name: 'seed manifest', binding, room: { ...room, seedManifestCommitment: randomHex() } },
      { name: 'membership', binding, room: { ...room, fixedMembersCommitment: randomHex() } },
    ];
    for (const changed of changedContexts) {
      await assert.rejects(runtime.run(changed.binding, changed.room), /episode_context_changed|resident_room_binding_mismatch/, changed.name);
    }
    assert.equal(runtime.inferenceCalls, 0);
    for (const observation of [
      { ...room, contextSlot: '2' },
      { ...room, operationId: 'another-recovery' },
      { ...room, contextSlot: '3', operationId: 'latest-recovery' },
    ]) {
      assert.deepEqual(await runtime.run(binding, observation), first);
    }
    assert.equal(runtime.inferenceCalls, 0);
    assert.deepEqual((await records.read(`context/${binding.episodeId}`))?.value, { binding, room });
    const updated: RecoveredRoom = { ...room, checkpoint: { ...room.checkpoint, stateCommitment: randomHex(), revision: '1' }, memory: { ...room.memory, lesson: first.proposal.lesson }, policy: { policyId: '1', scores: [40, 50] } };
    const second = await runtime.run({ ...binding, episodeId: 'second', episodeCommitment: await digest({ episode: 'second' }), predecessor: updated.checkpoint, ordinal: '2' }, updated);
    assert.equal(JSON.parse(second.investigator).selectedProcedure, 1);
    assert.equal(JSON.parse(second.investigator).value, 5);
    assert.equal(JSON.parse(second.investigator).lessonUsed, first.proposal.lesson);
    const encryptedDatabase = await readFile(join(directory, 'records.sqlite'));
    assert.equal(encryptedDatabase.includes(Buffer.from(first.proposal.lesson)), false);
  } finally {
    await runtime.stop();
    records.close();
    await rm(directory, { recursive: true, force: true });
  }
});
