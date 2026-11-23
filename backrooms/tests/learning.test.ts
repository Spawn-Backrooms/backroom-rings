import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { base64, digest, digestBytes, randomHex, utf8 } from '../client/codec.js';
import { PROTOCOL_VERSION, type AdvanceRoomInput, type BridgeRequest, type EpisodeBinding, type OriginalResult, type PreparedTransaction, type RecoveredRoom, type RingsTransport } from '../client/contracts.js';
import { LearningCoordinator } from '../client/learning.js';
import { RingsClient } from '../client/rings-client.js';
import { ReferenceAuthority } from '../reference-host/authority.js';
import { EncryptedSqliteRecords } from '../reference-host/records.js';

test('proof failures and state conflicts retain the original result and one blinded authorization', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'backrooms-learning-'));
  const records = await EncryptedSqliteRecords.open(join(directory, 'records.sqlite'), crypto.getRandomValues(new Uint8Array(32)), 'test-host');
  try {
    const roomId = randomHex();
    const zero = '0'.repeat(64);
    const room: RecoveredRoom = {
      protocolVersion: PROTOCOL_VERSION, operationId: 'injected-recovery-fixture', status: 'recovered',
      checkpoint: { roomId, uniqueAddress: randomHex(), stateCommitment: randomHex(), revision: '0' },
      memory: { lesson: '', episodeCommitment: zero, originalResultCommitment: zero, candidateCommitment: zero, predecessorCommitment: zero, authorizationCommitment: zero },
      policy: { policyId: '1', scores: [50, 50] }, slot: '9007199254740992', contextSlot: '9007199254740992', signature: 'fixture-signature',
      seedManifestCommitment: randomHex(), fixedMembersCommitment: randomHex(), writerIdentity: 'fixture-writer', artifactVersion: 'backrooms.localnet.v0',
    };
    const binding: EpisodeBinding = { roomId, episodeId: 'retained-episode', episodeCommitment: await digest({ episode: 'retained' }), predecessor: room.checkpoint, ordinal: '1', minimumConfirmedSlot: room.slot, residentIds: ['investigator', 'critic'] };
    const original: OriginalResult = { episodeId: binding.episodeId, originalResultCommitment: randomHex(), candidateCommitment: randomHex(), investigator: 'captured candidate', critic: 'captured feedback', proposal: { lesson: 'Keep the original.', selectedProcedure: 0, feedback: { negative: true, magnitude: 10 } } };
    const requests: BridgeRequest[] = [];
    let errorCode = 'proof_failed';
    const transport: RingsTransport = { request: async request => {
      requests.push(request);
      return { protocolVersion: PROTOCOL_VERSION, operationId: request.operationId, status: 'error', error: { code: errorCode } };
    } };
    let inferenceCalls = 0;
    const authority = new ReferenceAuthority(records);
    const diagnostics: unknown[] = [];
    const coordinator = new LearningCoordinator(authority, { run: async () => { inferenceCalls++; return original; } }, new RingsClient(transport, 'backrooms.localnet.v0'), records, event => diagnostics.push(event));
    assert.equal((await coordinator.run(binding, room)).status, 'commit_pending');
    assert.equal((await coordinator.run(binding, room)).status, 'commit_pending');
    errorCode = 'state_conflict';
    const conflicted = await coordinator.run(binding, room);
    assert.equal(conflicted.status, 'state_conflict');
    assert.deepEqual(conflicted.originalResult, original);
    assert.equal(inferenceCalls, 1);
    assert.equal(requests.length, 3);
    assert.deepEqual(requests[0], requests[1]);
    assert.deepEqual(requests[1], requests[2]);
    const grant = await authority.authorizeAcceptance(binding, original);
    assert.match(grant.acceptanceNonce, /^[0-9a-f]{64}$/);
    assert.notEqual(grant.acceptanceNonce, zero);
    assert.equal(JSON.stringify(diagnostics).includes(original.proposal.lesson), false);
    await assert.rejects(authority.resolveEpisode({ ...binding, predecessor: { ...binding.predecessor, stateCommitment: randomHex() } }), /identity_reused/);
    await assert.rejects(authority.authorizeAcceptance({ ...binding, ordinal: '2' }, original), /authorization_replay/);
  } finally { records.close(); await rm(directory, { recursive: true, force: true }); }
});

test('the bridge boundary rejects lossy u64 input and an answer for a different operation', async () => {
  let invoked = false;
  const client = new RingsClient({ request: async () => { invoked = true; return { protocolVersion: PROTOCOL_VERSION, operationId: 'different', status: 'not_found' }; } }, 'backrooms.localnet.v0');
  await assert.rejects(client.recover('recover', randomHex(), 9007199254740992 as unknown as string), /invalid_u64/);
  assert.equal(invoked, false);
  await assert.rejects(client.recover('recover', randomHex(), '9007199254740993'), /binding_mismatch/);
});

