import { init } from '@flue/runtime';
import { sqlite, start, type Flue } from '@flue/runtime/node';
import { chmod } from 'node:fs/promises';
import { join } from 'node:path';
import * as v from 'valibot';
import { base64, canonicalJson, digest, randomHex } from '../client/codec.js';
import { PROTOCOL_VERSION, type EpisodeBinding, type OriginalResult, type PrivateRecordStore, type RecoveredRoom, type ResidentRuntime } from '../client/contracts.js';
import type { PrivateMessage } from '../client/encryption.js';
import { createResidents, type EpisodeContext, type ResidentInitialData } from '../flue/agents.js';
import { deterministicInferenceFixture } from '../flue/fixture.js';
import { seedManifestCommitment } from '../flue/seeds.js';
import { PrivateMessageLog, residentSigningKey } from './messages.js';
import { protectedDirectory } from './records.js';
import { RuntimeOwnership } from './runtime-ownership.js';

const proposalSchema = v.strictObject({
  lesson: v.string(), selectedProcedure: v.picklist([0, 1]),
  feedback: v.strictObject({ negative: v.boolean(), magnitude: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(10)) }),
});

function episodeContextIdentity({ binding, room }: EpisodeContext): string {
  const { operationId: _operationId, contextSlot: _contextSlot, ...state } = room;
  return canonicalJson({ binding, room: state });
}

export class FlueResidents implements ResidentRuntime {
  private readonly activeRuns = new Set<Promise<OriginalResult>>();
  private stopping: Promise<void> | undefined;

  private constructor(
    private readonly records: PrivateRecordStore,
    private readonly runtime: Flue,
    private readonly agents: ReturnType<typeof createResidents>,
    private readonly fixture: ReturnType<typeof deterministicInferenceFixture>,
    private readonly log: PrivateMessageLog,
    private readonly signingKeys: readonly [CryptoKeyPair, CryptoKeyPair],
    readonly residentIds: readonly [string, string],
    readonly seedCommitment: string,
    readonly membershipCommitment: string,
    private readonly ownership: RuntimeOwnership,
  ) {}

  static async start(options: { directory: string; records: PrivateRecordStore; masterKey: Uint8Array<ArrayBuffer>; residentIds: readonly [string, string] }): Promise<FlueResidents> {
    const directory = await protectedDirectory(options.directory);
    const ownership = RuntimeOwnership.acquire(directory);
    let runtime: Flue | undefined;
    let persistence: ReturnType<typeof sqlite> | undefined;
    try {
      const signingKeys = await Promise.all(options.residentIds.map(id => residentSigningKey(options.records, id))) as [CryptoKeyPair, CryptoKeyPair];
      const log = new PrivateMessageLog(options.records, options.masterKey, new Map(options.residentIds.map((id, i) => [id, signingKeys[i]!.publicKey])));
      const seedCommitment = await seedManifestCommitment();
      const residents = await Promise.all(options.residentIds.map(async (id, i) => ({ id, verificationKey: base64(new Uint8Array(await crypto.subtle.exportKey('raw', signingKeys[i]!.publicKey))) })));
      const membershipCommitment = await digest({ domain: 'backrooms.members.v0', owner: 'configured-writer', residents });
      const agents = createResidents({
        records: options.records,
        readCandidate: async (episodeId, initial) => {
          const message = (await options.records.read<PrivateMessage>(`candidate/${episodeId}`))?.value;
          if (!message) throw new Error('candidate_missing');
          const received = await log.receive(message, { protocolVersion: PROTOCOL_VERSION, roomId: initial.roomId, episodeId, senderId: options.residentIds[0], recipientId: initial.residentId });
          return received.payload;
        },
      }, { investigator: 'backrooms-fixture/investigator-v0', critic: 'backrooms-fixture/critic-v0' });
      const fixture = deterministicInferenceFixture();
      const databasePath = join(directory, 'flue.sqlite');
      persistence = sqlite(databasePath);
      runtime = await start({
        agents: [{ agent: agents.InvestigatorV0, name: 'backroom-investigator-v0' }, { agent: agents.CriticV0, name: 'backroom-critic-v0' }],
        db: persistence, providers: [fixture.provider], env: {},
      });
      await chmod(databasePath, 0o600);
      return new FlueResidents(options.records, runtime, agents, fixture, log, signingKeys, options.residentIds, seedCommitment, membershipCommitment, ownership);
    } catch (error) {
      if (runtime) await runtime.stop();
      else await persistence?.close?.();
      ownership.release();
      throw error;
    }
  }

