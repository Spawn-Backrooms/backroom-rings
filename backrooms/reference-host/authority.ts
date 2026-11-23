import { assertDigest, assertInteger, assertLesson, assertU64, canonicalJson, digest, randomHex } from '../client/codec.js';
import type { AcceptanceAuthorization, Checkpoint, EpisodeAuthority, EpisodeBinding, OriginalResult, PrivateRecordStore } from '../client/contracts.js';
import type { AcceptanceReceipt } from '../client/learning.js';

export class ReferenceAuthority implements EpisodeAuthority {
  constructor(private readonly records: PrivateRecordStore) {}

  async resolveEpisode(binding: EpisodeBinding): Promise<EpisodeBinding> {
    const reserved = await this.reserveEpisode(binding);
    if (canonicalJson(reserved) !== canonicalJson(binding)) throw new Error('episode_identity_reused');
    const key = `episode/${binding.episodeId}`;
    await this.records.create(key, binding);
    const retained = await this.records.read<EpisodeBinding>(key);
    if (!retained || canonicalJson(retained.value) !== canonicalJson(binding)) throw new Error('episode_identity_reused');
    return retained.value;
  }

  async reserveEpisode(request: EpisodeBinding): Promise<EpisodeBinding> {
    assertDigest(request.roomId);
    assertDigest(request.episodeCommitment);
    assertU64(request.ordinal);
    assertU64(request.predecessor.revision);
    if (request.predecessor.roomId !== request.roomId || BigInt(request.ordinal) !== BigInt(request.predecessor.revision) + 1n || new Set(request.residentIds).size !== 2) throw new Error('invalid_episode_binding');
    const binding = (await this.records.read<EpisodeBinding>(`episode/${request.episodeId}`))?.value ?? request;
    await this.assertAcceptedPredecessor(binding.predecessor);
    const ordinalKey = `ordinal/${binding.roomId}/${binding.ordinal}`;
    await this.records.create(ordinalKey, { episodeId: binding.episodeId });
    if ((await this.records.read<{ episodeId: string }>(ordinalKey))?.value.episodeId !== binding.episodeId) throw new Error('room_episode_in_progress');
    return binding;
  }

  async getCheckpointEpisode(checkpoint: Checkpoint): Promise<EpisodeBinding | undefined> {
    if (checkpoint.revision === '0') return undefined;
    const ordinal = await this.records.read<{ episodeId: string }>(`ordinal/${checkpoint.roomId}/${checkpoint.revision}`);
    const episode = ordinal && await this.records.read<EpisodeBinding>(`episode/${ordinal.value.episodeId}`);
    if (!episode) throw new Error('room_episode_lineage_missing');
    if (episode.value.roomId !== checkpoint.roomId || episode.value.ordinal !== checkpoint.revision) throw new Error('room_episode_lineage_conflict');
    return episode.value;
  }

  private async assertAcceptedPredecessor(checkpoint: Checkpoint): Promise<void> {
    const episode = await this.getCheckpointEpisode(checkpoint);
    if (!episode) return;
    const authorization = (await this.records.read<AcceptanceAuthorization>(`authorization/${episode.episodeId}`))?.value;
    const receipt = authorization && await this.records.read<AcceptanceReceipt>(`receipt/${authorization.operationId}`);
    if (!receipt) throw new Error('room_episode_in_progress');
    if (canonicalJson(receipt.value.authorization) !== canonicalJson(authorization) || canonicalJson(receipt.value.room.checkpoint) !== canonicalJson(checkpoint)) throw new Error('room_episode_state_conflict');
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
