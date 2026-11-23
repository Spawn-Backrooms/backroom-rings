import * as v from 'valibot';
import { canonicalJson, digest, randomHex, utf8 } from './codec.js';

export const KNOWLEDGE_SCHEMA_VERSION = 'backrooms.knowledge.v1' as const;
export const KNOWLEDGE_BINDING_SCHEME = 'sha256-blinded-v1' as const;
export const MAX_KNOWLEDGE_ENVELOPE_BYTES = 65_536;
export const MAX_KNOWLEDGE_OPENING_BYTES = 1_048_576;

function strictFields<const TEntries extends v.ObjectEntries>(entries: TEntries) {
  // Valibot tests membership with "in"; only declared wire fields belong in this table.
  return v.strictObject(Object.assign(Object.create(null), entries) as TEntries);
}

const hash = v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/));
const identifier = v.pipe(v.string(), v.regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/));
const u64 = v.pipe(v.string(), v.regex(/^(0|[1-9][0-9]{0,19})$/), v.check(value => BigInt(value) <= 18_446_744_073_709_551_615n));
const purpose = v.picklist(['content', 'source_run', 'artifact', 'evidence', 'policy', 'license', 'record_revision']);
const bindingContextSchema = strictFields({ purpose, id: identifier });
export const knowledgeBindingSchema = strictFields({
  scheme: v.literal(KNOWLEDGE_BINDING_SCHEME),
  context: bindingContextSchema,
  digest: hash,
});

function bindingFor(expected: v.InferOutput<typeof purpose>) {
  return v.pipe(knowledgeBindingSchema, v.check(binding => binding.context.purpose === expected));
}

const revisionReferenceSchema = strictFields({
  roomId: hash,
  recordId: identifier,
  revision: u64,
  binding: bindingFor('record_revision'),
});
const sourceSchema = v.variant('kind', [
  strictFields({ kind: v.literal('run'), runId: identifier, run: bindingFor('source_run'), originalResult: bindingFor('artifact') }),
  strictFields({ kind: v.literal('artifact'), artifact: bindingFor('artifact') }),
]);
const lifecycleSchema = v.variant('state', [
  strictFields({ state: v.literal('retained') }),
  strictFields({ state: v.literal('superseded'), replacement: revisionReferenceSchema, reason: bindingFor('evidence') }),
  strictFields({ state: v.literal('retracted'), reason: bindingFor('evidence') }),
]);
const recordFields = {
  roomId: hash,
  recordId: identifier,
  revision: u64,
  previousRevision: v.nullable(revisionReferenceSchema),
  createdAt: u64,
  content: strictFields({ mediaType: v.picklist(['text/plain', 'application/json', 'application/octet-stream']), binding: bindingFor('content') }),
  sources: v.pipe(v.array(sourceSchema), v.minLength(1), v.maxLength(64)),
  provenance: strictFields({ producerId: identifier, derivedFrom: v.pipe(v.array(revisionReferenceSchema), v.maxLength(64)) }),
  lifecycle: lifecycleSchema,
};

export const knowledgeRecordSchema = v.variant('kind', [
  strictFields({ ...recordFields, kind: v.literal('observation') }),
  strictFields({ ...recordFields, kind: v.literal('hypothesis') }),
  strictFields({ ...recordFields, kind: v.literal('procedure') }),
  strictFields({ ...recordFields, kind: v.literal('failure') }),
  strictFields({ ...recordFields, kind: v.literal('preference') }),
  strictFields({ ...recordFields, kind: v.literal('policy'), enforcement: v.literal('native_grant_contract'), policy: bindingFor('policy') }),
]);

export const knowledgeRightsSchema = strictFields({
  policy: bindingFor('policy'),
  audience: v.pipe(v.array(identifier), v.minLength(1), v.maxLength(64)),
  purposes: v.pipe(v.array(v.picklist(['derive', 'evaluate', 'retrieve', 'review'])), v.minLength(1), v.maxLength(4)),
  license: v.nullable(bindingFor('license')),
  expiresAt: v.nullable(u64),
  retainUntil: v.nullable(u64),
});

