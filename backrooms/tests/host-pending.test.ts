import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { base64, digest, digestBytes, randomHex, utf8 } from '../client/codec.js';
import { PROTOCOL_VERSION, type AdvanceRoomInput, type BridgeRequest, type EpisodeBinding, type PreparedTransaction, type RecoveredRoom, type RingsTransport } from '../client/contracts.js';
import { ReferenceAuthority } from '../reference-host/authority.js';
import { ReferenceHost } from '../reference-host/host.js';

type FixtureRoom = RecoveredRoom & { contextSlot: string };
interface PreparedFixture { transaction: PreparedTransaction; room: FixtureRoom }

class PendingAcceptanceTransport implements RingsTransport {
  current: FixtureRoom | undefined;
  recoveredView: FixtureRoom | undefined;
  acceptanceRecoveryUnavailable = false;
  advancePreparations = 0;
  advanceSubmissions = 0;
  private readonly transactions = new Map<string, PreparedFixture>();
  private readonly confirmed = new Set<string>();

  async request(request: BridgeRequest): Promise<unknown> {
    const envelope = { protocolVersion: PROTOCOL_VERSION, operationId: request.operationId };
    if (request.op === 'recover') {
      if (this.acceptanceRecoveryUnavailable && request.operationId.startsWith('accept/')) throw new Error('injected_acceptance_recovery_outage');
      const recovered = this.recoveredView ?? this.current;
      return recovered ? { ...recovered, ...envelope } : { ...envelope, status: 'not_found', contextSlot: '1' };
    }
    if (request.op === 'submit') {
      const prepared = this.transactions.get(request.input.transactionDigest);
      assert.ok(prepared);
      if (!this.confirmed.has(request.input.transactionDigest)) {
        this.confirmed.add(request.input.transactionDigest);
        this.current = prepared.room;
        if (prepared.transaction.authorizationCommitment) {
          this.advanceSubmissions++;
          if (this.advanceSubmissions === 1) this.acceptanceRecoveryUnavailable = true;
        }
      }
      return { ...envelope, status: 'confirmed', slot: prepared.room.slot, signature: prepared.room.signature };
    }
    if (request.op === 'reframe') throw new Error('unexpected_fixture_reframe');
    const bytes = utf8(`TEST TRANSPORT ONLY, no Solana transaction or proof: ${request.operationId}`);
    let room: FixtureRoom;
    let authorizationCommitment: string | undefined;
    if (request.op === 'prepare_create') {
      const zero = '0'.repeat(64);
      room = {
        ...envelope, status: 'recovered', artifactVersion: 'backrooms.localnet.v0',
        checkpoint: { roomId: randomHex(), uniqueAddress: randomHex(), stateCommitment: randomHex(), revision: '0' },
        memory: { lesson: '', episodeCommitment: zero, originalResultCommitment: zero, candidateCommitment: zero, predecessorCommitment: zero, authorizationCommitment: zero },
        policy: { policyId: '1', scores: [50, 50] }, slot: '1', contextSlot: '1', signature: 'genesis-unit-signature',
        seedManifestCommitment: request.input.seedManifestCommitment, fixedMembersCommitment: request.input.fixedMembersCommitment, writerIdentity: 'unit-fixture-writer',
      };
    } else {
      assert.equal(request.op, 'prepare_advance');
      assert.ok(this.current);
      if (request.input.expectedPredecessor !== this.current.checkpoint.stateCommitment) return { ...envelope, status: 'error', error: { code: 'state_conflict' } };
      this.advancePreparations++;
      authorizationCommitment = randomHex();
      room = this.advance(request.input, authorizationCommitment);
    }
    const transaction: PreparedTransaction = {
      ...envelope, status: 'prepared', transactionBase64: base64(bytes), transactionDigest: await digestBytes(bytes),
      checkpoint: room.checkpoint, proofs: { applicationProofDigest: randomHex(), privateTxHash: randomHex() },
      artifactVersion: room.artifactVersion, ...(authorizationCommitment ? { authorizationCommitment } : {}),
    };
    this.transactions.set(transaction.transactionDigest, { transaction, room });
    return transaction;
  }

