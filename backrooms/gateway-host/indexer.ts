import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { assertInteger } from '../client/codec.js';
import { gatewayEndpoint } from '../client/gateway-protocol.js';

export interface SupervisedIndexerConfiguration {
  port: number;
  databasePath: string;
  startSlot: string;
}

export class SupervisedIndexer {
  private stopped = false;
  private constructor(private readonly process: ChildProcess, readonly endpoint: string) {}

  static async start(supervisor: string, executable: string, rpcUrl: string, configuration: SupervisedIndexerConfiguration, signal?: AbortSignal): Promise<SupervisedIndexer> {
    signal?.throwIfAborted();
    gatewayEndpoint(rpcUrl, 'production');
    assertInteger(configuration.port, 1, 65_535);
    if (!isAbsolute(configuration.databasePath) || /[?#\x00]/.test(configuration.databasePath)) throw new Error('gateway_indexer_database_invalid');
    if (!/^(0|[1-9][0-9]{0,19})$/.test(configuration.startSlot) || BigInt(configuration.startSlot) > 18_446_744_073_709_551_615n) throw new Error('gateway_indexer_start_slot_invalid');
    const probe = createServer();
    await new Promise<void>((resolve, reject) => { probe.once('error', reject); probe.listen(configuration.port, '127.0.0.1', resolve); });
    await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
    const readyFile = join(dirname(executable), 'indexer-ready.json');
    const child = spawn(supervisor, ['--supervise-indexer', executable, '--bind-address', '127.0.0.1', '--ready-file', readyFile, '--port', String(configuration.port), '--rpc-url', rpcUrl, '--db-url', `sqlite://${configuration.databasePath}?mode=rwc`, '--start-slot', configuration.startSlot, '--max-concurrent-block-fetches', '4'], {
      env: { PATH: process.env.PATH }, stdio: ['pipe', 'ignore', 'ignore'],
    });
    await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    const result = new SupervisedIndexer(child, `http://127.0.0.1:${configuration.port}`);
    try {
      for (let attempt = 0; attempt < 120; attempt++) {
        signal?.throwIfAborted();
        result.assertRunning();
        try {
          const ready = JSON.parse(await readFile(readyFile, 'utf8')) as { address?: unknown; pid?: unknown };
          if (ready.address !== `127.0.0.1:${configuration.port}` || !Number.isSafeInteger(ready.pid) || (ready.pid as number) <= 0) throw new Error('gateway_indexer_readiness_invalid');
          const response = await fetch(result.endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(1000), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getIndexerSlot', params: {} }) });
          const body = response.ok ? await response.json() as { jsonrpc?: unknown; id?: unknown; result?: unknown; error?: unknown } : null;
          if (body?.jsonrpc === '2.0' && body.id === 1 && body.error === undefined && Number.isSafeInteger(body.result) && (body.result as number) >= Number(configuration.startSlot)) { result.assertRunning(); return result; }
        } catch { result.assertRunning(); }
        await delay(250);
      }
      throw new Error('gateway_indexer_start_timeout');
    } catch (error) { await result.close(); throw error; }
  }

  assertRunning(): void {
    if (this.stopped || this.process.exitCode !== null || this.process.signalCode !== null) throw new Error('gateway_indexer_unavailable');
  }

  async close(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.process.exitCode !== null || this.process.signalCode !== null) return;
    await new Promise<void>(resolve => {
      const timeout = setTimeout(() => this.process.kill('SIGKILL'), 5000);
      this.process.once('exit', () => { clearTimeout(timeout); resolve(); });
      this.process.stdin!.end();
    });
  }
}
