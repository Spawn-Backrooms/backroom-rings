import { assertDigest, assertIdentifier, assertInteger, assertLesson, assertU64, digestBytes, fromBase64, record } from './codec.js';
import { PROTOCOL_VERSION, type AdvanceRoomInput, type BridgeRequest, type Checkpoint, type ConfirmedTransaction, type CreateRoomInput, type ExpiredTransaction, type PreparedTransaction, type RecoveredRoom, type ReframedTransaction, type RingsTransport, type UnknownTransaction, type UnrecoveredRoom } from './contracts.js';
import { isRingsErrorCode, RingsOperationError } from './errors.js';

function parseCheckpoint(value: unknown): Checkpoint {
  const item = record(value);
  assertDigest(item.roomId);
  assertDigest(item.uniqueAddress);
  assertDigest(item.stateCommitment);
  assertU64(item.revision);
  return { roomId: item.roomId, uniqueAddress: item.uniqueAddress, stateCommitment: item.stateCommitment, revision: item.revision };
}

function response(value: unknown, operationId: string): Record<string, unknown> {
  const item = record(value);
  if (item.protocolVersion !== PROTOCOL_VERSION || item.operationId !== operationId) throw new Error('bridge_response_binding_mismatch');
  if (item.status === 'error') {
    const error = record(item.error);
    if (!isRingsErrorCode(error.code)) throw new Error('invalid_bridge_error');
    throw new RingsOperationError(error.code);
  }
  return item;
}

function assertProposal(input: AdvanceRoomInput): void {
  assertDigest(input.acceptanceNonce);
  if (input.acceptanceNonce === '0'.repeat(64)) throw new Error('invalid_acceptance_nonce');
  assertDigest(input.roomId);
  assertDigest(input.expectedPredecessor);
  assertDigest(input.episodeCommitment);
  assertDigest(input.originalResultCommitment);
  assertDigest(input.candidateCommitment);
  assertU64(input.ordinal);
  assertU64(input.minimumConfirmedSlot);
  if (input.ordinal === '0') throw new Error('invalid_ordinal');
  assertInteger(input.selectedProcedure, 0, 1);
  assertInteger(input.feedback.magnitude, 0, 10);
  if (typeof input.feedback.negative !== 'boolean') throw new Error('invalid_feedback');
  assertLesson(input.lesson);
  if (input.lesson.length === 0) throw new Error('empty_lesson');
}

export class RingsClient {
  constructor(private readonly transport: RingsTransport, readonly artifactVersion: string) {
    assertIdentifier(artifactVersion);
  }

  private async call(request: BridgeRequest): Promise<Record<string, unknown>> {
    assertIdentifier(request.operationId);
    return response(await this.transport.request(request), request.operationId);
  }

  private async prepared(request: BridgeRequest): Promise<PreparedTransaction> {
    const item = await this.call(request);
    if (item.status !== 'prepared' || item.artifactVersion !== this.artifactVersion) throw new Error('unqualified_bridge_artifacts');
    assertDigest(item.transactionDigest);
    if (typeof item.transactionBase64 !== 'string') throw new Error('invalid_prepared_transaction');
    const bytes = fromBase64(item.transactionBase64);
    if (bytes.length === 0 || await digestBytes(bytes) !== item.transactionDigest) throw new Error('prepared_transaction_digest_mismatch');
    const checkpoint = parseCheckpoint(item.checkpoint);
    const proofs = record(item.proofs);
    assertDigest(proofs.applicationProofDigest);
    assertDigest(proofs.privateTxHash);
    const authorization = request.op === 'prepare_advance' ? item.authorizationCommitment : undefined;
    if (request.op === 'prepare_advance') assertDigest(authorization);
    return {
      protocolVersion: PROTOCOL_VERSION, operationId: request.operationId, status: 'prepared',
      transactionBase64: item.transactionBase64, transactionDigest: item.transactionDigest, checkpoint,
      proofs: { applicationProofDigest: proofs.applicationProofDigest, privateTxHash: proofs.privateTxHash }, artifactVersion: this.artifactVersion,
      ...(typeof authorization === 'string' ? { authorizationCommitment: authorization } : {}),
    };
  }

  async prepareCreate(operationId: string, input: CreateRoomInput): Promise<PreparedTransaction> {
    assertDigest(input.creationNonce);
    assertDigest(input.seedManifestCommitment);
    assertDigest(input.fixedMembersCommitment);
    const prepared = await this.prepared({ protocolVersion: PROTOCOL_VERSION, operationId, op: 'prepare_create', input });
    if (prepared.checkpoint.revision !== '0') throw new Error('invalid_genesis_revision');
    return prepared;
  }

  async prepareAdvance(operationId: string, input: AdvanceRoomInput): Promise<PreparedTransaction> {
    assertProposal(input);
    const prepared = await this.prepared({ protocolVersion: PROTOCOL_VERSION, operationId, op: 'prepare_advance', input });
    if (prepared.checkpoint.roomId !== input.roomId || prepared.checkpoint.revision !== input.ordinal) throw new Error('prepared_state_binding_mismatch');
    return prepared;
  }