const subjectSchema = strictFields({ roomId: hash, recordId: identifier, revision: u64, contentCommitment: hash });
const evidenceFields = { subject: subjectSchema, evaluatorId: identifier, recordedAt: u64, receipt: bindingFor('evidence') };
export const knowledgeEvaluationSchema = strictFields({
  ownerAcceptance: strictFields({ ...evidenceFields, kind: v.literal('owner_acceptance'), decision: v.literal('accepted'), authority: bindingFor('policy') }),
  deterministicChecks: v.pipe(v.array(strictFields({ ...evidenceFields, kind: v.literal('deterministic_check'), checker: bindingFor('artifact'), result: v.picklist(['pass', 'fail', 'inconclusive']) })), v.maxLength(64)),
  modelOpinions: v.pipe(v.array(strictFields({ ...evidenceFields, kind: v.literal('model_opinion'), modelId: identifier, result: v.picklist(['supports', 'opposes', 'uncertain']) })), v.maxLength(64)),
  externalAcceptances: v.pipe(v.array(strictFields({ ...evidenceFields, kind: v.literal('external_acceptance'), systemId: identifier, result: v.picklist(['accepted', 'rejected', 'pending']) })), v.maxLength(64)),
});

export const knowledgeEnvelopeSchema = strictFields({
  schemaVersion: v.literal(KNOWLEDGE_SCHEMA_VERSION),
  authority: v.literal('context_only'),
  record: knowledgeRecordSchema,
  rights: knowledgeRightsSchema,
  evaluation: knowledgeEvaluationSchema,
});

export type KnowledgeBindingContext = v.InferOutput<typeof bindingContextSchema>;
export type KnowledgeBinding = v.InferOutput<typeof knowledgeBindingSchema>;
export type KnowledgeRevisionReference = v.InferOutput<typeof revisionReferenceSchema>;
export type KnowledgeRecord = v.InferOutput<typeof knowledgeRecordSchema>;
export type KnowledgeRights = v.InferOutput<typeof knowledgeRightsSchema>;
export type KnowledgeEvaluation = v.InferOutput<typeof knowledgeEvaluationSchema>;
export type KnowledgeEnvelope = v.InferOutput<typeof knowledgeEnvelopeSchema>;
export interface KnowledgeOpening { blinding: string; value: unknown }

function assertJsonTree(value: unknown, ancestors = new Set<object>(), depth = 0): void {
  if (depth > 64) throw new Error('knowledge_json_too_deep');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    if (!value.isWellFormed()) throw new Error('knowledge_invalid_unicode');
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) throw new Error('knowledge_noncanonical_number');
    return;
  }
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== (Array.isArray(value) ? Array.prototype : Object.prototype)) throw new Error('knowledge_invalid_json');
  if (ancestors.has(value)) throw new Error('knowledge_cyclic_json');
  ancestors.add(value);
  const keys = Reflect.ownKeys(value);
  if (Array.isArray(value)) {
    if (keys.length !== value.length + 1) throw new Error('knowledge_noncanonical_array');
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new Error('knowledge_noncanonical_array');
      assertJsonTree(descriptor.value, ancestors, depth + 1);
    }
  } else {
    for (const key of keys) {
      if (typeof key !== 'string' || !key.isWellFormed()) throw new Error('knowledge_invalid_json_key');
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!descriptor.enumerable || !('value' in descriptor)) throw new Error('knowledge_noncanonical_property');
      assertJsonTree(descriptor.value, ancestors, depth + 1);
    }
  }
  ancestors.delete(value);
}

function canonical(value: unknown, maximumBytes: number): string {
  assertJsonTree(value);
  const encoded = canonicalJson(value);
  if (utf8(encoded).byteLength > maximumBytes) throw new Error('knowledge_encoding_too_large');
  return encoded;
}

function assertSortedSet(values: readonly string[]): void {
  for (let index = 1; index < values.length; index++) {
    if (values[index - 1]! >= values[index]!) throw new Error('knowledge_noncanonical_set');
  }
}

function assertUnique(values: readonly unknown[]): void {
  const encoded = values.map(canonicalJson);
  if (new Set(encoded).size !== encoded.length) throw new Error('knowledge_duplicate_reference');
}

