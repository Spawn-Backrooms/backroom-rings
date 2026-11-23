import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { canonicalJson, digestBytes, randomHex, utf8 } from '../client/codec.js';
import { GATEWAY_VERSION, gatewayAuthenticationKey, gatewayMac, parseGatewayRequest, verifyGatewayMac } from '../client/gateway-protocol.js';

const executable = process.env.BACKROOM_WORKERD_EXECUTABLE;

test('actual workerd authenticates enrollment with its default fetch and preserves a custom transport', { skip: !executable, timeout: 30_000 }, async () => {
  assert.ok(executable && isAbsolute(executable));
  const directory = await mkdtemp(join(tmpdir(), 'backrooms-gateway-workerd-'));
  const authenticationKey = new Uint8Array(32).fill(7);
  const key = await gatewayAuthenticationKey(authenticationKey);
  let requests = 0;
  const gateway = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const bytes = new Uint8Array(Buffer.concat(chunks));
      assert.equal(await verifyGatewayMac(key, 'request', bytes, String(request.headers['x-backrooms-auth'])), true);
      const packet = parseGatewayRequest(JSON.parse(new TextDecoder().decode(bytes)));
      assert.equal(packet.kind, 'bind');
      if (packet.kind !== 'bind') throw new Error('unexpected_fixture_command');
      requests++;
      const result = {
        version: GATEWAY_VERSION, bindingId: 'a'.repeat(64), scope: packet.enrollment.scope,
        creationId: packet.enrollment.creationId, releaseManifestSha256: packet.enrollment.releaseManifestSha256,
        writerIdentity: '11111111111111111111111111111111', keyRef: 'fixture-key', artifactVersion: 'backrooms.localnet.v0',
      };
      const body = utf8(canonicalJson({ version: GATEWAY_VERSION, requestSha256: await digestBytes(bytes), status: 'ok', result }));
      response.writeHead(200, { 'content-type': 'application/json', 'x-backrooms-auth': await gatewayMac(key, 200, body) });
      response.end(body);
    } catch (error) {
      response.writeHead(500);
      response.end(String(error));
    }
  });
  await new Promise<void>(resolve => gateway.listen(0, '127.0.0.1', resolve));
  const gatewayAddress = gateway.address();
  assert.ok(gatewayAddress && typeof gatewayAddress !== 'string');
  const probe = createServer();
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const workerAddress = probe.address();
  assert.ok(workerAddress && typeof workerAddress !== 'string');
  await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  const origin = `http://127.0.0.1:${workerAddress.port}`;
  let child: ChildProcess | undefined;
  let diagnostics = '';
  try {
    const entry = join(directory, 'entry.js');
    await writeFile(entry, `
      import { AuthenticatedRingsGatewayClient } from './client/gateway.js';
      export default { async fetch(request) {
        if (new URL(request.url).pathname === '/health') return new Response('ready');
        try {
          const enrollment = await request.json();
          const options = { endpoint: 'http://127.0.0.1:${gatewayAddress.port}/v1/backrooms', authenticationKey: new Uint8Array(32).fill(7), mode: 'synthetic_localnet' };
          const binding = await new AuthenticatedRingsGatewayClient(options).bind(enrollment);
          let customCalls = 0;
          const custom = new AuthenticatedRingsGatewayClient({ ...options, fetch: (input, init) => { customCalls++; return globalThis.fetch(input, init); } });
          const customBinding = await custom.bind(enrollment);
          return Response.json({ binding, customBinding, customCalls });
        } catch (error) { return new Response(String(error), { status: 500 }); }
      } };
    `);
    const modules = [{ name: 'entry.js', path: entry }];
    for (const name of ['gateway', 'gateway-protocol', 'codec', 'contracts']) {
      const path = fileURLToPath(new URL(`../dist/client/${name}.js`, import.meta.url));
      await readFile(path); // The check intentionally executes the built distributable.
      modules.push({ name: `client/${name}.js`, path });
    }
    modules.push({ name: 'client/valibot', path: fileURLToPath(import.meta.resolve('valibot')) });
    for (const [index, module] of modules.entries()) {
      const name = `source-${index}.js`;
      await writeFile(join(directory, name), await readFile(module.path));
      module.path = name;
    }
    const configuration = join(directory, 'worker.capnp');
    await writeFile(configuration, `
      using Workerd = import "/workerd/workerd.capnp";
      const config :Workerd.Config = (
        services = [
          (name = "client", worker = (
            compatibilityDate = "2026-10-01", globalOutbound = "loopback",
            modules = [${modules.map(module => `(name = ${JSON.stringify(module.name)}, esModule = embed ${JSON.stringify(module.path)})`).join(',')}]
          )),
          (name = "loopback", network = (allow = ["local"]))
        ],
        sockets = [(name = "http", address = "127.0.0.1:${workerAddress.port}", http = (), service = "client")]
      );
    `);
    child = spawn(executable, ['serve', configuration], { env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const output of [child.stdout!, child.stderr!]) output.on('data', chunk => { diagnostics = `${diagnostics}${String(chunk)}`.slice(-8000); });
    await new Promise<void>((resolve, reject) => { child!.once('spawn', resolve); child!.once('error', reject); });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`workerd exited: ${diagnostics}`);
      try { ready = (await fetch(`${origin}/health`, { signal: AbortSignal.timeout(1000) })).ok; } catch { /* The listener is not ready yet. */ }
      if (ready) break;
      await delay(50);
    }
    assert.equal(ready, true, diagnostics);
    const enrollment = { scope: { ownerId: 'owner', projectId: 'project', roomId: 'room' }, creationId: 'creation', creationNonce: randomHex(), seedManifestCommitment: randomHex(), fixedMembersCommitment: randomHex(), releaseManifestSha256: randomHex() };
    const response = await fetch(origin, { method: 'POST', body: JSON.stringify(enrollment), headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(5000) });
    const body = await response.text();
    assert.equal(response.status, 200, body);
    const result = JSON.parse(body);
    assert.deepEqual(result.binding.scope, enrollment.scope);
    assert.deepEqual(result.customBinding, result.binding);
    assert.equal(result.customCalls, 1);
    assert.equal(requests, 2);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const active = child;
      await new Promise<void>(resolve => {
        const timeout = setTimeout(() => active.kill('SIGKILL'), 2000);
        active.once('exit', () => { clearTimeout(timeout); resolve(); });
        active.kill('SIGTERM');
      });
    }
    await new Promise<void>((resolve, reject) => gateway.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
