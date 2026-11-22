import { base64, canonicalJson, digest, fromBase64, randomHex } from '../client/codec.js';
import { PROTOCOL_VERSION, type PrivateRecordStore } from '../client/contracts.js';
import { openMessage, scopeKey, sealMessage, type MessageContext, type PrivateMessage } from '../client/encryption.js';

interface StoredSigningKey { publicKey: string; privateKey: string }

export async function residentSigningKey(records: PrivateRecordStore, residentId: string): Promise<CryptoKeyPair> {
  const key = `signer/${residentId}`;
  let retained = await records.read<StoredSigningKey>(key);
  if (!retained) {
    const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair;
    await records.create(key, { publicKey: base64(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))), privateKey: base64(new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))) } satisfies StoredSigningKey);
    retained = await records.read<StoredSigningKey>(key);
  }
  if (!retained) throw new Error('resident_key_missing');
  return {
    publicKey: await crypto.subtle.importKey('raw', fromBase64(retained.value.publicKey), 'Ed25519', true, ['verify']),
    privateKey: await crypto.subtle.importKey('pkcs8', fromBase64(retained.value.privateKey), 'Ed25519', false, ['sign']),
  };
}

export class PrivateMessageLog {
  constructor(private readonly records: PrivateRecordStore, private readonly masterKey: Uint8Array<ArrayBuffer>, private readonly acceptedSenders: ReadonlyMap<string, CryptoKey>) {}

  private async encryptionKey(context: Pick<MessageContext, 'roomId' | 'senderId' | 'recipientId'>): Promise<CryptoKey> {
    return scopeKey(this.masterKey, { roomId: context.roomId, scope: `message/${context.senderId}/${context.recipientId}` });
  }

  async send<T>(payload: T, context: Omit<MessageContext, 'nonce'>, senderKey: CryptoKey): Promise<PrivateMessage> {
    const key = `message/${await digest(context)}`;
    let retained = await this.records.read<PrivateMessage>(key);
    if (!retained) {
      const message = await sealMessage(payload, { ...context, nonce: randomHex(16) }, await this.encryptionKey(context), senderKey);
      await this.records.create(key, message);
      retained = await this.records.read<PrivateMessage>(key);
    }
    if (!retained) throw new Error('message_not_retained');
    const verified = await this.decrypt<T>(retained.value, context, Date.now());
    if (canonicalJson(verified) !== canonicalJson(payload)) throw new Error('message_identity_reused');
    return retained.value;
  }

  private async decrypt<T>(message: PrivateMessage, expected: Omit<MessageContext, 'nonce' | 'expiresAt'>, now: number): Promise<T> {
    const sender = this.acceptedSenders.get(expected.senderId);
    if (!sender) throw new Error('sender_not_a_resident');
    return openMessage<T>(message, expected, await this.encryptionKey(expected), sender, now);
  }

  async receive<T>(message: PrivateMessage, expected: Omit<MessageContext, 'nonce' | 'expiresAt'>, now = Date.now()): Promise<{ status: 'received' | 'recovered'; payload: T }> {
    if (expected.protocolVersion !== PROTOCOL_VERSION) throw new Error('unsupported_message_version');
    const payload = await this.decrypt<T>(message, expected, now);
    const nonceKey = `received/${await digest({ roomId: expected.roomId, senderId: expected.senderId, nonce: message.context.nonce })}`;
    const messageDigest = await digest(message);
    const fresh = await this.records.create(nonceKey, { messageDigest, payload });
    const retained = await this.records.read<{ messageDigest: string; payload: T }>(nonceKey);
    if (!retained || retained.value.messageDigest !== messageDigest) throw new Error('message_nonce_reused');
    return { status: fresh ? 'received' : 'recovered', payload: retained.value.payload };
  }
}