  async submit(prepared: PreparedTransaction): Promise<ConfirmedTransaction | UnknownTransaction | ExpiredTransaction> {
    if (prepared.protocolVersion !== PROTOCOL_VERSION || prepared.artifactVersion !== this.artifactVersion || await digestBytes(fromBase64(prepared.transactionBase64)) !== prepared.transactionDigest) throw new Error('prepared_transaction_changed');
    const item = await this.call({ protocolVersion: PROTOCOL_VERSION, operationId: prepared.operationId, op: 'submit', input: { transactionBase64: prepared.transactionBase64, transactionDigest: prepared.transactionDigest } });
    if (item.status !== 'confirmed' && item.status !== 'unknown' && item.status !== 'expired') throw new Error('invalid_submission_status');
    assertIdentifier(item.signature);
    const common = { protocolVersion: PROTOCOL_VERSION, operationId: prepared.operationId, signature: item.signature };
    if (item.status === 'unknown') return { ...common, status: 'unknown' };
    if (item.status === 'expired') return { ...common, status: 'expired' };
    assertU64(item.slot);
    return { ...common, status: 'confirmed', slot: item.slot };
  }

  async reframe(prepared: PreparedTransaction): Promise<ReframedTransaction | ConfirmedTransaction | UnknownTransaction> {
    if (prepared.protocolVersion !== PROTOCOL_VERSION || prepared.artifactVersion !== this.artifactVersion || await digestBytes(fromBase64(prepared.transactionBase64)) !== prepared.transactionDigest) throw new Error('prepared_transaction_changed');
    const item = await this.call({ protocolVersion: PROTOCOL_VERSION, operationId: prepared.operationId, op: 'reframe', input: { transactionBase64: prepared.transactionBase64, transactionDigest: prepared.transactionDigest } });
    assertIdentifier(item.signature);
    const common = { protocolVersion: PROTOCOL_VERSION, operationId: prepared.operationId, signature: item.signature };
    if (item.status === 'unknown') return { ...common, status: 'unknown' };
    if (item.status === 'confirmed') {
      assertU64(item.slot);
      return { ...common, status: 'confirmed', slot: item.slot };
    }
    if (item.status !== 'reframed' || item.parentTransactionDigest !== prepared.transactionDigest || typeof item.transactionBase64 !== 'string') throw new Error('reframed_transaction_binding_mismatch');
    assertDigest(item.transactionDigest);
    const bytes = fromBase64(item.transactionBase64);
    if (bytes.length === 0 || item.transactionDigest === prepared.transactionDigest || await digestBytes(bytes) !== item.transactionDigest) throw new Error('reframed_transaction_digest_mismatch');
    return { ...common, status: 'reframed', transactionBase64: item.transactionBase64, transactionDigest: item.transactionDigest, parentTransactionDigest: prepared.transactionDigest };
  }

  async recover(operationId: string, roomId: string, minimumConfirmedSlot = '0'): Promise<RecoveredRoom | UnrecoveredRoom> {
    assertDigest(roomId);
    assertU64(minimumConfirmedSlot);
    const item = await this.call({ protocolVersion: PROTOCOL_VERSION, operationId, op: 'recover', input: { roomId, minimumConfirmedSlot } });
    if (item.status === 'not_found' || item.status === 'pending') return { protocolVersion: PROTOCOL_VERSION, operationId, status: item.status };
    if (item.status !== 'recovered') throw new Error('invalid_recovery_status');
    const checkpoint = parseCheckpoint(item.checkpoint);
    if (checkpoint.roomId !== roomId) throw new Error('recovered_room_mismatch');
    assertU64(item.slot);
    if (BigInt(item.slot) < BigInt(minimumConfirmedSlot)) throw new Error('indexer_below_confirmed_slot');
    assertIdentifier(item.signature);
    assertIdentifier(item.writerIdentity);
    assertDigest(item.seedManifestCommitment);
    assertDigest(item.fixedMembersCommitment);
    if (item.artifactVersion !== this.artifactVersion) throw new Error('recovered_artifacts_mismatch');
    const memory = record(item.memory);
    assertLesson(memory.lesson);
    for (const key of ['episodeCommitment', 'originalResultCommitment', 'candidateCommitment', 'predecessorCommitment', 'authorizationCommitment'] as const) assertDigest(memory[key]);
    const policy = record(item.policy);
    if (policy.policyId !== '1' || !Array.isArray(policy.scores) || policy.scores.length !== 2) throw new Error('invalid_policy');
    assertInteger(policy.scores[0], 0, 100);
    assertInteger(policy.scores[1], 0, 100);
    return {
      protocolVersion: PROTOCOL_VERSION, operationId, status: 'recovered', checkpoint,
      memory: memory as unknown as RecoveredRoom['memory'], policy: { policyId: '1', scores: [policy.scores[0], policy.scores[1]] }, slot: item.slot, signature: item.signature,
      seedManifestCommitment: item.seedManifestCommitment, fixedMembersCommitment: item.fixedMembersCommitment,
      writerIdentity: item.writerIdentity, artifactVersion: this.artifactVersion,
    };
  }
}
