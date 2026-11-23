import { useInitialData, useModel, useTool } from '@flue/runtime';
import * as v from 'valibot';
import type { EpisodeBinding, PrivateRecordStore, RecoveredRoom } from '../client/contracts.js';
import { RESIDENT_SEEDS } from './seeds.js';

export interface ResidentInitialData {
  roomId: string;
  residentId: string;
  seedManifestCommitment: string;
}

export interface EpisodeContext { binding: EpisodeBinding; room: RecoveredRoom }

const candidateSchema = v.strictObject({ selectedProcedure: v.picklist([0, 1]), procedure: v.picklist(['take-first', 'sort-and-take-median']), value: v.number(), memoryRevision: v.string(), lessonUsed: v.string() });

export interface ResidentTools {
  records: PrivateRecordStore;
  readCandidate(episodeId: string, initial: ResidentInitialData): Promise<unknown>;
}

async function episodeContext(tools: ResidentTools, episodeId: string, initial: ResidentInitialData, role: 0 | 1): Promise<EpisodeContext> {
  const context = (await tools.records.read<EpisodeContext>(`context/${episodeId}`))?.value;
  if (!context || context.binding.roomId !== initial.roomId || context.binding.residentIds[role] !== initial.residentId || context.room.seedManifestCommitment !== initial.seedManifestCommitment) throw new Error('resident_scope_denied');
  return context;
}

export function createResidents(tools: ResidentTools, models: { investigator: string; critic: string }) {
  function InvestigatorV0() {
    const initial = useInitialData<ResidentInitialData>();
    useModel(models.investigator);
    useTool({
      name: 'read_private_memory',
      description: 'Read the accepted room checkpoint for this admitted episode.',
      input: v.strictObject({ episodeId: v.string() }),
      output: v.strictObject({ revision: v.string(), lesson: v.string(), scores: v.tuple([v.number(), v.number()]) }),
      run: async ({ data: { episodeId } }) => {
        const context = await episodeContext(tools, episodeId, initial, 0);
        return { output: { revision: context.room.checkpoint.revision, lesson: context.room.memory.lesson, scores: context.room.policy.scores } };
      },
    });
    return RESIDENT_SEEDS.investigator.instruction;
  }

  function CriticV0() {
    const initial = useInitialData<ResidentInitialData>();
    useModel(models.critic);
    useTool({
      name: 'read_private_candidate',
      description: 'Read the authenticated candidate sent by the room investigator.',
      input: v.strictObject({ episodeId: v.string() }),
      output: candidateSchema,
      run: async ({ data: { episodeId } }) => {
        await episodeContext(tools, episodeId, initial, 1);
        return { output: v.parse(candidateSchema, await tools.readCandidate(episodeId, initial)) };
      },
    });
    return RESIDENT_SEEDS.critic.instruction;
  }
  return { InvestigatorV0, CriticV0 };
}
