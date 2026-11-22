import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { base64, digestBytes, randomHex, utf8 } from '../client/codec.js';
import { PROTOCOL_VERSION, type AdvanceRoomInput, type BridgeRequest, type CreateRoomInput, type EpisodeBinding, type OriginalResult, type PreparedTransaction, type PriorTransactionFrame, type PrivateRecordStore, type RecoveredRoom, type RingsTransport } from '../client/contracts.js';
import { LearningCoordinator } from '../client/learning.js';
import { RingsClient } from '../client/rings-client.js';
import { ReferenceAuthority } from '../reference-host/authority.js';
import { ReferenceHost } from '../reference-host/host.js';
import { EncryptedSqliteRecords } from '../reference-host/records.js';

function recoveredFixture(): RecoveredRoom {
  const zero = '0'.repeat(64);
  return {
    protocolVersion: PROTOCOL_VERSION, operationId: 'injected-expiry-state', status: 'recovered',
    checkpoint: { roomId: randomHex(), uniqueAddress: randomHex(), stateCommitment: randomHex(), revision: '0' },
    memory: { lesson: '', episodeCommitment: zero, originalResultCommitment: zero, candidateCommitment: zero, predecessorCommitment: zero, authorizationCommitment: zero },
    policy: { policyId: '1', scores: [50, 50] }, slot: '1', signature: 'unit-fixture-signature',
    seedManifestCommitment: randomHex(), fixedMembersCommitment: randomHex(), writerIdentity: 'unit-fixture-writer', artifactVersion: 'backrooms.localnet.v0',
  };
}

class ExpiryProtocolFixture implements RingsTransport {
  prepared: PreparedTransaction | undefined;
  advance: AdvanceRoomInput | undefined;
  creation: CreateRoomInput | undefined;
  current: RecoveredRoom | undefined;
  prepareCalls = 0;
  reframeCalls = 0;
  oldSubmissions = 0;
  submitted: string[] = [];
  oldStatus: 'expired' | 'unknown' = 'expired';
  reframeResult: 'replace' | 'confirmed' | 'unknown' | 'live' | 'wrong-parent' = 'replace';
  recoveryUnavailable = false;
  loseAcknowledgement = false;
  onReplacementSubmit: ((digest: string) => Promise<void>) | undefined;
  private readonly replacementBytes = utf8(`UNIT TRANSPORT FIXTURE ONLY, no Solana transaction or proof: ${randomHex()}`);

  constructor(readonly predecessor?: RecoveredRoom) { this.current = predecessor; }

  private accepted(): RecoveredRoom {
    if (!this.prepared) throw new Error('fixture_not_prepared');
    const state = this.predecessor ?? recoveredFixture();
    if (this.creation) {
      state.seedManifestCommitment = this.creation.seedManifestCommitment;
      state.fixedMembersCommitment = this.creation.fixedMembersCommitment;
    }
    return {
      ...state, checkpoint: this.prepared.checkpoint, slot: '2', signature: 'accepted-unit-signature',
      ...(this.advance ? {
        policy: { policyId: '1' as const, scores: [40, 50] as [number, number] },
        memory: {
          lesson: this.advance.lesson, episodeCommitment: this.advance.episodeCommitment,
          originalResultCommitment: this.advance.originalResultCommitment, candidateCommitment: this.advance.candidateCommitment,
          predecessorCommitment: this.advance.expectedPredecessor, authorizationCommitment: this.prepared.authorizationCommitment!,
        },
      } : {}),
    };
  }

