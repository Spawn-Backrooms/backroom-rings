import { randomHex } from '../../client/codec.js';
import { PROTOCOL_VERSION, type EpisodeBinding, type RecoveredRoom } from '../../client/contracts.js';
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
      policy: { policyId: '1', scores: [50, 50] }, slot: '1', signature: 'test-signature',
      seedManifestCommitment: host.residents.seedCommitment, fixedMembersCommitment: host.residents.membershipCommitment,
      writerIdentity: 'test-writer', artifactVersion: 'backrooms.localnet.v0',
    };
    const binding: EpisodeBinding = { roomId, episodeId: 'process-recovery', episodeCommitment: randomHex(), predecessor: room.checkpoint, ordinal: '1', minimumConfirmedSlot: '1', residentIds: host.residents.residentIds };
    await host.records.create('process-test-context', { binding, room });
    retained = await host.records.read('process-test-context');
  }
  if (!retained) throw new Error('test_context_missing');
  const result = await host.residents.run(retained.value.binding, retained.value.room);
  process.stdout.write(`${JSON.stringify({ status: 'completed', inferenceCalls: host.residents.inferenceCalls, residentIds: host.residents.residentIds, originalResultCommitment: result.originalResultCommitment })}\n`);
  if (mode === 'hold') {
    for await (const chunk of process.stdin) { if (String(chunk).includes('stop')) break; }
  }
} catch (error) {
  if (mode !== 'probe' || !(error instanceof Error) || error.message !== 'private_runtime_already_owned') throw error;
  process.stdout.write(`${JSON.stringify({ status: 'refused', reason: error.message, inferenceCalls: 0 })}\n`);
} finally { await host?.close(); }
