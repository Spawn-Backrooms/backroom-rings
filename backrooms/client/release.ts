import * as v from 'valibot';
import { digest } from './codec.js';
import { PROTOCOL_VERSION } from './contracts.js';

const hash = v.nullable(v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/)));
const nullableText = v.nullable(v.pipe(v.string(), v.minLength(1)));
const artifacts = v.strictObject({ circuitSha256: hash, provingKeySha256: hash, verifyingKeySha256: hash });
const service = v.strictObject({ version: nullableText, sourceCommit: v.nullable(v.pipe(v.string(), v.regex(/^[0-9a-f]{40}$/))), binarySha256: hash, imageDigest: nullableText });
const requiredHash = v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/));
const file = v.strictObject({ path: v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)*$/)), sha256: requiredHash });
const circuitFiles = v.strictObject({ circuit: file, schema: file, provingKey: file, verifyingKey: file, metadata: file });
const runtime = v.strictObject({
  identity: file,
  schema: file,
  bridgeSha256: requiredHash,
  applicationProgramSha256: requiredHash,
  shieldedPoolProgramSha256: requiredHash,
  tree: v.strictObject({ address: v.pipe(v.string(), v.regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)), id: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(65_535)) }),
  circuits: v.strictObject({ createRoom: circuitFiles, advanceRoom: circuitFiles }),
  proverPolicy: file,
  poolProvingKeys: v.pipe(v.array(v.strictObject({ name: v.pipe(v.string(), v.regex(/^[A-Za-z0-9_.-]+$/)), sha256: requiredHash })), v.minLength(1), v.maxLength(64)),
  indexer: v.strictObject({ kind: v.literal('supervised'), binarySha256: requiredHash, startSlot: v.pipe(v.string(), v.regex(/^(0|[1-9][0-9]{0,19})$/), v.check(value => /^(0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= 18_446_744_073_709_551_615n)) }),
  privacy: v.strictObject({ applicationProving: v.literal('trusted_bridge'), poolProving: v.literal('attested'), inference: v.literal('native_authority') }),
});
const manifestFields = {
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
};
const manifestSchema = v.variant('manifestVersion', [
  v.strictObject({ manifestVersion: v.literal(0), ...manifestFields }),
  v.strictObject({ manifestVersion: v.literal(1), ...manifestFields, runtime }),
]);

export type ReleaseManifest = Readonly<v.InferOutput<typeof manifestSchema>>;
export type CircuitArtifacts = ReleaseManifest['circuits']['createRoom'];
export type ProductionReleaseManifest = Extract<ReleaseManifest, { manifestVersion: 1 }>;
export type RuntimeArtifact = v.InferOutput<typeof file>;

export function decodeReleaseManifest(value: unknown): ReleaseManifest {
  return v.parse(manifestSchema, value);
}

export function productionBlockers(value: unknown): string[] {
  const parsed = v.safeParse(manifestSchema, value);
  if (!parsed.success) return ['invalid_manifest'];
  const manifest = parsed.output;
  const blockers: string[] = [];
  if (manifest.manifestVersion !== 1) blockers.push('runtime_not_pinned');
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
  if (manifest.manifestVersion === 1) {
    if (manifest.runtime.schema.sha256 !== manifest.schemaSha256) blockers.push('schema_runtime_mismatch');
    if (manifest.runtime.indexer.binarySha256 !== manifest.services.indexer.binarySha256) blockers.push('indexer_runtime_mismatch');
    const names = new Set(manifest.runtime.poolProvingKeys.map(key => key.name));
    if (names.size !== manifest.runtime.poolProvingKeys.length) blockers.push('pool_proving_keys_duplicated');
    const paths = new Set<string>();
    for (const entry of runtimeArtifacts(manifest)) {
      if (entry.path.split('/').some(part => part === '.' || part === '..') || paths.has(entry.path)) blockers.push('runtime_artifact_path_invalid');
      paths.add(entry.path);
    }
    for (const name of ['createRoom', 'advanceRoom'] as const) {
      const expected = manifest.circuits[name], actual = manifest.runtime.circuits[name];
      if (expected.circuitSha256 !== actual.circuit.sha256 || expected.provingKeySha256 !== actual.provingKey.sha256 || expected.verifyingKeySha256 !== actual.verifyingKey.sha256) blockers.push(`${name}.runtime_mismatch`);
    }
  }
  return blockers;
}

export function runtimeArtifacts(manifest: ProductionReleaseManifest): RuntimeArtifact[] {
  return [manifest.runtime.identity, manifest.runtime.schema, manifest.runtime.proverPolicy, ...Object.values(manifest.runtime.circuits.createRoom), ...Object.values(manifest.runtime.circuits.advanceRoom)];
}

export async function assertProductionEligible(value: unknown, approvedManifestSha256: string): Promise<ProductionReleaseManifest> {
  const manifest = decodeReleaseManifest(value);
  const blockers = productionBlockers(manifest);
  if (blockers.length > 0) throw new Error(`production_release_blocked:${blockers.join(',')}`);
  if (manifest.manifestVersion !== 1) throw new Error('production_release_blocked:runtime_not_pinned');
  if (!/^[0-9a-f]{64}$/.test(approvedManifestSha256) || await digest(manifest) !== approvedManifestSha256) throw new Error('release_not_operator_approved');
  return manifest;
}