  async request(request: BridgeRequest): Promise<unknown> {
    const envelope = { protocolVersion: PROTOCOL_VERSION, operationId: request.operationId };
    if (request.op === 'prepare_create' || request.op === 'prepare_advance') {
      this.prepareCalls++;
      assert.equal(this.prepared, undefined, 'an expired frame must not prepare another proof');
      const bytes = utf8(`UNIT TRANSPORT FIXTURE old frame, no Solana proof: ${randomHex()}`);
      const checkpoint = this.predecessor ? { ...this.predecessor.checkpoint, revision: '1', stateCommitment: randomHex() } : { roomId: randomHex(), uniqueAddress: randomHex(), stateCommitment: randomHex(), revision: '0' };
      if (request.op === 'prepare_advance') this.advance = request.input;
      else this.creation = request.input;
      this.prepared = {
        ...envelope, status: 'prepared', transactionBase64: base64(bytes), transactionDigest: await digestBytes(bytes), checkpoint,
        proofs: { applicationProofDigest: randomHex(), privateTxHash: randomHex() }, artifactVersion: 'backrooms.localnet.v0',
        ...(this.advance ? { authorizationCommitment: randomHex() } : {}),
      };
      return this.prepared;
    }
    if (request.op === 'recover') {
      if (this.recoveryUnavailable && this.oldSubmissions > 0) throw new Error('injected_indexer_outage');
      return this.current ? { ...this.current, ...envelope } : { ...envelope, status: 'not_found' };
    }
    assert.ok(this.prepared);
    if (request.op === 'submit') {
      this.submitted.push(request.input.transactionDigest);
      if (request.input.transactionDigest === this.prepared.transactionDigest) {
        this.oldSubmissions++;
        return { ...envelope, status: this.oldStatus, signature: 'expired-unit-signature' };
      }
      assert.equal(request.input.transactionDigest, await digestBytes(this.replacementBytes));
      await this.onReplacementSubmit?.(request.input.transactionDigest);
      this.current = this.accepted();
      if (this.loseAcknowledgement) throw new Error('injected_lost_acknowledgement');
      return { ...envelope, status: 'confirmed', slot: '2', signature: 'accepted-unit-signature' };
    }
    assert.equal(request.op, 'reframe');
    this.reframeCalls++;
    assert.equal(request.input.transactionDigest, this.prepared.transactionDigest);
    if (this.reframeResult === 'live') return { ...envelope, status: 'error', error: { code: 'transaction_live' } };
    if (this.reframeResult === 'unknown') return { ...envelope, status: 'unknown', signature: 'expired-unit-signature' };
    if (this.reframeResult === 'confirmed') {
      this.current = this.accepted();
      return { ...envelope, status: 'confirmed', slot: '2', signature: 'accepted-unit-signature' };
    }
    return {
      ...envelope, status: 'reframed', transactionBase64: base64(this.replacementBytes), transactionDigest: await digestBytes(this.replacementBytes),
      parentTransactionDigest: this.reframeResult === 'wrong-parent' ? randomHex() : this.prepared.transactionDigest, signature: 'replacement-unit-signature',
    };
  }
}

async function learningFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'backrooms-expiry-'));
  const key = crypto.getRandomValues(new Uint8Array(32));
  const records = await EncryptedSqliteRecords.open(join(directory, 'records.sqlite'), key, 'test-host');
  const room = recoveredFixture();
  const binding: EpisodeBinding = { roomId: room.checkpoint.roomId, episodeId: 'expired-learning', episodeCommitment: randomHex(), predecessor: room.checkpoint, ordinal: '1', minimumConfirmedSlot: '1', residentIds: ['investigator', 'critic'] };
  const original: OriginalResult = { episodeId: binding.episodeId, originalResultCommitment: randomHex(), candidateCommitment: randomHex(), investigator: 'retained candidate', critic: 'retained feedback', proposal: { lesson: 'Retain the original.', selectedProcedure: 0, feedback: { negative: true, magnitude: 10 } } };
  const transport = new ExpiryProtocolFixture(room);
  let inferenceCalls = 0;
  return {
    directory, key, records, room, binding, original, transport,
    get inferenceCalls() { return inferenceCalls; },
    coordinator(store: PrivateRecordStore = records) {
      return new LearningCoordinator(new ReferenceAuthority(store), { run: async () => { inferenceCalls++; return original; } }, new RingsClient(transport, 'backrooms.localnet.v0'), store);
    },
    async close() { records.close(); await rm(directory, { recursive: true, force: true }); },
  };
}

interface JournalFrame { prepared: PreparedTransaction; priorFrames?: PriorTransactionFrame[]; authorization?: AdvanceRoomInput }

