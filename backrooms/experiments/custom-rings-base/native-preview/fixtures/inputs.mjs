import { INPUT_SCHEMA, makePolicy, publicPolicy } from "../contract.mjs";

export const synthetic = Object.freeze({ kind: "synthetic", synthetic: true, qualifying: false });
export const nowMs = 1_000_000;
export const fakeArtifacts = Object.freeze({
  customRingsSource: "1".repeat(40),
  zolanaSource: "2".repeat(40),
  backroomsReferenceHost: "3".repeat(40),
  overlaySha256: "4".repeat(64),
  programId: "5".repeat(44),
  programSha256: "6".repeat(64),
  genesisKeySha256: "7".repeat(64),
  advanceKeySha256: "8".repeat(64),
});
export const fakeRuntime = Object.freeze({
  seedCommitment: "9".repeat(64),
  membershipCommitment: "a".repeat(64),
});
const fakeNativeBuild = Object.freeze({ nativeSource: "b".repeat(40), toolchainSha256: "c".repeat(64) });
const syntheticGates = Object.fromEntries(
  Object.keys(publicPolicy.gates).map((check) => [check, Object.freeze({ status: "synthetic-qualified" })]),
);

export const scenarios = Object.freeze({
  "current-gates": makePolicy("synthetic", fakeArtifacts, fakeRuntime, null, publicPolicy.gates),
  qualified: makePolicy("synthetic", fakeArtifacts, fakeRuntime, fakeNativeBuild, syntheticGates),
});

export function healthyInput(policy) {
  const observe = (value) => ({ scopeSha256: policy.scopeSha256, observedAtMs: nowMs, value });
  return {
    schema: INPUT_SCHEMA,
    nowMs,
    selection: { ...policy.selection },
    observations: {
      artifacts: observe({ ...policy.artifacts, ...policy.nativeBuild }),
      runtime: observe({ ...policy.runtime }),
      validator: observe({ endpoint: "http://localhost:8899", status: "reachable" }),
      prover: observe({ endpoint: "http://127.0.0.1:3000", status: "reachable" }),
      indexer: observe({ endpoint: "https://[::1]:8080/health", status: "reachable" }),
      recovery: observe("complete"),
    },
  };
}

export function optimisticReferences(scopeSha256) {
  const reference = { kind: "maintainer-reference", scopeSha256, reviewedEvidenceSha256: "f".repeat(64) };
  return {
    historicalJourney: { ...reference },
    gates: Object.fromEntries(Object.keys(publicPolicy.gates).map((check) => [check, { ...reference }])),
  };
}
