import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { evaluateReadiness, prepareEvidenceEnvelope } from "@spawn-backrooms/cr05-native-preview";
import descriptor from "@spawn-backrooms/cr05-native-preview/descriptor.json" with { type: "json" };
import { buildDescriptor } from "./contract.mjs";
import { fixturePack } from "./fixtures/cases.mjs";
import { healthyInput, optimisticReferences, scenarios } from "./fixtures/inputs.mjs";
import { runFixtures } from "./fixtures/run.mjs";

const profile = descriptor.profile;
const action = (code, label) => ({ code, label });
const hostInvariants = {
  kind: "host-observation",
  purpose: "display-only",
  activationAuthorized: false,
  productionAvailable: false,
};
const openChecks = [
  "cr02-independent-acceptance", "cr03-dependency", "cr04-independent-acceptance", "native-integration",
];
const openReasons = openChecks.map((check) => [check, "qualification-open"]);
const codes = (result) => result.reasons.map(({ check, code }) => [check, code]);
const badInput = evaluateReadiness(null);

function assertHostBlocked(result, reasons) {
  assert.equal(result.status, "blocked");
  for (const [field, value] of Object.entries(hostInvariants)) assert.equal(result[field], value);
  assert.deepEqual(result.disclosures, Object.keys(descriptor.disclosures));
  assert.deepEqual(codes(result), reasons);
}

test("the published descriptor matches the evaluator and specifies every check in order", () => {
  const file = new URL("./descriptor.json", import.meta.url);
  assert.equal(readFileSync(file, "utf8"), `${JSON.stringify(buildDescriptor(), null, 2)}\n`);
  assert.deepEqual(descriptor.checks.map(({ check }) => check), [
    "selection", "artifacts", "upstream-go", ...openChecks, "runtime", "validator", "prover", "indexer", "recovery",
  ]);
  const scope = [
    "cr05-profile-scope.v1", "public", Object.entries(profile.selection),
    Object.entries(profile.artifacts), Object.entries(profile.runtime), null,
  ];
  assert.equal(profile.scopeSha256, createHash("sha256").update(JSON.stringify(scope), "utf8").digest("hex"));
  assert.equal(profile.maxAgeMs, 60_000);
  assert.equal(profile.nativeBuild, null);
  assert.deepEqual(profile.gates["upstream-go"], {
    status: "recorded",
    source: "25439b26fcbaa1d938ea2be4c23b7ced132037ec",
    rawReceipts: 18,
    expectedReceipts: 18,
  });
  assert.deepEqual(descriptor.statusContext.daybreak, { status: "outstanding", runtimePrerequisite: false });
});

