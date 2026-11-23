import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { canonicalJson, utf8 } from '../client/codec.js';
import { PROTOCOL_VERSION } from '../client/contracts.js';
import { createKnowledgeBinding, decodeCanonicalKnowledgeEnvelope, decodeKnowledgeEnvelope, encodeKnowledgeEnvelope, knowledgeSigningBytes, MAX_KNOWLEDGE_ENVELOPE_BYTES, MAX_KNOWLEDGE_OPENING_BYTES, verifyKnowledgeBinding } from '../client/knowledge.js';
import type { KnowledgeBinding, KnowledgeEnvelope, KnowledgeOpening, KnowledgeRevisionReference } from '../client/knowledge.js';

interface VectorChange { path: (string | number)[]; op: 'set' | 'remove'; value?: unknown }
interface Vectors {
  baseEnvelope: KnowledgeEnvelope;
  canonicalEnvelope: string;
  signingSha256: string;
  bindings: { id: string; binding: KnowledgeBinding; opening: KnowledgeOpening }[];
  validEnvelopes: { id: string; changes: VectorChange[] }[];
  invalidEnvelopes: { id: string; changes: VectorChange[] }[];
}
const vectors = JSON.parse(await readFile(new URL('./fixtures/knowledge-v1.vectors.json', import.meta.url), 'utf8')) as Vectors;
const base = (): KnowledgeEnvelope => structuredClone(vectors.baseEnvelope);

function changed(changes: VectorChange[]): unknown {
  const envelope = base();
  for (const change of changes) {
    let parent: unknown = envelope;
    for (const key of change.path.slice(0, -1)) parent = (parent as Record<string | number, unknown>)[key];
    const key = change.path.at(-1)!;
    if (change.op === 'remove') delete (parent as Record<string | number, unknown>)[key];
    else Object.defineProperty(parent, key, { value: change.value, writable: true, enumerable: true, configurable: true });
  }
  return envelope;
}

test('canonical encoding and signing preimage match independently calculated language-neutral vectors', () => {
  assert.equal(encodeKnowledgeEnvelope(base()), vectors.canonicalEnvelope);
  assert.equal(createHash('sha256').update(knowledgeSigningBytes(base())).digest('hex'), vectors.signingSha256);
  assert.equal(decodeCanonicalKnowledgeEnvelope(utf8(vectors.canonicalEnvelope)).record.recordId, 'record-001');
});

for (const vector of vectors.validEnvelopes) {
  test(`portable positive vector: ${vector.id}`, () => {
    const envelope = changed(vector.changes);
    assert.deepEqual(decodeCanonicalKnowledgeEnvelope(encodeKnowledgeEnvelope(envelope)), envelope);
  });
}

for (const vector of vectors.invalidEnvelopes) {
  test(`portable negative vector: ${vector.id}`, () => assert.throws(() => decodeKnowledgeEnvelope(changed(vector.changes))));
}

test('all six record kinds remain distinct and policy requires an external enforcement reference', () => {
  for (const kind of ['observation', 'hypothesis', 'procedure', 'failure', 'preference'] as const) {
    const envelope = base();
    envelope.record = { ...envelope.record, kind };
    assert.equal(decodeKnowledgeEnvelope(envelope).record.kind, kind);
  }
  const envelope = base();
  envelope.record = { ...envelope.record, kind: 'policy', enforcement: 'native_grant_contract', policy: envelope.rights.policy };
  assert.equal(decodeKnowledgeEnvelope(envelope).record.kind, 'policy');
  assert.throws(() => decodeKnowledgeEnvelope({ ...envelope, record: { ...envelope.record, enforcement: 'record_signature' } }));
});

test('owner acceptance does not convert a failed check or model opinion into proof', () => {
  const result = decodeKnowledgeEnvelope(base());
  assert.equal(result.evaluation.ownerAcceptance.decision, 'accepted');
  assert.equal(result.evaluation.deterministicChecks[0]!.result, 'fail');
  assert.equal(result.evaluation.modelOpinions[0]!.result, 'supports');
  assert.equal(result.evaluation.externalAcceptances.length, 0);
  const envelope = base();
  const opinion = envelope.evaluation.modelOpinions[0]!;
  assert.throws(() => decodeKnowledgeEnvelope({ ...envelope, evaluation: { ...envelope.evaluation, ownerAcceptance: opinion } }));
});

