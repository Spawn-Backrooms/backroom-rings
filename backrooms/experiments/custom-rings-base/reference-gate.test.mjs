import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAnonymousAdvance } from './reference-gate.mjs';

const fixture = () => ({
  profile: { mode: 'anonymous-policy', network: 'network-a', ring: 'ring-a', application: 'app-a',
    verifier: 'vk-a', policyRoot: 'policy-a', trackingRoot: 'tracking-a', policyEpoch: 'epoch-a' },
  current: { room: 'room-a', checkpoint: 'checkpoint-0', revision: 0n },
  grant: { room: 'room-a', predecessor: 'checkpoint-0', revision: 1n, commitment: 'grant-a',
    original: 'original-a', active: true, alreadyConsumed: false, policyEpoch: 'epoch-a', actor: 'fixture-actor-a' },
  ring: { route: 'hidden-owner', publicOwners: false, delegate: false, enrolledNonzeroKey: true,
    linkedPublicOwner: false, inputCount: 1, liveInputCount: 1, liveOutputCount: 1, ring: 'ring-a', policyRoot: 'policy-a',
    trackingRoot: 'tracking-a', privateTxHash: 'tx-a', firstNullifier: 'nullifier-a', privateActor: 'fixture-actor-a' },
  spp: { ring: 'ring-a', privateTxHash: 'tx-a', firstNullifier: 'nullifier-a', predecessor: 'checkpoint-0',
    successor: 'checkpoint-1', liveInputCount: 1, liveOutputCount: 1, inputAmount: 0, outputAmount: 0,
    publicDepositCount: 0, publicWithdrawalCount: 0, exitCount: 0 },
  app: { network: 'network-a', application: 'app-a', verifier: 'vk-a', ring: 'ring-a', policyRoot: 'policy-a',
    trackingRoot: 'tracking-a', privateTxHash: 'tx-a', firstNullifier: 'nullifier-a', room: 'room-a',
    predecessor: 'checkpoint-0', successor: 'checkpoint-1', revision: 1n, grantCommitment: 'grant-a',
    original: 'original-a', privateActor: 'fixture-actor-a' },
});

test('matching independently supplied facts yield the expected transition without mutation', () => {
  const f = fixture(); const original = structuredClone(f);
  assert.deepEqual(checkAnonymousAdvance(f), { room: 'room-a', checkpoint: 'checkpoint-1', revision: 1n, original: 'original-a' });
  assert.deepEqual(f, original);
});

test('one live note is not confused with a padded published input count', () => {
  const f = fixture();
  f.ring.inputCount = 2;
  assert.deepEqual(checkAnonymousAdvance(f), { room: 'room-a', checkpoint: 'checkpoint-1', revision: 1n, original: 'original-a' });
});

const negatives = [
  ['confidential fallback', 'ring', 'route', 'confidential', 'WRONG_RAIL'],
  ['public owner fallback', 'ring', 'publicOwners', true, 'WRONG_RAIL'],
  ['delegate bypass', 'ring', 'delegate', true, 'WRONG_RAIL'],
  ['merge bypass', 'ring', 'route', 'merge', 'WRONG_RAIL'],
  ['direct base SPP path', 'ring', 'route', 'base-spp', 'WRONG_RAIL'],
  ['zero-key input', 'ring', 'enrolledNonzeroKey', false, 'OWNER_PRIVACY'],
  ['linked public owner', 'ring', 'linkedPublicOwner', true, 'OWNER_PRIVACY'],
  ['extra live input', 'ring', 'liveInputCount', 2, 'NONFINANCIAL_SHAPE'],
  ['extra live output', 'spp', 'liveOutputCount', 2, 'NONFINANCIAL_SHAPE'],
  ['nonzero value', 'spp', 'outputAmount', 1, 'NONFINANCIAL_SHAPE'],
  ['public deposit', 'spp', 'publicDepositCount', 1, 'NONFINANCIAL_SHAPE'],
  ['public withdrawal', 'spp', 'publicWithdrawalCount', 1, 'NONFINANCIAL_SHAPE'],
  ['exit to another ring', 'spp', 'exitCount', 1, 'NONFINANCIAL_SHAPE'],
  ['cross-network proof', 'app', 'network', 'network-b', 'NETWORK'],
  ['cross-ring proof', 'app', 'ring', 'ring-b', 'RING'],
  ['ring/SPP substitution', 'spp', 'ring', 'ring-b', 'RING'],
  ['substituted app', 'app', 'application', 'app-b', 'APPLICATION'],
  ['substituted verifier', 'app', 'verifier', 'vk-b', 'VERIFIER'],
  ['stale policy', 'ring', 'policyRoot', 'policy-old', 'POLICY'],
  ['stale tracking', 'app', 'trackingRoot', 'tracking-old', 'TRACKING'],
  ['independently valid proof for different settlement', 'app', 'privateTxHash', 'tx-b', 'SETTLEMENT'],
  ['SPP frame substitution', 'spp', 'privateTxHash', 'tx-b', 'SETTLEMENT'],
  ['substituted nullifier', 'spp', 'firstNullifier', 'nullifier-b', 'NULLIFIER'],
  ['cross-room proof', 'app', 'room', 'room-b', 'ROOM'],
  ['stale predecessor', 'app', 'predecessor', 'checkpoint-old', 'PREDECESSOR'],
  ['substituted successor', 'app', 'successor', 'checkpoint-b', 'SUCCESSOR'],
  ['skipped ordinal', 'app', 'revision', 2n, 'REVISION'],
  ['revoked grant', 'grant', 'active', false, 'GRANT'],
  ['consumed original', 'grant', 'alreadyConsumed', true, 'GRANT'],
  ['stale grant epoch', 'grant', 'policyEpoch', 'epoch-old', 'GRANT_EPOCH'],
  ['grant substitution', 'app', 'grantCommitment', 'grant-b', 'GRANT'],
  ['different original', 'app', 'original', 'original-b', 'ORIGINAL'],
  ['ring owner different from approved actor', 'ring', 'privateActor', 'fixture-actor-b', 'ACTOR'],
  ['app owner different from approved actor', 'app', 'privateActor', 'fixture-actor-b', 'ACTOR'],
];
for (const [name, section, key, value, code] of negatives) {
  test(name, () => {
    const f = fixture(); f[section][key] = value;
    const snapshot = structuredClone(f);
    assert.throws(() => checkAnonymousAdvance(f), { message: code });
    assert.deepEqual(f, snapshot);
  });
}

test('rejects u64 revision overflow even if application and grant agree', () => {
  const f = fixture(); f.current.revision = (1n << 64n) - 1n;
  f.grant.revision = f.app.revision = 1n << 64n;
  assert.throws(() => checkAnonymousAdvance(f), { message: 'REVISION' });
});
test('rejects same checkpoint even when application and SPP agree', () => {
  const f = fixture(); f.spp.successor = f.app.successor = f.current.checkpoint;
  assert.throws(() => checkAnonymousAdvance(f), { message: 'SUCCESSOR' });
});
