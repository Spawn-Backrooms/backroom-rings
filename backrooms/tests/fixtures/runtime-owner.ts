import assert from 'node:assert/strict';
import { base64, canonicalJson, digestBytes, randomHex, utf8 } from '../../client/codec.js';
import { PROTOCOL_VERSION, type AcceptanceAuthorization, type BridgeRequest, type EpisodeBinding, type PreparedTransaction, type RecoveredRoom } from '../../client/contracts.js';
import { LearningCoordinator } from '../../client/learning.js';
import { RingsClient } from '../../client/rings-client.js';
import { ReferenceAuthority } from '../../reference-host/authority.js';
import { ReferenceHost } from '../../reference-host/host.js';

const mode = process.argv[2];
const directory = process.argv[3];
if (!directory) throw new Error('test_directory_required');
let host: ReferenceHost | undefined;
try {
  host = await ReferenceHost.open({ directory, transport: { request: async () => { throw new Error('no_chain_in_this_runtime_ownership_test'); } } });
  let retained = await host.records.read<{ binding: EpisodeBinding; room: RecoveredRoom }>('process-test-context');
  if (!retained) {
    const zero = '0'.repeat(64);
    const roomId = randomHex();
    const room: RecoveredRoom = {
      protocolVersion: PROTOCOL_VERSION, operationId: 'injected-process-state', status: 'recovered',
      checkpoint: { roomId, uniqueAddress: randomHex(), stateCommitment: randomHex(), revision: '0' },
      memory: { lesson: '', episodeCommitment: zero, originalResultCommitment: zero, candidateCommitment: zero, predecessorCommitment: zero, authorizationCommitment: zero },
      policy: { policyId: '1', scores: [50, 50] }, slot: '1', contextSlot: '1', signature: 'test-signature',
      seedManifestCommitment: host.residents.seedCommitment, fixedMembersCommitment: host.residents.membershipCommitment,
      writerIdentity: 'test-writer', artifactVersion: 'backrooms.localnet.v0',
    };
    const binding: EpisodeBinding = { roomId, episodeId: 'process-recovery', episodeCommitment: randomHex(), predecessor: room.checkpoint, ordinal: '1', minimumConfirmedSlot: '1', residentIds: host.residents.residentIds };
    await host.records.create('process-test-context', { binding, room });
    retained = await host.records.read('process-test-context');
  }
  if (!retained) throw new Error('test_context_missing');
  const { binding, room } = retained.value;
  const authority = new ReferenceAuthority(host.records);
  await authority.resolveEpisode(binding);
  if (mode === 'recover-fresh-context') {
    const observation = { ...room, operationId: 'fresh-process-recovery', contextSlot: (BigInt(room.contextSlot) + 1n).toString() };
    let prepared: PreparedTransaction | undefined;
    let accepted: RecoveredRoom | undefined;
    const bridgeOperations: BridgeRequest['op'][] = [];
    const rings = new RingsClient({ request: async request => {
      bridgeOperations.push(request.op);
      const envelope = { protocolVersion: PROTOCOL_VERSION, operationId: request.operationId };
      if (request.op === 'prepare_advance') {
        const bytes = utf8('TEST TRANSPORT ONLY: no chain transaction or proof');
        const authorizationCommitment = randomHex();
        const checkpoint = { ...room.checkpoint, stateCommitment: randomHex(), revision: request.input.ordinal };
        prepared = { ...envelope, status: 'prepared', transactionBase64: base64(bytes), transactionDigest: await digestBytes(bytes), checkpoint, proofs: { applicationProofDigest: randomHex(), privateTxHash: randomHex() }, authorizationCommitment, artifactVersion: room.artifactVersion };
        accepted = {
          ...observation, checkpoint, slot: observation.contextSlot, signature: 'fixture-accepted-signature', policy: { policyId: '1', scores: [40, 50] },
          memory: { lesson: request.input.lesson, episodeCommitment: request.input.episodeCommitment, originalResultCommitment: request.input.originalResultCommitment, candidateCommitment: request.input.candidateCommitment, predecessorCommitment: request.input.expectedPredecessor, authorizationCommitment },
        };
        return prepared;
      }
      assert.ok(prepared);
      assert.ok(accepted);
      if (request.op === 'submit') {
        assert.equal(request.input.transactionDigest, prepared.transactionDigest);
        return { ...envelope, status: 'confirmed', slot: accepted.slot, signature: accepted.signature };
      }
      assert.equal(request.op, 'recover');
      return { ...accepted, ...envelope };
    } }, room.artifactVersion);
    const coordinator = new LearningCoordinator(authority, host.residents, rings, host.records);
    const outcome = await coordinator.run(binding, observation);
    assert.equal(outcome.status, 'accepted');
    assert.deepEqual(await coordinator.run(binding, observation), outcome);
    const authorization = (await host.records.read<AcceptanceAuthorization>(`authorization/${binding.episodeId}`))?.value;
    assert.ok(authorization);
    const receipt = await host.records.read(`receipt/${authorization.operationId}`);
    process.stdout.write(`${JSON.stringify({ status: outcome.status, inferenceCalls: host.residents.inferenceCalls, originalResultCommitment: outcome.originalResult.originalResultCommitment, receiptRetained: Boolean(receipt), contextUnchanged: canonicalJson((await host.records.read(`context/${binding.episodeId}`))?.value) === canonicalJson(retained.value), bridgeOperations })}\n`);
  } else {
    const result = await host.residents.run(binding, room);
    process.stdout.write(`${JSON.stringify({ status: 'completed', inferenceCalls: host.residents.inferenceCalls, residentIds: host.residents.residentIds, originalResultCommitment: result.originalResultCommitment, originalCaptured: Boolean(await host.records.read(`original/${binding.episodeId}`)) })}\n`);
  }
  if (mode === 'hold') {
    for await (const chunk of process.stdin) { if (String(chunk).includes('stop')) break; }
  }
} catch (error) {
  if (mode !== 'probe' || !(error instanceof Error) || error.message !== 'private_runtime_already_owned') throw error;
  process.stdout.write(`${JSON.stringify({ status: 'refused', reason: error.message, inferenceCalls: 0 })}\n`);
} finally { await host?.close(); }
