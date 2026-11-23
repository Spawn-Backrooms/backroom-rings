import * as v from 'valibot';

const identitySchema = v.strictObject({
  identityVersion: v.literal(1),
  mode: v.picklist(['synthetic_localnet', 'production']),
  artifactVersion: v.pipe(v.string(), v.regex(/^(backrooms\.localnet\.v0|[0-9]+\.[0-9]+\.[0-9]+)$/)),
  schema: v.literal(0),
  deployment: v.pipe(v.string(), v.regex(/^[1-9][0-9]{0,19}$/), v.check(value => BigInt(value) <= 18_446_744_073_709_551_615n)),
  programId: v.pipe(v.string(), v.regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)),
  programDomain: v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/)),
  authoritySeed: v.pipe(v.string(), v.regex(/^[A-Za-z0-9_]{1,32}$/)),
  policy: v.literal(1),
  lessonCapacity: v.literal(96),
});

export type DeploymentIdentity = v.InferOutput<typeof identitySchema>;

export function decodeDeploymentIdentity(value: unknown): DeploymentIdentity {
  const result = v.parse(identitySchema, value);
  if ((result.mode === 'synthetic_localnet') !== (result.artifactVersion === 'backrooms.localnet.v0')) throw new Error('deployment_profile_mismatch');
  if (result.mode === 'production' && (result.programId === '7nA1Dh53c8eUZudEj7vDSvoT9rHapHHuF9NvHRLqjNmi' || result.deployment === '4778966057907997744' || result.programDomain === '64b77045c482ffa2cd163792ef15b63c7615510e3890e31f3a8310e56c183b85')) throw new Error('deployment_reuses_localnet_identity');
  return result;
}