  private advance(input: AdvanceRoomInput, authorizationCommitment: string): FixtureRoom {
    assert.ok(this.current);
    assert.equal(input.ordinal, (BigInt(this.current.checkpoint.revision) + 1n).toString());
    const scores: [number, number] = [...this.current.policy.scores];
    scores[input.selectedProcedure] = Math.max(0, Math.min(100, scores[input.selectedProcedure] + (input.feedback.negative ? -1 : 1) * input.feedback.magnitude));
    const slot = (BigInt(this.current.slot) + 1n).toString();
    return {
      ...this.current, checkpoint: { ...this.current.checkpoint, stateCommitment: randomHex(), revision: input.ordinal },
      slot, contextSlot: slot, signature: `advance-unit-signature-${input.ordinal}`, policy: { policyId: '1', scores },
      memory: {
        lesson: input.lesson, episodeCommitment: input.episodeCommitment, originalResultCommitment: input.originalResultCommitment,
        candidateCommitment: input.candidateCommitment, predecessorCommitment: input.expectedPredecessor, authorizationCommitment,
      },
    };
  }
}

async function hostFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'backrooms-pending-host-'));
  const transport = new PendingAcceptanceTransport();
  let host = await ReferenceHost.open({ directory, transport });
  return {
    transport,
    get host() { return host; },
    async reopen() { await host.close(); host = await ReferenceHost.open({ directory, transport }); },
    async close() { await host.close(); await rm(directory, { recursive: true, force: true }); },
  };
}

test('a new host episode retains the prior confirmed acceptance receipt before consuming its checkpoint', async () => {
  const fixture = await hostFixture();
  try {
    const first = await fixture.host.episode('first');
    assert.equal(first.status, 'commit_pending');
    assert.equal(fixture.transport.current?.checkpoint.revision, '1');
    assert.equal(fixture.host.residents.inferenceCalls, 4);
    await fixture.reopen();
    fixture.transport.acceptanceRecoveryUnavailable = false;
    const next = await fixture.host.episode('next');
    assert.equal(next.status, 'accepted');
    assert.equal(fixture.transport.current?.checkpoint.revision, '2');
    const replay = await fixture.host.episode('first');
    assert.equal(replay.status, 'accepted');
    if (replay.status === 'accepted') assert.equal(replay.room.checkpoint.revision, '1');
    assert.deepEqual(replay.originalResult, first.originalResult);
    assert.equal(fixture.host.residents.inferenceCalls, 4);
    assert.equal(fixture.transport.advancePreparations, 2);
    assert.equal(fixture.transport.advanceSubmissions, 2);
  } finally { await fixture.close(); }
});

test('an acceptance recovery outage blocks new episode and inspection labels before inference across restart', async () => {
  const fixture = await hostFixture();
  try {
    assert.equal((await fixture.host.episode('first')).status, 'commit_pending');
    await assert.rejects(fixture.host.episode('next'), /room_episode_in_progress/);
    await assert.rejects(fixture.host.inspectNextEpisode('preview'), /room_episode_in_progress/);
    assert.equal(fixture.host.residents.inferenceCalls, 4);
    assert.equal(fixture.transport.advancePreparations, 1);
    await fixture.reopen();
    await assert.rejects(fixture.host.episode('next'), /room_episode_in_progress/);
    await assert.rejects(fixture.host.inspectNextEpisode('preview'), /room_episode_in_progress/);
    assert.equal(fixture.host.residents.inferenceCalls, 0);
    fixture.transport.acceptanceRecoveryUnavailable = false;
    const replay = await fixture.host.episode('first');
    assert.equal(replay.status, 'accepted');
    assert.equal(fixture.host.residents.inferenceCalls, 0);
    assert.equal((await fixture.host.episode('next')).status, 'accepted');
    assert.equal(fixture.host.residents.inferenceCalls, 4);
    assert.equal(fixture.transport.advancePreparations, 2);
  } finally { await fixture.close(); }
});