test("only readiness and the envelope validator form the host API", async () => {
  const api = await import("@spawn-backrooms/cr05-native-preview");
  assert.deepEqual(Object.keys(api), ["evaluateReadiness", "prepareEvidenceEnvelope"]);
  await assert.rejects(import("@spawn-backrooms/cr05-native-preview/fixtures/run.mjs"), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
  await assert.rejects(import("@spawn-backrooms/cr05-native-preview/contract.mjs"), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
});

test("healthy public observations, historical passes and optimistic references leave current gates open", () => {
  const input = healthyInput(profile);
  const currentResult = evaluateReadiness(input);
  assertHostBlocked(currentResult, openReasons);
  assert.deepEqual(currentResult.primaryAction, action("obtain-cr02-acceptance", "Obtain independent CR02 acceptance"));
  input.qualification = optimisticReferences(profile.scopeSha256);
  input.observations.artifacts.value.nativeSource = "a".repeat(40);
  input.observations.artifacts.value.toolchainSha256 = "b".repeat(64);
  assert.deepEqual(evaluateReadiness(input), currentResult);
});

test("current gates remain in order alongside independently applicable blockers", () => {
  const input = healthyInput(profile);
  input.observations.artifacts.value.programSha256 = "a".repeat(64);
  input.observations.runtime.value.membershipCommitment = "a".repeat(64);
  delete input.observations.validator;
  input.observations.prover.value.status = "unreachable";
  input.observations.indexer.observedAtMs = input.nowMs + 1;
  input.observations.recovery.value = "unknown-submission";
  const result = evaluateReadiness(input);
  assertHostBlocked(result, [
    ["artifacts", "fingerprint-mismatch"], ...openReasons, ["runtime", "runtime-mismatch"],
    ["validator", "missing"], ["prover", "unreachable"], ["indexer", "malformed"], ["recovery", "recovery-unresolved"],
  ]);
  assert.deepEqual(result.primaryAction, action("check-artifacts", "Check the local preview artifacts"));
});

test("an observation exactly 60 seconds old is fresh, and older observations are stale", () => {
  const input = healthyInput(profile);
  for (const observed of Object.values(input.observations)) observed.observedAtMs = input.nowMs - 60_000;
  assertHostBlocked(evaluateReadiness(input), openReasons);
  input.observations.validator.observedAtMs -= 1;
  assertHostBlocked(evaluateReadiness(input), [...openReasons, ["validator", "stale"]]);
});

test("service addresses use explicit HTTP or HTTPS loopback authority", () => {
  const input = healthyInput(profile);
  for (const endpoint of ["http://localhost", "HTTP://LOCALHOST:8899/", "https://127.0.0.1/a", "https://[::1]:3000/a"]) {
    input.observations.validator.value.endpoint = endpoint;
    assertHostBlocked(evaluateReadiness(input), openReasons);
  }
  for (const endpoint of [
    "http://localhost.example.invalid",
    "http://localhost@127.0.0.1",
    "https://@localhost/",
    "http://127.0.0.2:8899",
    "http://127.1",
    "http://2130706433",
    "http://0x7f000001",
    "http://%6cocalhost",
    "http://localhost.",
    "http://[0:0:0:0:0:0:0:1]",
    "http://localhost/?",
    "http://localhost/#",
    "http://localhost/secret?value=1",
    "http://localhost/secret#value",
    "http://localhost/path\\file",
    " http://localhost/",
    "ftp://localhost/",
  ]) {
    input.observations.validator.value.endpoint = endpoint;
    const result = evaluateReadiness(input);
    assertHostBlocked(result, [...openReasons, ["validator", "non-loopback-service"]]);
    assert.equal(JSON.stringify(result).includes(endpoint), false);
  }
  for (const endpoint of ["//localhost:8899", "http://localhost:65536", "localhost only", null]) {
    input.observations.validator.value.endpoint = endpoint;
    assertHostBlocked(evaluateReadiness(input), [...openReasons, ["validator", "malformed"]]);
  }
});

test("malformed inputs refuse with fixed display output and cannot expose private fields", () => {
  const mutations = [
    (input) => { input.policy = { status: "recorded" }; },
    (input) => { input.maxAgeMs = 1_000_000; },
    (input) => { input.activationAuthorized = true; },
    (input) => { input.schema = "cr05-readiness-input.v2"; },
    (input) => { input.nowMs = -1; },
    (input) => { input.nowMs = 1.5; },
    (input) => { input.observations = null; },
    (input) => { input.qualification = { gates: { "native-integration": true } }; },
    (input) => { input.qualification = { gates: { daybreak: true } }; },
    (input) => { input.qualification = { historicalJourney: { passed: true } }; },
    (input) => { input.selection.fallback = "SYNTHETIC_PRIVATE"; },
    (input) => { input.observations.artifacts.value.rawKey = "SYNTHETIC_PRIVATE"; },
    (input) => { input.observations.runtime.value.residentId = "SYNTHETIC_PRIVATE"; },
    (input) => { input.observations.validator.value.credential = "SYNTHETIC_PRIVATE"; },
    (input) => { input.observations.recovery.roomIdSha256 = "e".repeat(64); },
    (input) => { input.observations.recovery.operationId = "SYNTHETIC_PRIVATE"; },
  ];
  for (const mutate of mutations) {
    const input = healthyInput(profile);
    mutate(input);
    assert.deepEqual(evaluateReadiness(input), badInput);
  }
  for (const value of [false, 0, "", [], {}, { __proto__: null }, JSON.parse('{"__proto__":{"status":"ready"}}')]) {
    assert.deepEqual(evaluateReadiness(value), badInput);
  }
  assertHostBlocked(badInput, [["input", "malformed-input"]]);
  assert.equal(JSON.stringify(badInput).includes("SYNTHETIC_PRIVATE"), false);
});

test("the validity of synthetic inputs gives the public evaluator no qualification", () => {
  assert.deepEqual(evaluateReadiness(fixturePack), badInput);
  assert.deepEqual(evaluateReadiness(fixturePack.cases[0]), badInput);
  const result = evaluateReadiness(healthyInput(scenarios.qualified));
  assertHostBlocked(result, [
    ["artifacts", "scope-mismatch"], ...openReasons, ["runtime", "scope-mismatch"],
    ["validator", "scope-mismatch"], ["prover", "scope-mismatch"], ["indexer", "scope-mismatch"], ["recovery", "scope-mismatch"],
  ]);
});

test("the evaluator accepts neither missing fingerprint fields nor malformed scope and clock values", () => {
  const input = healthyInput(profile);
  delete input.observations.artifacts.value.programId;
  delete input.observations.runtime.value.seedCommitment;
  input.observations.validator.scopeSha256 = "0".repeat(63) + "\n";
  input.observations.prover.scopeSha256 = "0".repeat(64);
  input.observations.indexer.observedAtMs = "1000000";
  input.observations.recovery.observedAtMs = Number.MAX_SAFE_INTEGER + 1;
  assertHostBlocked(evaluateReadiness(input), [
    ["artifacts", "missing"], ...openReasons, ["runtime", "missing"],
    ["validator", "malformed"], ["prover", "scope-mismatch"], ["indexer", "malformed"], ["recovery", "malformed"],
  ]);
});

test("modifying a returned object leaves later results and the input intact", () => {
  const input = healthyInput(profile);
  const savedInput = structuredClone(input);
  const expected = evaluateReadiness(input);
  const returned = evaluateReadiness(input);
  returned.status = "ready";
  returned.primaryAction.code = "modified";
  returned.reasons[0].code = "modified";
  returned.disclosures.push("modified");
  assert.deepEqual(evaluateReadiness(input), expected);
  assert.deepEqual(input, savedInput);
  const savedPack = structuredClone(fixturePack);
  runFixtures(fixturePack).cases[0].result.primaryAction.code = "modified";
  assert.equal(runFixtures(fixturePack).cases[0].result.primaryAction.code, "view-local-preview");
  assert.deepEqual(fixturePack, savedPack);
});

function returnEnvelope() {
  return {
    schema: "cr05-maintainer-evidence.v1",
    kind: "maintainer-reference",
    profileScopeSha256: profile.scopeSha256,
    nativeSource: "1".repeat(40),
    artifactFingerprintSha256: "2".repeat(64),
    toolchainSha256: "3".repeat(64),
    evidence: Object.fromEntries([
      ["independent-review", "passed"],
      ["proof-verification", "passed"],
      ["validator-execution", "failed"],
      ["native-activation", "skipped"],
      ["profile-selection", "passed"],
      ["native-journey", "failed"],
      ["chain-and-recovered-revision", "skipped"],
      ["ui-readiness-and-blockers", "passed"],
    ].map(([stage, outcome], index) => [stage, { outcome, reviewedExtractSha256: String(index).repeat(64) }])),
  };
}

test("the return envelope accepts separate digest-only stage outcomes and keeps qualification open", () => {
  const input = returnEnvelope();
  const result = prepareEvidenceEnvelope(input);
  assert.deepEqual(result, { status: "valid", envelope: input });
  result.envelope.evidence["independent-review"].outcome = "failed";
  assert.equal(input.evidence["independent-review"].outcome, "passed");
  const partial = { ...input, evidence: { "independent-review": input.evidence["independent-review"] } };
  assert.deepEqual(prepareEvidenceEnvelope(partial), { status: "valid", envelope: partial });
  assertHostBlocked(evaluateReadiness(healthyInput(profile)), openReasons);
});

test("the return envelope refuses empty, unscoped, unknown, private, and raw fields", () => {
  const refusal = { status: "invalid", code: "malformed-evidence-envelope" };
  for (const invalid of [null, {}, [], { kind: "synthetic" }]) {
    assert.deepEqual(prepareEvidenceEnvelope(invalid), refusal);
  }
  for (const mutate of [
    (input) => { input.kind = "synthetic"; },
    (input) => { input.schema = "cr05-maintainer-evidence.v2"; },
    (input) => { delete input.nativeSource; },
    (input) => { input.profileScopeSha256 = "c".repeat(65); },
    (input) => { input.nativeSource = "F".repeat(40); },
    (input) => { input.artifactFingerprintSha256 = "2".repeat(63) + "\n"; },
    (input) => { input.original = "SYNTHETIC_PRIVATE"; },
    (input) => { input.nonceSha256 = "a".repeat(64); },
    (input) => { input.evidence = {}; },
    (input) => { input.evidence.unscoped = { outcome: "passed", reviewedExtractSha256: "a".repeat(64) }; },
    (input) => { input.evidence["native-journey"].outcome = true; },
    (input) => { input.evidence["native-journey"].reviewedExtractSha256 = "short"; },
    (input) => { input.evidence["native-journey"].raw = "SYNTHETIC_PRIVATE"; },
    (input) => { input.evidence["native-journey"].lessonSha256 = "c".repeat(64); },
    (input) => { input.evidence["native-journey"] = null; },
  ]) {
    const input = returnEnvelope();
    mutate(input);
    assert.deepEqual(prepareEvidenceEnvelope(input), refusal);
  }
});

test("the built-in pack has a ready case, open gates and exact non-qualifying expectations", () => {
  const report = runFixtures(fixturePack);
  assert.equal(report.status, "passed");
  assert.equal(report.failed, 0);
  assert.equal(report.passed, fixturePack.cases.length);
  assert.ok(report.passed > 40);
  assert.equal(report.cases[0].result.status, "ready");
  assert.deepEqual(codes(report.cases[1].result), openReasons);
  for (const row of [report, ...report.cases, ...report.cases.map(({ result }) => result)]) {
    assert.equal(row.synthetic, true);
    assert.equal(row.qualifying, false);
  }
});

const fixtureRunner = fileURLToPath(new URL("./fixtures/run.mjs", import.meta.url));
function runPackJson(json) {
  return spawnSync(process.execPath, [fixtureRunner, "-"], { input: json, encoding: "utf8" });
}

test("the direct runner evaluates a valid JSON pack from stdin", () => {
  const pack = { ...fixturePack, cases: fixturePack.cases.slice(0, 2) };
  const run = runPackJson(JSON.stringify(pack));
  assert.equal(run.error, undefined);
  assert.equal(run.status, 0);
  assert.equal(run.stderr, "");
  const report = JSON.parse(run.stdout);
  assert.equal(report.passed, 2);
  assert.equal(report.failed, 0);
});

test("the direct runner exits nonzero for an empty or malformed fixture pack", () => {
  const pack = { ...fixturePack, cases: [] };
  const noExpectation = structuredClone(fixturePack);
  delete noExpectation.cases[0].expected;
  const noInput = structuredClone(fixturePack);
  delete noInput.cases[0].input;
  const override = { ...fixturePack, policy: { activationAuthorized: true } };
  for (const json of ["not JSON", ...[pack, noExpectation, noInput, override].map((value) => JSON.stringify(value))]) {
    const run = runPackJson(json);
    assert.equal(run.error, undefined);
    assert.equal(run.status, 1);
    assert.equal(run.stderr, "");
    assert.equal(JSON.parse(run.stdout).code, "malformed-fixture-pack");
  }
});

test("the direct runner exits nonzero when an expected action, reason order, or disclosure differs", () => {
  for (const mutate of [
    (pack) => { pack.cases[0].expected.primaryAction.code = "fake-action"; },
    (pack) => { pack.cases[1].expected.reasons.reverse(); },
    (pack) => { pack.cases[0].expected.disclosures.pop(); },
  ]) {
    const pack = { ...fixturePack, cases: structuredClone(fixturePack.cases.slice(0, 2)) };
    mutate(pack);
    const run = runPackJson(JSON.stringify(pack));
    assert.equal(run.error, undefined);
    assert.equal(run.status, 1);
    assert.equal(run.stderr, "");
    const report = JSON.parse(run.stdout);
    assert.equal(report.status, "failed");
    assert.equal(report.passed, 1);
    assert.equal(report.failed, 1);
  }
});
