// Synthetic conformance oracle. These facts are NOT proof receipts, public inputs,
// or an authority API. Only an actual program/circuit can establish them.
const refuse = code => { throw new Error(code); };
const same = (left, right, code) => {
  if (typeof left !== 'string' || left.length === 0 || left !== right) refuse(code);
};

export function checkAnonymousAdvance({ profile, current, grant, ring, spp, app }) {
  if (profile.mode !== 'anonymous-policy' || ring.route !== 'hidden-owner' ||
      ring.publicOwners !== false || ring.delegate !== false) refuse('WRONG_RAIL');
  if (ring.enrolledNonzeroKey !== true || ring.linkedPublicOwner !== false) refuse('OWNER_PRIVACY');
  if (ring.inputCount !== 1 || ring.liveOutputCount !== 1 || spp.liveInputCount !== 1 ||
      spp.liveOutputCount !== 1 || spp.inputAmount !== 0 || spp.outputAmount !== 0 ||
      spp.publicDepositCount !== 0 || spp.publicWithdrawalCount !== 0 ||
      spp.exitCount !== 0) refuse('NONFINANCIAL_SHAPE');
  same(profile.network, app.network, 'NETWORK');
  same(profile.ring, ring.ring, 'RING');
  same(profile.ring, spp.ring, 'RING');
  same(profile.ring, app.ring, 'RING');
  same(profile.application, app.application, 'APPLICATION');
  same(profile.verifier, app.verifier, 'VERIFIER');
  same(profile.policyRoot, ring.policyRoot, 'POLICY');
  same(profile.policyRoot, app.policyRoot, 'POLICY');
  same(profile.trackingRoot, ring.trackingRoot, 'TRACKING');
  same(profile.trackingRoot, app.trackingRoot, 'TRACKING');
  same(ring.privateTxHash, spp.privateTxHash, 'SETTLEMENT');
  same(ring.privateTxHash, app.privateTxHash, 'SETTLEMENT');
  same(ring.firstNullifier, spp.firstNullifier, 'NULLIFIER');
  same(ring.firstNullifier, app.firstNullifier, 'NULLIFIER');
  same(current.room, grant.room, 'ROOM');
  same(current.room, app.room, 'ROOM');
  same(current.checkpoint, grant.predecessor, 'PREDECESSOR');
  same(current.checkpoint, spp.predecessor, 'PREDECESSOR');
  same(current.checkpoint, app.predecessor, 'PREDECESSOR');
  same(spp.successor, app.successor, 'SUCCESSOR');
  if (spp.successor === current.checkpoint) refuse('SUCCESSOR');
  if (typeof current.revision !== 'bigint' || current.revision < 0n ||
      current.revision >= (1n << 64n) - 1n || app.revision !== current.revision + 1n ||
      grant.revision !== app.revision) refuse('REVISION');
  if (grant.active !== true || grant.alreadyConsumed !== false) refuse('GRANT');
  same(grant.policyEpoch, profile.policyEpoch, 'GRANT_EPOCH');
  same(grant.commitment, app.grantCommitment, 'GRANT');
  same(grant.original, app.original, 'ORIGINAL');
  // Abstract equality of the admitted private actor and the actual opened input
  // owner. This is a fixture-only label, NOT a proposed published owner tag.
  same(grant.actor, ring.privateActor, 'ACTOR');
  same(grant.actor, app.privateActor, 'ACTOR');
  return { room: app.room, checkpoint: app.successor, revision: app.revision, original: app.original };
}