test('reference authority requires a receipt for the episode that produced a new predecessor', async () => {
  const fixture = await hostFixture();
  try {
    assert.equal((await fixture.host.episode('first')).status, 'commit_pending');
    const room = fixture.transport.current!;
    const binding: EpisodeBinding = {
      roomId: room.checkpoint.roomId, episodeId: 'direct-next-episode', episodeCommitment: randomHex(),
      predecessor: room.checkpoint, ordinal: '2', minimumConfirmedSlot: room.slot, residentIds: fixture.host.residents.residentIds,
    };
    const authority = new ReferenceAuthority(fixture.host.records);
    await assert.rejects(authority.resolveEpisode(binding), /room_episode_in_progress/);
    assert.equal(await fixture.host.records.read(`episode/${binding.episodeId}`), undefined);
    fixture.transport.acceptanceRecoveryUnavailable = false;
    assert.equal((await fixture.host.episode('first')).status, 'accepted');
    assert.deepEqual(await authority.resolveEpisode(binding), binding);
    assert.equal(fixture.host.residents.inferenceCalls, 4);
  } finally { await fixture.close(); }
});

test('a label blocked while the indexer retains the predecessor can be admitted after recovery catches up', async () => {
  const fixture = await hostFixture();
  try {
    await fixture.host.ensureRoom();
    const genesis = fixture.transport.current!;
    assert.equal((await fixture.host.episode('first')).status, 'commit_pending');
    fixture.transport.recoveredView = genesis;
    await assert.rejects(fixture.host.episode('next'), /room_episode_in_progress/);
    const episodeId = await digest({ domain: 'backrooms.episode.id.v0', roomId: genesis.checkpoint.roomId, label: 'next' });
    assert.equal(await fixture.host.records.read(`episode/${episodeId}`), undefined);
    assert.equal(fixture.host.residents.inferenceCalls, 4);
    fixture.transport.recoveredView = undefined;
    fixture.transport.acceptanceRecoveryUnavailable = false;
    assert.equal((await fixture.host.episode('next')).status, 'accepted');
    assert.equal((await fixture.host.episode('first')).status, 'accepted');
    assert.equal(fixture.host.residents.inferenceCalls, 8);
    assert.equal(fixture.transport.advancePreparations, 2);
  } finally { await fixture.close(); }
});

test('a conflicting live checkpoint keeps the original operation recoverable and blocks another episode', async () => {
  const fixture = await hostFixture();
  try {
    const first = await fixture.host.episode('first');
    assert.equal(first.status, 'commit_pending');
    fixture.transport.acceptanceRecoveryUnavailable = false;
    fixture.transport.current = {
      ...fixture.transport.current!,
      checkpoint: { ...fixture.transport.current!.checkpoint, stateCommitment: randomHex() },
    };
    await assert.rejects(fixture.host.episode('next'), /room_episode_state_conflict/);
    const replay = await fixture.host.episode('first');
    assert.equal(replay.status, 'state_conflict');
    assert.deepEqual(replay.originalResult, first.originalResult);
    assert.equal(fixture.host.residents.inferenceCalls, 4);
    assert.equal(fixture.transport.advancePreparations, 1);
  } finally { await fixture.close(); }
});

test('a restored host refuses new work when the live checkpoint has no local producing episode', async () => {
  const fixture = await hostFixture();
  try {
    const genesis = await fixture.host.ensureRoom();
    fixture.transport.current = {
      ...fixture.transport.current!,
      checkpoint: { ...genesis.checkpoint, stateCommitment: randomHex(), revision: '1' },
      slot: '2', contextSlot: '2',
    };
    await fixture.reopen();
    await assert.rejects(fixture.host.episode('next'), /room_episode_lineage_missing/);
    await assert.rejects(fixture.host.inspectNextEpisode('preview'), /room_episode_lineage_missing/);
    const episodeId = await digest({ domain: 'backrooms.episode.id.v0', roomId: genesis.checkpoint.roomId, label: 'next' });
    assert.equal(await fixture.host.records.read(`episode/${episodeId}`), undefined);
    assert.equal(fixture.host.residents.inferenceCalls, 0);
    assert.equal(fixture.transport.advancePreparations, 0);
  } finally { await fixture.close(); }
});
