import { MAX_LESSON_BYTES } from './contracts.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('invalid_canonical_value');
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

export function utf8(value: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(encoder.encode(value));
}

export function decodeUtf8(value: Uint8Array<ArrayBuffer>): string {
  return decoder.decode(value);
}

export function hex(bytes: Uint8Array<ArrayBuffer>): string {
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

export function fromHex(value: string): Uint8Array<ArrayBuffer> {
  if (!/^(?:[0-9a-f]{2})+$/.test(value)) throw new Error('invalid_hex');
  return Uint8Array.from(value.match(/../g)!, byte => Number.parseInt(byte, 16));
}

export function randomHex(bytes = 32): string {
  return hex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function digest(value: unknown): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(canonicalJson(value)))));
}

export async function digestBytes(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

export function base64(bytes: Uint8Array<ArrayBuffer>): string {
  let output = '';
  for (let i = 0; i < bytes.length; i += 0x8000) output += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(output);
}

export function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('invalid_base64');
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}

export function assertDigest(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw new Error('invalid_digest');
}

export function assertLesson(value: unknown): asserts value is string {
  if (typeof value !== 'string' || utf8(value).length > MAX_LESSON_BYTES) throw new Error('invalid_lesson');
}

export function assertInteger(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw new Error('invalid_integer');
}

export function assertU64(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value) || BigInt(value) > 18_446_744_073_709_551_615n) throw new Error('invalid_u64');
}

export function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_record');
  return value as Record<string, unknown>;
}

export function assertIdentifier(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:/-]{1,256}$/.test(value)) throw new Error('invalid_identifier');
}
