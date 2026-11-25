import { createHash } from "node:crypto";

export const INPUT_SCHEMA = "cr05-readiness-input.v1";
export const EVIDENCE_SCHEMA = "cr05-maintainer-evidence.v1";
const SCOPE_SCHEMA = "cr05-profile-scope.v1";
const MAX_AGE_MS = 60_000;

const selection = Object.freeze({
  profile: "anonymous-localnet-v1",
  network: "localnet",
  artifactVersion: "spawn-room.v1",
  protocolVersion: "backrooms.v0",
  programFeature: "spawn-room-v1",
  testKeySet: "spawn-room-v1-localnet-keys",
  localnetTestKeys: true,
  runtime: "seeded-flue",
  inference: "deterministic-local",
  authority: "anonymous-owner",
  providerSpend: false,
});

const currentGates = Object.freeze({
  "upstream-go": Object.freeze({
    status: "recorded",
    source: "25439b26fcbaa1d938ea2be4c23b7ced132037ec",
    rawReceipts: 18,
    expectedReceipts: 18,
  }),
  "cr02-independent-acceptance": Object.freeze({ status: "open" }),
  "cr03-dependency": Object.freeze({ status: "open" }),
  "cr04-independent-acceptance": Object.freeze({ status: "open" }),
  "native-integration": Object.freeze({ status: "open" }),
});
const gateNames = Object.freeze(Object.keys(currentGates));

export function makePolicy(namespace, artifacts, runtime, nativeBuild, gates) {
  const tuple = [
    SCOPE_SCHEMA,
    namespace,
    Object.entries(selection),
    Object.entries(artifacts),
    Object.entries(runtime),
    nativeBuild === null ? null : Object.entries(nativeBuild),
  ];
  return Object.freeze({
    namespace,
    selection,
    artifacts: Object.freeze(artifacts),
    runtime: Object.freeze(runtime),
    nativeBuild: Object.freeze(nativeBuild),
    gates: Object.freeze(gates),
    scopeSha256: createHash("sha256").update(JSON.stringify(tuple), "utf8").digest("hex"),
    maxAgeMs: MAX_AGE_MS,
  });
}

export const publicPolicy = makePolicy(
  "public",
  {
    customRingsSource: "02bca33729051798834ecbb4d94e968cdc0ef9b8",
    zolanaSource: "0fe4f952182b39464d472c52c40b3febe6cbd9ec",
    backroomsReferenceHost: "08822c65254cd73c5f2dccbdf182ce1df2c7510a",
    overlaySha256: "243ae5f816731a03cb85420919e62cc76db26213de87a4387c654d7423228288",
    programId: "2t8SPCrLAxKjhYjY1Yy1Dwx2ktRaKZ6fGf5khcY5zb5Y",
    programSha256: "81e618d960fcb87d5c79b559d3c3fb16ba358ab03657b5c5dabd62fe19b2a19d",
    genesisKeySha256: "734a190c0293a5615cfabc87b4f78a97231c6b093554a4fff201754b0888fe57",
    advanceKeySha256: "b6da837e7d476ca1ed007aae654d8327556a964b29fbaddc9511bed698fdf822",
  },
  {
    seedCommitment: "33be649119e365fa0fd1922f794c9903c4cf5cf30f5e82474d5a6a63e512a138",
    membershipCommitment: "4bffd551c58ebd26411ceb47ff0da6b79aba1d3ccd074f636c7afd9e86735eba",
  },
  null,
  currentGates,
);

const daybreak = Object.freeze({ status: "outstanding", runtimePrerequisite: false });

const disclosures = Object.freeze({
  "public-enrollment-and-genesis": "Enrollment and room genesis are visible on the chain.",
  "public-global-config-and-root-changes": "Global configuration and admission root changes are public.",
  "public-payer-and-timing": "Chain fee payer and timing metadata remain public.",
  "designated-auditor-ring-access": "The designated auditor can inspect the ring stream.",
  "native-host-private-originals-and-learning-state": "The native host retains private originals and learning state.",
  "operator-provider-and-network-anonymity-unqualified": "Operator, provider, and network anonymity remain unqualified.",
  "multiple-eligible-note-owners-required-for-journey": "The local journey requires multiple eligible note owners with live eligible notes.",
  "insecure-keys-localnet-only": "The insecure single-party proving keys are for localnet use only.",
});

