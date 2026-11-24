#!/usr/bin/env python3
"""Verify terminal raw evidence and stage durable partial/full Go packets."""
import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import shutil

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
PREFIX = "github.com/helius-labs/zolana-custom-rings/prover/"
EXPECTED_CATALOG = "4ad6ce9bf91a5446c0876b25c937b522a75473355e87bba81e776eaeaa13f3bc"
HEAVY = {"ring", "ringtest", "circuits/transfer"}
SKIPS = {
    "ring": {"TestExportAeglosRingFixtures", "TestWriteGoldenRequests", "TestWriteRequestFixtures", "TestWriteConstraintPins", "TestRingRpcEscrowFixture", "TestStorageFixtures"},
    "circuits/registry": {"TestSharedQuadProofMillionMembers"},
}

def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def write(path, data):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(data, indent=2) + "\n")

def catalog():
    raw = (HERE / "package-catalog.txt").read_bytes()
    assert hashlib.sha256(raw).hexdigest() == EXPECTED_CATALOG, "Independent catalog bytes changed"
    names = raw.decode().splitlines()
    assert len(names) == len(set(names)) == 18, "Required package catalog must contain all 18 packages"
    receipt = json.loads((HERE / "package-catalog.json").read_text())
    assert receipt["packages"] == names and receipt["exitCode"] == 0
    assert receipt["command"] == [str(ROOT / "toolchains/go1.27.3/go/bin/go"), "list", "./..."]
    assert receipt["sourceBefore"] == receipt["sourceAfter"]
    assert receipt["sourceBefore"]["customRings"] == "02bca33729051798834ecbb4d94e968cdc0ef9b8"
    assert receipt["sourceBefore"]["zolana"] == "0fe4f952182b39464d472c52c40b3febe6cbd9ec"
    assert receipt["sourceBefore"]["clean"] is True
    return names, receipt

