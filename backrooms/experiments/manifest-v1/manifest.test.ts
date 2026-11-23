import assert from 'node:assert/strict';
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { canonicalJson } from '../../client/codec.js';
import { ManifestRoom, recoverManifest } from './manifest.js';
import vector from './vector.json' with { type: 'json' };

const wire: string = JSON.parse(readFileSync(new URL('../../tests/fixtures/knowledge-v1.vectors.json', import.meta.url), 'utf8')).canonicalEnvelope;
const fresh = () => new ManifestRoom(vector.config);
const request = { predecessor: vector.genesis, ordinal: '1', canonicalEnvelope: wire, event: vector.event };
const evidence = { kind: 'writer_signature', signature: vector.signature };
function signer(label: string) {
  const seed = createHash('sha256').update('K02 public synthetic ' + label).digest();
  return createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), type: 'pkcs8', format: 'der' });
}
function signed(room: ManifestRoom, input: typeof request, label = 'signer') {
  return { kind: 'writer_signature', signature: sign(null, Buffer.from(room.authorization(input), 'hex'), signer(label)).toString('hex') };
}
test('matches independent genesis, append, score and replay-to-pinned-head vectors', () => {
  const room = fresh();
  assert.equal(room.domain, vector.domain);
  assert.equal(room.head.root, vector.emptyRoot);
  assert.equal(room.head.commitment, vector.genesis);
  assert.equal(room.authorization(request), vector.authorization);
  const statement = room.advance(request, evidence);
  assert.deepEqual(statement, { domain: vector.domain, predecessor: vector.genesis, ordinal: '1', authorization: vector.authorization, successor: vector.nextCheckpoint });
  assert.deepEqual(room.head, { revision: '1', root: vector.nextRoot, first: 50, second: 43, commitment: vector.nextCheckpoint });
  assert.deepEqual(recoverManifest(vector.config, [canonicalJson({ request, evidence })], vector.nextCheckpoint), room.head);
  assert.throws(() => recoverManifest(vector.config, [], vector.nextCheckpoint), /recovered_head_mismatch/);
  assert.throws(() => room.advance(request, evidence), /stale_predecessor/);
  const entry = canonicalJson({ request, evidence });
  for (const bad of [entry + ' ', entry.replace('{"evidence":', '{"evidence":null,"evidence":')]) {
    assert.throws(() => recoverManifest(vector.config, [bad], vector.nextCheckpoint), /noncanonical_journal/);
  }
  assert.throws(() => recoverManifest(vector.config, [entry, entry], vector.nextCheckpoint), /stale_predecessor/);
});
for (const field of ['roomId','roomOwner','creationNonce','deployment','program','seedManifest','fixedMembers','writerKey'] as const) {
  test('genesis binds immutable ' + field, () => {
    const room = new ManifestRoom({ ...vector.config, [field]: '01'.repeat(32) });
    assert.notEqual(room.domain, vector.domain);
    assert.notEqual(room.head.commitment, vector.genesis);
    assert.throws(() => room.advance(request, evidence), /stale_predecessor/);
  });
}
test('refuses displaced authority, invalid wire, foreign subject and malformed ordinals atomically', () => {
  const room = fresh();
  const alt = JSON.parse(wire);
  alt.rights.purposes = ['review'];
  assert.throws(() => room.advance({ ...request, canonicalEnvelope: canonicalJson(alt) }, evidence), /signature/);
  const foreign = wire.replaceAll(vector.config.roomId, 'bb'.repeat(32));
  assert.throws(() => room.advance({ ...request, canonicalEnvelope: foreign }, evidence), /room_mismatch/);
  assert.throws(() => room.advance({ ...request, canonicalEnvelope: wire + '\n' }, evidence), /noncanonical/);
  assert.throws(() => room.advance({ ...request, canonicalEnvelope: wire.replace('backrooms.knowledge.v1','backrooms.knowledge.v0') }, evidence));
  for (const ordinal of ['0','2','01','18446744073709551616']) {
    assert.throws(() => room.advance({ ...request, ordinal }, evidence));
  }
  assert.throws(() => room.advance(request, signed(room, request, 'other-writer')), /signature/);
  assert.throws(() => room.advance({ ...request, event: { ...request.event, nonce: '00'.repeat(32) } }, evidence));
  assert.throws(() => room.advance({ ...request, event: { ...request.event, magnitude: 11 } }, evidence));
  assert.throws(() => room.advance({ ...request, event: { ...request.event, selected: 2 } }, evidence));
  assert.equal(room.head.commitment, vector.genesis);
});
test('writer signature covers each acceptance field', () => {
  const room = fresh();
  for (const delta of [
    { nonce: 'bb'.repeat(32) }, { episode: 'bb'.repeat(32) }, { original: 'bb'.repeat(32) }, { candidate: 'bb'.repeat(32) },
    { selected: 0 }, { negative: false }, { magnitude: 0 },
  ]) assert.throws(() => room.advance({ ...request, event: { ...request.event, ...delta } }, evidence), /signature|run_source_mismatch/);
});
test('refuses v0 recovery, artifacts and keys even when the protocol label changes', () => {
  const legacy = { protocolVersion: 'backrooms.v0', checkpoint: { revision: '7', stateCommitment: vector.genesis }, artifactVersion: 'backrooms.localnet.v0' };
  for (const protocolVersion of [legacy.protocolVersion, vector.config.protocol]) {
    assert.throws(() => new ManifestRoom({ ...legacy, protocolVersion }));
    assert.throws(() => new ManifestRoom({ ...vector.config, migration: { ...legacy, protocolVersion } }));
    for (const kind of ['application_proof','proving_key','verifying_key']) {
      const room = fresh();
      assert.throws(() => room.advance(request, { kind, protocolVersion, digest: vector.authorization }));
      assert.throws(() => room.advance(request, { ...evidence, [kind]: vector.authorization }));
      assert.equal(room.head.commitment, vector.genesis);
    }
  }
  assert.throws(() => new ManifestRoom({ ...vector.config, protocol: 'backrooms.v0' }));
  assert.throws(() => new ManifestRoom({ ...vector.config, knowledgeSchema: 'backrooms.knowledge.v0' }));
  assert.throws(() => fresh().advance(request, { kind: 'writer_signature', signature: '23'.repeat(64) }), /signature/);
});
test('retains one winning successor and both bounded scores across ordered replay', () => {
  const room = fresh();
  const history: string[] = [];
  for (let i = 0; i < 12; i++) {
    const input = { ...request, predecessor: room.head.commitment, ordinal: String(i+1), event: { ...vector.event, selected: i < 6 ? 0 : 1, negative: i >= 6, magnitude: 10 } };
    const approval = signed(room, input);
    const competitor = { ...input, event: { ...input.event, magnitude: 3 } };
    const competingApproval = signed(room, competitor);
    room.advance(input, approval);
    assert.throws(() => room.advance(competitor, competingApproval), /stale_predecessor/);
    history.push(canonicalJson({ request: input, evidence: approval }));
  }
  assert.equal(room.head.first, 100);
  assert.equal(room.head.second, 0);
  assert.deepEqual(recoverManifest(vector.config, history, room.head.commitment), room.head);
  assert.throws(() => recoverManifest(vector.config, history.slice(1), room.head.commitment), /stale_predecessor/);
  assert.throws(() => recoverManifest(vector.config, history.toReversed(), room.head.commitment), /stale_predecessor/);
});

