import {
  EVIDENCE_SCHEMA, evaluateForPolicy, evidenceOutcomes, evidenceShape, evidenceStages,
  hasExactKeys, hasOnlyKeys, isCommit, isSha256, publicPolicy,
} from "./contract.mjs";

export function evaluateReadiness(input) {
  return evaluateForPolicy(input, publicPolicy);
}

export function prepareEvidenceEnvelope(input) {
  const invalid = { status: "invalid", code: "malformed-evidence-envelope" };
  if (!hasExactKeys(input, evidenceShape.keys) || input.schema !== EVIDENCE_SCHEMA
    || input.kind !== "maintainer-reference" || !isSha256(input.profileScopeSha256)
    || !isCommit(input.nativeSource) || !isSha256(input.artifactFingerprintSha256)
    || !isSha256(input.toolchainSha256) || !hasOnlyKeys(input.evidence, evidenceStages)) return invalid;

  const stages = Object.entries(input.evidence);
  if (stages.length === 0 || !stages.every(([, value]) => hasExactKeys(value, evidenceShape.entryKeys)
    && evidenceOutcomes.includes(value.outcome) && isSha256(value.reviewedExtractSha256))) return invalid;

  return {
    status: "valid",
    envelope: {
      ...input,
      evidence: Object.fromEntries(stages.map(([stage, value]) => [stage, { ...value }])),
    },
  };
}