def verify(receipt, required, source):
    package = receipt["package"]
    assert package in required and package.startswith(PREFIX), "Unknown package"
    suffix = package[len(PREFIX):]
    timeout = "180m" if suffix in HEAVY else "60m"
    command = [str(ROOT / "toolchains/go1.27.3/go/bin/go"), "test", "-json", "-p", "1", "-parallel", "1", "-timeout", timeout, package, "-count=1"]
    assert receipt["command"] == command, "Filtered or altered command cannot qualify"
    assert receipt["cwd"] == str(ROOT / "custom-rings-base/prover")
    assert receipt["toolchain"] == "go version go1.27.3 linux/amd64"
    assert receipt["sourceBefore"] == receipt["sourceAfter"] == source, "Source binding changed"
    assert receipt["exitCode"] == 0 and receipt["finishedAt"] and receipt["status"] in ("passed", "no-tests"), "No successful terminal exit"
    assert receipt["catalogSha256"] == EXPECTED_CATALOG
    runner_snapshots = [HERE / "run_packages.py", HERE / "run_packages_initial.py"]
    assert receipt["runnerSha256"] in {digest(p) for p in runner_snapshots if p.exists()}, "Recorded runner snapshot is unavailable"
    required_unset = {"WRITE_RING_GOLDENS", "REQUEST_FIXTURES", "RING_RPC_ESCROW_MEMBER", "STORAGE_REGISTRY", "UPDATE_RING_GOLDENS", "WRITE_RING_PINS", "WRITE_RING_PROOF_VECTORS", "WRITE_AUDIT_VECTORS", "AEGLOS_FIXTURES", "RING_MILLION_RECORDS"}
    assert set(receipt["unsetOptIns"]) == required_unset, "Fixture/service opt-ins changed"
    for k, value in {"GOENV": "off", "GOWORK": "off", "GOFLAGS": "", "GOTOOLCHAIN": "local", "GOMAXPROCS": "1", "GOMEMLIMIT": "1GiB", "GOGC": "25", "REQUIRE_RING_KEYS": "1"}.items():
        assert receipt["environment"][k] == value, f"Unexpected environment: {k}"
    if suffix in HEAVY:
        assert receipt["timeoutBasis"]["logSha256"] == "eba591fb26ef6a9ef772f93c6195346dd928897d1e0c3f0f9ae993a599f4c234"
        assert receipt["timeoutBasis"]["ceiling"] == "180m" and receipt["timeoutBasis"]["testSelectionChanged"] is False
    assert receipt["resources"]["affinityViolation"] is False
    assert receipt["resources"]["observedAffinitySets"] == [receipt["executionProfile"]["childAllowedCpus"]]
    assert len(receipt["executionProfile"]["childAllowedCpus"]) == 2
    for key in ("log", "stderr"):
        path = Path(receipt[key]["path"])
        assert digest(path) == receipt[key]["sha256"] and path.stat().st_size == receipt[key]["bytes"], "Complete output identity mismatch"
    events = [json.loads(line) for line in Path(receipt["log"]["path"]).read_text().splitlines() if line]
    assert events and all(e.get("Package") in (None, package) for e in events), "Unexpected package output"
    assert not any(e.get("Action") == "fail" for e in events), "Failure events cannot be relabeled as a pass"
    terminals = [e for e in events if e.get("Action") in ("pass", "fail", "skip") and not e.get("Test")]
    assert len(terminals) == 1 and events[-1] == terminals[0], "Missing or ambiguous final package event"
    no_tests = any("[no test files]" in e.get("Output", "") for e in events)
    assert terminals[0]["Action"] == ("skip" if no_tests else "pass")
    assert receipt["status"] == ("no-tests" if no_tests else "passed")
    passes = [e["Test"] for e in events if e.get("Test") and e.get("Action") == "pass"]
    skips = [e["Test"] for e in events if e.get("Test") and e.get("Action") == "skip"]
    assert set(skips) == SKIPS.get(suffix, set()), "Unexpected skip inventory"
    started = {e["Test"] for e in events if e.get("Test") and e.get("Action") == "run"}
    ended = set(passes + skips)
    assert started == ended, "Missing executed or terminal test events"
    assert bool(passes) != no_tests, "No executed tests and no explicit no-test-files result"
    assert receipt["parsed"]["tests"] == {"pass": len(passes), "fail": 0, "skip": len(skips)}
    assert receipt["parsed"]["qualifies"] is True
    return {"package": package, "status": receipt["status"], "exitCode": 0, "durationSeconds": receipt["durationSeconds"], "passEvents": len(passes), "topLevelPasses": sum("/" not in name for name in passes), "skipEvents": len(skips), "skippedTests": sorted(skips), "logSha256": receipt["log"]["sha256"], "logBytes": receipt["log"]["bytes"], "sampledConcurrentRssPeakKiB": receipt["resources"]["sampledConcurrentRssPeakKiB"]}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--require-complete", action="store_true")
    parser.add_argument("--stage", action="store_true")
    args = parser.parse_args()
    required, cat = catalog()
    verified = {}
    files = []
    incomplete = []
    for path in sorted((HERE / "packages").glob("*.json")):
        receipt = json.loads(path.read_text())
        if receipt["status"] not in ("passed", "no-tests"):
            incomplete.append({"package": receipt["package"], "status": receipt["status"], "receipt": path.name})
            continue
        record = verify(receipt, required, cat["sourceBefore"])
        assert record["package"] not in verified, "Duplicate success must be resolved explicitly"
        record["receipt"] = "packages/" + path.name
        record["receiptSha256"] = digest(path)
        verified[record["package"]] = record
        files.append((path, Path("packages") / path.name))
        for key in ("log", "stderr"):
            f = Path(receipt[key]["path"])
            files.append((f, Path("packages") / f.name))
    missing = [p for p in required if p not in verified]
    if args.require_complete:
        assert not missing, f"Complete gate still missing {len(missing)} packages"
    summary = {"schema": "cr01-durable-go-requalification-v1", "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "status": "passed" if not missing else "incomplete", "executionMode": "18-separate-unfiltered-package-commands", "requiredPackageCount": len(required), "verifiedTerminalPackageCount": len(verified), "passedTestPackageCount": sum(r["status"] == "passed" for r in verified.values()), "explicitNoTestFilesPackageCount": sum(r["status"] == "no-tests" for r in verified.values()), "source": cat["sourceBefore"], "catalogSha256": EXPECTED_CATALOG, "packages": [verified[p] for p in required if p in verified], "missingPackages": missing, "incompleteAttempts": incomplete, "historicalMetadataCountedAsNewExecution": False, "wholeSuiteSingleCommandExitClaimed": False, "verifierSha256": digest(__file__), "scope": "Fresh terminal raw evidence at unchanged source after loss of unpublished local logs. Native/application evidence remains in its original public packets; broad CR04 and independent review gates are separate."}
    write(HERE / "summary.json", summary)
    if args.stage:
        stage = HERE / "stage"
        stage.mkdir(exist_ok=True)
        fixed = [(HERE / "package-catalog.txt", Path("package-catalog.txt")), (HERE / "package-catalog.json", Path("package-catalog.json")), (HERE / "summary.json", Path("summary.json")), (HERE / "run_packages.py", Path("run_packages.py")), (Path(__file__), Path("verify_and_stage.py")), (HERE / "guard-receipt.json", Path("guard-receipt.json")), (HERE / "daybreak-status.json", Path("daybreak-status.json")), (ROOT / "context/restore-go-environment/environment-recovery.json", Path("environment-recovery.json")), (ROOT / "context/restore-go-keys/restoration-receipt.json", Path("keys-recovery.json"))]
        for optional in ("run_packages_initial.py", "default-skips.json", "verification-guards.json"):
            if (HERE / optional).exists():
                fixed.append((HERE / optional, Path(optional)))
        for report in sorted((HERE / "inspection").glob("*.json")):
            fixed.append((report, Path("inspection") / report.name))
        for src, dest in files + fixed:
            target = stage / dest
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, target)
        lines = ["# Fresh Go qualification", "", f"**{len(verified)}/18 whole packages have verified terminal evidence. Status: {summary['status']}.**", "", "This packet records fresh unfiltered package commands after unpublished working files became unavailable. Historical success summaries do not replace a new raw log or exit receipt. Every completed package has exact argv, clean source pins, complete log hashes and terminal event checks. The complete gate remains open until all 18 actual catalog entries qualify.", "", "| Package | Result | Pass events | Default test skips | Duration (s) |", "| --- | --- | ---: | ---: | ---: |"]
        for p in required:
            r = verified.get(p)
            lines.append(f"| `{p[len(PREFIX):]}` | {r['status'] if r else 'pending'} | {r['passEvents'] if r else '—'} | {r['skipEvents'] if r else '—'} | {r['durationSeconds'] if r else '—'} |")
        lines += ["", "Pass-event counts include top-level tests and subtests; the JSON summary separately records top-level passes. Explicit no-test-file packages are coverage entries, not executed tests. Canonical fixture/service/population opt-ins remain unset, and their named skips are retained.", "", "Heavy packages use the already documented 180-minute ceiling, based on the preserved actual one-hour timeout. It is not a runtime estimate. The process sees two already-allowed CPUs with GOMAXPROCS=1, GOMEMLIMIT=1GiB and GOGC=25. RSS values are sampled concurrent process-tree observations, not hard memory caps or production performance claims.", "", "This packet establishes no latest independent application review, broader CR04 acceptance, native UI activation, merge or deployment. Earlier failed/interrupted attempts remain in the historical checkpoint. The application overlay and live result are unchanged.", ""]
        (stage / "README.md").write_text("\n".join(lines))
        entries = []
        for f in sorted(stage.rglob("*")):
            if f.is_file() and f.name != "manifest.json":
                raw = f.read_bytes()
                entries.append({"path": str(f.relative_to(stage)), "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(), "gitBlobSha1": hashlib.sha1(f"blob {len(raw)}\0".encode() + raw).hexdigest()})
        write(stage / "manifest.json", {"schema": "cr01-go-requalification-manifest-v1", "generatedAt": summary["generatedAt"], "qualificationStatus": summary["status"], "verifiedTerminalPackageCount": len(verified), "requiredPackageCount": 18, "summarySha256": digest(stage / "summary.json"), "files": entries})
    print(json.dumps({"status": summary["status"], "verifiedTerminalPackageCount": len(verified), "requiredPackageCount": 18, "missingPackages": missing, "staged": args.stage}))

if __name__ == "__main__":
    main()
