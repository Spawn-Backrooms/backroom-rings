import { chmod } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { assertIdentifier } from '../client/codec.js';
import { PROTOCOL_VERSION, type PrivateRecordStore } from '../client/contracts.js';
import { decryptRecord, encryptRecord, scopeKey, type EncryptedRecord, type EncryptionContext } from '../client/encryption.js';
import { protectedDirectory } from '../reference-host/records.js';

export interface GatewayKeyring {
  currentKeyRef: string;
  keys: Readonly<Record<string, Uint8Array>>;
}

export class GatewayRecords implements PrivateRecordStore {
  private constructor(private readonly database: DatabaseSync, readonly currentKeyRef: string, private readonly keys: ReadonlyMap<string, Uint8Array<ArrayBuffer>>) {}

  static async open(path: string, keyring: GatewayKeyring): Promise<GatewayRecords> {
    if (!isAbsolute(path)) throw new Error('gateway_database_path_must_be_absolute');
    const keys = new Map<string, Uint8Array<ArrayBuffer>>();
    for (const [ref, bytes] of Object.entries(keyring.keys)) {
      assertIdentifier(ref);
      if (ref.length > 64 || bytes.length !== 32) throw new Error('invalid_gateway_storage_key');
      keys.set(ref, new Uint8Array(bytes));
    }
    if (!keys.has(keyring.currentKeyRef)) throw new Error('gateway_current_storage_key_missing');
    await protectedDirectory(dirname(path));
    const database = new DatabaseSync(path);
    try {
      await chmod(path, 0o600);
      database.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS gateway_records (record_key TEXT PRIMARY KEY, version INTEGER NOT NULL, key_ref TEXT NOT NULL, envelope TEXT NOT NULL); CREATE TABLE IF NOT EXISTS gateway_nonces (nonce TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)');
      return new GatewayRecords(database, keyring.currentKeyRef, keys);
    } catch (error) { database.close(); throw error; }
  }

  private context(key: string, keyRef: string): EncryptionContext {
    assertIdentifier(key);
    return { protocolVersion: PROTOCOL_VERSION, roomId: 'rings-gateway', scope: `gateway-records/${keyRef}`, recordId: key };
  }

  private async key(keyRef: string): Promise<CryptoKey> {
    const key = this.keys.get(keyRef);
    if (!key) throw new Error('gateway_historical_storage_key_missing');
    return scopeKey(key, { roomId: 'rings-gateway', scope: `gateway-records/${keyRef}` });
  }

  async read<T>(key: string): Promise<{ value: T; version: number } | undefined> {
    const row = this.database.prepare('SELECT version, key_ref, envelope FROM gateway_records WHERE record_key = ?').get(key);
    if (!row) return undefined;
    if (typeof row.version !== 'number' || typeof row.key_ref !== 'string' || typeof row.envelope !== 'string') throw new Error('invalid_gateway_record');
    return { version: row.version, value: await decryptRecord<T>(JSON.parse(row.envelope) as EncryptedRecord, this.context(key, row.key_ref), await this.key(row.key_ref)) };
  }

  async create<T>(key: string, value: T): Promise<boolean> {
    const envelope = await encryptRecord(value, this.context(key, this.currentKeyRef), await this.key(this.currentKeyRef));
    return this.database.prepare('INSERT OR IGNORE INTO gateway_records (record_key, version, key_ref, envelope) VALUES (?, 0, ?, ?)').run(key, this.currentKeyRef, JSON.stringify(envelope)).changes === 1;
  }

  async replace<T>(key: string, expectedVersion: number, value: T): Promise<boolean> {
    const envelope = await encryptRecord(value, this.context(key, this.currentKeyRef), await this.key(this.currentKeyRef));
    return this.database.prepare('UPDATE gateway_records SET version = version + 1, key_ref = ?, envelope = ? WHERE record_key = ? AND version = ?').run(this.currentKeyRef, JSON.stringify(envelope), key, expectedVersion).changes === 1;
  }

  claimNonce(nonce: string, expiresAt: number, now: number): boolean {
    this.database.prepare('DELETE FROM gateway_nonces WHERE expires_at < ?').run(now);
    return this.database.prepare('INSERT OR IGNORE INTO gateway_nonces (nonce, expires_at) VALUES (?, ?)').run(nonce, expiresAt).changes === 1;
  }

  close(): void { this.database.close(); }
}
