import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import * as v from 'valibot';
import { fromHex } from '../client/codec.js';
import type { ProductionGatewayOptions } from './host.js';
import type { ProductionListenerConfiguration } from './server.js';

const path = v.pipe(v.string(), v.check(isAbsolute));
const hash = v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/));
const identifier = v.pipe(v.string(), v.regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/));
const environmentVariable = v.pipe(v.string(), v.regex(/^[A-Z][A-Z0-9_]{0,127}$/));
const keyRef = v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{1,128}$/));
const port = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65_535));
const https = v.pipe(v.string(), v.check(value => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash; } catch { return false; } }));
const configSchema = v.strictObject({
  version: v.literal(1), mode: v.literal('production'), databasePath: path,
  releaseManifestFile: path, approvedManifestSha256: hash,
  authenticationKeyEnvironment: environmentVariable,
  storageKeys: v.strictObject({ currentKeyRef: keyRef, keys: v.record(keyRef, environmentVariable) }),
  bridge: v.strictObject({
    configuration: v.strictObject({ rpcUrl: https, proverUrl: https, treeAddress: identifier, treeId: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(65_535)), genesisHash: identifier }),
    artifacts: v.strictObject({ directory: path, bridge: path, indexer: path }),
    indexer: v.strictObject({ port, databasePath: path, startSlot: v.pipe(v.string(), v.regex(/^(0|[1-9][0-9]{0,19})$/), v.check(value => BigInt(value) <= 18_446_744_073_709_551_615n)) }),
    timeoutMs: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(3_600_000))),
  }),
  listener: v.variant('mode', [
    v.strictObject({ mode: v.literal('trusted_proxy'), port, publicOrigin: https }),
    v.strictObject({ mode: v.literal('tls'), host: v.pipe(v.string(), v.minLength(1)), port, publicOrigin: https, certificateFile: path, keyFile: path }),
  ]),
});

export type ProductionGatewayConfiguration = v.InferOutput<typeof configSchema>;

export function decodeProductionGatewayConfiguration(value: unknown): ProductionGatewayConfiguration {
  const config = v.parse(configSchema, value);
  if (new URL(config.listener.publicOrigin).pathname !== '/') throw new Error('gateway_public_origin_invalid');
  if (!Object.hasOwn(config.storageKeys.keys, config.storageKeys.currentKeyRef) || Object.keys(config.storageKeys.keys).length > 32) throw new Error('gateway_storage_key_configuration_invalid');
  if (/[?#\x00]/.test(config.bridge.indexer.databasePath)) throw new Error('gateway_indexer_database_invalid');
  return config;
}

async function readJson(path: string, ownerOnly: boolean): Promise<unknown> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size === 0 || metadata.size > 1024 * 1024) throw new Error('gateway_configuration_size_invalid');
    if (ownerOnly && ((metadata.mode & 0o077) !== 0 || (process.getuid && metadata.uid !== process.getuid()))) throw new Error('gateway_configuration_permissions');
    const bytes = await handle.readFile();
    if (bytes.length > 1024 * 1024) throw new Error('gateway_configuration_size_invalid');
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } finally { await handle.close(); }
}

export async function loadProductionGatewayConfiguration(configPath: string, environment: NodeJS.ProcessEnv = process.env): Promise<{ gateway: ProductionGatewayOptions; listener: ProductionListenerConfiguration }> {
  if (!isAbsolute(configPath)) throw new Error('gateway_configuration_path_must_be_absolute');
  const config = decodeProductionGatewayConfiguration(await readJson(configPath, true));
  const key = (name: string): Uint8Array<ArrayBuffer> => {
    const value = environment[name];
    if (!value || !/^[0-9a-f]{64}$/.test(value)) throw new Error('gateway_secret_environment_invalid');
    return fromHex(value);
  };
  return {
    gateway: {
      mode: 'production', databasePath: config.databasePath, authenticationKey: key(config.authenticationKeyEnvironment),
      storageKeys: { currentKeyRef: config.storageKeys.currentKeyRef, keys: Object.fromEntries(Object.entries(config.storageKeys.keys).map(([ref, name]) => [ref, key(name)])) },
      releaseManifest: await readJson(config.releaseManifestFile, false), releaseManifestSha256: config.approvedManifestSha256,
      bridge: { configuration: config.bridge.configuration, artifacts: config.bridge.artifacts, indexer: config.bridge.indexer, ...(config.bridge.timeoutMs === undefined ? {} : { timeoutMs: config.bridge.timeoutMs }) },
    },
    listener: config.listener,
  };
}