  get inferenceCalls(): number { return this.fixture.state.callCount; }

  run(binding: EpisodeBinding, room: RecoveredRoom): Promise<OriginalResult> {
    if (this.stopping) return Promise.reject(new Error('private_runtime_stopping'));
    const run = this.runEpisode(binding, room);
    this.activeRuns.add(run);
    run.then(() => this.activeRuns.delete(run), () => this.activeRuns.delete(run));
    return run;
  }

  private async runEpisode(binding: EpisodeBinding, room: RecoveredRoom): Promise<OriginalResult> {
    if (room.seedManifestCommitment !== this.seedCommitment || room.fixedMembersCommitment !== this.membershipCommitment || canonicalJson(binding.residentIds) !== canonicalJson(this.residentIds) || canonicalJson(binding.predecessor) !== canonicalJson(room.checkpoint)) throw new Error('resident_room_binding_mismatch');
    const retainedContext = { binding, room } satisfies EpisodeContext;
    await this.records.create(`context/${binding.episodeId}`, retainedContext);
    const prior = (await this.records.read<EpisodeContext>(`context/${binding.episodeId}`))?.value;
    if (!prior || episodeContextIdentity(prior) !== episodeContextIdentity(retainedContext)) throw new Error('episode_context_changed');
    await this.records.create(`blinding/${binding.episodeId}`, randomHex());
    const blinding = (await this.records.read<string>(`blinding/${binding.episodeId}`))!.value;
    const initial = (role: 0 | 1): ResidentInitialData => ({ roomId: binding.roomId, residentId: this.residentIds[role], seedManifestCommitment: this.seedCommitment });
    const message = JSON.stringify({ episodeId: binding.episodeId, task: [9, 1, 5] });
    const investigator = init(this.agents.InvestigatorV0, { id: `${binding.roomId}/${this.residentIds[0]}` });
    if (this.stopping) throw new Error('private_runtime_stopping');
    const investigatorReceipt = await investigator.dispatch({ message, initialData: initial(0), idempotencyKey: `${binding.episodeId}/investigator` });
    const candidate = await investigator.read(investigatorReceipt, { signal: AbortSignal.timeout(60_000) });
    const payload: unknown = JSON.parse(candidate.text);
    const encryptedCandidate = await this.log.send(payload, { protocolVersion: PROTOCOL_VERSION, roomId: binding.roomId, episodeId: binding.episodeId, senderId: this.residentIds[0], recipientId: this.residentIds[1], expiresAt: null }, this.signingKeys[0].privateKey);
    await this.records.create(`candidate/${binding.episodeId}`, encryptedCandidate);
    const critic = init(this.agents.CriticV0, { id: `${binding.roomId}/${this.residentIds[1]}` });
    if (this.stopping) throw new Error('private_runtime_stopping');
    const criticReceipt = await critic.dispatch({ message, initialData: initial(1), idempotencyKey: `${binding.episodeId}/critic` });
    const feedback = await critic.read(criticReceipt, { signal: AbortSignal.timeout(60_000) });
    const proposal = v.parse(proposalSchema, JSON.parse(feedback.text));
    return {
      episodeId: binding.episodeId,
      investigator: candidate.text,
      critic: feedback.text,
      proposal,
      candidateCommitment: await digest({ domain: 'backrooms.candidate.v0', blinding, episode: binding.episodeCommitment, candidate: candidate.text }),
      originalResultCommitment: await digest({ domain: 'backrooms.original.v0', blinding, episode: binding.episodeCommitment, candidate: candidate.text, feedback: feedback.text }),
    };
  }

  stop(): Promise<void> {
    this.stopping ??= (async () => {
      await this.runtime.stop();
      await Promise.allSettled(this.activeRuns);
      this.ownership.release();
    })();
    return this.stopping;
  }
}
