import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { randomHex } from '../client/codec.js';
import { PROTOCOL_VERSION } from '../client/contracts.js';
import { decryptRecord, encryptRecord, scopeKey, sealMessage } from '../client/encryption.js';
import { PrivateMessageLog } from '../reference-host/messages.js';
import { EncryptedSqliteRecords } from '../reference-host/records.js';

test('ciphertext rejects cross-scope substitution, tampering, and incorrect recovered content commitments', async () => {
  const master = crypto.getRandomValues(new Uint8Array(32));
  const context = { protocolVersion: PROTOCOL_VERSION, roomId: randomHex(), scope: 'agent/investigator', recordId: 'memory/1' };
  const key = await scopeKey(master, context);
  const encrypted = await encryptRecord({ lesson: 'private canary' }, context, key);
  await assert.rejects(decryptRecord(encrypted, { ...context, scope: 'agent/critic' }, key), /context_mismatch/);
  await assert.rejects(decryptRecord({ ...encrypted, ciphertextDigest: randomHex() }, context, key), /digest_mismatch/);
  await assert.rejects(decryptRecord({ ...encrypted, contentCommitment: randomHex() }, context, key));
  await assert.rejects(decryptRecord(encrypted, context, await scopeKey(crypto.getRandomValues(new Uint8Array(32)), context)));
});

test('private records survive restart, reject stale CAS, and keep private values out of SQLite bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'backrooms-records-'));
  const path = join(directory, 'records.sqlite');
  const master = crypto.getRandomValues(new Uint8Array(32));
  let records = await EncryptedSqliteRecords.open(path, master, 'test-host');
  try {
    const value = { lesson: `private-canary-${randomHex()}` };
    assert.equal(await records.create('memory/1', value), true);
    const original = await records.read<typeof value>('memory/1');
    assert.ok(original);
    assert.equal(await records.replace('memory/1', original.version, { lesson: 'updated' }), true);
    assert.equal(await records.replace('memory/1', original.version, { lesson: 'stale' }), false);
    for (const file of [path, `${path}-wal`]) assert.equal((await readFile(file)).includes(Buffer.from(value.lesson)), false);
    records.close();
    records = await EncryptedSqliteRecords.open(path, master, 'test-host');
    assert.deepEqual((await records.read('memory/1'))?.value, { lesson: 'updated' });
  } finally { records.close(); await rm(directory, { recursive: true, force: true }); }
});

test('authenticated messages retain one receipt and reject reused nonces, unknown signers, and wrong recipients', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'backrooms-messages-'));
  const master = crypto.getRandomValues(new Uint8Array(32));
  const records = await EncryptedSqliteRecords.open(join(directory, 'records.sqlite'), master, 'test-host');
  const sender = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair;
  const other = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair;
  const log = new PrivateMessageLog(records, master, new Map([['investigator', sender.publicKey]]));
  try {
    const context = { protocolVersion: PROTOCOL_VERSION, roomId: randomHex(), episodeId: 'episode-1', senderId: 'investigator', recipientId: 'critic', expiresAt: null };
    const message = await log.send({ proposal: 'private candidate' }, context, sender.privateKey);
    assert.equal((await log.receive(message, context)).status, 'received');
    assert.equal((await log.receive(message, context)).status, 'recovered');
    await assert.rejects(log.receive(message, { ...context, recipientId: 'other' }), /scope_mismatch/);
    await assert.rejects(log.receive(message, {} as typeof context), /unsupported_message_version/);
    await assert.rejects(log.receive(message, { ...context, senderId: 'unknown' }), /sender_not_a_resident/);
    const key = await scopeKey(master, { roomId: context.roomId, scope: 'message/investigator/critic' });
    const changed = await sealMessage({ proposal: 'changed' }, message.context, key, sender.privateKey);
    await assert.rejects(log.receive(changed, context), /nonce_reused/);
    const impersonated = await sealMessage({ proposal: 'changed' }, { ...message.context, nonce: randomHex(16) }, key, other.privateKey);
    await assert.rejects(log.receive(impersonated, context), /signature_invalid/);
    const expired = await sealMessage({ proposal: 'expired' }, { ...message.context, expiresAt: 10, nonce: randomHex(16) }, key, sender.privateKey);
    await assert.rejects(log.receive(expired, context, 11), /expired/);
  } finally { records.close(); await rm(directory, { recursive: true, force: true }); }
});