test('explicit transport expiry reframes learning only after recovery and persists the replacement before a lost acknowledgement', async () => {
  const fixture = await learningFixture();
  try {
    fixture.transport.loseAcknowledgement = true;
    fixture.transport.onReplacementSubmit = async transactionDigest => {
      const grant = await new ReferenceAuthority(fixture.records).authorizeAcceptance(fixture.binding, fixture.original);
      const journal = (await fixture.records.read<JournalFrame>(`commit/${grant.operationId}`))!.value;
      assert.equal(journal.prepared.transactionDigest, transactionDigest);
      assert.deepEqual(journal.prepared.checkpoint, fixture.transport.prepared!.checkpoint);
      assert.deepEqual(journal.prepared.proofs, fixture.transport.prepared!.proofs);
      assert.equal(journal.prepared.authorizationCommitment, fixture.transport.prepared!.authorizationCommitment);
      assert.equal(journal.authorization!.acceptanceNonce, fixture.transport.advance!.acceptanceNonce);
      assert.equal(journal.priorFrames![0]!.transactionDigest, fixture.transport.prepared!.transactionDigest);
    };
    const result = await fixture.coordinator().run(fixture.binding, fixture.room);
    assert.equal(result.status, 'accepted');
    assert.deepEqual(result.originalResult, fixture.original);
    assert.equal(fixture.inferenceCalls, 1);
    assert.equal(fixture.transport.prepareCalls, 1);
    assert.equal(fixture.transport.reframeCalls, 1);
    assert.equal(fixture.transport.submitted.length, 2);
  } finally { await fixture.close(); }
});

