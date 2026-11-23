import { canonicalJson } from './codec.js';
import type { AcceptanceAuthorization, DiagnosticSink, EpisodeAuthority, EpisodeBinding, LearningOutcome, OriginalResult, PreparedTransaction, PriorTransactionFrame, PrivateRecordStore, RecoveredRoom, ResidentRuntime } from './contracts.js';
import { RingsClient } from './rings-client.js';
import { RingsOperationError } from './errors.js';

interface CommitRecord {
  authorization: AcceptanceAuthorization;
  prepared: PreparedTransaction;
  phase: 'prepared' | 'submitted';
  minimumConfirmedSlot: string;
  priorFrames?: PriorTransactionFrame[];
}

interface Reconciliation { outcome: LearningOutcome; predecessorAvailable: boolean }

export interface AcceptanceReceipt { authorization: AcceptanceAuthorization; room: RecoveredRoom }

export class LearningCoordinator {
  constructor(
    private readonly authority: EpisodeAuthority,
    private readonly runtime: ResidentRuntime,
    private readonly rings: RingsClient,
    private readonly records: PrivateRecordStore,
    private readonly diagnostic: DiagnosticSink = () => {},
  ) {}

  async run(request: EpisodeBinding, room: RecoveredRoom): Promise<LearningOutcome> {
    const binding = await this.authority.resolveEpisode(request);
    let original = await this.authority.getOriginalResult(binding.episodeId);
    if (!original) {
      if (canonicalJson(binding.predecessor) !== canonicalJson(room.checkpoint)) throw new Error('episode_predecessor_changed');
      original = await this.authority.captureOriginalResult(binding, await this.runtime.run(binding, room));
      this.diagnostic({ event: 'episode_captured', operationId: binding.episodeId, revision: room.checkpoint.revision });
    }
    const authorization = await this.authority.authorizeAcceptance(binding, original);
    if (authorization.episodeId !== binding.episodeId || authorization.roomId !== binding.roomId || authorization.expectedPredecessor !== binding.predecessor.stateCommitment || authorization.ordinal !== binding.ordinal || authorization.episodeCommitment !== binding.episodeCommitment || authorization.originalResultCommitment !== original.originalResultCommitment || authorization.candidateCommitment !== original.candidateCommitment) throw new Error('acceptance_binding_mismatch');
    return this.accept(authorization, original);
  }

  private async accept(authorization: AcceptanceAuthorization, original: OriginalResult, reframesRemaining = 1): Promise<LearningOutcome> {
    const { operationId } = authorization;
    const receipt = await this.records.read<AcceptanceReceipt>(`receipt/${operationId}`);
    if (receipt) {
      if (canonicalJson(receipt.value.authorization) !== canonicalJson(authorization) || receipt.value.room.artifactVersion !== this.rings.artifactVersion) throw new Error('retained_receipt_binding_mismatch');
      return { status: 'accepted', originalResult: original, room: receipt.value.room };
    }
    const key = `commit/${operationId}`;
    let entry = await this.records.read<CommitRecord>(key);
    let commit = entry?.value;
    if (commit && canonicalJson(commit.authorization) !== canonicalJson(authorization)) throw new Error('acceptance_authorization_changed');
    if (!commit) {
      let prepared: PreparedTransaction;
      try {
        const { episodeId: _episodeId, operationId: _operationId, ...input } = authorization;
        prepared = await this.rings.prepareAdvance(operationId, input);
      } catch (error) {
        if (error instanceof RingsOperationError && error.code === 'state_conflict') return { status: 'state_conflict', originalResult: original, operationId };
        return { status: 'commit_pending', originalResult: original, operationId, reason: 'prepare_failed' };
      }
      await this.records.create(key, { authorization, prepared, phase: 'prepared', minimumConfirmedSlot: authorization.minimumConfirmedSlot } satisfies CommitRecord);
      entry = await this.records.read<CommitRecord>(key);
      commit = entry?.value;
      if (!commit || canonicalJson(commit.authorization) !== canonicalJson(authorization)) throw new Error('commit_journal_conflict');
      this.diagnostic({ event: 'transaction_prepared', operationId, revision: prepared.checkpoint.revision });
    }
    if (commit.phase === 'submitted') {
      const recovered = await this.reconcile(commit, original, commit.minimumConfirmedSlot);
      if (recovered.outcome.status !== 'commit_pending') return recovered.outcome;
    }

    if (!entry || !await this.records.replace(key, entry.version, { ...commit, phase: 'submitted' } satisfies CommitRecord)) {
      return { status: 'commit_pending', originalResult: original, operationId, reason: 'submission_unknown' };
    }
    let minimumSlot = commit.minimumConfirmedSlot;
    let submitted;
    try {
      submitted = await this.rings.submit(commit.prepared);
      if (submitted.status === 'confirmed') {
        if (BigInt(submitted.slot) > BigInt(minimumSlot)) minimumSlot = submitted.slot;
        await this.retainConfirmedSlot(key, commit, minimumSlot);
      }
      else if (submitted.status === 'unknown') this.diagnostic({ event: 'submission_unknown', operationId });
    } catch {
      this.diagnostic({ event: 'submission_unknown', operationId });
    }
    const reconciled = await this.reconcile(commit, original, minimumSlot);
    if (submitted?.status === 'expired' && reconciled.predecessorAvailable) {
      if (reframesRemaining === 0) return { status: 'commit_pending', originalResult: original, operationId, reason: 'transaction_expired' };
      return this.reframe(commit, original, submitted.signature, reframesRemaining);
    }
    return reconciled.outcome;
  }

