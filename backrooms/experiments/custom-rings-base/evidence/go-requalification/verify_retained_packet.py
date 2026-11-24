#!/usr/bin/env python3
"""Read-only verification of the published CR01 Go packet, on any checkout."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath

HERE = Path(__file__).resolve().parent
PREFIX = "github.com/helius-labs/zolana-custom-rings/prover/"
CATALOG = "4ad6ce9bf91a5446c0876b25c937b522a75473355e87bba81e776eaeaa13f3bc"
HEAVY = {"ring", "ringtest", "circuits/transfer"}
SKIPS = {"ring": {"TestExportAeglosRingFixtures", "TestWriteGoldenRequests", "TestWriteRequestFixtures", "TestWriteConstraintPins", "TestRingRpcEscrowFixture", "TestStorageFixtures"}, "circuits/registry": {"TestSharedQuadProofMillionMembers"}}
OPT_INS = {"WRITE_RING_GOLDENS", "REQUEST_FIXTURES", "RING_RPC_ESCROW_MEMBER", "STORAGE_REGISTRY", "UPDATE_RING_GOLDENS", "WRITE_RING_PINS", "WRITE_RING_PROOF_VECTORS", "WRITE_AUDIT_VECTORS", "AEGLOS_FIXTURES", "RING_MILLION_RECORDS"}
ENV = {"GOENV": "off", "GOWORK": "off", "GOFLAGS": "", "GOTOOLCHAIN": "local", "GOMAXPROCS": "1", "GOMEMLIMIT": "1GiB", "GOGC": "25", "REQUIRE_RING_KEYS": "1"}


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def historical_root(catalog):
    executable = PurePosixPath(catalog["command"][0])
    assert executable.is_absolute() and ".." not in executable.parts, "Invalid recorded executable"
    root = executable.parents[4]
    assert catalog["command"] == [str(root / "toolchains/go1.27.3/go/bin/go"), "list", "./..."]
    assert catalog["cwd"] == str(root / "custom-rings-base/prover")
    return root


def packet_bytes(packet, relative):
    rel = PurePosixPath(relative)
    assert not rel.is_absolute() and ".." not in rel.parts and str(rel) == relative, "Invalid packet path"
    path = packet / rel
    assert path.resolve() == path and path.is_file(), "Missing or redirected packet file"
    return path.read_bytes()


def verify_packet(packet):
    if not __debug__:
        raise RuntimeError("Do not run this verifier with Python optimization")
    packet = Path(packet).resolve()
    manifest = json.loads(packet_bytes(packet, "manifest.json"))
    assert manifest["schema"] == "cr01-go-requalification-manifest-v1"
    files = {}
    for entry in manifest["files"]:
        name = entry["path"]
        assert name not in files, "Duplicate manifest entry"
        raw = packet_bytes(packet, name)
        assert len(raw) == entry["bytes"] and digest(raw) == entry["sha256"], f"Manifest mismatch: {name}"
        assert hashlib.sha1(f"blob {len(raw)}\0".encode() + raw).hexdigest() == entry["gitBlobSha1"], f"Git blob mismatch: {name}"
        files[name] = raw
    summary = json.loads(files["summary.json"])
    assert digest(files["summary.json"]) == manifest["summarySha256"]
    assert digest(files["verify_and_stage.py"]) == summary["verifierSha256"]
    assert digest(files["package-catalog.txt"]) == CATALOG
    required = files["package-catalog.txt"].decode().splitlines()
    assert len(required) == len(set(required)) == 18
    cat = json.loads(files["package-catalog.json"])
    root = historical_root(cat)
    assert cat["packages"] == required and cat["exitCode"] == 0
    source = cat["sourceBefore"]
    assert source == cat["sourceAfter"] == summary["source"]
    assert source["customRings"] == "02bca33729051798834ecbb4d94e968cdc0ef9b8"
    assert source["zolana"] == "0fe4f952182b39464d472c52c40b3febe6cbd9ec" and source["clean"] is True
    runners = {digest(files[p]) for p in ("run_packages.py", "run_packages_initial.py") if p in files}
    records = {}
    for name, raw in files.items():
        if not name.startswith("packages/") or not name.endswith(".json"):
            continue
        r = json.loads(raw)
        package = r["package"]
        assert package in required and package.startswith(PREFIX) and package not in records
        suffix = package[len(PREFIX):]
        timeout = "180m" if suffix in HEAVY else "60m"
        assert r["command"] == [str(root / "toolchains/go1.27.3/go/bin/go"), "test", "-json", "-p", "1", "-parallel", "1", "-timeout", timeout, package, "-count=1"]
        assert r["cwd"] == str(root / "custom-rings-base/prover") and r["toolchain"] == "go version go1.27.3 linux/amd64"
        assert r["sourceBefore"] == r["sourceAfter"] == source
        assert r["exitCode"] == 0 and r["finishedAt"] and r["status"] in ("passed", "no-tests")
        assert r["catalogSha256"] == CATALOG and r["runnerSha256"] in runners
        assert set(r["unsetOptIns"]) == OPT_INS and all(r["environment"][k] == v for k, v in ENV.items())
        if suffix in HEAVY:
            assert r["timeoutBasis"]["logSha256"] == "eba591fb26ef6a9ef772f93c6195346dd928897d1e0c3f0f9ae993a599f4c234"
            assert r["timeoutBasis"]["ceiling"] == "180m" and r["timeoutBasis"]["testSelectionChanged"] is False
        assert r["resources"]["affinityViolation"] is False
        assert r["resources"]["observedAffinitySets"] == [r["executionProfile"]["childAllowedCpus"]]
        assert len(r["executionProfile"]["childAllowedCpus"]) == 2
        outputs = {}
        for key, ext in (("log", ".jsonl"), ("stderr", ".stderr.log")):
            basename = PurePosixPath(name).stem + ext
            assert r[key]["path"] == str(root / "context/go-recovery/packages" / basename), "Historical output binding changed"
            output = files["packages/" + basename]
            assert digest(output) == r[key]["sha256"] and len(output) == r[key]["bytes"]
            outputs[key] = output
        events = [json.loads(line) for line in outputs["log"].splitlines() if line]
        assert events and all(e.get("Package") in (None, package) for e in events)
        assert not any(e.get("Action") == "fail" for e in events)
        terminals = [e for e in events if e.get("Action") in ("pass", "fail", "skip") and not e.get("Test")]
        assert len(terminals) == 1 and events[-1] == terminals[0]
        no_tests = any("[no test files]" in e.get("Output", "") for e in events)
        assert terminals[0]["Action"] == ("skip" if no_tests else "pass")
        assert r["status"] == ("no-tests" if no_tests else "passed")
        passes = [e["Test"] for e in events if e.get("Test") and e.get("Action") == "pass"]
        skips = [e["Test"] for e in events if e.get("Test") and e.get("Action") == "skip"]
        assert set(skips) == SKIPS.get(suffix, set())
        assert {e["Test"] for e in events if e.get("Test") and e.get("Action") == "run"} == set(passes + skips)
        assert bool(passes) != no_tests
        assert r["parsed"]["tests"] == {"pass": len(passes), "fail": 0, "skip": len(skips)} and r["parsed"]["qualifies"] is True
        records[package] = {"package": package, "status": r["status"], "exitCode": 0, "durationSeconds": r["durationSeconds"], "passEvents": len(passes), "topLevelPasses": sum("/" not in n for n in passes), "skipEvents": len(skips), "skippedTests": sorted(skips), "logSha256": r["log"]["sha256"], "logBytes": r["log"]["bytes"], "sampledConcurrentRssPeakKiB": r["resources"]["sampledConcurrentRssPeakKiB"], "receipt": name, "receiptSha256": digest(raw)}
    assert set(records) == set(required), "Incomplete package coverage"
    assert summary["packages"] == [records[p] for p in required]
    passed = sum(r["status"] == "passed" for r in records.values())
    no_tests = len(records) - passed
    assert summary["status"] == manifest["qualificationStatus"] == "passed"
    assert summary["requiredPackageCount"] == summary["verifiedTerminalPackageCount"] == manifest["requiredPackageCount"] == manifest["verifiedTerminalPackageCount"] == 18
    assert summary["passedTestPackageCount"] == passed and summary["explicitNoTestFilesPackageCount"] == no_tests
    assert summary["missingPackages"] == summary["incompleteAttempts"] == []
    assert summary["catalogSha256"] == CATALOG and summary["wholeSuiteSingleCommandExitClaimed"] is False and summary["historicalMetadataCountedAsNewExecution"] is False
    return {"status": "passed", "verifiedTerminalPackageCount": len(records), "passedTestPackageCount": passed, "explicitNoTestFilesPackageCount": no_tests, "manifestFilesVerified": len(files), "newExecution": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--packet", type=Path, default=HERE)
    parser.add_argument("--require-complete", action="store_true", help="Compatibility flag; this verifier always requires the complete packet")
    args = parser.parse_args()
    print(json.dumps(verify_packet(args.packet), sort_keys=True))