test('wire decoder rejects duplicate keys, alternate escaping, whitespace and unsorted object keys', () => {
  const text = vectors.canonicalEnvelope;
  const invalid = [
    `${text}\n`,
    ` ${text}`,
    text.replace('"authority":"context_only"', '"authority":"context_only","authority":"context_only"'),
    text.replace('"authority"', '"\\u0061uthority"'),
    JSON.stringify(base()),
    `\uFEFF${text}`,
  ];
  for (const input of invalid) assert.throws(() => decodeCanonicalKnowledgeEnvelope(input));
  const bytes = utf8(text);
  assert.throws(() => decodeCanonicalKnowledgeEnvelope(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes])));
  assert.throws(() => decodeCanonicalKnowledgeEnvelope(new Uint8Array([0xff])));
});

test('object decoder rejects hidden authority properties and getters without evaluating them', () => {
  const hidden = base();
  Object.defineProperty(hidden.rights, 'grant', { value: 'spend', enumerable: false });
  assert.throws(() => decodeKnowledgeEnvelope(hidden), /noncanonical_property/);
  const symbol = base();
  Object.defineProperty(symbol, Symbol('grant'), { value: true, enumerable: true });
  assert.throws(() => decodeKnowledgeEnvelope(symbol), /invalid_json_key/);
  const accessor = base();
  let invoked = false;
  Object.defineProperty(accessor, 'authority', { enumerable: true, get() { invoked = true; return 'context_only'; } });
  assert.throws(() => decodeKnowledgeEnvelope(accessor), /noncanonical_property/);
  assert.equal(invoked, false);
});

test('canonical values reject non-JSON and ambiguous numeric or Unicode representations', async () => {
  const sparse: unknown[] = new Array(1);
  const arrayProperty: unknown[] = [];
  Object.defineProperty(arrayProperty, 'extra', { value: 'hidden', enumerable: true });
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  class CustomArray extends Array<unknown> {}
  for (const value of [undefined, -0, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 1n, '\ud800', sparse, arrayProperty, cycle, new Date(), new Map(), new CustomArray(), Object.create(null)]) {
    await assert.rejects(createKnowledgeBinding({ purpose: 'content', id: 'canonical-test' }, value));
  }
});

test('blinded commitment vectors verify across the independent SHA256 implementation', async () => {
  for (const vector of vectors.bindings) {
    assert.deepEqual(await verifyKnowledgeBinding(vector.binding, vector.binding.context, vector.opening), vector.opening.value);
  }
});

test('fresh private openings hide a low-entropy value and reject unblinded or rebound commitments', async () => {
  const context = { purpose: 'content', id: 'binary-answer' } as const;
  const first = await createKnowledgeBinding(context, 'yes');
  const second = await createKnowledgeBinding(context, 'yes');
  assert.notEqual(first.opening.blinding, second.opening.blinding);
  assert.notEqual(first.binding.digest, second.binding.digest);
  assert.equal(JSON.stringify(first.binding).includes(first.opening.blinding), false);
  assert.equal(await verifyKnowledgeBinding(first.binding, context, first.opening), 'yes');
  await assert.rejects(verifyKnowledgeBinding(first.binding, context, { ...first.opening, value: 'no' }), /binding_mismatch/);
  await assert.rejects(verifyKnowledgeBinding(first.binding, { ...context, id: 'another-content' }, first.opening), /context_mismatch/);
  await assert.rejects(verifyKnowledgeBinding(first.binding, { ...context, purpose: 'policy' }, first.opening), /context_mismatch/);
  const unblinded = createHash('sha256').update(canonicalJson('yes')).digest('hex');
  await assert.rejects(verifyKnowledgeBinding({ ...first.binding, digest: unblinded }, context, first.opening), /binding_mismatch/);
  await assert.rejects(verifyKnowledgeBinding({ ...first.binding, scheme: 'sha256' }, context, first.opening));
  await assert.rejects(verifyKnowledgeBinding(first.binding, context, { value: 'yes', blinding: '00' }));
});

test('commitment helpers capture a stable value before asynchronous crypto', async () => {
  const context = { purpose: 'content', id: 'snapshot' } as const;
  const value = { answer: 'before' };
  const creating = createKnowledgeBinding(context, value);
  value.answer = 'after';
  const created = await creating;
  assert.deepEqual(created.opening.value, { answer: 'before' });
  const verifying = verifyKnowledgeBinding(created.binding, context, created.opening);
  (created.opening.value as { answer: string }).answer = 'mutated-after-check-start';
  assert.deepEqual(await verifying, { answer: 'before' });
});