test('binds canonical owner-acceptance evidence independently of the writer signature', () => {
  const room = fresh();
  const envelope = JSON.parse(wire);
  envelope.evaluation.ownerAcceptance.receipt.digest = 'f0'.repeat(32);
  const changed = { ...request, canonicalEnvelope: canonicalJson(envelope) };
  assert.notEqual(room.authorization(changed), vector.authorization);
  assert.throws(() => room.advance(changed, evidence), /signature/);
  delete envelope.evaluation.ownerAcceptance;
  assert.throws(() => room.authorization({ ...request, canonicalEnvelope: canonicalJson(envelope) }));
  assert.equal(room.head.commitment, vector.genesis);
});

test('a fresh signature cannot reconcile an unmatched run and original-result pair', () => {
  const room = fresh();
  const envelope = JSON.parse(wire);
  const second = structuredClone(envelope.record.sources[0]);
  second.runId = 'run-002';
  second.run.digest = 'ba'.repeat(32);
  second.originalResult.digest = 'cd'.repeat(32);
  envelope.record.sources.push(second);
  const mixed = { ...request, canonicalEnvelope: canonicalJson(envelope), event: { ...request.event, original: second.originalResult.digest } };
  assert.throws(() => room.authorization(mixed), /run_source_mismatch/);
});

