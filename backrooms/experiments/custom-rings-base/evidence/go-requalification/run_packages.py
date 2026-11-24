#!/usr/bin/env python3
"""Record unfiltered, pinned CR01 Go package executions after evidence loss.

Historical summaries are never imported as new passing receipts. A package can
be published while the complete 18-package gate remains incomplete.
"""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
REPO = ROOT / "custom-rings-base"
HERE = Path(__file__).resolve().parent
GO = ROOT / "toolchains/go1.27.3/go/bin/go"
PREFIX = "github.com/helius-labs/zolana-custom-rings/prover/"
PINS = {"customRings": "02bca33729051798834ecbb4d94e968cdc0ef9b8", "zolana": "0fe4f952182b39464d472c52c40b3febe6cbd9ec"}
CATALOG_SHA = "4ad6ce9bf91a5446c0876b25c937b522a75473355e87bba81e776eaeaa13f3bc"
HEAVY = {"ring", "ringtest", "circuits/transfer"}
RING_SKIPS = {"TestExportAeglosRingFixtures", "TestWriteGoldenRequests", "TestWriteRequestFixtures", "TestWriteConstraintPins", "TestRingRpcEscrowFixture", "TestStorageFixtures"}
REGISTRY_SKIPS = {"TestSharedQuadProofMillionMembers"}
OPT_INS = ("WRITE_RING_GOLDENS", "REQUEST_FIXTURES", "RING_RPC_ESCROW_MEMBER", "STORAGE_REGISTRY", "UPDATE_RING_GOLDENS", "WRITE_RING_PINS", "WRITE_RING_PROOF_VECTORS", "WRITE_AUDIT_VECTORS", "AEGLOS_FIXTURES", "RING_MILLION_RECORDS")

def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()

