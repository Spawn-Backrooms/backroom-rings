import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';
import { isProxy } from 'node:util/types';
import * as v from 'valibot';
import { canonicalJson } from '../../client/codec.js';
import { decodeCanonicalKnowledgeEnvelope, KNOWLEDGE_SCHEMA_VERSION, MAX_KNOWLEDGE_ENVELOPE_BYTES } from '../../client/knowledge.js';

const protocol = 'backrooms.manifest.experiment.v1';
const zero = '00'.repeat(32);
const digest = v.pipe(v.string(), v.length(64), v.regex(/^[a-f0-9]+$/));
const ordinal = v.pipe(v.string(), v.regex(/^[1-9][0-9]{0,19}$/), v.check(n => BigInt(n) <= 0xffff_ffff_ffff_ffffn));

// The direct API and canonical journal admit the same declared, own JSON data properties.
// Validate descriptors before Valibot reads values or projects them onto its output.
function exactObject<const T extends v.ObjectEntries>(fields: T) {
  const declared = new Set(Object.keys(fields));
  const data = v.custom<Record<string, unknown>>(value => {
    if (value === null || typeof value !== 'object' || isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
    const keys = Reflect.ownKeys(value);
    return keys.length === declared.size && keys.every(key => {
      if (typeof key !== 'string' || !declared.has(key)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      return descriptor.enumerable === true && Object.hasOwn(descriptor, 'value');
    });
  }, 'invalid_manifest_object');
  return v.pipe(data, v.strictObject(fields));
}
const configSchema = exactObject({
  protocol: v.literal(protocol), knowledgeSchema: v.literal(KNOWLEDGE_SCHEMA_VERSION),
  roomId: digest, deployment: digest, program: digest, roomOwner: digest, creationNonce: digest,
  seedManifest: digest, fixedMembers: digest, writerKey: digest,
});
const eventSchema = exactObject({
  nonce: v.pipe(digest, v.check(n => n !== zero)), episode: digest, original: digest, candidate: digest,
  selected: v.union([v.literal(0), v.literal(1)]), negative: v.boolean(),
  magnitude: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(10)),
});
const requestSchema = exactObject({
  predecessor: digest, ordinal, canonicalEnvelope: v.string(), event: eventSchema,
});
const evidenceSchema = exactObject({
  kind: v.literal('writer_signature'), signature: v.pipe(v.string(), v.length(128), v.regex(/^[0-9a-f]+$/)),
});
const entrySchema = exactObject({ request: requestSchema, evidence: evidenceSchema });

interface Head {
  readonly revision: string;
  readonly root: string;
  readonly first: number;
  readonly second: number;
  readonly commitment: string;
}
function hash(tag: string, ...values: unknown[]): string {
  return createHash('sha256').update(canonicalJson([protocol, tag, ...values])).digest('hex');
}
function checkpoint(domain: string, revision: string, root: string, first: number, second: number, predecessor: string, authorization: string): Head {
  const commitment = hash('checkpoint', domain, revision, root, first, second, predecessor, authorization);
  return Object.freeze({ revision, root, first, second, commitment });
}

// One instance represents an ordered synthetic history. Chain finality and native receipt admission are separate.
export class ManifestRoom {
  readonly #config: v.InferOutput<typeof configSchema>;
  readonly #domain: string;
  readonly #writer: KeyObject;
  #head: Head;

  constructor(freshConfig: unknown) {
    this.#config = v.parse(configSchema, freshConfig);
    this.#domain = hash('domain', this.#config);
    this.#head = checkpoint(this.#domain, '0', hash('empty', this.#domain), 50, 50, zero, zero);
    this.#writer = createPublicKey({ format: 'jwk', key: {
      kty: 'OKP', crv: 'Ed25519', x: Buffer.from(this.#config.writerKey, 'hex').toString('base64url'),
    } });
  }
  get domain(): string { return this.#domain; }
  get head(): Head { return this.#head; }

  #prepare(input: unknown) {
    const request = v.parse(requestSchema, input);
    if (request.predecessor !== this.#head.commitment) throw new Error('stale_predecessor');
    if (BigInt(request.ordinal) !== BigInt(this.#head.revision) + 1n) throw new Error('wrong_ordinal');
    const envelope = decodeCanonicalKnowledgeEnvelope(request.canonicalEnvelope);
    if (envelope.record.roomId !== this.#config.roomId) throw new Error('room_mismatch');
    const { event } = request;
    if (!envelope.record.sources.some(s => s.kind === 'run' && s.run.digest === event.episode && s.originalResult.digest === event.original)) {
      throw new Error('run_source_mismatch');
    }
    const leaf = hash('envelope', envelope.schemaVersion, request.canonicalEnvelope);
    const authorization = hash('authorize', this.#domain, request.predecessor, request.ordinal, leaf, event);
    return { request, leaf, authorization };
  }
  authorization(input: unknown): string {
    return this.#prepare(input).authorization;
  }
  advance(input: unknown, evidence: unknown) {
    const signature = v.parse(evidenceSchema, evidence).signature;
    const { request, leaf, authorization } = this.#prepare(input);
    if (!verify(null, Buffer.from(authorization, 'hex'), this.#writer, Buffer.from(signature, 'hex'))) {
      throw new Error('writer_signature_mismatch');
    }
    const { ordinal, predecessor, event } = request;
    const old = this.#head;
    const delta = event.negative ? -event.magnitude : event.magnitude;
    const nextScore = Math.max(0, Math.min(100, (event.selected === 0 ? old.first : old.second) + delta));
    const root = hash('append', this.#domain, old.root, ordinal, leaf, authorization);
    this.#head = checkpoint(this.#domain, ordinal, root,
      event.selected === 0 ? nextScore : old.first, event.selected === 1 ? nextScore : old.second, predecessor, authorization);
    return { domain: this.#domain, predecessor, ordinal, authorization, successor: this.#head.commitment };
  }
}

// Verify from independently supplied genesis configuration and tip. Accept no restored mutable head or verifier key.
export function recoverManifest(config: unknown, canonicalEntries: Iterable<string>, expectedHead: string): Head {
  v.parse(digest, expectedHead);
  const room = new ManifestRoom(config);
  for (const text of canonicalEntries) {
    if (typeof text !== 'string' || Buffer.byteLength(text) > 2 * MAX_KNOWLEDGE_ENVELOPE_BYTES + 2048) throw new Error('invalid_journal_size');
    const entry = v.parse(entrySchema, JSON.parse(text));
    if (text !== canonicalJson(entry)) throw new Error('noncanonical_journal');
    room.advance(entry.request, entry.evidence);
  }
  if (room.head.commitment !== expectedHead) throw new Error('recovered_head_mismatch');
  return room.head;
}