test('historical expired and retracted records remain decodable without acquiring fresh authority', () => {
  const envelope = base();
  envelope.rights.expiresAt = '1';
  envelope.rights.retainUntil = '2';
  envelope.record.lifecycle = { state: 'retracted', reason: envelope.evaluation.ownerAcceptance.receipt };
  const decoded = decodeKnowledgeEnvelope(envelope);
  assert.equal(decoded.record.lifecycle.state, 'retracted');
  assert.equal(decoded.rights.expiresAt, '1');
  assert.equal(decoded.authority, 'context_only');
  assert.throws(() => decodeKnowledgeEnvelope({ ...envelope, currentGrant: { tool: 'publish' } }));
});

test('revision references preserve exact u64 lineage and reject ambiguous sources', async () => {
  const envelope = base();
  const { binding } = await createKnowledgeBinding({ purpose: 'record_revision', id: 'previous-revision' }, { revision: '18446744073709551614' });
  const previous: KnowledgeRevisionReference = { roomId: envelope.record.roomId, recordId: envelope.record.recordId, revision: '18446744073709551614', binding };
  envelope.record.revision = '18446744073709551615';
  envelope.record.previousRevision = previous;
  for (const evidence of [envelope.evaluation.ownerAcceptance, ...envelope.evaluation.deterministicChecks, ...envelope.evaluation.modelOpinions]) evidence.subject.revision = envelope.record.revision;
  assert.equal(decodeKnowledgeEnvelope(envelope).record.revision, '18446744073709551615');
  assert.throws(() => decodeKnowledgeEnvelope({ ...envelope, record: { ...envelope.record, previousRevision: { ...previous, roomId: 'b'.repeat(64) } } }), /invalid_predecessor/);
  const duplicateRun = base();
  const run = duplicateRun.record.sources[0]!;
  assert.equal(run.kind, 'run');
  if (run.kind === 'run') duplicateRun.record.sources.push({ ...run, originalResult: { ...run.originalResult, digest: 'b'.repeat(64) } });
  assert.throws(() => decodeKnowledgeEnvelope(duplicateRun), /duplicate_reference/);
  const self = base();
  self.record.provenance.derivedFrom.push({ ...previous, revision: '0' });
  assert.throws(() => decodeKnowledgeEnvelope(self), /invalid_lineage/);
  self.record.provenance.derivedFrom = [];
  self.record.lifecycle = { state: 'superseded', replacement: { ...previous, revision: '0' }, reason: self.evaluation.ownerAcceptance.receipt };
  assert.throws(() => decodeKnowledgeEnvelope(self), /invalid_replacement/);
});

test('a valid record signature carries context and cannot grant execution, spending or publication', async () => {
  const envelope = base();
  envelope.record = { ...envelope.record, kind: 'policy', enforcement: 'native_grant_contract', policy: envelope.rights.policy };
  const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair;
  const bytes = knowledgeSigningBytes(envelope);
  const signature = await crypto.subtle.sign('Ed25519', keys.privateKey, bytes);
  assert.equal(await crypto.subtle.verify('Ed25519', keys.publicKey, signature, bytes), true);
  assert.equal(decodeCanonicalKnowledgeEnvelope(encodeKnowledgeEnvelope(envelope)).authority, 'context_only');
  for (const field of ['tools', 'spending', 'publication']) {
    assert.throws(() => knowledgeSigningBytes({ ...envelope, rights: { ...envelope.rights, [field]: true } }));
  }
  assert.equal(PROTOCOL_VERSION, 'backrooms.v0');
});

test('encoding bounds and nesting limits fail before a record is accepted', async () => {
  assert.throws(() => decodeCanonicalKnowledgeEnvelope(' '.repeat(MAX_KNOWLEDGE_ENVELOPE_BYTES + 1)), /encoding_too_large/);
  let deep: unknown = null;
  for (let depth = 0; depth < 66; depth++) deep = { child: deep };
  await assert.rejects(createKnowledgeBinding({ purpose: 'content', id: 'deep' }, deep), /too_deep/);
  await assert.rejects(createKnowledgeBinding({ purpose: 'content', id: 'large' }, 'x'.repeat(MAX_KNOWLEDGE_OPENING_BYTES)), /encoding_too_large/);
  const size = MAX_KNOWLEDGE_OPENING_BYTES - 128;
  const { binding, opening } = await createKnowledgeBinding({ purpose: 'content', id: 'boundary' }, 'x'.repeat(size));
  assert.equal((await verifyKnowledgeBinding(binding, binding.context, opening) as string).length, size);
});
