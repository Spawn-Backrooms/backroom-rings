import { createPrivateKey, createPublicKey } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { assertDigest, assertIdentifier, assertInteger, digestBytes, fromHex, record } from '../client/codec.js';
import type { BridgeRequest } from '../client/contracts.js';
import { gatewayEndpoint, gatewayJson, readGatewayBody } from '../client/gateway-protocol.js';
import { ProcessRingsTransport } from '../reference-host/bridge.js';

export interface LocalnetBridgeConfiguration {
  rpcUrl: string;
  indexerUrl: string;
  proverUrl: string;
  treeAddress: string;
  treeId: number;
  artifactsDirectory: string;
  genesisHash: string;
  programBinarySha256: string;
  shieldedPoolBinarySha256: string;
}

export interface LocalnetBridgeOptions {
  executable: string;
  binarySha256: string;
  configuration: LocalnetBridgeConfiguration;
  temporaryDirectory: string;
  fundingLamports?: number;
  timeoutMs?: number;
}

export function writerIdentity(seedHex: string): string {
  assertDigest(seedHex);
  const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(fromHex(seedHex))]), format: 'der', type: 'pkcs8' });
  const bytes = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32);
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = BigInt(`0x${bytes.toString('hex')}`);
  let output = '';
  while (value > 0n) { output = alphabet[Number(value % 58n)]! + output; value /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; output = `1${output}`; }
  return output;
}

export class LocalnetBridge {
  private constructor(private readonly options: LocalnetBridgeOptions) {}

  static async open(options: LocalnetBridgeOptions): Promise<LocalnetBridge> {
    const config = options.configuration;
    for (const endpoint of [config.rpcUrl, config.indexerUrl, config.proverUrl]) gatewayEndpoint(endpoint, 'synthetic_localnet');
    for (const path of [options.executable, options.temporaryDirectory, config.artifactsDirectory]) if (!isAbsolute(path)) throw new Error('gateway_bridge_paths_must_be_absolute');
    assertDigest(options.binarySha256);
    assertDigest(config.programBinarySha256);
    assertDigest(config.shieldedPoolBinarySha256);
    assertIdentifier(config.genesisHash);
    assertIdentifier(config.treeAddress);
    assertInteger(config.treeId, 0, 65_535);
    assertInteger(options.fundingLamports ?? 0, 0, 10_000_000_000);
    assertInteger(options.timeoutMs ?? 600_000, 1, 3_600_000);
    if (!(await stat(options.executable)).isFile() || await digestBytes(new Uint8Array(await readFile(options.executable))) !== options.binarySha256) throw new Error('gateway_bridge_binary_mismatch');
    return new LocalnetBridge(structuredClone(options));
  }

  private async rpc(method: string, params: unknown[]): Promise<unknown> {
    const response = await fetch(this.options.configuration.rpcUrl, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (!response.ok) throw new Error('gateway_localnet_rpc_failed');
    const reply = record(gatewayJson(await readGatewayBody(response.body)));
    if (reply.jsonrpc !== '2.0' || reply.id !== 1 || 'error' in reply || !('result' in reply)) throw new Error('gateway_localnet_rpc_failed');
    return reply.result;
  }

  private async fund(writer: string): Promise<void> {
    const minimum = this.options.fundingLamports ?? 0;
    if (minimum === 0) return;
    if (await this.rpc('getGenesisHash', []) !== this.options.configuration.genesisHash) throw new Error('gateway_localnet_genesis_mismatch');
    const balance = async () => {
      const result = record(await this.rpc('getBalance', [writer, { commitment: 'confirmed' }]));
      assertInteger(result.value, 0);
      return result.value;
    };
    const current = await balance();
    if (current >= minimum) return;
    const rentExemptMinimum = await this.rpc('getMinimumBalanceForRentExemption', [0, { commitment: 'confirmed' }]);
    assertInteger(rentExemptMinimum, 0, 10_000_000_000);
    const amount = Math.max(minimum - current, rentExemptMinimum);
    const signature = await this.rpc('requestAirdrop', [writer, amount, { commitment: 'confirmed' }]);
    assertIdentifier(signature);
    for (let attempt = 0; attempt < 20; attempt++) {
      if (await balance() >= minimum) return;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('gateway_localnet_funding_unconfirmed');
  }

  async request(seedHex: string, request: BridgeRequest): Promise<unknown> {
    if (request.op !== 'recover' && request.op !== 'reframe') await this.fund(writerIdentity(seedHex));
    const directory = await mkdtemp(join(this.options.temporaryDirectory, 'rings-bridge-'));
    await chmod(directory, 0o700);
    const configPath = join(directory, 'config.json');
    try {
      await writeFile(configPath, JSON.stringify({ ...this.options.configuration, signerSeedHex: seedHex }), { mode: 0o600, flag: 'wx' });
      return await new ProcessRingsTransport(this.options.executable, configPath, this.options.timeoutMs).request(request);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
}
