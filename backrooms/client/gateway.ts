import { canonicalJson, digestBytes, randomHex, utf8 } from './codec.js';
import type { BridgeRequest, RingsTransport } from './contracts.js';
import { GATEWAY_MAX_BYTES, GATEWAY_VERSION, gatewayAuthenticationKey, gatewayEndpoint, gatewayJson, gatewayMac, parseGatewayBinding, parseGatewayEnrollment, parseGatewayRequest, parseGatewayResponse, readGatewayBody, verifyGatewayMac, type GatewayBinding, type GatewayEnrollment } from './gateway-protocol.js';

export type { GatewayScope, GatewayBinding, GatewayEnrollment } from './gateway-protocol.js';

export interface AuthenticatedRingsGatewayOptions {
  endpoint: string;
  authenticationKey: Uint8Array;
  mode: 'synthetic_localnet' | 'production';
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}

export class AuthenticatedRingsGatewayClient {
  private readonly endpoint: URL;
  private readonly key: Promise<CryptoKey>;
  private readonly fetch: typeof fetch;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(options: AuthenticatedRingsGatewayOptions) {
    this.endpoint = gatewayEndpoint(options.endpoint, options.mode);
    if (options.authenticationKey.byteLength !== 32) throw new Error('invalid_gateway_authentication_key');
    this.key = gatewayAuthenticationKey(options.authenticationKey);
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 660_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 3_600_000) throw new Error('invalid_gateway_timeout');
    this.now = options.now ?? Date.now;
  }

  private async call(command: { kind: 'bind'; enrollment: GatewayEnrollment } | { kind: 'bridge'; binding: GatewayBinding; request: BridgeRequest }): Promise<unknown> {
    const request = parseGatewayRequest({ version: GATEWAY_VERSION, issuedAt: this.now(), nonce: randomHex(), ...command });
    const body = utf8(canonicalJson(request));
    if (body.length > GATEWAY_MAX_BYTES) throw new Error('gateway_body_exceeds_bound');
    const key = await this.key;
    const response = await this.fetch(this.endpoint, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs), body,
      headers: { 'content-type': 'application/json', 'x-backrooms-auth': await gatewayMac(key, 'request', body) },
    });
    const responseBytes = await readGatewayBody(response.body);
    if (!await verifyGatewayMac(key, response.status, responseBytes, response.headers.get('x-backrooms-auth'))) throw new Error('gateway_response_unauthenticated');
    const reply = parseGatewayResponse(gatewayJson(responseBytes));
    if (reply.requestSha256 !== await digestBytes(body)) throw new Error('gateway_response_request_mismatch');
    if (reply.status === 'error') throw new Error(reply.code);
    if (response.status !== 200) throw new Error('gateway_response_status_mismatch');
    return reply.result;
  }

  async bind(input: GatewayEnrollment): Promise<GatewayBinding> {
    const enrollment = parseGatewayEnrollment(input);
    const binding = parseGatewayBinding(await this.call({ kind: 'bind', enrollment }));
    if (canonicalJson(binding.scope) !== canonicalJson(enrollment.scope) || binding.creationId !== enrollment.creationId || binding.releaseManifestSha256 !== enrollment.releaseManifestSha256) throw new Error('gateway_enrollment_binding_mismatch');
    return binding;
  }

  transport(value: GatewayBinding): RingsTransport {
    const binding = parseGatewayBinding(value);
    return { request: request => this.call({ kind: 'bridge', binding, request }) };
  }
}
