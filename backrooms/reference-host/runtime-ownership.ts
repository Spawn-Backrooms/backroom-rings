import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

const heldOwnership = new Set<RuntimeOwnership>();

export class RuntimeOwnership {
  private constructor(private readonly database: DatabaseSync) {}

  static acquire(directory: string): RuntimeOwnership {
    const database = new DatabaseSync(join(directory, 'runtime-owner.sqlite'));
    try {
      database.exec('PRAGMA busy_timeout=0; PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE');
    } catch (error) {
      database.close();
      if (error instanceof Error && 'errcode' in error && (error.errcode === 5 || error.errcode === 6)) throw new Error('private_runtime_already_owned');
      throw error;
    }
    const ownership = new RuntimeOwnership(database);
    heldOwnership.add(ownership);
    return ownership;
  }

  release(): void {
    this.database.close();
    heldOwnership.delete(this);
  }
}