export function decodeKnowledgeEnvelope(value: unknown): KnowledgeEnvelope {
  canonical(value, MAX_KNOWLEDGE_ENVELOPE_BYTES);
  const envelope = v.parse(knowledgeEnvelopeSchema, value);
  const { record, rights, evaluation } = envelope;
  const previous = record.previousRevision;
  if (record.revision === '0') {
    if (previous !== null) throw new Error('knowledge_invalid_predecessor');
  } else if (previous === null || previous.roomId !== record.roomId || previous.recordId !== record.recordId || BigInt(previous.revision) + 1n !== BigInt(record.revision)) {
    throw new Error('knowledge_invalid_predecessor');
  }
  assertSortedSet(rights.audience);
  assertSortedSet(rights.purposes);
  assertUnique(record.sources);
  assertUnique(record.sources.filter(source => source.kind === 'run').map(source => source.runId));
  assertUnique(record.provenance.derivedFrom.map(source => [source.roomId, source.recordId, source.revision]));
  for (const source of record.provenance.derivedFrom) {
    if (source.roomId === record.roomId && source.recordId === record.recordId && BigInt(source.revision) >= BigInt(record.revision)) throw new Error('knowledge_invalid_lineage');
  }
  if (record.lifecycle.state === 'superseded') {
    const replacement = record.lifecycle.replacement;
    if (replacement.roomId === record.roomId && replacement.recordId === record.recordId && BigInt(replacement.revision) <= BigInt(record.revision)) throw new Error('knowledge_invalid_replacement');
  }
  for (const evidence of [evaluation.ownerAcceptance, ...evaluation.deterministicChecks, ...evaluation.modelOpinions, ...evaluation.externalAcceptances]) {
    const subject = evidence.subject;
    if (subject.roomId !== record.roomId || subject.recordId !== record.recordId || subject.revision !== record.revision || subject.contentCommitment !== record.content.binding.digest) throw new Error('knowledge_evidence_subject_mismatch');
  }
  for (const group of [evaluation.deterministicChecks, evaluation.modelOpinions, evaluation.externalAcceptances]) assertUnique(group);
  return envelope;
}

export function encodeKnowledgeEnvelope(value: unknown): string {
  return canonicalJson(decodeKnowledgeEnvelope(value));
}

export function decodeCanonicalKnowledgeEnvelope(input: string | Uint8Array<ArrayBuffer>): KnowledgeEnvelope {
  if ((typeof input === 'string' ? utf8(input).byteLength : input.byteLength) > MAX_KNOWLEDGE_ENVELOPE_BYTES) throw new Error('knowledge_encoding_too_large');
  const text = typeof input === 'string' ? input : new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input);
  const envelope = decodeKnowledgeEnvelope(JSON.parse(text));
  if (text !== canonicalJson(envelope)) throw new Error('knowledge_noncanonical_encoding');
  return envelope;
}

export function knowledgeSigningBytes(value: unknown): Uint8Array<ArrayBuffer> {
  return utf8(`backrooms.knowledge.signature.v1\n${encodeKnowledgeEnvelope(value)}`);
}

export async function createKnowledgeBinding(context: KnowledgeBindingContext, value: unknown): Promise<{ binding: KnowledgeBinding; opening: KnowledgeOpening }> {
  canonical(context, MAX_KNOWLEDGE_ENVELOPE_BYTES);
  const approvedContext = v.parse(bindingContextSchema, context);
  const opening: KnowledgeOpening = { blinding: randomHex(), value: JSON.parse(canonical(value, MAX_KNOWLEDGE_OPENING_BYTES)) };
  canonical(opening, MAX_KNOWLEDGE_OPENING_BYTES);
  const binding: KnowledgeBinding = {
    scheme: KNOWLEDGE_BINDING_SCHEME,
    context: approvedContext,
    digest: await digest({ domain: 'backrooms.knowledge.binding.v1', context: approvedContext, opening }),
  };
  return { binding, opening };
}

export async function verifyKnowledgeBinding(value: unknown, expectedContext: KnowledgeBindingContext, opening: KnowledgeOpening): Promise<unknown> {
  const snapshot = JSON.parse(canonical({ value, expectedContext }, MAX_KNOWLEDGE_ENVELOPE_BYTES)) as { value: unknown; expectedContext: unknown };
  const binding = v.parse(knowledgeBindingSchema, snapshot.value);
  const context = v.parse(bindingContextSchema, snapshot.expectedContext);
  const parsed = v.parse(strictFields({ blinding: hash, value: v.unknown() }), JSON.parse(canonical(opening, MAX_KNOWLEDGE_OPENING_BYTES)));
  if (canonicalJson(binding.context) !== canonicalJson(context)) throw new Error('knowledge_binding_context_mismatch');
  if (binding.digest !== await digest({ domain: 'backrooms.knowledge.binding.v1', context, opening: parsed })) throw new Error('knowledge_binding_mismatch');
  return parsed.value;
}