test('a client protocol fixture reconciles a lost submission acknowledgement and retains the accepted receipt', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'backrooms-receipt-'));
  const key = crypto.getRandomValues(new Uint8Array(32));
  let records = await EncryptedSqliteRecords.open(join(directory, 'records.sqlite'), key, 'test-host');
  try {
    const roomId = randomHex();
    const zero = '0'.repeat(64);
    const room: RecoveredRoom = {
      protocolVersion: PROTOCOL_VERSION, operationId: 'injected-protocol-fixture', status: 'recovered',
      checkpoint: { roomId, uniqueAddress: randomHex(), stateCommitment: randomHex(), revision: '0' },
      memory: { lesson: '', episodeCommitment: zero, originalResultCommitment: zero, candidateCommitment: zero, predecessorCommitment: zero, authorizationCommitment: zero },
      policy: { policyId: '1', scores: [50, 50] }, slot: '1', contextSlot: '1', signature: 'unit-fixture-signature',
      seedManifestCommitment: randomHex(), fixedMembersCommitment: randomHex(), writerIdentity: 'unit-fixture-writer', artifactVersion: 'backrooms.localnet.v0',
    };
    const binding: EpisodeBinding = { roomId, episodeId: 'receipt-episode', episodeCommitment: randomHex(), predecessor: room.checkpoint, ordinal: '1', minimumConfirmedSlot: '1', residentIds: ['investigator', 'critic'] };
    const original: OriginalResult = { episodeId: binding.episodeId, originalResultCommitment: randomHex(), candidateCommitment: randomHex(), investigator: 'captured', critic: 'reviewed', proposal: { lesson: 'Keep this result.', selectedProcedure: 0, feedback: { negative: true, magnitude: 10 } } };
    const bytes = utf8('client-protocol-unit-fixture; not a Solana transaction or proof');
    let prepared: PreparedTransaction | undefined;
    let acceptedInput: AdvanceRoomInput | undefined;
    let requests = 0;
    let laterRoom: RecoveredRoom | undefined;
    const transport: RingsTransport = { request: async request => {
      requests++;
      if (request.op === 'prepare_advance') {
        acceptedInput = request.input;
        prepared = { protocolVersion: PROTOCOL_VERSION, operationId: request.operationId, status: 'prepared', transactionBase64: base64(bytes), transactionDigest: await digestBytes(bytes), checkpoint: { ...room.checkpoint, stateCommitment: randomHex(), revision: '1' }, proofs: { applicationProofDigest: randomHex(), privateTxHash: randomHex() }, artifactVersion: room.artifactVersion, authorizationCommitment: randomHex() };
        return prepared;
      }
      if (request.op === 'submit') throw new Error('injected_lost_acknowledgement');
      if (request.op !== 'recover' || !prepared || !acceptedInput) throw new Error('unexpected_fixture_request');
      if (laterRoom) return { ...laterRoom, operationId: request.operationId };
      return { ...room, operationId: request.operationId, checkpoint: prepared.checkpoint, slot: '2', contextSlot: '2', policy: { policyId: '1', scores: [40, 50] }, memory: { lesson: acceptedInput.lesson, episodeCommitment: acceptedInput.episodeCommitment, originalResultCommitment: acceptedInput.originalResultCommitment, candidateCommitment: acceptedInput.candidateCommitment, predecessorCommitment: acceptedInput.expectedPredecessor, authorizationCommitment: prepared.authorizationCommitment } };
    } };
    let modelCalls = 0;
    let coordinator = new LearningCoordinator(new ReferenceAuthority(records), { run: async () => { modelCalls++; return original; } }, new RingsClient(transport, room.artifactVersion), records);
    assert.equal((await coordinator.run(binding, room)).status, 'accepted');
    assert.equal(requests, 3);
    records.close();
    records = await EncryptedSqliteRecords.open(join(directory, 'records.sqlite'), key, 'test-host');
    laterRoom = { ...room, checkpoint: { ...room.checkpoint, stateCommitment: randomHex(), revision: '2' }, slot: '3', contextSlot: '3', policy: { policyId: '1', scores: [40, 60] } };
    coordinator = new LearningCoordinator(new ReferenceAuthority(records), { run: async () => { modelCalls++; return original; } }, new RingsClient(transport, room.artifactVersion), records);
    const recoveredReceipt = await coordinator.run(binding, laterRoom);
    assert.equal(recoveredReceipt.status, 'accepted');
    if (recoveredReceipt.status === 'accepted') assert.equal(recoveredReceipt.room.checkpoint.revision, '1');
    assert.equal(requests, 3, 'a retained accepted receipt must survive restart and later state changes without another submission');
    assert.equal(modelCalls, 1);
  } finally { records.close(); await rm(directory, { recursive: true, force: true }); }
});
