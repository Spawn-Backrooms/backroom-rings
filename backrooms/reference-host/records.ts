import { chmod, mkdir, open, readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { assertIdentifier, assertInteger, fromHex, randomHex } from '../client/codec.js';
import { PROTOCOL_VERSION, type PrivateRecordStore } from '../client/contracts.js';
import { decryptRecord, encryptRecord, scopeKey, type EncryptedRecord, type EncryptionContext } from '../client/encryption.js';

export async function protectedDirectory(path: string): Promise<string> {
  const directory = resolve(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  return directory;
}

export async function loadDevelopmentKey(path: string): Promise<Uint8Array<ArrayBuffer>> {
  await protectedDirectory(dirname(path));
  try {
    const file = await open(path, 'wx', 0o600);
    try { await file.writeFile(randomHex()); } finally { await file.close(); }
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
  }
  const metadata = await stat(path);
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) throw new Error('development_key_permissions');
  const bytes = fromHex((await readFile(path, 'utf8')).trim());
  if (bytes.length !== 32) throw new Error('invalid_development_key');
  return bytes;
}

export class EncryptedSqliteRecords implements PrivateRecordStore {
  private constructor(private readonly database: DatabaseSync, private readonly key: CryptoKey, private readonly namespace: string) {}

  static async open(path: string, masterKey: Uint8Array<ArrayBuffer>, namespace: string): Promise<EncryptedSqliteRecords> {
    assertIdentifier(namespace);
    await protectedDirectory(dirname(path));
    const database = new DatabaseSync(path);
    await chmod(path, 0o600);
    database.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS private_records (record_key TEXT PRIMARY KEY, version INTEGER NOT NULL, envelope TEXT NOT NULL)');
    return new EncryptedSqliteRecords(database, await scopeKey(masterKey, { roomId: namespace, scope: 'host-records' }), namespace);
  }

  private context(key: string): EncryptionContext {
    assertIdentifier(key);
    return { protocolVersion: PROTOCOL_VERSION, roomId: this.namespace, scope: 'host-records', recordId: key };
  }

  async read<T>(key: string): Promise<{ value: T; version: number } | undefined> {
    const context = this.context(key);
    const row = this.database.prepare('SELECT version, envelope FROM private_records WHERE record_key = ?').get(key);
    if (!row) return undefined;
    if (typeof row.envelope !== 'string' || typeof row.version !== 'number') throw new Error('invalid_private_record');
    return { version: row.version, value: await decryptRecord<T>(JSON.parse(row.envelope) as EncryptedRecord, context, this.key) };
  }

  async create<T>(key: string, value: T): Promise<boolean> {
    const envelope = await encryptRecord(value, this.context(key), this.key);
    const result = this.database.prepare('INSERT OR IGNORE INTO private_records (record_key, version, envelope) VALUES (?, 0, ?)').run(key, JSON.stringify(envelope));
    return result.changes === 1;
  }

  async replace<T>(key: string, expectedVersion: number, value: T): Promise<boolean> {
    assertInteger(expectedVersion, 0);
    const envelope = await encryptRecord(value, this.context(key), this.key);
    const result = this.database.prepare('UPDATE private_records SET version = version + 1, envelope = ? WHERE record_key = ? AND version = ?').run(JSON.stringify(envelope), key, expectedVersion);
    return result.changes === 1;
  }

  close(): void {
    this.database.close();
  }
}
