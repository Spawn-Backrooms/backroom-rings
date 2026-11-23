import { join } from 'node:path';
import { canonicalJson, digest, randomHex } from '../client/codec.js';
import type { CreateRoomInput, DiagnosticSink, EpisodeBinding, LearningOutcome, PreparedTransaction, PriorTransactionFrame, RecoveredRoom, RingsTransport } from '../client/contracts.js';
import { LearningCoordinator } from '../client/learning.js';
import { RingsClient } from '../client/rings-client.js';
import { residentIds } from '../flue/seeds.js';
import { ReferenceAuthority } from './authority.js';
import { EncryptedSqliteRecords, loadDevelopmentKey, protectedDirectory } from './records.js';
import { FlueResidents } from './residents.js';

interface CreationIntent { nonce: string; residentIds: [string, string] }
interface Genesis { input: CreateRoomInput; prepared: PreparedTransaction; minimumConfirmedSlot: string; priorFrames?: PriorTransactionFrame[] }

export class ReferenceHost {
  private constructor(
    readonly records: EncryptedSqliteRecords,
    readonly residents: FlueResidents,
    readonly rings: RingsClient,
    private readonly intent: CreationIntent,
    private readonly diagnostic: DiagnosticSink,
  ) {}

  static async open(options: { directory: string; transport: RingsTransport; diagnostic?: DiagnosticSink }): Promise<ReferenceHost> {
    const directory = await protectedDirectory(options.directory);
    const key = await loadDevelopmentKey(join(directory, 'development.key'));
    const records = await EncryptedSqliteRecords.open(join(directory, 'private-records.sqlite'), key, 'private-learning-host-v0');
    try {
      let retained = await records.read<CreationIntent>('creation');
      if (!retained) {
        const nonce = randomHex();
        await records.create('creation', { nonce, residentIds: await residentIds(nonce) } satisfies CreationIntent);
        retained = await records.read<CreationIntent>('creation');
      }
      if (!retained) throw new Error('creation_intent_missing');
      const residents = await FlueResidents.start({ directory, records, masterKey: key, residentIds: retained.value.residentIds });
      return new ReferenceHost(records, residents, new RingsClient(options.transport, 'backrooms.localnet.v0'), retained.value, options.diagnostic ?? (() => {}));
    } catch (error) {
      records.close();
      throw error;
    }
  }

  async ensureRoom(): Promise<RecoveredRoom> {
    if (!await this.records.read<Genesis>('genesis')) {
      const input: CreateRoomInput = { creationNonce: this.intent.nonce, seedManifestCommitment: this.residents.seedCommitment, fixedMembersCommitment: this.residents.membershipCommitment };
      const prepared = await this.rings.prepareCreate(`create/${await digest(input)}`, input);
      await this.records.create('genesis', { input, prepared, minimumConfirmedSlot: '0' } satisfies Genesis);
    }
    for (let frameAttempt = 0; frameAttempt < 2; frameAttempt++) {
      const retained = await this.records.read<Genesis>('genesis');
      if (!retained || retained.value.input.creationNonce !== this.intent.nonce || retained.value.input.seedManifestCommitment !== this.residents.seedCommitment || retained.value.input.fixedMembersCommitment !== this.residents.membershipCommitment) throw new Error('genesis_binding_mismatch');
      const genesis = retained.value;
      const operationId = `${genesis.prepared.operationId}/recover`;
      let minimumSlot = genesis.minimumConfirmedSlot;
      let recovered = await this.rings.recover(operationId, genesis.prepared.checkpoint.roomId, minimumSlot);
      if (recovered.status === 'recovered') return this.checkGenesis(recovered, genesis);
      if (recovered.status !== 'not_found') throw new Error('room_preparation_pending');
      let submitted;
      try { submitted = await this.rings.submit(genesis.prepared); }
      catch { submitted = undefined; }
      if (submitted?.status === 'confirmed') minimumSlot = await this.retainGenesisSlot(genesis, submitted.slot);
      recovered = await this.rings.recover(operationId, genesis.prepared.checkpoint.roomId, minimumSlot);
      if (recovered.status === 'recovered') return this.checkGenesis(recovered, genesis);
      if (submitted?.status !== 'expired' || recovered.status !== 'not_found' || frameAttempt > 0) throw new Error('room_preparation_pending');
      let reframed;
      try { reframed = await this.rings.reframe(genesis.prepared); }
      catch { throw new Error('room_preparation_pending'); }
      if (reframed.status === 'unknown') throw new Error('room_preparation_pending');
      if (reframed.status === 'confirmed') {
        minimumSlot = await this.retainGenesisSlot(genesis, reframed.slot);
        recovered = await this.rings.recover(operationId, genesis.prepared.checkpoint.roomId, minimumSlot);
        if (recovered.status === 'recovered') return this.checkGenesis(recovered, genesis);
        throw new Error('room_preparation_pending');
      }
      const current = await this.records.read<Genesis>('genesis');
      if (!current || current.value.prepared.transactionDigest !== genesis.prepared.transactionDigest) throw new Error('room_preparation_pending');
      const replacement: Genesis = {
        ...current.value,
        prepared: { ...current.value.prepared, transactionBase64: reframed.transactionBase64, transactionDigest: reframed.transactionDigest },
        priorFrames: [...(current.value.priorFrames ?? []), { transactionBase64: genesis.prepared.transactionBase64, transactionDigest: genesis.prepared.transactionDigest, signature: submitted.signature }],
      };
      if (!await this.records.replace('genesis', current.version, replacement)) throw new Error('room_preparation_pending');
    }
    throw new Error('room_preparation_pending');
  }

