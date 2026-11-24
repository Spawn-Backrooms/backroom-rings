import hashlib
import json
import tempfile
import unittest
from pathlib import Path
import verify_retained_packet as v


class PortablePacketTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.packet = Path(self.tmp.name) / "unrelated checkout" / "packet"
        self.packet.mkdir(parents=True)
        self.root = "/nonexistent-original-build-host"
        self.executable = self.root + "/toolchains/go1.27.3/go/bin/go"
        self.cwd = self.root + "/custom-rings-base/prover"
        self.source = {"customRings": "02bca33729051798834ecbb4d94e968cdc0ef9b8", "zolana": "0fe4f952182b39464d472c52c40b3febe6cbd9ec", "clean": True}
        suffixes = "circuits circuits/audit circuits/policy circuits/registry circuits/ringgadget circuits/shared circuits/transfer cmd/catalog cmd/prover ring ringtest ringtest/ringaudit ringtest/ringkey ringtest/ringmerge ringtest/ringpolicy ringtest/ringprotocol ringtest/ringregistry ringtest/ringtransfer".split()
        self.required = [v.PREFIX + s for s in suffixes]
        self.write("package-catalog.txt", ("\n".join(self.required) + "\n").encode())
        self.assertEqual(v.digest((self.packet / "package-catalog.txt").read_bytes()), v.CATALOG)
        self.write_json("package-catalog.json", {"command": [self.executable, "list", "./..."], "cwd": self.cwd, "packages": self.required, "exitCode": 0, "sourceBefore": self.source, "sourceAfter": self.source})
        self.write("verify_and_stage.py", b"# historical verifier fixture\n")
        self.write("run_packages.py", b"# historical runner fixture\n")
        self.rows = []
        for index, package in enumerate(self.required):
            suffix = package[len(v.PREFIX):]
            no_tests = index in {7, 8, 12, 13, 14, 17}
            passes = [] if no_tests else ["TestFixture"]
            skips = sorted(v.SKIPS.get(suffix, set()))
            events = []
            for test in passes + skips:
                events += [{"Action": "run", "Package": package, "Test": test}, {"Action": "pass" if test in passes else "skip", "Package": package, "Test": test}]
            if no_tests:
                events.append({"Action": "output", "Package": package, "Output": "[no test files]"})
            events.append({"Action": "skip" if no_tests else "pass", "Package": package})
            stem = "package-" + str(index)
            output = ("\n".join(json.dumps(e) for e in events) + "\n").encode()
            self.write("packages/" + stem + ".jsonl", output)
            self.write("packages/" + stem + ".stderr.log", b"")
            meta = lambda ext, raw: {"path": self.root + "/context/go-recovery/packages/" + stem + ext, "sha256": v.digest(raw), "bytes": len(raw)}
            r = {"package": package, "command": [self.executable, "test", "-json", "-p", "1", "-parallel", "1", "-timeout", "180m" if suffix in v.HEAVY else "60m", package, "-count=1"], "cwd": self.cwd, "toolchain": "go version go1.27.3 linux/amd64", "sourceBefore": self.source, "sourceAfter": self.source, "exitCode": 0, "finishedAt": "fixture", "status": "no-tests" if no_tests else "passed", "catalogSha256": v.CATALOG, "runnerSha256": v.digest(b"# historical runner fixture\n"), "unsetOptIns": sorted(v.OPT_INS), "environment": v.ENV, "resources": {"affinityViolation": False, "observedAffinitySets": [[1, 2]], "sampledConcurrentRssPeakKiB": 100}, "executionProfile": {"childAllowedCpus": [1, 2]}, "log": meta(".jsonl", output), "stderr": meta(".stderr.log", b""), "parsed": {"tests": {"pass": len(passes), "fail": 0, "skip": len(skips)}, "qualifies": True}, "durationSeconds": 1}
            if suffix in v.HEAVY:
                r["timeoutBasis"] = {"logSha256": "eba591fb26ef6a9ef772f93c6195346dd928897d1e0c3f0f9ae993a599f4c234", "ceiling": "180m", "testSelectionChanged": False}
            name = "packages/" + stem + ".json"
            self.write_json(name, r)
            self.rows.append({"package": package, "status": r["status"], "exitCode": 0, "durationSeconds": 1, "passEvents": len(passes), "topLevelPasses": len(passes), "skipEvents": len(skips), "skippedTests": skips, "logSha256": v.digest(output), "logBytes": len(output), "sampledConcurrentRssPeakKiB": 100, "receipt": name, "receiptSha256": v.digest((self.packet / name).read_bytes())})
        self.write_json("summary.json", {"packages": self.rows, "source": self.source, "status": "passed", "requiredPackageCount": 18, "verifiedTerminalPackageCount": 18, "passedTestPackageCount": 12, "explicitNoTestFilesPackageCount": 6, "missingPackages": [], "incompleteAttempts": [], "catalogSha256": v.CATALOG, "wholeSuiteSingleCommandExitClaimed": False, "historicalMetadataCountedAsNewExecution": False, "verifierSha256": v.digest(b"# historical verifier fixture\n")})
        self.seal()

    def write(self, name, raw):
        path = self.packet / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)

    def write_json(self, name, value):
        self.write(name, json.dumps(value).encode())

    def seal(self):
        entries = []
        for p in sorted(self.packet.rglob("*")):
            if p.is_file() and p.name != "manifest.json":
                raw = p.read_bytes()
                entries.append({"path": p.relative_to(self.packet).as_posix(), "bytes": len(raw), "sha256": v.digest(raw), "gitBlobSha1": hashlib.sha1(f"blob {len(raw)}\0".encode() + raw).hexdigest()})
        self.write_json("manifest.json", {"schema": "cr01-go-requalification-manifest-v1", "qualificationStatus": "passed", "verifiedTerminalPackageCount": 18, "requiredPackageCount": 18, "summarySha256": v.digest((self.packet / "summary.json").read_bytes()), "files": entries})

    def test_relocated_full_packet_read_only(self):
        before = {p: p.read_bytes() for p in self.packet.rglob("*") if p.is_file()}
        result = v.verify_packet(self.packet)
        self.assertEqual((result["verifiedTerminalPackageCount"], result["passedTestPackageCount"], result["explicitNoTestFilesPackageCount"]), (18, 12, 6))
        self.assertEqual(before, {p: p.read_bytes() for p in self.packet.rglob("*") if p.is_file()})

    def test_modified_log(self):
        self.write("packages/package-0.jsonl", b"changed")
        with self.assertRaises(AssertionError):
            v.verify_packet(self.packet)

    def test_misdirected_historical_log_even_with_resealed_manifest(self):
        name = "packages/package-0.json"
        r = json.loads((self.packet / name).read_bytes())
        r["log"]["path"] = self.root + "/context/go-recovery/packages/package-1.jsonl"
        self.write_json(name, r)
        self.seal()
        with self.assertRaisesRegex(AssertionError, "Historical output binding changed"):
            v.verify_packet(self.packet)

    def test_changed_command_even_with_resealed_manifest(self):
        name = "packages/package-0.json"
        r = json.loads((self.packet / name).read_bytes())
        r["command"].append("-run=TestFixture")
        self.write_json(name, r)
        self.seal()
        with self.assertRaises(AssertionError):
            v.verify_packet(self.packet)

    def test_missing_package(self):
        (self.packet / "packages/package-0.json").unlink()
        self.seal()
        with self.assertRaisesRegex(AssertionError, "Incomplete package coverage"):
            v.verify_packet(self.packet)


if __name__ == "__main__":
    unittest.main()