test('changing trusted membership cannot carry over a signature even with a fresh predecessor', () => {
  const room = new ManifestRoom({ ...vector.config, fixedMembers: 'ed'.repeat(32) });
  assert.throws(() => room.advance({ ...request, predecessor: room.head.commitment }, evidence), /signature/);
  assert.throws(() => recoverManifest({ ...vector.config, roomOwner: 'ab'.repeat(32) }, [canonicalJson({ request, evidence })], vector.nextCheckpoint), /stale_predecessor/);
});

test('changing caller-owned objects cannot change the configured or exposed head', () => {
  const supplied = { ...vector.config };
  const room = new ManifestRoom(supplied);
  supplied.fixedMembers = 'ac'.repeat(32);
  assert.throws(() => Object.assign(room.head, { first: 99 }), TypeError);
  assert.equal(room.advance(request, evidence).successor, vector.nextCheckpoint);
});

for (const name of ['constructor', 'toString', '__proto__']) {
  test('genesis refuses undeclared own config field ' + name, () => {
    assert.throws(() => new ManifestRoom({ ...vector.config, [name]: 'undeclared' }), /invalid_manifest_object/);
  });
  for (const boundary of ['request', 'event', 'evidence', 'journal']) {
    test(boundary + ' refuses undeclared own field ' + name, () => {
      const room = fresh();
      const input = boundary === 'request' ? { ...request, [name]: 'undeclared' }
        : boundary === 'event' ? { ...request, event: { ...request.event, [name]: 'undeclared' } } : request;
      const approval = boundary === 'evidence' ? { ...evidence, [name]: 'undeclared' } : evidence;
      if (boundary !== 'journal') {
        if (boundary !== 'evidence') assert.throws(() => room.authorization(input), /invalid_manifest_object/);
        assert.throws(() => room.advance(input, approval), /invalid_manifest_object/);
        assert.equal(room.head.commitment, vector.genesis);
      }
      const entry = { request: input, evidence: approval, ...(boundary === 'journal' ? { [name]: 'undeclared' } : {}) };
      assert.throws(() => recoverManifest(vector.config, [canonicalJson(entry)], vector.nextCheckpoint), /invalid_manifest_object/);
    });
  }
}

test('accepts only plain JSON data properties and preserves replay after a refusal', () => {
  const room = fresh();
  let reads = 0;
  const getterEvidence = Object.defineProperty({ ...evidence }, 'signature', {
    enumerable: true, get() { reads++; return evidence.signature; },
  });
  const badEvidence = [
    getterEvidence, Object.create(evidence), new Proxy(evidence, {}),
    { ...evidence, [Symbol('extra')]: true }, Object.defineProperty({ ...evidence }, 'kind', { enumerable: false }),
  ];
  for (const malformed of badEvidence) {
    assert.throws(() => room.advance(request, malformed), /invalid_manifest_object/);
    assert.equal(room.head.commitment, vector.genesis);
  }
  assert.equal(reads, 0);
  const statement = room.advance(request, evidence);
  assert.equal(statement.successor, vector.nextCheckpoint);
  assert.deepEqual(recoverManifest(vector.config, [canonicalJson({ request, evidence })], statement.successor), room.head);
});