  private async retainGenesisSlot(expected: Genesis, slot: string): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await this.records.read<Genesis>('genesis');
      if (!current || current.value.prepared.checkpoint.roomId !== expected.prepared.checkpoint.roomId) throw new Error('genesis_binding_mismatch');
      if (current.value.prepared.transactionDigest !== expected.prepared.transactionDigest && !current.value.priorFrames?.some(frame => frame.transactionDigest === expected.prepared.transactionDigest)) throw new Error('genesis_frame_changed');
      if (BigInt(current.value.minimumConfirmedSlot) >= BigInt(slot)) return current.value.minimumConfirmedSlot;
      if (await this.records.replace('genesis', current.version, { ...current.value, minimumConfirmedSlot: slot })) return slot;
    }
    throw new Error('room_preparation_pending');
  }

  private checkGenesis(recovered: RecoveredRoom, genesis: Genesis): RecoveredRoom {
    if (recovered.checkpoint.uniqueAddress !== genesis.prepared.checkpoint.uniqueAddress || recovered.seedManifestCommitment !== genesis.input.seedManifestCommitment || recovered.fixedMembersCommitment !== genesis.input.fixedMembersCommitment) throw new Error('recovered_genesis_mismatch');
    if (recovered.checkpoint.revision === '0' && recovered.checkpoint.stateCommitment !== genesis.prepared.checkpoint.stateCommitment) throw new Error('genesis_commitment_mismatch');
    return recovered;
  }

  private async reconcileCheckpointEpisode(room: RecoveredRoom): Promise<void> {
    const authority = new ReferenceAuthority(this.records);
    const binding = await authority.getCheckpointEpisode(room.checkpoint);
    if (!binding) return;
    const coordinator = new LearningCoordinator(authority, this.residents, this.rings, this.records, this.diagnostic);
    const outcome = await coordinator.run(binding, room);
    if (outcome.status === 'commit_pending') throw new Error('room_episode_in_progress');
    if (outcome.status === 'state_conflict' || canonicalJson(outcome.room.checkpoint) !== canonicalJson(room.checkpoint)) throw new Error('room_episode_state_conflict');
  }

  private async resolveEpisode(label: string, room: RecoveredRoom): Promise<EpisodeBinding> {
    const episodeId = await digest({ domain: 'backrooms.episode.id.v0', roomId: room.checkpoint.roomId, label });
    let retained = await this.records.read<EpisodeBinding>(`episode/${episodeId}`);
    if (!retained) {
      await this.reconcileCheckpointEpisode(room);
      const binding = await new ReferenceAuthority(this.records).reserveEpisode({
        roomId: room.checkpoint.roomId, episodeId,
        episodeCommitment: await digest({ domain: 'backrooms.episode.v0', roomId: room.checkpoint.roomId, label, blinding: randomHex() }),
        predecessor: room.checkpoint, ordinal: (BigInt(room.checkpoint.revision) + 1n).toString(), minimumConfirmedSlot: room.slot, residentIds: this.intent.residentIds,
      });
      await this.records.create(`episode/${episodeId}`, binding);
      retained = await this.records.read<EpisodeBinding>(`episode/${episodeId}`);
    }
    if (!retained) throw new Error('episode_not_retained');
    return retained.value;
  }

  async episode(label: string): Promise<LearningOutcome> {
    const room = await this.ensureRoom();
    const binding = await this.resolveEpisode(label, room);
    const coordinator = new LearningCoordinator(new ReferenceAuthority(this.records), this.residents, this.rings, this.records, this.diagnostic);
    return coordinator.run(binding, room);
  }

  async inspectNextEpisode(label: string): Promise<{ room: RecoveredRoom; selectedProcedure: number; value: number }> {
    const room = await this.ensureRoom();
    const authority = new ReferenceAuthority(this.records);
    const binding = await authority.resolveEpisode(await this.resolveEpisode(label, room));
    const existing = await authority.getOriginalResult(binding.episodeId);
    const result = existing ?? await authority.captureOriginalResult(binding, await this.residents.run(binding, room));
    const candidate = JSON.parse(result.investigator) as { selectedProcedure: number; value: number };
    return { room, selectedProcedure: candidate.selectedProcedure, value: candidate.value };
  }

  async close(): Promise<void> {
    await this.residents.stop();
    this.records.close();
  }
}