def sha(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for b in iter(lambda: f.read(1024 * 1024), b""):
            h.update(b)
    return h.hexdigest()

def write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + ".tmp")
    with temp.open("w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
        f.flush()
        os.fsync(f.fileno())
    temp.replace(path)

def run(argv, cwd=REPO, env=None):
    return subprocess.run(argv, cwd=cwd, env=env, text=True, capture_output=True, check=True).stdout

def source():
    result = {}
    for key, path in (("customRings", REPO), ("zolana", REPO / "zolana")):
        result[key] = run(["git", "rev-parse", "HEAD"], path).strip()
        dirty = run(["git", "status", "--porcelain=v1", "--untracked-files=all", "--ignore-submodules=none"], path)
        if dirty:
            raise RuntimeError(f"Source is dirty: {key}: {dirty[:1000]}")
    if result != PINS:
        raise RuntimeError(f"Unexpected source pins: {result}")
    result["clean"] = True
    result["lockfiles"] = {str(p.relative_to(REPO)): sha(p) for p in [REPO / "prover/go.mod", REPO / "prover/go.sum", REPO / "zolana/prover/server/go.mod", REPO / "zolana/prover/server/go.sum", REPO / "prover/ring/proving-keys.lock"]}
    return result

def environment():
    env = os.environ.copy()
    for key in OPT_INS:
        env.pop(key, None)
    selected = {"GOENV": "off", "GOWORK": "off", "GOFLAGS": "", "GOTOOLCHAIN": "local", "GOMAXPROCS": "1", "GOMEMLIMIT": "1GiB", "GOGC": "25", "REQUIRE_RING_KEYS": "1", "GOCACHE": str(ROOT / "toolchains/go-cache"), "GOPATH": str(ROOT / "toolchains/go-path"), "ZOLANA_PROVER_KEYS_DIR": str(REPO / "zolana/prover/server/proving-keys")}
    env.update(selected)
    return env, selected

def validate_catalog(env):
    before = source()
    command = [str(GO), "list", "./..."]
    result = subprocess.run(command, cwd=REPO / "prover", env=env, capture_output=True, check=True)
    if hashlib.sha256(result.stdout).hexdigest() != CATALOG_SHA:
        raise RuntimeError("Actual package catalog differs from the pinned 18-package catalog")
    packages = result.stdout.decode().splitlines()
    if len(packages) != 18 or len(set(packages)) != 18:
        raise RuntimeError("Catalog must contain exactly 18 distinct packages")
    after = source()
    if before != after:
        raise RuntimeError("Source changed during catalog discovery")
    (HERE / "package-catalog.txt").write_bytes(result.stdout)
    catalog = {"schema": "cr01-recovered-package-catalog-v1", "observedAt": now(), "command": command, "cwd": str(REPO / "prover"), "exitCode": 0, "sha256": CATALOG_SHA, "packages": packages, "sourceBefore": before, "sourceAfter": after}
    if not (HERE / "package-catalog.json").exists():
        write_json(HERE / "package-catalog.json", catalog)
    return packages

def verify_timeout_basis():
    p = ROOT / "context/recovery-evidence/pr38/evidence/go-timeout-checkpoint"
    log = p / "transfer-timeout.jsonl"
    receipt = json.loads((p / "transfer-timeout-receipt.json").read_text())
    if sha(log) != "eba591fb26ef6a9ef772f93c6195346dd928897d1e0c3f0f9ae993a599f4c234":
        raise RuntimeError("Published timeout basis digest mismatch")
    events = [json.loads(line) for line in log.read_text().splitlines()]
    if receipt.get("exitCode") != 1 or not any(e.get("Action") == "fail" and not e.get("Test") for e in events) or not any("panic: test timed out after 1h0m0s" in e.get("Output", "") for e in events):
        raise RuntimeError("Missing actual terminal timeout basis for longer heavy-package ceiling")
    return {"logSha256": sha(log), "receiptSha256": sha(p / "transfer-timeout-receipt.json"), "policySha256": sha(p / "retry-budget.json"), "ceiling": "180m", "scope": sorted(PREFIX + x for x in HEAVY), "testSelectionChanged": False}

def inspect_log(path, package):
    events = []
    with Path(path).open() as f:
        for line in f:
            if line.strip():
                events.append(json.loads(line))
    if not events or any(e.get("Package") not in (None, package) for e in events):
        raise ValueError("Empty log or unexpected package in JSONL")
    failures = [e for e in events if e.get("Action") == "fail"]
    test_passes = [e for e in events if e.get("Test") and e.get("Action") == "pass"]
    test_skips = [e for e in events if e.get("Test") and e.get("Action") == "skip"]
    terminals = [e for e in events if not e.get("Test") and e.get("Action") in ("pass", "fail", "skip")]
    no_tests = any("[no test files]" in e.get("Output", "") for e in events)
    expected_skips = RING_SKIPS if package == PREFIX + "ring" else REGISTRY_SKIPS if package == PREFIX + "circuits/registry" else set()
    skip_names = {e["Test"] for e in test_skips}
    top_pass = [e["Test"] for e in test_passes if "/" not in e["Test"]]
    run_tests = {e["Test"] for e in events if e.get("Action") == "run" and e.get("Test")}
    end_tests = {e["Test"] for e in events if e.get("Action") in ("pass", "fail", "skip") and e.get("Test")}
    package_ok = len(terminals) == 1 and terminals[0]["Action"] == ("skip" if no_tests else "pass")
    result = {"eventCount": len(events), "tests": {"pass": len(test_passes), "fail": sum(bool(e.get("Test")) for e in failures), "skip": len(test_skips)}, "topLevelPassCount": len(top_pass), "topLevelPassed": top_pass, "skippedTests": sorted(skip_names), "terminalActions": [e["Action"] for e in terminals], "explicitlyHasNoTestFiles": no_tests, "failureEventCount": len(failures), "unterminatedTests": sorted(run_tests - end_tests), "unexpectedSkipNames": sorted(skip_names - expected_skips)}
    result["qualifies"] = package_ok and not failures and not result["unterminatedTests"] and skip_names == expected_skips and (bool(test_passes) or no_tests)
    return result

def sample_tree(root_pid):
    processes = {}
    for path in Path("/proc").iterdir():
        if not path.name.isdecimal():
            continue
        try:
            values = {}
            for line in (path / "status").read_text().splitlines():
                k, _, value = line.partition(":")
                if k in ("PPid", "VmRSS"):
                    values[k] = int(value.strip().split()[0])
            pid = int(path.name)
            processes[pid] = {"pid": pid, "ppid": values.get("PPid", 0), "rssKiB": values.get("VmRSS", 0), "affinity": sorted(os.sched_getaffinity(pid))}
        except (OSError, ValueError, ProcessLookupError):
            continue
    owned = {root_pid}
    while True:
        expanded = owned | {p["pid"] for p in processes.values() if p["ppid"] in owned}
        if expanded == owned:
            break
        owned = expanded
    return [processes[pid] for pid in sorted(owned) if pid in processes]

def execute(package, env, selected, lock_fd, catalog):
    suffix = package.removeprefix(PREFIX)
    if package not in catalog or not package.startswith(PREFIX):
        raise RuntimeError("Package is not in the actual pinned catalog")
    before = source()
    version = run([str(GO), "version"], REPO / "prover", env).strip()
    if version != "go version go1.27.3 linux/amd64":
        raise RuntimeError("Unexpected Go toolchain")
    allowed = sorted(os.sched_getaffinity(0))
    if len(allowed) < 2:
        raise RuntimeError("The recorded two-CPU profile needs two already-allowed CPUs")
    affinity = allowed[:2]
    timeout = "180m" if suffix in HEAVY else "60m"
    basis = verify_timeout_basis() if suffix in HEAVY else None
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    stem = f"{suffix.replace('/', '-')}-{stamp}"
    folder = HERE / "packages"
    folder.mkdir(parents=True, exist_ok=True)
    log = folder / (stem + ".jsonl")
    stderr = folder / (stem + ".stderr.log")
    receipt_path = folder / (stem + ".json")
    command = [str(GO), "test", "-json", "-p", "1", "-parallel", "1", "-timeout", timeout, package, "-count=1"]
    receipt = {"schema": "cr01-go-recovered-execution-v1", "status": "running", "package": package, "startedAt": now(), "finishedAt": None, "exitCode": None, "command": command, "cwd": str(REPO / "prover"), "toolchain": version, "environment": selected, "unsetOptIns": list(OPT_INS), "sourceBefore": before, "catalogSha256": CATALOG_SHA, "runnerSha256": sha(__file__), "timeoutBasis": basis, "executionProfile": {"parentAllowedCpus": allowed, "childAllowedCpus": affinity, "onePackageAtATime": True, "sampleIntervalSeconds": 5, "rssScope": "Sampled concurrent RSS of this Go child and its observed descendants; excludes downloads, agent tools, supervisor and unrelated processes; not a hard memory limit"}, "log": {"path": str(log)}, "stderr": {"path": str(stderr)}}
    write_json(receipt_path, receipt)
    write_json(HERE / "active.json", {"package": package, "receipt": str(receipt_path), "status": "running", "startedAt": receipt["startedAt"]})
    started = time.monotonic()
    observations = {"sampleCount": 0, "observedPids": set(), "observedAffinitySets": set(), "sampledConcurrentRssPeakKiB": 0, "affinityViolation": False}
    with log.open("wb") as out, stderr.open("wb") as err:
        proc = subprocess.Popen(command, cwd=REPO / "prover", env=env, stdout=out, stderr=err, pass_fds=(lock_fd,), preexec_fn=lambda: os.sched_setaffinity(0, affinity))
        receipt["pid"] = proc.pid
        while True:
            processes = sample_tree(proc.pid)
            observations["sampleCount"] += 1
            observations["observedPids"].update(p["pid"] for p in processes)
            observations["observedAffinitySets"].update(tuple(p["affinity"]) for p in processes)
            observations["sampledConcurrentRssPeakKiB"] = max(observations["sampledConcurrentRssPeakKiB"], sum(p["rssKiB"] for p in processes))
            observations["affinityViolation"] |= any(p["affinity"] != affinity for p in processes)
            receipt.update({"heartbeatAt": now(), "elapsedSeconds": round(time.monotonic() - started, 3), "lastHeartbeatLogBytes": log.stat().st_size})
            receipt["resources"] = {**observations, "observedPids": sorted(observations["observedPids"]), "observedAffinitySets": [list(x) for x in sorted(observations["observedAffinitySets"])]}
            write_json(receipt_path, receipt)
            try:
                exit_code = proc.wait(timeout=5)
                break
            except subprocess.TimeoutExpired:
                pass
        out.flush()
        err.flush()
        os.fsync(out.fileno())
        os.fsync(err.fileno())
    receipt.update({"exitCode": exit_code, "finishedAt": now(), "durationSeconds": round(time.monotonic() - started, 3), "sourceAfter": source()})
    receipt["log"].update({"sha256": sha(log), "bytes": log.stat().st_size})
    receipt["stderr"].update({"sha256": sha(stderr), "bytes": stderr.stat().st_size})
    try:
        receipt["parsed"] = inspect_log(log, package)
    except (ValueError, json.JSONDecodeError) as error:
        receipt["parsed"] = {"qualifies": False, "error": str(error)}
    qualifies = exit_code == 0 and receipt["sourceBefore"] == receipt["sourceAfter"] and receipt["parsed"]["qualifies"] and not observations["affinityViolation"]
    receipt["status"] = ("no-tests" if receipt["parsed"].get("explicitlyHasNoTestFiles") else "passed") if qualifies else "failed-or-incomplete"
    write_json(receipt_path, receipt)
    write_json(HERE / "active.json", {"package": package, "receipt": str(receipt_path), "status": receipt["status"], "finishedAt": receipt["finishedAt"]})
    print(json.dumps({"receipt": str(receipt_path), "package": package, "status": receipt["status"], "durationSeconds": receipt["durationSeconds"], "exitCode": exit_code, "logBytes": receipt["log"]["bytes"], "logSha256": receipt["log"]["sha256"], "parsed": receipt["parsed"]}), flush=True)
    if not qualifies:
        raise RuntimeError("Package did not qualify; terminal evidence retained")
    return receipt_path

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--package", action="append", default=[])
    parser.add_argument("--prepare", action="store_true")
    args = parser.parse_args()
    HERE.mkdir(parents=True, exist_ok=True)
    with (HERE / "proof-run.lock").open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        env, selected = environment()
        catalog = validate_catalog(env)
        if args.prepare:
            print(json.dumps({"catalogCount": len(catalog), "catalogSha256": CATALOG_SHA, "source": source(), "toolchain": run([str(GO), "version"], REPO / "prover", env).strip()}))
        for name in args.package:
            package = name if name.startswith(PREFIX) else PREFIX + name
            execute(package, env, selected, lock.fileno(), catalog)

if __name__ == "__main__":
    main()
