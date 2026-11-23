import { base64, canonicalJson, decodeUtf8, digest, digestBytes, fromBase64, fromHex, randomHex, record, utf8 } from './codec.js';
import { PROTOCOL_VERSION } from './contracts.js';

export interface EncryptionContext {
  protocolVersion: typeof PROTOCOL_VERSION;
  roomId: string;
  scope: string;
  recordId: string;
}

export interface EncryptedRecord {
  version: 0;
  context: EncryptionContext;
  iv: string;
  ciphertext: string;
  ciphertextDigest: string;
  contentCommitment: string;
}

export async function scopeKey(masterKey: Uint8Array<ArrayBuffer>, context: Pick<EncryptionContext, 'roomId' | 'scope'>): Promise<CryptoKey> {
  if (masterKey.byteLength !== 32) throw new Error('invalid_master_key');
  const key = await crypto.subtle.importKey('raw', masterKey, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: utf8(PROTOCOL_VERSION), info: utf8(canonicalJson(context)) }, key, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptRecord(value: unknown, context: EncryptionContext, key: CryptoKey): Promise<EncryptedRecord> {
  const payload = { blinding: randomHex(), value };
  const contentCommitment = await digest({ domain: 'backrooms.blob.v0', context, payload });
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const additionalData = utf8(canonicalJson({ context, contentCommitment }));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData }, key, utf8(canonicalJson(payload))));
  return { version: 0, context, iv: base64(iv), ciphertext: base64(ciphertext), ciphertextDigest: await digestBytes(ciphertext), contentCommitment };
}

export async function decryptRecord<T>(envelope: EncryptedRecord, expected: EncryptionContext, key: CryptoKey): Promise<T> {
  if (envelope.version !== 0 || canonicalJson(envelope.context) !== canonicalJson(expected)) throw new Error('encryption_context_mismatch');
  const ciphertext = fromBase64(envelope.ciphertext);
  if (await digestBytes(ciphertext) !== envelope.ciphertextDigest) throw new Error('ciphertext_digest_mismatch');
  const iv = fromBase64(envelope.iv);
  if (iv.length !== 12) throw new Error('invalid_nonce');
  const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: utf8(canonicalJson({ context: expected, contentCommitment: envelope.contentCommitment })) }, key, ciphertext));
  const payload = record(JSON.parse(decodeUtf8(plaintext)));
  if (typeof payload.blinding !== 'string' || fromHex(payload.blinding).length !== 32) throw new Error('invalid_blinding');
  if (await digest({ domain: 'backrooms.blob.v0', context: expected, payload }) !== envelope.contentCommitment) throw new Error('content_commitment_mismatch');
  return payload.value as T;
}

export interface MessageContext {
  protocolVersion: typeof PROTOCOL_VERSION;
  roomId: string;
  episodeId: string;
  senderId: string;
  recipientId: string;
  nonce: string;
  expiresAt: number | null;
}

export interface PrivateMessage {
  context: MessageContext;
  body: EncryptedRecord;
  signature: string;
}

function messageRecordContext(context: MessageContext): EncryptionContext {
  return { protocolVersion: PROTOCOL_VERSION, roomId: context.roomId, scope: `message/${context.senderId}/${context.recipientId}`, recordId: `${context.episodeId}/${context.nonce}` };
}

export async function sealMessage(payload: unknown, context: MessageContext, encryptionKey: CryptoKey, senderKey: CryptoKey): Promise<PrivateMessage> {
  const body = await encryptRecord(payload, messageRecordContext(context), encryptionKey);
  const signature = await crypto.subtle.sign('Ed25519', senderKey, utf8(canonicalJson({ context, body })));
  return { context, body, signature: base64(new Uint8Array(signature)) };
}

export async function openMessage<T>(message: PrivateMessage, expected: Omit<MessageContext, 'nonce' | 'expiresAt'>, encryptionKey: CryptoKey, acceptedSenderKey: CryptoKey, now: number): Promise<T> {
  const context = message.context;
  for (const key of ['protocolVersion', 'roomId', 'episodeId', 'senderId', 'recipientId'] as const) {
    if (typeof expected[key] !== 'string' || expected[key].length === 0 || context[key] !== expected[key]) throw new Error('message_scope_mismatch');
  }
  if (!/^[0-9a-f]{32}$/.test(context.nonce)) throw new Error('invalid_message_nonce');
  if (context.expiresAt !== null && (!Number.isSafeInteger(context.expiresAt) || context.expiresAt <= now)) throw new Error('message_expired');
  const valid = await crypto.subtle.verify('Ed25519', acceptedSenderKey, fromBase64(message.signature), utf8(canonicalJson({ context, body: message.body })));
  if (!valid) throw new Error('message_signature_invalid');
  return decryptRecord<T>(message.body, messageRecordContext(context), encryptionKey);
}