test('a lost replacement CAS prevents submission and a restart reuses the original authorization', async () => {
  const fixture = await learningFixture();
  let reopened: EncryptedSqliteRecords | undefined;
  try {
    let replacementRefused = false;
    const competingStore: PrivateRecordStore = {
      read: key => fixture.records.read(key), create: (key, value) => fixture.records.create(key, value),
      replace: async (key, version, value) => {
        const candidate = value as Partial<JournalFrame>;
        if (!replacementRefused && candidate.priorFrames?.length) {
          replacementRefused = true;
          const existing = (await fixture.records.read(key))!;
          assert.equal(await fixture.records.replace(key, existing.version, existing.value), true);
        }
        return fixture.records.replace(key, version, value);
      },
    };
    const first = await fixture.coordinator(competingStore).run(fixture.binding, fixture.room);
    assert.equal(first.status, 'commit_pending');
    assert.equal(fixture.transport.submitted.length, 1);
    const acceptanceNonce = fixture.transport.advance!.acceptanceNonce;
    fixture.records.close();
    reopened = await EncryptedSqliteRecords.open(join(fixture.directory, 'records.sqlite'), fixture.key, 'test-host');
    const resumed = await fixture.coordinator(reopened).run(fixture.binding, fixture.room);
    assert.equal(resumed.status, 'accepted');
    assert.equal(fixture.inferenceCalls, 1);
    assert.equal(fixture.transport.prepareCalls, 1);
    assert.equal(fixture.transport.advance!.acceptanceNonce, acceptanceNonce);
  } finally {
    reopened?.close();
    if (!reopened) fixture.records.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('a replacement saved before an interrupted acknowledgement survives restart without another proof or inference', async () => {
  const fixture = await learningFixture();
  let reopened: EncryptedSqliteRecords | undefined;
  try {
    let interrupted = false;
    const interruptedStore: PrivateRecordStore = {
      read: key => fixture.records.read(key), create: (key, value) => fixture.records.create(key, value),
      replace: async (key, version, value) => {
        const saved = await fixture.records.replace(key, version, value);
        if (!interrupted && saved && (value as Partial<JournalFrame>).priorFrames?.length) {
          interrupted = true;
          throw new Error('injected_persistence_acknowledgement_loss');
        }
        return saved;
      },
    };
    const first = await fixture.coordinator(interruptedStore).run(fixture.binding, fixture.room);
    assert.equal(first.status, 'commit_pending');
    assert.equal(fixture.transport.submitted.length, 1);
    const authorization = await new ReferenceAuthority(fixture.records).authorizeAcceptance(fixture.binding, fixture.original);
    const saved = (await fixture.records.read<JournalFrame>(`commit/${authorization.operationId}`))!.value;
    assert.notEqual(saved.prepared.transactionDigest, fixture.transport.prepared!.transactionDigest);
    fixture.records.close();
    reopened = await EncryptedSqliteRecords.open(join(fixture.directory, 'records.sqlite'), fixture.key, 'test-host');
    const resumed = await fixture.coordinator(reopened).run(fixture.binding, fixture.room);
    assert.equal(resumed.status, 'accepted');
    assert.deepEqual(resumed.originalResult, fixture.original);
    assert.equal(fixture.transport.submitted[1], saved.prepared.transactionDigest);
    assert.equal(fixture.transport.submitted.length, 2);
    assert.equal(fixture.transport.reframeCalls, 1);
    assert.equal(fixture.transport.prepareCalls, 1);
    assert.equal(fixture.inferenceCalls, 1);
  } finally {
    reopened?.close();
    if (!reopened) fixture.records.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

for (const condition of ['unknown', 'recovery-outage', 'reframe-unknown', 'live', 'wrong-parent'] as const) {
  test(`learning transport ${condition} cannot authorize a replacement submission`, async () => {
    const fixture = await learningFixture();
    try {
      if (condition === 'unknown') fixture.transport.oldStatus = 'unknown';
      if (condition === 'recovery-outage') fixture.transport.recoveryUnavailable = true;
      if (condition === 'reframe-unknown') fixture.transport.reframeResult = 'unknown';
      if (condition === 'live') fixture.transport.reframeResult = 'live';
      if (condition === 'wrong-parent') fixture.transport.reframeResult = 'wrong-parent';
      assert.equal((await fixture.coordinator().run(fixture.binding, fixture.room)).status, 'commit_pending');
      assert.equal(fixture.transport.submitted.length, 1);
      assert.equal(fixture.transport.reframeCalls, condition === 'unknown' || condition === 'recovery-outage' ? 0 : 1);
      assert.equal(fixture.inferenceCalls, 1);
    } finally { await fixture.close(); }
  });
}

test('reframing an already confirmed learning operation recovers it without another transaction', async () => {
  const fixture = await learningFixture();
  try {
    fixture.transport.reframeResult = 'confirmed';
    assert.equal((await fixture.coordinator().run(fixture.binding, fixture.room)).status, 'accepted');
    assert.equal(fixture.transport.submitted.length, 1);
    assert.equal(fixture.transport.prepareCalls, 1);
    assert.equal(fixture.inferenceCalls, 1);
  } finally { await fixture.close(); }
});

for (const condition of ['unknown', 'recovery-outage', 'live'] as const) {
  test(`genesis transport ${condition} retains its original frame without replacement submission`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'backrooms-genesis-pending-'));
    const transport = new ExpiryProtocolFixture();
    const host = await ReferenceHost.open({ directory, transport });
    try {
      if (condition === 'unknown') transport.oldStatus = 'unknown';
      if (condition === 'recovery-outage') transport.recoveryUnavailable = true;
      if (condition === 'live') transport.reframeResult = 'live';
      await assert.rejects(host.ensureRoom());
      const saved = (await host.records.read<JournalFrame>('genesis'))!.value;
      assert.equal(saved.prepared.transactionDigest, transport.prepared!.transactionDigest);
      assert.equal(saved.priorFrames, undefined);
      assert.equal(transport.submitted.length, 1);
      assert.equal(transport.reframeCalls, condition === 'live' ? 1 : 0);
      assert.equal(host.residents.inferenceCalls, 0);
    } finally { await host.close(); await rm(directory, { recursive: true, force: true }); }
  });
}

test('expired genesis transport preserves its nonce, proof and checkpoint through durable reframing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'backrooms-genesis-expiry-'));
  const transport = new ExpiryProtocolFixture();
  const host = await ReferenceHost.open({ directory, transport });
  try {
    transport.loseAcknowledgement = true;
    transport.onReplacementSubmit = async transactionDigest => {
      const journal = (await host.records.read<JournalFrame & { input: CreateRoomInput }>('genesis'))!.value;
      assert.equal(journal.prepared.transactionDigest, transactionDigest);
      assert.deepEqual(journal.prepared.proofs, transport.prepared!.proofs);
      assert.deepEqual(journal.prepared.checkpoint, transport.prepared!.checkpoint);
      assert.equal(journal.input.creationNonce, transport.creation!.creationNonce);
      assert.equal(journal.priorFrames![0]!.transactionDigest, transport.prepared!.transactionDigest);
    };
    const room = await host.ensureRoom();
    assert.equal(room.checkpoint.stateCommitment, transport.prepared!.checkpoint.stateCommitment);
    assert.equal(transport.prepareCalls, 1);
    assert.equal(transport.reframeCalls, 1);
    assert.equal(transport.submitted.length, 2);
    assert.equal(host.residents.inferenceCalls, 0);
  } finally { await host.close(); await rm(directory, { recursive: true, force: true }); }
});
