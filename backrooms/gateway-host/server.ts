import { createServer, type Server, type RequestListener } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { Readable } from 'node:stream';
import { gatewayEndpoint } from '../client/gateway-protocol.js';
import type { RingsGateway } from './host.js';

export interface GatewayListener {
  server: Server;
  endpoint: string;
  /** Resolves if the admitted runtime fails before shutdown starts. */
  runtimeFailure?: Promise<void>;
  close(): Promise<void>;
}

export type ProductionListenerConfiguration =
  | { mode: 'tls'; host: string; port: number; publicOrigin: string; certificateFile: string; keyFile: string }
  | { mode: 'trusted_proxy'; port: number; publicOrigin: string };

function handler(gateway: RingsGateway, origin: string): RequestListener {
  return async (incoming, outgoing) => {
    try {
      if (!incoming.url?.startsWith('/') || incoming.url.startsWith('//')) { outgoing.writeHead(400); outgoing.end(); return; }
      const request = new Request(`${origin}${incoming.url}`, { method: incoming.method, headers: incoming.headers as HeadersInit, body: incoming.method === 'GET' || incoming.method === 'HEAD' ? null : Readable.toWeb(incoming), duplex: 'half' } as RequestInit);
      const response = await gateway.fetch(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch { outgoing.writeHead(500); outgoing.end(); }
  };
}

async function listen(gateway: RingsGateway, server: Server, host: string, port: number, origin?: string): Promise<GatewayListener> {
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error('invalid_gateway_port');
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('gateway_listen_failed');
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    try { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
    finally { await gateway.close(); }
  })();
  const failure = gateway.runtimeFailure;
  const runtimeFailure = failure ? new Promise<void>(resolve => {
    void failure.then(() => {
      // An intentional shutdown has already stopped accepting requests.
      if (closing) return;
      // Stop accepting, then drain existing operations before releasing ownership.
      // The CLI reports the failure independently of the cleanup result.
      void close().catch(() => {});
      resolve();
    });
  }) : undefined;
  return {
    server, endpoint: `${origin ?? `http://127.0.0.1:${address.port}`}/v1/backrooms`, close,
    ...(runtimeFailure ? { runtimeFailure } : {}),
  };
}

export async function listenLocalnetGateway(gateway: RingsGateway, port = 0): Promise<GatewayListener> {
  if (gateway.mode !== 'synthetic_localnet') throw new Error('gateway_localnet_listener_requires_localnet');
  return listen(gateway, createServer({ requestTimeout: 30_000, headersTimeout: 10_000, maxHeaderSize: 8192 }, handler(gateway, 'http://127.0.0.1')), '127.0.0.1', port);
}

export async function listenProductionGateway(gateway: RingsGateway, configuration: ProductionListenerConfiguration): Promise<GatewayListener> {
  if (gateway.mode !== 'production') throw new Error('gateway_production_listener_requires_production');
  const publicOrigin = gatewayEndpoint(configuration.publicOrigin, 'production');
  if (publicOrigin.pathname !== '/') throw new Error('gateway_public_origin_invalid');
  const options = { requestTimeout: 30_000, headersTimeout: 10_000, maxHeaderSize: 8192 };
  if (configuration.mode === 'trusted_proxy') return listen(gateway, createServer(options, handler(gateway, publicOrigin.origin)), '127.0.0.1', configuration.port, publicOrigin.origin);
  if (configuration.mode !== 'tls' || !configuration.host || !isAbsolute(configuration.keyFile) || !isAbsolute(configuration.certificateFile)) throw new Error('gateway_tls_configuration_invalid');
  const key = await stat(configuration.keyFile);
  if (!key.isFile() || key.size > 65_536 || (key.mode & 0o077) !== 0) throw new Error('gateway_tls_key_permissions');
  const certificate = await stat(configuration.certificateFile);
  if (!certificate.isFile() || certificate.size > 1024 * 1024) throw new Error('gateway_tls_certificate_invalid');
  const server = createSecureServer({ ...options, minVersion: 'TLSv1.3', key: await readFile(configuration.keyFile), cert: await readFile(configuration.certificateFile) }, handler(gateway, publicOrigin.origin));
  return listen(gateway, server, configuration.host, configuration.port, publicOrigin.origin);
}
