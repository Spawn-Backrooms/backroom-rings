import { readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { canonicalJson, digest, digestBytes, randomHex, utf8 } from '../client/codec.js';
import { PROTOCOL_VERSION, type BridgeRequest, type Checkpoint, type PreparedTransaction, type RecoveredRoom, type ReframedTransaction, type RingsTransport, type UnrecoveredRoom } from '../client/contracts.js';
import { RingsOperationError } from '../client/errors.js';
import { GATEWAY_MAX_BYTES, GATEWAY_REQUEST_WINDOW_MS, GATEWAY_VERSION, gatewayAuthenticationKey, gatewayJson, gatewayMac, parseGatewayRequest, readGatewayBody, verifyGatewayMac, type GatewayBinding, type GatewayEnrollment, type GatewayRequest, type GatewayResponse } from '../client/gateway-protocol.js';
import { decodeReleaseManifest } from '../client/release.js';
import { RingsClient } from '../client/rings-client.js';
import { protectedDirectory } from '../reference-host/records.js';
import { RuntimeOwnership } from '../reference-host/runtime-ownership.js';
import { LocalnetBridge, writerIdentity, type LocalnetBridgeOptions } from './process.js';
import { GatewayRecords, type GatewayKeyring } from './records.js';

type Preparation = Extract<BridgeRequest, { op: 'prepare_create' | 'prepare_advance' }>;
type Creation = { status: 'unprepared' } | { status: 'reserved'; operationId: string } | { status: 'prepared'; operationId: string; checkpoint: Checkpoint };
interface EnrollmentRecord { enrollment: GatewayEnrollment; binding: GatewayBinding; signerSeedHex: string; creation: Creation }
type Frame = { transactionBase64: string; transactionDigest: string } & ({ kind: 'original' } | { kind: 'replacement'; parentTransactionDigest: string; signature: string });
type Operation = { status: 'reserved'; request: Preparation } | { status: 'prepared'; request: Preparation; prepared: PreparedTransaction; frames: Frame[] };

export interface LocalnetGatewayOptions {
  mode: 'synthetic_localnet';
  databasePath: string;
  authenticationKey: Uint8Array;
  storageKeys: GatewayKeyring;
  releaseManifest: unknown;
  releaseManifestSha256: string;
  bridge: Omit<LocalnetBridgeOptions, 'temporaryDirectory'>;
  now?: () => number;
}

const publicErrors = new Set([
  'gateway_invalid_request', 'gateway_request_unauthenticated', 'gateway_request_expired', 'gateway_request_replayed',
  'gateway_release_mismatch', 'gateway_enrollment_conflict', 'gateway_binding_mismatch', 'gateway_custody_missing',
  'gateway_historical_storage_key_missing', 'gateway_creation_operation_conflict', 'gateway_creation_unprepared',
  'gateway_preparation_conflict', 'gateway_frame_not_retained', 'gateway_frame_limit', 'gateway_room_mismatch',
  'gateway_recovery_binding_mismatch', 'gateway_recovery_pending', 'gateway_state_conflict', 'gateway_journal_busy',
  'gateway_localnet_genesis_mismatch', 'gateway_localnet_funding_unconfirmed', 'gateway_localnet_rpc_failed',
]);

export class LocalnetRingsGateway {
  private readonly pending = new Map<string, Promise<unknown>>();

  private constructor(
    private readonly records: GatewayRecords,
    private readonly bridge: LocalnetBridge,
    private readonly authenticationKey: CryptoKey,
    private readonly releaseManifestSha256: string,
    private readonly artifactVersion: string,
    private readonly now: () => number,
    private readonly ownership: RuntimeOwnership,
  ) {}

  static async open(options: LocalnetGatewayOptions): Promise<LocalnetRingsGateway> {
    if (options.mode !== 'synthetic_localnet') throw new Error('gateway_localnet_only');
    const manifest = decodeReleaseManifest(options.releaseManifest);
    if (manifest.network.cluster !== 'localnet' || manifest.setup.kind !== 'insecure_test' || manifest.artifactVersion !== 'backrooms.localnet.v0' || await digest(manifest) !== options.releaseManifestSha256) throw new Error('gateway_unqualified_localnet_release');
    if (manifest.network.genesisHash !== null && manifest.network.genesisHash !== options.bridge.configuration.genesisHash) throw new Error('gateway_release_genesis_mismatch');
    const authenticationKey = await gatewayAuthenticationKey(options.authenticationKey);
    await protectedDirectory(dirname(options.databasePath));
    const directory = await protectedDirectory(`${options.databasePath}.runtime`);
    const ownership = RuntimeOwnership.acquire(directory);
    try {
      for (const entry of await readdir(directory)) if (entry.startsWith('rings-bridge-')) await rm(join(directory, entry), { recursive: true, force: true });
      const bridge = await LocalnetBridge.open({ ...options.bridge, temporaryDirectory: directory });
      const records = await GatewayRecords.open(options.databasePath, options.storageKeys);
      return new LocalnetRingsGateway(records, bridge, authenticationKey, options.releaseManifestSha256, manifest.artifactVersion, options.now ?? Date.now, ownership);
    } catch (error) { ownership.release(); throw error; }
  }

  private async serialized<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.pending.set(key, current);
    try { return await current; }
    finally { if (this.pending.get(key) === current) this.pending.delete(key); }
  }

  private async bindingId(enrollment: GatewayEnrollment): Promise<string> {
    return digest({ domain: 'backrooms.gateway.scope.v1', scope: enrollment.scope });
  }

  private async bind(enrollment: GatewayEnrollment): Promise<GatewayBinding> {
    if (enrollment.releaseManifestSha256 !== this.releaseManifestSha256) throw new Error('gateway_release_mismatch');
    const bindingId = await this.bindingId(enrollment);
    const recordKey = `enrollment/${bindingId}`;
    let retained = await this.records.read<EnrollmentRecord>(recordKey);
    if (!retained) {
      const signerSeedHex = randomHex();
      const binding: GatewayBinding = {
        version: GATEWAY_VERSION, bindingId, scope: enrollment.scope, creationId: enrollment.creationId,
        writerIdentity: writerIdentity(signerSeedHex), keyRef: `custody/${this.records.currentKeyRef}/${bindingId}`,
        artifactVersion: this.artifactVersion, releaseManifestSha256: this.releaseManifestSha256,
      };
      await this.records.create<EnrollmentRecord>(recordKey, { enrollment, binding, signerSeedHex, creation: { status: 'unprepared' } });
      retained = await this.records.read<EnrollmentRecord>(recordKey);
    }
    if (!retained) throw new Error('gateway_custody_missing');
    if (canonicalJson(retained.value.enrollment) !== canonicalJson(enrollment)) throw new Error('gateway_enrollment_conflict');
    this.assertCustody(retained.value);
    return retained.value.binding;
  }

  private assertCustody(retained: EnrollmentRecord): void {
    if (writerIdentity(retained.signerSeedHex) !== retained.binding.writerIdentity || retained.binding.releaseManifestSha256 !== this.releaseManifestSha256 || retained.binding.artifactVersion !== this.artifactVersion) throw new Error('gateway_binding_mismatch');
  }

  private async enrollment(binding: GatewayBinding): Promise<EnrollmentRecord> {
    const retained = await this.records.read<EnrollmentRecord>(`enrollment/${binding.bindingId}`);
    if (!retained) throw new Error('gateway_custody_missing');
    if (canonicalJson(retained.value.binding) !== canonicalJson(binding)) throw new Error('gateway_binding_mismatch');
    this.assertCustody(retained.value);
    return retained.value;
  }

  private async reserveCreation(enrollment: EnrollmentRecord, operationId: string, checkpoint?: Checkpoint): Promise<void> {
    const key = `enrollment/${enrollment.binding.bindingId}`;
    for (let attempt = 0; attempt < 8; attempt++) {
      const row = await this.records.read<EnrollmentRecord>(key);
      if (!row) throw new Error('gateway_custody_missing');
      const creation = row.value.creation;
      if (creation.status !== 'unprepared' && creation.operationId !== operationId) throw new Error('gateway_creation_operation_conflict');
      if (creation.status === 'prepared') {
        if (checkpoint && canonicalJson(creation.checkpoint) !== canonicalJson(checkpoint)) throw new Error('gateway_room_mismatch');
        return;
      }
      if (!checkpoint && creation.status === 'reserved') return;
      const next: Creation = checkpoint ? { status: 'prepared', operationId, checkpoint } : { status: 'reserved', operationId };
      if (await this.records.replace(key, row.version, { ...row.value, creation: next })) return;
    }
    throw new Error('gateway_journal_busy');
  }

  private client(enrollment: EnrollmentRecord): RingsClient {
    const transport: RingsTransport = { request: request => this.bridge.request(enrollment.signerSeedHex, request) };
    return new RingsClient(transport, this.artifactVersion);
  }

  private assertRoom(enrollment: EnrollmentRecord, roomId: string): Checkpoint {
    if (enrollment.creation.status !== 'prepared') throw new Error('gateway_creation_unprepared');
    if (enrollment.creation.checkpoint.roomId !== roomId) throw new Error('gateway_room_mismatch');
    return enrollment.creation.checkpoint;
  }

  private async recover(enrollment: EnrollmentRecord, operationId: string, roomId: string, minimumConfirmedSlot: string): Promise<RecoveredRoom | UnrecoveredRoom> {
    const identity = this.assertRoom(enrollment, roomId);
    const result = await this.client(enrollment).recover(operationId, roomId, minimumConfirmedSlot);
    if (result.status === 'recovered' && (result.checkpoint.uniqueAddress !== identity.uniqueAddress || result.writerIdentity !== enrollment.binding.writerIdentity || result.seedManifestCommitment !== enrollment.enrollment.seedManifestCommitment || result.fixedMembersCommitment !== enrollment.enrollment.fixedMembersCommitment)) throw new Error('gateway_recovery_binding_mismatch');
    return result;
  }

  private async prepare(enrollment: EnrollmentRecord, request: Preparation, key: string): Promise<PreparedTransaction> {
    if (request.op === 'prepare_create') {
      const input = enrollment.enrollment;
      if (canonicalJson(request.input) !== canonicalJson({ creationNonce: input.creationNonce, seedManifestCommitment: input.seedManifestCommitment, fixedMembersCommitment: input.fixedMembersCommitment })) throw new Error('gateway_preparation_conflict');
      await this.reserveCreation(enrollment, request.operationId);
    } else this.assertRoom(enrollment, request.input.roomId);
    await this.records.create<Operation>(key, { status: 'reserved', request });
    for (let attempt = 0; attempt < 8; attempt++) {
      const retained = await this.records.read<Operation>(key);
      if (!retained) throw new Error('gateway_custody_missing');
      if (canonicalJson(retained.value.request) !== canonicalJson(request)) throw new Error('gateway_preparation_conflict');
      if (retained.value.status === 'prepared') {
        if (request.op === 'prepare_create') await this.reserveCreation(enrollment, request.operationId, retained.value.prepared.checkpoint);
        return retained.value.prepared;
      }
      const client = this.client(enrollment);
      const prepared = request.op === 'prepare_create' ? await client.prepareCreate(request.operationId, request.input) : await client.prepareAdvance(request.operationId, request.input);
      if (request.op === 'prepare_advance' && prepared.checkpoint.uniqueAddress !== this.assertRoom(enrollment, request.input.roomId).uniqueAddress) throw new Error('gateway_room_mismatch');
      if (await this.records.replace<Operation>(key, retained.version, { status: 'prepared', request, prepared, frames: [{ kind: 'original', transactionBase64: prepared.transactionBase64, transactionDigest: prepared.transactionDigest }] })) {
        if (request.op === 'prepare_create') await this.reserveCreation(enrollment, request.operationId, prepared.checkpoint);
        return prepared;
      }
    }
    throw new Error('gateway_journal_busy');
  }

  private replacement(operationId: string, frame: Frame): ReframedTransaction {
    if (frame.kind !== 'replacement') throw new Error('gateway_frame_not_retained');
    return { protocolVersion: PROTOCOL_VERSION, operationId, status: 'reframed', transactionBase64: frame.transactionBase64, transactionDigest: frame.transactionDigest, parentTransactionDigest: frame.parentTransactionDigest, signature: frame.signature };
  }

  private async frameOperation(enrollment: EnrollmentRecord, request: Extract<BridgeRequest, { op: 'submit' | 'reframe' }>, key: string): Promise<unknown> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const retained = await this.records.read<Operation>(key);
      if (!retained || retained.value.status !== 'prepared') throw new Error('gateway_frame_not_retained');
      const operation = retained.value;
      const index = operation.frames.findIndex(frame => frame.transactionDigest === request.input.transactionDigest && frame.transactionBase64 === request.input.transactionBase64);
      if (index < 0) throw new Error('gateway_frame_not_retained');
      const prepared = { ...operation.prepared, ...request.input };
      if (request.op === 'submit') return this.client(enrollment).submit(prepared);
      const replacement = operation.frames[index + 1];
      if (replacement) return this.replacement(request.operationId, replacement);
      const minimum = operation.request.op === 'prepare_advance' ? operation.request.input.minimumConfirmedSlot : '0';
      const recovered = await this.recover(enrollment, request.operationId, prepared.checkpoint.roomId, minimum);
      if (recovered.status === 'pending') throw new Error('gateway_recovery_pending');
      if (recovered.status === 'recovered' && canonicalJson(recovered.checkpoint) === canonicalJson(prepared.checkpoint)) return { protocolVersion: PROTOCOL_VERSION, operationId: request.operationId, status: 'confirmed', signature: recovered.signature, slot: recovered.slot };
      if (operation.request.op === 'prepare_create' ? recovered.status !== 'not_found' : recovered.status !== 'recovered' || recovered.checkpoint.stateCommitment !== operation.request.input.expectedPredecessor || BigInt(recovered.checkpoint.revision) + 1n !== BigInt(operation.request.input.ordinal)) throw new Error('gateway_state_conflict');
      if (operation.frames.length >= 64) throw new Error('gateway_frame_limit');
      const result = await this.client(enrollment).reframe(prepared);
      if (result.status !== 'reframed') return result;
      const next: Frame = { kind: 'replacement', transactionBase64: result.transactionBase64, transactionDigest: result.transactionDigest, parentTransactionDigest: result.parentTransactionDigest, signature: result.signature };
      if (await this.records.replace<Operation>(key, retained.version, { ...operation, frames: [...operation.frames, next] })) return result;
    }
    throw new Error('gateway_journal_busy');
  }

  private async dispatch(packet: GatewayRequest): Promise<unknown> {
    if (packet.kind === 'bind') return this.serialized(await this.bindingId(packet.enrollment), () => this.bind(packet.enrollment));
    return this.serialized(packet.binding.bindingId, async () => {
      const enrollment = await this.enrollment(packet.binding);
      const request = packet.request;
      if (request.op === 'recover') return this.recover(enrollment, request.operationId, request.input.roomId, request.input.minimumConfirmedSlot);
      const key = `operation/${packet.binding.bindingId}/${await digest(request.operationId)}`;
      if (request.op === 'prepare_create' || request.op === 'prepare_advance') return this.prepare(enrollment, request, key);
      return this.frameOperation(enrollment, request, key);
    });
  }

  private async response(value: GatewayResponse, status: number): Promise<Response> {
    const body = utf8(canonicalJson(value));
    if (body.length > GATEWAY_MAX_BYTES) throw new Error('gateway_response_exceeds_bound');
    return new Response(body, { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-backrooms-auth': await gatewayMac(this.authenticationKey, status, body) } });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/v1/backrooms' || url.search) return new Response(null, { status: 404 });
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    let body: Uint8Array<ArrayBuffer>;
    try { body = await readGatewayBody(request.body); }
    catch { return new Response(null, { status: 413 }); }
    const requestSha256 = await digestBytes(body);
    const envelope = { version: GATEWAY_VERSION, requestSha256 };
    let packet: GatewayRequest | undefined;
    try {
      if (!await verifyGatewayMac(this.authenticationKey, 'request', body, request.headers.get('x-backrooms-auth'))) throw new Error('gateway_request_unauthenticated');
      if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new Error('gateway_invalid_request');
      packet = parseGatewayRequest(gatewayJson(body));
      const now = this.now();
      if (Math.abs(packet.issuedAt - now) > GATEWAY_REQUEST_WINDOW_MS) throw new Error('gateway_request_expired');
      if (!this.records.claimNonce(packet.nonce, packet.issuedAt + GATEWAY_REQUEST_WINDOW_MS, now)) throw new Error('gateway_request_replayed');
      return this.response({ ...envelope, status: 'ok', result: await this.dispatch(packet) }, 200);
    } catch (error) {
      if (error instanceof RingsOperationError && packet?.kind === 'bridge') return this.response({ ...envelope, status: 'ok', result: { protocolVersion: PROTOCOL_VERSION, operationId: packet.request.operationId, status: 'error', error: { code: error.code } } }, 200);
      const code = error instanceof Error && publicErrors.has(error.message) ? error.message : packet ? 'gateway_operation_failed' : 'gateway_invalid_request';
      return this.response({ ...envelope, status: 'error', code }, code === 'gateway_request_unauthenticated' ? 401 : 409);
    }
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.pending.values());
    this.records.close();
    this.ownership.release();
  }
}
