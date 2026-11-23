import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { randomHex } from '../client/codec.js';
import { FlueResidents } from '../reference-host/residents.js';

function worker(mode: string, directory: string) {
  const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./fixtures/runtime-owner.ts', import.meta.url)), mode, directory], { stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  const closed = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  return {
    child, closed,
    async message(): Promise<Record<string, unknown>> {
      const line = await lines.next();
      assert.equal(line.done, false, `worker exited without a result: ${stderr}`);
      return JSON.parse(line.value!) as Record<string, unknown>;
    },
    async successfulExit(): Promise<void> {
      const result = await closed;
      assert.equal(result.code, 0, stderr);
    },
  };
}

test('independent processes cannot share a Flue runtime, and SIGKILL releases ownership without repeating settled inference', { timeout: 20_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'backrooms-owner-'));
  const owner = worker('hold', directory);
  const children = [owner];
  try {
    const first = await owner.message();
    assert.equal(first.status, 'completed');
    assert.equal(first.inferenceCalls, 4);
    const competitor = worker('probe', directory);
    children.push(competitor);
    assert.deepEqual(await competitor.message(), { status: 'refused', reason: 'private_runtime_already_owned', inferenceCalls: 0 });
    await competitor.successfulExit();
    owner.child.kill('SIGKILL');
    assert.equal((await owner.closed).signal, 'SIGKILL');
    const recovered = worker('recover', directory);
    children.push(recovered);
    const next = await recovered.message();
    assert.equal(next.status, 'completed');
    assert.equal(next.inferenceCalls, 0);
    assert.deepEqual(next.residentIds, first.residentIds);
    assert.equal(next.originalResultCommitment, first.originalResultCommitment);
    await recovered.successfulExit();
  } finally {
    for (const child of children) child.child.kill('SIGKILL');
    await Promise.all(children.map(child => child.closed));
    await rm(directory, { recursive: true, force: true });
  }
});

test('startup failure releases ownership before another process starts', { timeout: 10_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'backrooms-owner-failure-'));
  let next: ReturnType<typeof worker> | undefined;
  try {
    await assert.rejects(FlueResidents.start({
      directory,
      masterKey: crypto.getRandomValues(new Uint8Array(32)),
      residentIds: [randomHex(), randomHex()],
      records: { read: async () => { throw new Error('injected_key_storage_failure'); }, create: async () => false, replace: async () => false },
    }), /injected_key_storage_failure/);
    next = worker('recover', directory);
    assert.equal((await next.message()).status, 'completed');
    await next.successfulExit();
  } finally {
    next?.child.kill('SIGKILL');
    await next?.closed;
    await rm(directory, { recursive: true, force: true });
  }
});

test('SIGKILL before original capture resumes settled Flue results through a fresher observation and retains acceptance', { timeout: 20_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'backrooms-context-replay-'));
  const owner = worker('hold', directory);
  const children = [owner];
  try {
    const first = await owner.message();
    assert.equal(first.status, 'completed');
    assert.equal(first.inferenceCalls, 4);
    assert.equal(first.originalCaptured, false);
    owner.child.kill('SIGKILL');
    assert.equal((await owner.closed).signal, 'SIGKILL');
    const recovered = worker('recover-fresh-context', directory);
    children.push(recovered);
    const next = await recovered.message();
    assert.equal(next.status, 'accepted');
    assert.equal(next.inferenceCalls, 0);
    assert.equal(next.originalResultCommitment, first.originalResultCommitment);
    assert.equal(next.receiptRetained, true);
    assert.equal(next.contextUnchanged, true);
    assert.deepEqual(next.bridgeOperations, ['prepare_advance', 'submit', 'recover']);
    await recovered.successfulExit();
  } finally {
    for (const child of children) child.child.kill('SIGKILL');
    await Promise.all(children.map(child => child.closed));
    await rm(directory, { recursive: true, force: true });
  }
});
