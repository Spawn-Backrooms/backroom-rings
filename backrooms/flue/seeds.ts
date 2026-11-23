import { digest } from '../client/codec.js';

export const RESIDENT_SEEDS = {
  version: 'private-learning-room.v0',
  investigator: {
    version: 0,
    instruction: 'Read authorized room memory. Choose the procedure with the higher retained score; break ties with procedure zero. Investigate the supplied numbers and return a candidate.',
  },
  critic: {
    version: 0,
    instruction: 'Read the authenticated candidate from the investigator. Evaluate its procedure. Propose one bounded lesson and a signed score adjustment for that procedure.',
  },
} as const;

export async function seedManifestCommitment(): Promise<string> {
  return digest({ domain: 'backrooms.seeds.v0', seeds: RESIDENT_SEEDS });
}

export async function residentIds(creationNonce: string): Promise<[string, string]> {
  return Promise.all(['investigator', 'critic'].map(role => digest({ domain: 'backrooms.resident.v0', creationNonce, role, version: RESIDENT_SEEDS.version }))) as Promise<[string, string]>;
}
