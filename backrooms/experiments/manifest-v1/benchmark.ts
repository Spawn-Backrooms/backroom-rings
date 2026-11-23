import assert from 'node:assert/strict';
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { canonicalJson } from '../../client/codec.js';
import { MAX_LESSON_BYTES, PROTOCOL_VERSION, type AdvanceRoomInput, type BridgeRequest } from '../../client/contracts.js';
import { RingsClient } from '../../client/rings-client.js';
import { encodeKnowledgeEnvelope } from '../../client/knowledge.js';
import { ManifestRoom, recoverManifest } from './manifest.js';
import vector from './vector.json' with { type: 'json' };

const source = JSON.parse(readFileSync(new URL('../../tests/fixtures/knowledge-v1.vectors.json', import.meta.url), 'utf8'));
const canonicalEnvelope: string = source.canonicalEnvelope;
const lesson: string = source.bindings.find((b: { id: string }) => b.id === 'content-001').opening.value;
const { config, event } = vector;
const request = { predecessor: vector.genesis, ordinal: '1', event, canonicalEnvelope };
const evidence = { kind: 'writer_signature', signature: vector.signature };
const journal = canonicalJson({ request, evidence });

// Public synthetic bridge replies. The real v0 TypeScript client checks its wire protocol;
// no Rust state creation, validation, proving, transaction construction, or indexed lookup takes place.
const fakeDigest = (label: string) => createHash('sha256').update('K02 v0 fixture ' + label).digest('hex');
const predecessor = fakeDigest('predecessor');
const checkpoint = { roomId: config.roomId, uniqueAddress: fakeDigest('unique'), revision: '1', stateCommitment: fakeDigest('successor') };
const tx = Buffer.from('K02 synthetic bridge frame');
const frame = { transactionBase64: tx.toString('base64'), transactionDigest: createHash('sha256').update(tx).digest('hex') };
const authorizationCommitment = fakeDigest('authorization');
const artifactVersion = 'backrooms.localnet.v0';
const input: AdvanceRoomInput = {
  roomId: config.roomId, expectedPredecessor: predecessor, ordinal: '1', episodeCommitment: event.episode,
  originalResultCommitment: event.original, candidateCommitment: event.candidate, acceptanceNonce: event.nonce,
  minimumConfirmedSlot: '1', lesson, selectedProcedure: 1, feedback: { negative: true, magnitude: 7 },
};
async function mockBridge(req: BridgeRequest) {
  const common = { protocolVersion: PROTOCOL_VERSION, operationId: req.operationId };
  switch (req.op) {
    case 'prepare_advance': return { ...common, status: 'prepared', artifactVersion, checkpoint, ...frame, authorizationCommitment,
      proofs: { applicationProofDigest: fakeDigest('proof'), privateTxHash: fakeDigest('privateTxHash') } };
    case 'submit': return { ...common, status: 'confirmed', signature: 'synthetic', slot: '1' };
    case 'recover': return { ...common, status: 'recovered', checkpoint, artifactVersion, signature: 'synthetic', slot: '1', contextSlot: '1',
      writerIdentity: config.writerKey, seedManifestCommitment: config.seedManifest, fixedMembersCommitment: config.fixedMembers,
      memory: { lesson, episodeCommitment: event.episode, originalResultCommitment: event.original, candidateCommitment: event.candidate,
        predecessorCommitment: predecessor, authorizationCommitment }, policy: { policyId: '1', scores: [50, 43] } };
    default: throw new Error('unexpected_benchmark_operation');
  }
}
async function v0Cycle() {
  const client = new RingsClient({ request: mockBridge }, artifactVersion);
  const prepared = await client.prepareAdvance('bench', input);
  assert.equal((await client.submit(prepared)).status, 'confirmed');
  const room = await new RingsClient({ request: mockBridge }, artifactVersion).recover('bench/recover', config.roomId, '1');
  assert.equal(room.status, 'recovered');
  assert.equal(room.memory.lesson, lesson);
  assert.deepEqual(room.policy.scores, [50, 43]);
}
function manifestCycle() {
  const room = new ManifestRoom(config);
  assert.equal(room.authorization(request), vector.authorization);
  const statement = room.advance(request, evidence);
  assert.equal(statement.successor, vector.nextCheckpoint);
  const recovered = recoverManifest(config, [journal], vector.nextCheckpoint);
  assert.equal(recovered.root, vector.nextRoot);
  assert.deepEqual([recovered.first, recovered.second], [50, 43]);
}