  private async reframe(commit: CommitRecord, original: OriginalResult, expiredSignature: string, reframesRemaining: number): Promise<LearningOutcome> {
    const { authorization, prepared } = commit;
    const operationId = authorization.operationId;
    const pending: LearningOutcome = { status: 'commit_pending', originalResult: original, operationId, reason: 'transaction_expired' };
    let reframed;
    try { reframed = await this.rings.reframe(prepared); }
    catch { return pending; }
    if (reframed.status === 'unknown') return { ...pending, reason: 'submission_unknown' };
    const key = `commit/${operationId}`;
    if (reframed.status === 'confirmed') {
      await this.retainConfirmedSlot(key, commit, reframed.slot);
      return (await this.reconcile(commit, original, reframed.slot)).outcome;
    }
    const current = await this.records.read<CommitRecord>(key);
    if (!current || current.value.prepared.transactionDigest !== prepared.transactionDigest || canonicalJson(current.value.authorization) !== canonicalJson(authorization)) return pending;
    const replacement: CommitRecord = {
      ...current.value,
      prepared: { ...current.value.prepared, transactionBase64: reframed.transactionBase64, transactionDigest: reframed.transactionDigest },
      priorFrames: [...(current.value.priorFrames ?? []), { transactionBase64: prepared.transactionBase64, transactionDigest: prepared.transactionDigest, signature: expiredSignature }],
      phase: 'prepared',
    };
    try {
      if (!await this.records.replace(key, current.version, replacement)) return pending;
    } catch { return pending; }
    return this.accept(authorization, original, reframesRemaining - 1);
  }

  private async retainConfirmedSlot(key: string, expected: CommitRecord, slot: string): Promise<void> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await this.records.read<CommitRecord>(key);
      if (!current || canonicalJson(current.value.authorization) !== canonicalJson(expected.authorization)) throw new Error('commit_journal_changed');
      if (current.value.prepared.transactionDigest !== expected.prepared.transactionDigest && !current.value.priorFrames?.some(frame => frame.transactionDigest === expected.prepared.transactionDigest)) throw new Error('commit_frame_changed');
      if (BigInt(current.value.minimumConfirmedSlot) >= BigInt(slot)) return;
      if (await this.records.replace(key, current.version, { ...current.value, minimumConfirmedSlot: slot })) return;
    }
    throw new Error('commit_journal_busy');
  }

  private async reconcile(commit: CommitRecord, original: OriginalResult, minimumSlot = '0'): Promise<Reconciliation> {
    const { authorization, prepared } = commit;
    const operationId = authorization.operationId;
    const pending: Reconciliation = { outcome: { status: 'commit_pending', originalResult: original, operationId, reason: 'recovery_pending' }, predecessorAvailable: false };
    let recovered;
    try {
      recovered = await this.rings.recover(`${operationId}/recover`, prepared.checkpoint.roomId, minimumSlot);
    } catch {
      return pending;
    }
    if (recovered.status !== 'recovered') return pending;
    if (recovered.checkpoint.stateCommitment === prepared.checkpoint.stateCommitment && recovered.checkpoint.uniqueAddress === prepared.checkpoint.uniqueAddress && recovered.checkpoint.revision === authorization.ordinal && recovered.memory.episodeCommitment === authorization.episodeCommitment && recovered.memory.originalResultCommitment === authorization.originalResultCommitment && recovered.memory.candidateCommitment === authorization.candidateCommitment && recovered.memory.predecessorCommitment === authorization.expectedPredecessor && recovered.memory.authorizationCommitment === prepared.authorizationCommitment && recovered.memory.lesson === authorization.lesson) {
      await this.records.create(`receipt/${operationId}`, { authorization, room: recovered });
      this.diagnostic({ event: 'state_recovered', operationId, revision: recovered.checkpoint.revision });
      return { outcome: { status: 'accepted', originalResult: original, room: recovered }, predecessorAvailable: false };
    }
    if (recovered.checkpoint.stateCommitment !== authorization.expectedPredecessor) return { outcome: { status: 'state_conflict', originalResult: original, operationId }, predecessorAvailable: false };
    return { ...pending, predecessorAvailable: true };
  }
}
