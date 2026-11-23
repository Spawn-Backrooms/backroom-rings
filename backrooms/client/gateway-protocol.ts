import * as v from 'valibot';
import { decodeUtf8, fromHex, hex, utf8 } from './codec.js';
import { PROTOCOL_VERSION } from './contracts.js';

export const GATEWAY_VERSION = 'backrooms.gateway.v1' as const;
export const GATEWAY_MAX_BYTES = 1024 * 1024;
export const GATEWAY_REQUEST_WINDOW_MS = 60_000;

const identifier = v.pipe(v.string(), v.regex(/^[A-Za-z0-9._:/-]{1,256}$/));
const digest = v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/));
const u64 = v.pipe(v.string(), v.regex(/^(0|[1-9][0-9]{0,19})$/), v.check(value => /^(0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= 18_446_744_073_709_551_615n));
const operationId = v.pipe(v.string(), v.regex(/^[A-Za-z0-9._:/-]{1,128}$/));
const scopeSchema = v.strictObject({ ownerId: identifier, projectId: identifier, roomId: identifier });
const creation = { creationNonce: digest, seedManifestCommitment: digest, fixedMembersCommitment: digest };
const enrollmentSchema = v.strictObject({ scope: scopeSchema, creationId: identifier, ...creation, releaseManifestSha256: digest });
const bindingSchema = v.strictObject({
  version: v.literal(GATEWAY_VERSION), bindingId: digest, scope: scopeSchema, creationId: identifier,
  writerIdentity: v.pipe(v.string(), v.regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)), keyRef: identifier,
  artifactVersion: identifier, releaseManifestSha256: digest,
});
const frame = v.strictObject({ transactionBase64: v.pipe(v.string(), v.minLength(1), v.maxLength(GATEWAY_MAX_BYTES)), transactionDigest: digest });
const bridgeEnvelope = { protocolVersion: v.literal(PROTOCOL_VERSION), operationId };
const bridgeRequestSchema = v.variant('op', [
  v.strictObject({ ...bridgeEnvelope, op: v.literal('prepare_create'), input: v.strictObject(creation) }),
  v.strictObject({ ...bridgeEnvelope, op: v.literal('prepare_advance'), input: v.strictObject({
    acceptanceNonce: v.pipe(digest, v.check(value => value !== '0'.repeat(64))), roomId: digest, expectedPredecessor: digest,
    ordinal: v.pipe(u64, v.check(value => value !== '0')), episodeCommitment: digest, originalResultCommitment: digest,
    candidateCommitment: digest, minimumConfirmedSlot: u64,
    lesson: v.pipe(v.string(), v.minLength(1), v.check(value => utf8(value).length <= 96)),
    selectedProcedure: v.union([v.literal(0), v.literal(1)]),
    feedback: v.strictObject({ negative: v.boolean(), magnitude: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(10)) }),
  }) }),
  v.strictObject({ ...bridgeEnvelope, op: v.literal('submit'), input: frame }),
  v.strictObject({ ...bridgeEnvelope, op: v.literal('reframe'), input: frame }),
  v.strictObject({ ...bridgeEnvelope, op: v.literal('recover'), input: v.strictObject({ roomId: digest, minimumConfirmedSlot: u64 }) }),
]);
const envelope = { version: v.literal(GATEWAY_VERSION), issuedAt: v.pipe(v.number(), v.safeInteger(), v.minValue(0)), nonce: digest };
const requestSchema = v.variant('kind', [
  v.strictObject({ ...envelope, kind: v.literal('bind'), enrollment: enrollmentSchema }),
  v.strictObject({ ...envelope, kind: v.literal('bridge'), binding: bindingSchema, request: bridgeRequestSchema }),
]);
const responseEnvelope = { version: v.literal(GATEWAY_VERSION), requestSha256: digest };
const responseSchema = v.variant('status', [
  v.strictObject({ ...responseEnvelope, status: v.literal('ok'), result: v.unknown() }),
  v.strictObject({ ...responseEnvelope, status: v.literal('error'), code: identifier }),
]);

export type GatewayScope = v.InferOutput<typeof scopeSchema>;
export type GatewayEnrollment = v.InferOutput<typeof enrollmentSchema>;
export type GatewayBinding = v.InferOutput<typeof bindingSchema>;
export type GatewayRequest = v.InferOutput<typeof requestSchema>;
export type GatewayResponse = v.InferOutput<typeof responseSchema>;

export function parseGatewayEnrollment(value: unknown): GatewayEnrollment {
  const parsed = v.safeParse(enrollmentSchema, value);
  if (!parsed.success) throw new Error('gateway_invalid_request');
  return parsed.output;
}
export function parseGatewayBinding(value: unknown): GatewayBinding {
  const parsed = v.safeParse(bindingSchema, value);
  if (!parsed.success) throw new Error('gateway_invalid_binding');
  return parsed.output;
}
export function parseGatewayRequest(value: unknown): GatewayRequest {
  const parsed = v.safeParse(requestSchema, value);
  if (!parsed.success) throw new Error('gateway_invalid_request');
  return parsed.output;
}
export function parseGatewayResponse(value: unknown): GatewayResponse {
  const parsed = v.safeParse(responseSchema, value);
  if (!parsed.success) throw new Error('gateway_invalid_response');
  return parsed.output;
}

export function gatewayEndpoint(value: string, mode: 'synthetic_localnet' | 'production'): URL {
  const url = new URL(value);
  if (url.username || url.password || url.hash || url.search) throw new Error('invalid_gateway_endpoint');
  if (mode === 'production') {
    if (url.protocol !== 'https:') throw new Error('gateway_https_required');
  } else if (mode !== 'synthetic_localnet' || url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('gateway_loopback_required');
  }
  return url;
}

export async function gatewayAuthenticationKey(bytes: Uint8Array): Promise<CryptoKey> {
  if (bytes.byteLength !== 32) throw new Error('invalid_gateway_authentication_key');
  return crypto.subtle.importKey('raw', new Uint8Array(bytes), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

function authenticatedBytes(direction: 'request' | number, body: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const prefix = utf8(`${GATEWAY_VERSION}\n${direction}\n`);
  const bytes = new Uint8Array(prefix.length + body.length);
  bytes.set(prefix);
  bytes.set(body, prefix.length);
  return bytes;
}

export async function gatewayMac(key: CryptoKey, direction: 'request' | number, body: Uint8Array<ArrayBuffer>): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, authenticatedBytes(direction, body))));
}

export async function verifyGatewayMac(key: CryptoKey, direction: 'request' | number, body: Uint8Array<ArrayBuffer>, mac: string | null): Promise<boolean> {
  return mac !== null && /^[0-9a-f]{64}$/.test(mac) && crypto.subtle.verify('HMAC', key, fromHex(mac), authenticatedBytes(direction, body));
}

export async function readGatewayBody(body: ReadableStream<Uint8Array> | null): Promise<Uint8Array<ArrayBuffer>> {
  if (!body) throw new Error('gateway_body_missing');
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > GATEWAY_MAX_BYTES) throw new Error('gateway_body_exceeds_bound');
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export function gatewayJson(body: Uint8Array<ArrayBuffer>): unknown { return JSON.parse(decodeUtf8(body)); }