const warmup = 20;
const samples = 51;
const batchSize = 3;
async function sample(cycle: () => void | Promise<void>) {
  const start = performance.now();
  for (let i = 0; i < batchSize; i++) await cycle();
  return (performance.now() - start) / batchSize;
}
for (let i = 0; i < warmup; i++) { await v0Cycle(); manifestCycle(); }
const timings = { v0ClientMockBridge: [] as number[], manifestModel: [] as number[] };
for (let i = 0; i < samples; i++) {
  if (i % 2 === 0) timings.v0ClientMockBridge.push(await sample(v0Cycle));
  timings.manifestModel.push(await sample(manifestCycle));
  if (i % 2 !== 0) timings.v0ClientMockBridge.push(await sample(v0Cycle));
}
function summarize(values: number[]) {
  const sorted = values.toSorted((a,b) => a-b);
  const ms = (quantile: number) => Number(sorted[Math.ceil(values.length * quantile) - 1]!.toFixed(3));
  return { median: ms(0.5), p95: ms(0.95) };
}
// Grow a fresh synthetic log with distinct record subjects. Signing and journal construction
// are outside the recovery timer. Each timed replay starts again from trusted genesis.
const key = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'),
  createHash('sha256').update('K02 public synthetic signer').digest()]), type: 'pkcs8', format: 'der' });
const longRoom = new ManifestRoom(config);
const history: string[] = [];
const recovery = [];
for (let n = 1; n <= 32; n++) {
  const envelope = JSON.parse(canonicalEnvelope);
  const recordId = 'bench-' + n;
  envelope.record.recordId = recordId;
  const channels = envelope.evaluation;
  for (const assessment of [channels.ownerAcceptance, ...channels.deterministicChecks, ...channels.modelOpinions, ...channels.externalAcceptances]) {
    assessment.subject.recordId = recordId;
  }
  const input = { canonicalEnvelope: encodeKnowledgeEnvelope(envelope), ordinal: String(n),
    predecessor: longRoom.head.commitment, event: { ...event, nonce: fakeDigest('bench nonce ' + n) } };
  const approval = { kind: 'writer_signature', signature: sign(null, Buffer.from(longRoom.authorization(input), 'hex'), key).toString('hex') };
  longRoom.advance(input, approval);
  history.push(canonicalJson({ request: input, evidence: approval }));
  if ([1,8,32].includes(n)) {
    const tip = longRoom.head.commitment;
    const replay = () => { assert.equal(recoverManifest(config, history, tip).commitment, tip); };
    replay();
    const measured = [];
    for (let i = 0; i < 11; i++) measured.push(await sample(replay));
    recovery.push({ entries: n, journalBytes: history.reduce((sum, entry) => sum + Buffer.byteLength(entry), 0), ...summarize(measured) });
  }
}
console.log(JSON.stringify({
  evidence: 'synthetic_node_reference_only', node: process.version, os: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
  warmupCyclesPerPath: warmup, alternatingSamplesPerPath: samples, cyclesPerSample: batchSize,
  millisecondsPerCycle: { v0ClientMockBridge: summarize(timings.v0ClientMockBridge), manifestModel: summarize(timings.manifestModel) },
  replayMilliseconds: { warmup: 1, samples: 11, cyclesPerSample: batchSize, sizes: recovery },
  bytes: { contentOpeningUtf8: Buffer.byteLength(lesson), v0LessonCapacity: MAX_LESSON_BYTES,
    v0LessonWithLengthAndScope: MAX_LESSON_BYTES+2, v0AcceptedMemoryIncludingThreeDigests: MAX_LESSON_BYTES+2+3*32,
    manifestRoot: Buffer.from(vector.nextRoot,'hex').length, canonicalEnvelope: Buffer.byteLength(canonicalEnvelope), canonicalJournalEntry: Buffer.byteLength(journal) },
}, null, 2));
