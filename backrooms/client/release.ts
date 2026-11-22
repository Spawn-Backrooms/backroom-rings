import * as v from 'valibot';
import { digest } from './codec.js';
import { PROTOCOL_VERSION } from './contracts.js';

const hash = v.nullable(v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/)));
const nullableText = v.nullable(v.pipe(v.string(), v.minLength(1)));
const artifacts = v.strictObject({ circuitSha256: hash, provingKeySha256: hash, verifyingKeySha256: hash });
const service = v.strictObject({ version: nullableText, sourceCommit: v.nullable(v.pipe(v.string(), v.regex(/^[0-9a-f]{40}$/))), binarySha256: hash, imageDigest: nullableText });
const manifestSchema = v.strictObject({
  manifestVersion: v.literal(0),
  protocolVersion: v.literal(PROTOCOL_VERSION),
  artifactVersion: v.string(),
  source: v.strictObject({ upstreamCommit: v.pipe(v.string(), v.regex(/^[0-9a-f]{40}$/)), forkCommit: v.nullable(v.pipe(v.string(), v.regex(/^[0-9a-f]{40}$/))) }),
  schemaSha256: hash,
  client: v.strictObject({ version: v.string(), packageIntegrity: nullableText }),
  circuits: v.strictObject({ createRoom: artifacts, advanceRoom: artifacts }),
  setup: v.strictObject({ kind: v.picklist(['insecure_test', 'single_party', 'ceremony']), provenance: nullableText }),
  network: v.strictObject({ cluster: v.picklist(['localnet', 'devnet', 'mainnet-beta']), genesisHash: nullableText, applicationProgramId: nullableText, shieldedPoolProgramId: nullableText }),
  services: v.strictObject({ prover: service, indexer: service }),
  evidence: v.strictObject({ circuitReview: nullableText, programReview: nullableText, publicDemo: nullableText, nativeInference: nullableText, runtimePrivacy: nullableText }),
});

export type ReleaseManifest = Readonly<v.InferOutput<typeof manifestSchema>>;
export type CircuitArtifacts = ReleaseManifest['circuits']['createRoom'];

export function decodeReleaseManifest(value: unknown): ReleaseManifest {
  return v.parse(manifestSchema, value);
}

export function productionBlockers(value: unknown): string[] {
  const parsed = v.safeParse(manifestSchema, value);
  if (!parsed.success) return ['invalid_manifest'];
  const manifest = parsed.output;
  const blockers: string[] = [];
  const present = (value: string | null): value is string => typeof value === 'string' && value.length > 0 && !/pending|placeholder|todo|example|unqualified/i.test(value);
  const evidence = (value: string | null): boolean => present(value) && /^(https:\/\/[^\s]+|sha256:[0-9a-f]{64})$/.test(value);
  if (!/^\d+\.\d+\.\d+$/.test(manifest.artifactVersion)) blockers.push('unreleased_artifacts');
  if (!manifest.source.forkCommit) blockers.push('source_not_pinned');
  if (!manifest.schemaSha256) blockers.push('schema_not_pinned');
  if (!/^\d+\.\d+\.\d+$/.test(manifest.client.version) || !manifest.client.packageIntegrity || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(manifest.client.packageIntegrity)) blockers.push('client_not_released');
  for (const name of ['createRoom', 'advanceRoom'] as const) {
    for (const artifact of ['circuitSha256', 'provingKeySha256', 'verifyingKeySha256'] as const) {
      if (!manifest.circuits[name][artifact]) blockers.push(`${name}.${artifact}_missing`);
    }
  }
  if (manifest.setup.kind !== 'ceremony' || !evidence(manifest.setup.provenance)) blockers.push('setup_not_qualified');
  if (manifest.network.cluster !== 'mainnet-beta') blockers.push('network_not_production');
  for (const name of ['genesisHash', 'applicationProgramId', 'shieldedPoolProgramId'] as const) {
    const value = manifest.network[name];
    if (!present(value) || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) blockers.push(`${name}_not_pinned`);
  }
  for (const name of ['prover', 'indexer'] as const) {
    const service = manifest.services[name];
    if (!present(service.version) || !service.sourceCommit) blockers.push(`${name}_version_not_pinned`);
    if ((!service.binarySha256 && !service.imageDigest) || (service.imageDigest !== null && !/^sha256:[0-9a-f]{64}$/.test(service.imageDigest))) blockers.push(`${name}_artifact_not_pinned`);
  }
  for (const name of ['circuitReview', 'programReview', 'publicDemo', 'nativeInference', 'runtimePrivacy'] as const) if (!evidence(manifest.evidence[name])) blockers.push(`${name}_not_qualified`);
  return blockers;
}

export async function assertProductionEligible(value: unknown, approvedManifestSha256: string): Promise<ReleaseManifest> {
  const manifest = decodeReleaseManifest(value);
  const blockers = productionBlockers(manifest);
  if (blockers.length > 0) throw new Error(`production_release_blocked:${blockers.join(',')}`);
  if (!/^[0-9a-f]{64}$/.test(approvedManifestSha256) || await digest(manifest) !== approvedManifestSha256) throw new Error('release_not_operator_approved');
  return manifest;
}
