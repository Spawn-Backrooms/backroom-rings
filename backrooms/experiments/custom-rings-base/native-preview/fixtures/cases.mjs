import { healthyInput, optimisticReferences, scenarios, synthetic } from "./inputs.mjs";

const disclosures = [
  "public-enrollment-and-genesis",
  "public-global-config-and-root-changes",
  "public-payer-and-timing",
  "designated-auditor-ring-access",
  "native-host-private-originals-and-learning-state",
  "operator-provider-and-network-anonymity-unqualified",
  "multiple-eligible-note-owners-required-for-journey",
  "insecure-keys-localnet-only",
];
const capabilities = { purpose: "display-only", activationAuthorized: false, productionAvailable: false };
const selectProfile = ["select-localnet-profile", "Select the anonymous localnet profile"];
const checkInput = ["check-preview-input", "Check the preview input"];
const checkArtifacts = ["check-artifacts", "Check the local preview artifacts"];
const checkRuntime = ["check-runtime-binding", "Check the seeded Flue binding"];
const obtainCr02 = ["obtain-cr02-acceptance", "Obtain independent CR02 acceptance"];
const qualificationReasons = [
  ["cr02-independent-acceptance", "qualification-open"],
  ["cr03-dependency", "qualification-open"],
  ["cr04-independent-acceptance", "qualification-open"],
  ["native-integration", "qualification-open"],
];

function expected([code, label], reasons) {
  return {
    ...synthetic,
    ...capabilities,
    status: reasons.length === 0 ? "ready" : "blocked",
    primaryAction: { code, label },
    reasons: reasons.map(([check, code]) => ({ check, code })),
    disclosures: [...disclosures],
  };
}

export const fixtureSchema = "cr05-synthetic-readiness-fixtures.v1";
const cases = [];
function add(name, mutate, action, reasons, scenario = "qualified") {
  const input = healthyInput(scenarios[scenario]);
  mutate(input);
  cases.push({ ...synthetic, name, scenario, input, expected: expected(action, reasons) });
}

add("ready", () => {}, ["view-local-preview", "View local preview"], []);
add("open-despite-historical-pass-and-references", (input) => {
  input.qualification = optimisticReferences(scenarios["current-gates"].scopeSha256);
}, obtainCr02, qualificationReasons, "current-gates");
add("open-and-local-blockers", (input) => {
  delete input.observations.artifacts;
  input.observations.runtime.value.seedCommitment = "0".repeat(64);
  input.observations.validator.value.status = "unreachable";
  delete input.observations.prover;
  input.observations.indexer.value.endpoint = "https://example.invalid";
  input.observations.recovery.value = "unknown-submission";
}, checkArtifacts, [
  ["artifacts", "missing"], ...qualificationReasons, ["runtime", "runtime-mismatch"],
  ["validator", "unreachable"], ["prover", "missing"], ["indexer", "non-loopback-service"],
  ["recovery", "recovery-unresolved"],
], "current-gates");

for (const [name, field, value] of [
  ["other-profile", "profile", "different-preview"],
  ["mainnet", "network", "mainnet"],
  ["other-artifact", "artifactVersion", "spawn-room.v2"],
  ["other-protocol", "protocolVersion", "backrooms.v1"],
  ["other-feature", "programFeature", "spawn-room-v2"],
  ["other-keyset", "testKeySet", "different-localnet-keys"],
  ["no-test-key-opt-in", "localnetTestKeys", false],
  ["other-runtime", "runtime", "unseeded-flue"],
  ["other-inference", "inference", "provider"],
  ["public-owner", "authority", "public-owner"],
  ["delegate", "authority", "delegate"],
  ["provider-spend", "providerSpend", true],
]) {
  add(name, (input) => {
    input.selection[field] = value;
  }, selectProfile, [["selection", field === "network" ? "unsupported-network" : "unsupported-profile"]]);
}

