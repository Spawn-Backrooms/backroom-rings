import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { evaluateForPolicy, hasExactKeys } from "../contract.mjs";
import { fixturePack, fixtureSchema } from "./cases.mjs";
import { scenarios, synthetic } from "./inputs.mjs";

const syntheticKeys = Object.keys(synthetic);
const caseKeys = [...syntheticKeys, "name", "scenario", "input", "expected"];
const packKeys = [...syntheticKeys, "schema", "cases"];
const resultKeys = [
  ...syntheticKeys, "purpose", "activationAuthorized", "productionAvailable",
  "status", "primaryAction", "reasons", "disclosures",
];

function isSynthetic(value) {
  return Object.entries(synthetic).every(([key, expected]) => value[key] === expected);
}

function validExpectation(value) {
  return hasExactKeys(value, resultKeys) && isSynthetic(value) && value.purpose === "display-only"
    && value.activationAuthorized === false && value.productionAvailable === false
    && hasExactKeys(value.primaryAction, ["code", "label"])
    && typeof value.primaryAction.code === "string" && value.primaryAction.code.length > 0
    && typeof value.primaryAction.label === "string" && value.primaryAction.label.length > 0
    && Array.isArray(value.reasons)
    && value.status === (value.reasons.length === 0 ? "ready" : "blocked")
    && value.reasons.every((entry) => hasExactKeys(entry, ["check", "code"])
      && typeof entry.check === "string" && typeof entry.code === "string")
    && Array.isArray(value.disclosures) && value.disclosures.length > 0
    && value.disclosures.every((entry) => typeof entry === "string");
}

function validPack(pack) {
  return hasExactKeys(pack, packKeys) && isSynthetic(pack) && pack.schema === fixtureSchema
    && Array.isArray(pack.cases) && pack.cases.length > 0
    && pack.cases.every((entry) => hasExactKeys(entry, caseKeys) && isSynthetic(entry)
      && typeof entry.name === "string" && entry.name.length > 0 && !/[^a-z0-9-]/u.test(entry.name)
      && typeof entry.scenario === "string" && Object.hasOwn(scenarios, entry.scenario)
      && validExpectation(entry.expected))
    && new Set(pack.cases.map(({ name }) => name)).size === pack.cases.length;
}

const reportHeader = { ...synthetic, schema: "cr05-synthetic-readiness-report.v1" };

export function runFixtures(pack) {
  if (!validPack(pack)) return { ...reportHeader, status: "invalid", code: "malformed-fixture-pack" };

  const cases = pack.cases.map((entry, index) => {
    const result = evaluateForPolicy(entry.input, scenarios[entry.scenario]);
    const actual = { ...result, reasons: result.reasons.map(({ check, code }) => ({ check, code })) };
    return {
      ...synthetic,
      caseNumber: index + 1,
      status: isDeepStrictEqual(actual, entry.expected) ? "passed" : "failed",
      result,
    };
  });
  const passed = cases.filter((entry) => entry.status === "passed").length;
  const failed = cases.length - passed;
  return { ...reportHeader, status: failed === 0 ? "passed" : "failed", passed, failed, cases };
}

if (import.meta.main) {
  let pack;
  const args = process.argv.slice(2);
  try {
    if (args.length === 0) pack = fixturePack;
    if (args.length === 1) pack = JSON.parse(readFileSync(args[0] === "-" ? 0 : args[0], "utf8"));
  } catch {
    pack = undefined;
  }
  const report = runFixtures(pack);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.status === "passed" ? 0 : 1;
}
