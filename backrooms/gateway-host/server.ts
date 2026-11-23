import { createServer, type Server } from 'node:http';
import { Readable } from 'node:stream';
import type { LocalnetRingsGateway } from './host.js';

export async function listenLocalnetGateway(gateway: LocalnetRingsGateway, port = 0): Promise<{ server: Server; endpoint: string; close(): Promise<void> }> {
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error('invalid_gateway_port');
  const server = createServer({ requestTimeout: 30_000, headersTimeout: 10_000, maxHeaderSize: 8192 }, async (incoming, outgoing) => {
    try {
      const request = new Request(`http://127.0.0.1${incoming.url}`, { method: incoming.method, headers: incoming.headers as HeadersInit, body: incoming.method === 'GET' || incoming.method === 'HEAD' ? null : Readable.toWeb(incoming), duplex: 'half' } as RequestInit);
      const response = await gateway.fetch(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch { outgoing.writeHead(500); outgoing.end(); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('gateway_listen_failed');
  return {
    server, endpoint: `http://127.0.0.1:${address.port}/v1/backrooms`,
    async close() { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await gateway.close(); },
  };
}
