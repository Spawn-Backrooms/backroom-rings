import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

const executable = process.env.BACKROOM_PHOTON_EXECUTABLE;

test('actual Photon rolls back failed file-backed migrations and retries on the repaired database', { skip: !executable, timeout: 30_000 }, async () => {
  assert.ok(executable && isAbsolute(executable));
  const directory = await mkdtemp(join(tmpdir(), 'backrooms-photon-rollback-'));
  const databasePath = join(directory, 'photon.sqlite');
  const original = new DatabaseSync(databasePath);
  original.exec("CREATE TABLE idx_rings_transactions_signature_event (marker TEXT NOT NULL); INSERT INTO idx_rings_transactions_signature_event VALUES ('retained');");
  original.close();
  const snapshot = () => {
    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      return database.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
    } finally { database.close(); }
  };
  const before = snapshot();
  let child: ChildProcess | undefined;
  let diagnostics = '';
  let attempt = 0;
  const start = async () => {
    diagnostics = '';
    const portProbe = createServer();
    await new Promise<void>(resolve => portProbe.listen(0, '127.0.0.1', resolve));
    const address = portProbe.address();
    assert.ok(address && typeof address !== 'string');
    await new Promise<void>((resolve, reject) => portProbe.close(error => error ? reject(error) : resolve()));
    const readyFile = join(directory, `ready-${attempt++}.json`);
    child = spawn(executable, ['--db-url', `sqlite://${databasePath}?mode=rwc`, '--migrate', '--max-db-conn', '2', '--disable-indexing', '--bind-address', '127.0.0.1', '--port', String(address.port), '--ready-file', readyFile, '--rpc-url', 'http://127.0.0.1:9'], { env: { PATH: process.env.PATH, RUST_LOG: 'warn', TOKIO_WORKER_THREADS: '2' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const active = child;
    const timeout = setTimeout(() => active.kill('SIGKILL'), 10_000);
    timeout.unref();
    for (const output of [child.stdout!, child.stderr!]) output.on('data', chunk => { diagnostics = `${diagnostics}${String(chunk)}`.slice(-8000); });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child!.once('error', reject);
      child!.once('close', (code, signal) => { clearTimeout(timeout); resolve({ code, signal }); });
    });
    return { exited, readyFile };
  };
  try {
    const failed = await (await start()).exited;
    assert.equal(failed.code, 1);
    assert.equal(failed.signal, null);
    assert.match(diagnostics, /Failed to run migrations/);
    assert.deepEqual(snapshot(), before, 'a failed batch must not retain schema or migration-prefix rows');
    const repair = new DatabaseSync(databasePath);
    assert.deepEqual(repair.prepare('SELECT marker FROM idx_rings_transactions_signature_event').all().map(row => row.marker), ['retained']);
    repair.exec('DROP TABLE idx_rings_transactions_signature_event');
    repair.close();
    let retained: unknown;
    for (let round = 0; round < 2; round += 1) {
      const { exited, readyFile } = await start();
      const deadline = Date.now() + 5000;
      let ready = false;
      while (Date.now() < deadline) {
        assert.equal(child!.exitCode, null, diagnostics);
        try {
          ready = (JSON.parse(await readFile(readyFile, 'utf8')) as { pid: number }).pid === child!.pid;
          if (ready) break;
        } catch {}
        await delay(25);
      }
      assert.ok(ready, diagnostics);
      const database = new DatabaseSync(databasePath, { readOnly: true });
      const migrations = database.prepare('SELECT version FROM seaql_migrations ORDER BY version').all();
      database.close();
      assert.ok(migrations.length > 0);
      if (round === 0) retained = migrations;
      else assert.deepEqual(migrations, retained);
      child!.kill('SIGINT');
      assert.deepEqual(await exited, { code: 0, signal: null });
    }
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>(resolve => child!.once('exit', () => resolve()));
      child.kill('SIGKILL');
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test('actual Photon migrates a fresh supplied database and resumes retained progress across restarts', { skip: !executable, timeout: 90_000 }, async () => {
  assert.ok(executable && isAbsolute(executable));
  const directory = await mkdtemp(join(tmpdir(), 'backrooms-photon-startup-'));
  const databasePath = join(directory, 'photon.sqlite');
  await writeFile(databasePath, '', { mode: 0o600 });
  let tip = 8;
  const fetched: number[] = [];
  const unexpectedMethods: string[] = [];
  const rpc = createServer(async (request, response) => {
    let input = '';
    for await (const chunk of request) input += String(chunk);
    const packet = JSON.parse(input) as { id: unknown; method: string; params: unknown[] };
    let result: unknown;
    switch (packet.method) {
      case 'getSlot': result = tip; break;
      case 'getProgramAccounts': result = []; break;
      case 'getGenesisHash': result = '11111111111111111111111111111111'; break;
      case 'getMultipleAccounts': result = { context: { slot: tip }, value: (packet.params[0] as unknown[]).map(() => null) }; break;
      case 'getBlock': {
        const slot = Number(packet.params[0]);
        fetched.push(slot);
        result = { previousBlockhash: '11111111111111111111111111111111', blockhash: '11111111111111111111111111111111', parentSlot: slot - 1, transactions: [], rewards: [], blockTime: 1_800_000_000 + slot, blockHeight: slot };
        break;
      }
      default:
        unexpectedMethods.push(packet.method);
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ jsonrpc: '2.0', id: packet.id, error: { code: -32601, message: 'Unexpected fixture RPC method' } }));
        return;
    }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ jsonrpc: '2.0', id: packet.id, result }));
  });
  await new Promise<void>(resolve => rpc.listen(0, '127.0.0.1', resolve));
  const rpcAddress = rpc.address();
  assert.ok(rpcAddress && typeof rpcAddress !== 'string');
  let child: ChildProcess | undefined;
  let diagnostics = '';
  const stop = async () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) { child = undefined; return; }
    const active = child;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { active.kill('SIGKILL'); reject(new Error('Photon did not shut down')); }, 5000);
      active.once('exit', (code, signal) => { clearTimeout(timeout); if (code !== 0 || signal !== null) reject(new Error(`Photon exit ${code}/${signal}: ${diagnostics}`)); else resolve(); });
      active.kill('SIGINT');
    });
    child = undefined;
  };
  const waitFor = async (predicate: () => Promise<boolean>, description: string) => {
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      if (child?.exitCode !== null || child?.signalCode !== null) throw new Error(`Photon exited before ${description}: ${diagnostics}`);
      if (await predicate()) return;
      await delay(50);
    }
    throw new Error(`Timed out waiting for ${description}: ${diagnostics}`);
  };
  const start = async (round: number, expectedSlot: number) => {
    const portProbe = createServer();
    await new Promise<void>(resolve => portProbe.listen(0, '127.0.0.1', resolve));
    const address = portProbe.address();
    assert.ok(address && typeof address !== 'string');
    await new Promise<void>((resolve, reject) => portProbe.close(error => error ? reject(error) : resolve()));
    const readyFile = join(directory, `ready-${round}.json`);
    diagnostics = '';
    child = spawn(executable, ['--bind-address', '127.0.0.1', '--port', String(address.port), '--ready-file', readyFile, '--rpc-url', `http://127.0.0.1:${rpcAddress.port}`, '--db-url', `sqlite://${databasePath}?mode=rwc`, '--migrate', '--resume-from-database', '--start-slot', '5', '--max-concurrent-block-fetches', '2', '--max-db-conn', '2'], { env: { PATH: process.env.PATH, RUST_LOG: 'warn', TOKIO_WORKER_THREADS: '2' }, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const output of [child.stdout!, child.stderr!]) output.on('data', chunk => { diagnostics = `${diagnostics}${String(chunk)}`.slice(-8000); });
    await new Promise<void>((resolve, reject) => { child!.once('spawn', resolve); child!.once('error', reject); });
    await waitFor(async () => {
      try {
        const ready = JSON.parse(await readFile(readyFile, 'utf8')) as { address: string; pid: number };
        assert.equal(ready.address, `127.0.0.1:${address.port}`);
        assert.equal(ready.pid, child!.pid);
        const response = await fetch(`http://127.0.0.1:${address.port}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getIndexerSlot', params: {} }), signal: AbortSignal.timeout(1000) });
        const value = await response.json() as { result?: number };
        return value.result === expectedSlot;
      } catch { return false; }
    }, `indexed slot ${expectedSlot}`);
  };
  const snapshot = () => {
    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const tables = (database.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]).map(row => row.name);
      assert.ok(tables.includes('blocks'));
      assert.ok(tables.includes('tree_metadata'));
      assert.ok(tables.includes('seaql_migrations'));
      return { tables, migrations: database.prepare('SELECT version FROM seaql_migrations ORDER BY version').all(), slots: (database.prepare('SELECT slot FROM blocks ORDER BY slot').all() as { slot: number }[]).map(row => row.slot) };
    } finally { database.close(); }
  };
  try {
    await start(1, 8);
    const first = snapshot();
    assert.deepEqual(first.slots, [5, 6, 7, 8]);
    assert.ok(first.migrations.length > 0);
    assert.equal(Math.min(...fetched), 5);
    await stop();
    fetched.length = 0;
    tip = 10;
    await start(2, 10);
    const second = snapshot();
    assert.deepEqual(second.tables, first.tables);
    assert.deepEqual(second.migrations, first.migrations);
    assert.deepEqual(second.slots, [5, 6, 7, 8, 9, 10]);
    assert.deepEqual([...new Set(fetched)].sort((a, b) => a - b), [9, 10]);
    await stop();
    fetched.length = 0;
    tip = 12;
    await start(3, 12);
    const third = snapshot();
    assert.deepEqual(third.migrations, first.migrations);
    assert.deepEqual(third.slots, [5, 6, 7, 8, 9, 10, 11, 12]);
    assert.deepEqual([...new Set(fetched)].sort((a, b) => a - b), [11, 12]);
    assert.deepEqual(unexpectedMethods, []);
  } finally {
    try { await stop(); }
    finally {
      await new Promise<void>((resolve, reject) => rpc.close(error => error ? reject(error) : resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  }
});
