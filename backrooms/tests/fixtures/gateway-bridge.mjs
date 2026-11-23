#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const hash = value => createHash('sha256').update(value).digest('hex');
const configPath = process.env.BACKROOM_RINGS_CONFIG;
const config = JSON.parse(readFileSync(configPath, 'utf8'));
assert.equal(statSync(configPath).mode & 0o077, 0);
assert.equal(statSync(dirname(configPath)).mode & 0o077, 0);
const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(config.signerSeedHex, 'hex')]), format: 'der', type: 'pkcs8' });
const publicKey = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32);
let number = BigInt(`0x${publicKey.toString('hex')}`);
let writer = '';
while (number > 0n) { writer = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'[Number(number % 58n)] + writer; number /= 58n; }
for (const byte of publicKey) { if (byte !== 0) break; writer = `1${writer}`; }
let input = '';
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
const envelope = { protocolVersion: 'backrooms.v0', operationId: request.operationId };
const statePath = join(config.artifactsDirectory, `${writer}.json`);
const controlsPath = join(config.artifactsDirectory, 'controls.json');
const controls = existsSync(controlsPath) ? JSON.parse(readFileSync(controlsPath, 'utf8')) : {};
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { frames: {}, sequence: 0, recoveryCount: 0, applications: 0 };
appendFileSync(join(config.artifactsDirectory, 'calls.jsonl'), `${JSON.stringify({ op: request.op, operationId: request.operationId, writer, configPath })}\n`);
const zero = '0'.repeat(64);
let reply;
if (request.op === 'prepare_create' || request.op === 'prepare_advance') {
  const creation = request.op === 'prepare_create';
  const roomId = creation ? hash(`${writer}/${request.input.creationNonce}`) : request.input.roomId;
  const checkpoint = { roomId, uniqueAddress: hash(`${writer}/unique`), stateCommitment: hash(JSON.stringify(request.input)), revision: creation ? '0' : request.input.ordinal };
  const body = Buffer.from(JSON.stringify({ fixture: 'synthetic gateway protocol, no Solana transaction or proof', writer, sequence: ++state.sequence, request }));
  const transactionDigest = hash(body);
  const transactionBase64 = body.toString('base64');
  const authorizationCommitment = hash(JSON.stringify(request.input));
  state.frames[transactionDigest] = { checkpoint, request, transactionBase64, authorizationCommitment, generation: 0 };
  reply = { ...envelope, status: 'prepared', checkpoint, transactionBase64, transactionDigest, proofs: { applicationProofDigest: hash('fixture application proof'), privateTxHash: hash('fixture private hash') }, artifactVersion: 'backrooms.localnet.v0', ...(creation ? {} : { authorizationCommitment }) };
} else if (request.op === 'submit') {
  const frame = state.frames[request.input.transactionDigest];
  assert.equal(frame.transactionBase64, request.input.transactionBase64);
  const signature = `fixture-signature-${request.input.transactionDigest}`;
  if (frame.confirmed) reply = { ...envelope, ...frame.confirmed };
  else if (controls.expireOriginal && frame.generation === 0) reply = { ...envelope, status: 'expired', signature };
  else if (controls.submissionUnknown) reply = { ...envelope, status: 'unknown', signature };
  else {
    const creation = frame.request.op === 'prepare_create';
    const proposal = frame.request.input;
    const slot = String(100 + ++state.applications);
    frame.confirmed = { status: 'confirmed', signature, slot };
    state.current = {
      ...envelope, status: 'recovered', checkpoint: frame.checkpoint,
      memory: creation ? { lesson: '', episodeCommitment: zero, originalResultCommitment: zero, candidateCommitment: zero, predecessorCommitment: zero, authorizationCommitment: zero } : {
        lesson: proposal.lesson, episodeCommitment: proposal.episodeCommitment, originalResultCommitment: proposal.originalResultCommitment, candidateCommitment: proposal.candidateCommitment, predecessorCommitment: proposal.expectedPredecessor, authorizationCommitment: frame.authorizationCommitment,
      },
      policy: { policyId: '1', scores: creation ? [50, 50] : [40, 50] }, slot, contextSlot: '200', signature,
      writerIdentity: writer, artifactVersion: 'backrooms.localnet.v0',
      seedManifestCommitment: creation ? proposal.seedManifestCommitment : state.current.seedManifestCommitment,
      fixedMembersCommitment: creation ? proposal.fixedMembersCommitment : state.current.fixedMembersCommitment,
    };
    reply = { ...envelope, ...frame.confirmed };
  }
} else if (request.op === 'recover') {
  state.recoveryCount++;
  const contextSlot = String(200 + state.recoveryCount);
  reply = controls.recoveryPending ? { ...envelope, status: 'pending' } : state.current ? { ...state.current, ...envelope, contextSlot } : { ...envelope, status: 'not_found', contextSlot };
  if (controls.wrongWriter && reply.status === 'recovered') reply.writerIdentity = '11111111111111111111111111111111';
  if (controls.wrongMembership && reply.status === 'recovered') reply.fixedMembersCommitment = zero;
} else if (request.op === 'reframe') {
  const parent = state.frames[request.input.transactionDigest];
  assert.equal(parent.transactionBase64, request.input.transactionBase64);
  const transactionBase64 = Buffer.from(JSON.stringify({ fixture: 'synthetic replacement, no proof', parent: request.input.transactionDigest, writer, sequence: ++state.sequence })).toString('base64');
  const transactionDigest = hash(Buffer.from(transactionBase64, 'base64'));
  state.frames[transactionDigest] = { ...parent, transactionBase64, generation: parent.generation + 1 };
  reply = { ...envelope, status: 'reframed', transactionBase64, transactionDigest, parentTransactionDigest: request.input.transactionDigest, signature: `fixture-signature-${transactionDigest}` };
} else throw new Error('unexpected_fixture_operation');
writeFileSync(statePath, JSON.stringify(state));
process.stdout.write(JSON.stringify(reply));