function action(code, label) {
  return Object.freeze({ code, label });
}

const fixInput = action("check-preview-input", "Check the preview input");
const selectLocalnet = action("select-localnet-profile", "Select the anonymous localnet profile");
const matchArtifacts = action("check-artifacts", "Check the local preview artifacts");
const checkRuntime = action("check-runtime-binding", "Check the seeded Flue binding");
const checkRecovery = action("check-room-recovery", "Check room recovery");
const readyAction = action("view-local-preview", "View local preview");

function reason(message, primaryAction) {
  return Object.freeze({ message, primaryAction });
}

function observationReasons(label, nextAction) {
  return {
    missing: reason(`The ${label} observation is missing.`, nextAction),
    malformed: reason(`The ${label} observation is malformed.`, nextAction),
    stale: reason(`The ${label} observation is stale.`, nextAction),
    "scope-mismatch": reason(`The ${label} observation is for a different profile scope.`, nextAction),
  };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function hasOnlyKeys(value, allowed) {
  return isRecord(value) && Object.keys(value).every((key) => allowed.includes(key));
}

export function hasExactKeys(value, keys) {
  return hasOnlyKeys(value, keys) && keys.every((key) => Object.hasOwn(value, key));
}

export function isSha256(value) {
  return typeof value === "string" && value.length === 64 && !/[^0-9a-f]/u.test(value);
}

export function isCommit(value) {
  return typeof value === "string" && value.length === 40 && !/[^0-9a-f]/u.test(value);
}

function isProgramId(value) {
  return typeof value === "string" && value.length >= 32 && value.length <= 44
    && !/[^1-9A-HJ-NP-Za-km-z]/u.test(value);
}

function isTimestamp(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function checkSelection({ input, policy }) {
  const actual = input.selection;
  if (!hasExactKeys(actual, Object.keys(policy.selection))) return "unsupported-profile";
  if (actual.network !== policy.selection.network) return "unsupported-network";
  if (!Object.entries(policy.selection).every(([key, value]) => actual[key] === value)) {
    return "unsupported-profile";
  }
}

const artifactTypes = Object.freeze({
  customRingsSource: isCommit,
  zolanaSource: isCommit,
  backroomsReferenceHost: isCommit,
  overlaySha256: isSha256,
  programId: isProgramId,
  programSha256: isSha256,
  genesisKeySha256: isSha256,
  advanceKeySha256: isSha256,
  nativeSource: isCommit,
  toolchainSha256: isSha256,
});

const runtimeTypes = Object.freeze({ seedCommitment: isSha256, membershipCommitment: isSha256 });
const serviceKeys = Object.freeze(["endpoint", "status"]);
const serviceStates = Object.freeze(["reachable", "unreachable"]);
const observationKeys = Object.freeze(["scopeSha256", "observedAtMs", "value"]);
const recoveryStates = Object.freeze(["complete", "incomplete", "unknown-submission"]);

function compareFields(actual, required, types) {
  if (!isRecord(actual)) return "malformed";
  for (const key of Object.keys(actual)) {
    if (!types[key](actual[key])) return "malformed";
  }
  for (const key of Object.keys(required)) {
    if (!Object.hasOwn(actual, key)) return "missing";
  }
  if (Object.entries(required).some(([key, value]) => actual[key] !== value)) {
    return "fingerprint-mismatch";
  }
}

function observe(check, reasons, keys, evaluateValue) {
  return {
    check,
    reasons,
    observationValueKeys: keys,
    evaluate({ input, policy }) {
      const observation = input.observations[check];
      if (observation === undefined) return "missing";
      if (!hasExactKeys(observation, observationKeys)
        || !isSha256(observation.scopeSha256)
        || !isTimestamp(observation.observedAtMs)
        || observation.observedAtMs > input.nowMs) return "malformed";
      if (input.nowMs - observation.observedAtMs > policy.maxAgeMs) return "stale";
      if (observation.scopeSha256 !== policy.scopeSha256) return "scope-mismatch";
      return evaluateValue(observation.value, policy);
    },
  };
}

function gate(check, gateAction, message) {
  return {
    check,
    reasons: { "qualification-open": reason(message, gateAction) },
    evaluate({ policy }) {
      const status = policy.gates[check]?.status;
      if (check === "native-integration" && policy.nativeBuild === null) return "qualification-open";
      if (status === "synthetic-qualified" && policy.namespace === "synthetic") return;
      if (status !== "recorded") return "qualification-open";
    },
  };
}

function loopbackEndpoint(endpoint) {
  return /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?(?=\/|$)/iu.test(endpoint)
    && !/[\s\\?#]/u.test(endpoint);
}

function service(check) {
  const checkEndpoint = action(`check-local-${check}`, `Check the local ${check} endpoint`);
  const startService = action(`start-local-${check}`, `Start the local ${check}`);
  return observe(check, {
    ...observationReasons(check, checkEndpoint),
    missing: reason(`The ${check} observation is missing.`, startService),
    "non-loopback-service": reason(`The ${check} endpoint must use explicit HTTP or HTTPS loopback.`, checkEndpoint),
    unreachable: reason(`The local ${check} is reported unreachable.`, startService),
  }, serviceKeys, (value) => {
    if (!hasExactKeys(value, serviceKeys) || typeof value.endpoint !== "string"
      || !serviceStates.includes(value.status) || !URL.canParse(value.endpoint)) {
      return "malformed";
    }
    if (!loopbackEndpoint(value.endpoint)) return "non-loopback-service";
    if (value.status === "unreachable") return "unreachable";
  });
}

const invalidInput = {
  check: "input",
  code: "malformed-input",
  ...reason("The preview input has an unsupported format.", fixInput),
};

const registry = [
  {
    check: "selection",
    reasons: {
      "unsupported-profile": reason("The selection must match the anonymous localnet profile.", selectLocalnet),
      "unsupported-network": reason("The anonymous preview requires localnet.", selectLocalnet),
    },
    evaluate: checkSelection,
  },
  observe("artifacts", {
    ...observationReasons("artifact", matchArtifacts),
    "fingerprint-mismatch": reason("The local artifact fingerprints differ from the profile pins.", matchArtifacts),
  }, Object.keys(artifactTypes), (value, policy) => {
    return compareFields(value, { ...policy.artifacts, ...policy.nativeBuild }, artifactTypes);
  }),
  gate("upstream-go", action("check-upstream-go", "Check the upstream Go baseline"), "The upstream Go baseline is open."),
  gate("cr02-independent-acceptance",
    action("obtain-cr02-acceptance", "Obtain independent CR02 acceptance"),
    "Independent CR02 acceptance is open."),
  gate("cr03-dependency",
    action("obtain-cr03-acceptance", "Obtain CR03 dependency acceptance"),
    "CR03 dependency acceptance is open."),
  gate("cr04-independent-acceptance",
    action("obtain-cr04-acceptance", "Obtain independent CR04 acceptance"),
    "Independent CR04 acceptance is open."),
  gate("native-integration",
    action("obtain-native-integration-evidence", "Obtain native integration evidence"),
    "The exact maintainer-approved native source, build, and integration evidence are open."),
  observe("runtime", {
    ...observationReasons("runtime", checkRuntime),
    "runtime-mismatch": reason("The runtime commitments differ from the seeded Flue profile.", checkRuntime),
  }, Object.keys(runtimeTypes), (value, policy) => {
    const code = compareFields(value, policy.runtime, runtimeTypes);
    return code === "fingerprint-mismatch" ? "runtime-mismatch" : code;
  }),
  service("validator"),
  service("prover"),
  service("indexer"),
  observe("recovery", {
    ...observationReasons("recovery", checkRecovery),
    "recovery-incomplete": reason("Room recovery is incomplete.", action("finish-room-recovery", "Finish room recovery")),
    "recovery-unresolved": reason("The submission outcome is unknown.", action("reconcile-submission", "Reconcile the unknown submission")),
  }, null, (value) => {
    if (!recoveryStates.includes(value)) return "malformed";
    if (value === "incomplete") return "recovery-incomplete";
    if (value === "unknown-submission") return "recovery-unresolved";
  }),
];

const observationChecks = registry.filter((entry) => Object.hasOwn(entry, "observationValueKeys"));
const observationNames = observationChecks.map((entry) => entry.check);
const qualificationKeys = ["historicalJourney", "gates"];
const referenceKeys = ["kind", "scopeSha256", "reviewedEvidenceSha256"];

function isReference(value) {
  return hasExactKeys(value, referenceKeys) && value.kind === "maintainer-reference"
    && isSha256(value.scopeSha256) && isSha256(value.reviewedEvidenceSha256);
}

function validQualification(value) {
  if (value === undefined) return true;
  if (!hasOnlyKeys(value, qualificationKeys)) return false;
  if (Object.hasOwn(value, "historicalJourney") && !isReference(value.historicalJourney)) return false;
  if (!Object.hasOwn(value, "gates")) return true;
  return hasOnlyKeys(value.gates, gateNames) && Object.values(value.gates).every(isReference);
}

function containsOnlyAllowedFields(value, keys) {
  return !isRecord(value) || hasOnlyKeys(value, keys);
}

const requiredInputKeys = ["schema", "nowMs", "selection", "observations"];
const inputKeys = [...requiredInputKeys, "qualification"];

function validInput(input, policy) {
  if (!hasOnlyKeys(input, inputKeys) || !requiredInputKeys.every((key) => Object.hasOwn(input, key))
    || input.schema !== INPUT_SCHEMA || !isTimestamp(input.nowMs)
    || !containsOnlyAllowedFields(input.selection, Object.keys(policy.selection))
    || !hasOnlyKeys(input.observations, observationNames) || !validQualification(input.qualification)) return false;

  return observationChecks.every(({ check, observationValueKeys }) => {
    const observation = input.observations[check];
    return containsOnlyAllowedFields(observation, observationKeys)
      && (observationValueKeys === null || containsOnlyAllowedFields(observation?.value, observationValueKeys));
  });
}

const capabilities = Object.freeze({
  purpose: "display-only",
  activationAuthorized: false,
  productionAvailable: false,
});

function present(blockers, policy) {
  const synthetic = policy.namespace !== "public";
  const firstAction = blockers.length === 0 ? readyAction : blockers[0].primaryAction;
  return {
    kind: synthetic ? "synthetic" : "host-observation",
    ...(synthetic ? { synthetic: true, qualifying: false } : {}),
    ...capabilities,
    status: blockers.length === 0 ? "ready" : "blocked",
    primaryAction: { ...firstAction },
    reasons: blockers.map(({ check, code, message }) => ({ check, code, message })),
    disclosures: Object.keys(disclosures),
  };
}

export function evaluateForPolicy(input, policy) {
  if (!validInput(input, policy)) return present([invalidInput], policy);
  const blockers = [];
  for (const { check, reasons, evaluate } of registry) {
    const code = evaluate({ input, policy });
    if (code === undefined) continue;
    blockers.push({ check, code, ...reasons[code] });
    if (check === "selection") break;
  }
  return present(blockers, policy);
}

export const evidenceStages = Object.freeze([
  "independent-review",
  "proof-verification",
  "validator-execution",
  "native-activation",
  "profile-selection",
  "native-journey",
  "chain-and-recovered-revision",
  "ui-readiness-and-blockers",
]);

export const evidenceOutcomes = Object.freeze(["passed", "failed", "skipped"]);

const evidenceKeys = Object.freeze([
  "schema", "kind", "profileScopeSha256", "nativeSource", "artifactFingerprintSha256", "toolchainSha256", "evidence",
]);
const evidenceEntryKeys = Object.freeze(["outcome", "reviewedExtractSha256"]);
export const evidenceShape = Object.freeze({ keys: evidenceKeys, entryKeys: evidenceEntryKeys });

export function buildDescriptor() {
  return {
    schema: "cr05-readiness-contract.v1",
    inputSchema: INPUT_SCHEMA,
    capabilities,
    profileScopeSchema: SCOPE_SCHEMA,
    profile: publicPolicy,
    qualificationReferences: { gateNames, keys: referenceKeys, kind: "maintainer-reference", role: "context-only" },
    statusContext: { daybreak },
    inputs: {
      required: requiredInputKeys,
      observationNames,
      observationKeys,
      observationValues: Object.fromEntries(observationChecks.map(({ check, observationValueKeys }) => [
        check, observationValueKeys ?? recoveryStates,
      ])),
      serviceStates,
    },
    invalidInput,
    readyAction,
    checks: registry.map(({ check, reasons }) => ({ check, reasons })),
    disclosures,
    returnEnvelope: { schema: EVIDENCE_SCHEMA, stages: evidenceStages, outcomes: evidenceOutcomes, ...evidenceShape },
  };
}
