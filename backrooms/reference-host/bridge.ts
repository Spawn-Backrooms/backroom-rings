import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { BridgeRequest, RingsTransport } from '../client/contracts.js';

export class ProcessRingsTransport implements RingsTransport {
  constructor(private readonly executable: string, private readonly configPath: string, private readonly timeoutMs = 600_000) {
    if (!isAbsolute(executable) || !isAbsolute(configPath)) throw new Error('bridge_paths_must_be_absolute');
  }

  async request(request: BridgeRequest): Promise<unknown> {
    const config = await stat(this.configPath);
    if (!config.isFile() || (config.mode & 0o077) !== 0) throw new Error('bridge_config_permissions');
    return new Promise((resolve, reject) => {
      const child = spawn(this.executable, [], {
        env: { PATH: process.env.PATH, BACKROOM_RINGS_CONFIG: this.configPath },
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: this.timeoutMs,
        killSignal: 'SIGKILL',
      });
      const chunks: Buffer[] = [];
      let size = 0;
      let overflow = false;
      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 1024 * 1024) { overflow = true; child.kill('SIGKILL'); }
        else chunks.push(chunk);
      });
      child.on('error', () => reject(new Error('bridge_unavailable')));
      child.stdin.on('error', () => reject(new Error('bridge_input_failed')));
      child.on('close', code => {
        if (overflow) { reject(new Error('bridge_output_exceeds_bound')); return; }
        try {
          const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (code !== 0 && (typeof parsed !== 'object' || parsed === null || !('status' in parsed) || parsed.status !== 'error')) { reject(new Error('bridge_operation_failed')); return; }
          resolve(parsed);
        }
        catch { reject(new Error('bridge_invalid_json')); }
      });
      child.stdin.end(JSON.stringify(request));
    });
  }
}