for (const field of [
  "customRingsSource", "zolanaSource", "backroomsReferenceHost", "overlaySha256", "programId",
  "programSha256", "genesisKeySha256", "advanceKeySha256", "nativeSource", "toolchainSha256",
]) {
  add(`mismatch-${field.toLowerCase()}`, (input) => {
    const value = input.observations.artifacts.value[field];
    input.observations.artifacts.value[field] = (field === "programId" ? "7" : "0").repeat(value.length);
  }, checkArtifacts, [["artifacts", "fingerprint-mismatch"]]);
}

for (const field of ["seedCommitment", "membershipCommitment"]) {
  add(`mismatch-${field.toLowerCase()}`, (input) => {
    input.observations.runtime.value[field] = "0".repeat(64);
  }, checkRuntime, [["runtime", "runtime-mismatch"]]);
}

for (const service of ["validator", "prover", "indexer"]) {
  const check = [`check-local-${service}`, `Check the local ${service} endpoint`];
  const start = [`start-local-${service}`, `Start the local ${service}`];
  add(`missing-${service}`, (input) => {
    delete input.observations[service];
  }, start, [[service, "missing"]]);
  add(`unreachable-${service}`, (input) => {
    input.observations[service].value.status = "unreachable";
  }, start, [[service, "unreachable"]]);
  add(`nonloopback-${service}`, (input) => {
    input.observations[service].value.endpoint = "http://example.invalid:8899";
  }, check, [[service, "non-loopback-service"]]);
}

add("incomplete-recovery", (input) => {
  input.observations.recovery.value = "incomplete";
}, ["finish-room-recovery", "Finish room recovery"], [["recovery", "recovery-incomplete"]]);
add("unknown-submission", (input) => {
  input.observations.recovery.value = "unknown-submission";
}, ["reconcile-submission", "Reconcile the unknown submission"], [["recovery", "recovery-unresolved"]]);
add("missing-nonservice-observations", (input) => {
  for (const key of ["artifacts", "runtime", "recovery"]) delete input.observations[key];
}, checkArtifacts, [["artifacts", "missing"], ["runtime", "missing"], ["recovery", "missing"]]);

const observationNames = ["artifacts", "runtime", "validator", "prover", "indexer", "recovery"];
add("stale-observations", (input) => {
  for (const key of observationNames) input.observations[key].observedAtMs = input.nowMs - 60_001;
}, checkArtifacts, observationNames.map((key) => [key, "stale"]));
add("future-observations", (input) => {
  for (const key of observationNames) input.observations[key].observedAtMs = input.nowMs + 1;
}, checkArtifacts, observationNames.map((key) => [key, "malformed"]));
add("invalid-observations", (input) => {
  input.observations.artifacts.value.programSha256 = "invalid";
  input.observations.runtime.value = null;
  input.observations.validator.value.endpoint = "not a URL";
  input.observations.prover.value.status = true;
  input.observations.indexer = [];
  input.observations.recovery.value = "unknown";
}, checkArtifacts, observationNames.map((key) => [key, "malformed"]));
add("different-observation-scopes", (input) => {
  for (const key of observationNames) input.observations[key].scopeSha256 = "0".repeat(64);
}, checkArtifacts, observationNames.map((key) => [key, "scope-mismatch"]));

for (const [name, mutate] of [
  ["unsupported-input-version", (input) => { input.schema = "cr05-readiness-input.v2"; }],
  ["private-operation-field", (input) => { input.observations.recovery.operationId = "synthetic-private-operation"; }],
  ["policy-override", (input) => { input.policy = { approved: true, maxAgeMs: 900_000 }; }],
  ["qualification-boolean", (input) => { input.qualification = { gates: { "native-integration": true } }; }],
]) {
  add(name, mutate, checkInput, [["input", "malformed-input"]]);
}

export const fixturePack = { ...synthetic, schema: fixtureSchema, cases };
