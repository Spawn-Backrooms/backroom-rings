import { assertDigest, assertInteger, assertLesson, assertU64, canonicalJson, digest, randomHex } from '../client/codec.js';
import type { AcceptanceAuthorization, EpisodeAuthority, EpisodeBinding, OriginalResult, PrivateRecordStore } from '../client/contracts.js';

export class ReferenceAuthority implements EpisodeAuthority {
  constructor(private readonly records: PrivateRecordStore) {}

  async resolveEpisode(binding: EpisodeBinding): Promise<EpisodeBinding> {
    assertDigest(binding.roomId);
    assertDigest(binding.episodeCommitment);
    assertU64(binding.ordinal);
    assertU64(binding.predecessor.revision);
    if (binding.predecessor.roomId !== binding.roomId || BigInt(binding.ordinal) !== BigInt(binding.predecessor.revision) + 1n || new Set(binding.residentIds).size !== 2) throw new Error('invalid_episode_binding');
    const key = `episode/${binding.episodeId}`;
    await this.records.create(key, binding);
    const retained = await this.records.read<EpisodeBinding>(key);
    if (!retained || canonicalJson(retained.value) !== canonicalJson(binding)) throw new Error('episode_identity_reused');
    const ordinalKey = `ordinal/${binding.roomId}/${binding.ordinal}`;
    await this.records.create(ordinalKey, { episodeId: binding.episodeId });
    if ((await this.records.read<{ episodeId: string }>(ordinalKey))?.value.episodeId !== binding.episodeId) throw new Error('room_episode_in_progress');
    return retained.value;
  }

  async getOriginalResult(episodeId: string): Promise<OriginalResult | undefined> {
    return (await this.records.read<OriginalResult>(`original/${episodeId}`))?.value;
  }

  async captureOriginalResult(binding: EpisodeBinding, result: OriginalResult): Promise<OriginalResult> {
    if (result.episodeId !== binding.episodeId) throw new Error('original_episode_mismatch');
    assertDigest(result.originalResultCommitment);
    assertDigest(result.candidateCommitment);
    await this.records.create(`original/${binding.episodeId}`, result);
    const original = await this.getOriginalResult(binding.episodeId);
    if (!original) throw new Error('original_result_missing');
    if (canonicalJson(original) !== canonicalJson(result)) throw new Error('original_result_conflict');
    return original;
  }

  async authorizeAcceptance(binding: EpisodeBinding, result: OriginalResult): Promise<AcceptanceAuthorization> {
    const original = await this.getOriginalResult(binding.episodeId);
    if (!original || canonicalJson(original) !== canonicalJson(result)) throw new Error('original_result_not_captured');
    assertLesson(result.proposal.lesson);
    assertInteger(result.proposal.selectedProcedure, 0, 1);
    assertInteger(result.proposal.feedback.magnitude, 0, 10);
    const key = `authorization/${binding.episodeId}`;
    const prior = await this.records.read<AcceptanceAuthorization>(key);
    const authorization: AcceptanceAuthorization = {
      ...result.proposal,
      acceptanceNonce: prior?.value.acceptanceNonce ?? randomHex(),
      episodeId: binding.episodeId,
      operationId: `accept/${await digest({ domain: 'backrooms.accept.v0', binding, originalResultCommitment: result.originalResultCommitment })}`,
      roomId: binding.roomId,
      expectedPredecessor: binding.predecessor.stateCommitment,
      ordinal: binding.ordinal,
      episodeCommitment: binding.episodeCommitment,
      originalResultCommitment: result.originalResultCommitment,
      candidateCommitment: result.candidateCommitment,
      minimumConfirmedSlot: binding.minimumConfirmedSlot,
    };
    await this.records.create(key, authorization);
    const retained = await this.records.read<AcceptanceAuthorization>(key);
    if (!retained) throw new Error('authorization_missing');
    assertDigest(retained.value.acceptanceNonce);
    if (canonicalJson(retained.value) !== canonicalJson({ ...authorization, acceptanceNonce: retained.value.acceptanceNonce })) throw new Error('authorization_replay');
    return retained.value;
  }
}
