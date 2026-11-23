import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadProductionGatewayConfiguration } from './configuration.js';
import { RingsGateway } from './host.js';
import { listenProductionGateway, type GatewayListener } from './server.js';

export async function startProductionGateway(configPath: string, signal?: AbortSignal): Promise<GatewayListener> {
  const configuration = await loadProductionGatewayConfiguration(configPath);
  signal?.throwIfAborted();
  const gateway = await RingsGateway.open({ ...configuration.gateway, ...(signal ? { startupSignal: signal } : {}) });
  try {
    signal?.throwIfAborted();
    return await listenProductionGateway(gateway, configuration.listener);
  } catch (error) { await gateway.close(); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const startup = new AbortController();
  let listener: GatewayListener | undefined;
  let stopping: Promise<void> | undefined;
  const stop = () => {
    startup.abort();
    stopping ??= listener?.close().catch(() => { process.exitCode = 1; }) ?? Promise.resolve();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    if (process.argv.length !== 3) throw new Error('gateway_configuration_path_required');
    listener = await startProductionGateway(resolve(process.argv[2]!), startup.signal);
    if (startup.signal.aborted) await listener.close();
    else console.log(JSON.stringify({ listening: listener.endpoint, mode: 'production' }));
  } catch {
    if (!startup.signal.aborted) { console.error('gateway_start_failed'); process.exitCode = 1; }
  }
}
