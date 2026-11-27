import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from reconcile_vm_artifacts import ReceiptError, pinned_json, reconcile


def fixture():
    h = lambda char: char * 64
    pins = {"customRingsSource": "a" * 40, "zolanaSource": "b" * 40,
            "backroomsReferenceHost": "c" * 40, "programId": "pinned-program",
            "overlaySha256": h("a"), "programSha256": h("b"),
            "genesisKeySha256": h("c"), "advanceKeySha256": h("d")}
    descriptor = {"schema": "cr05-readiness-contract.v1", "profile": {"selection": {"profile": "anonymous-localnet-v1", "network": "localnet"}, "scopeSha256": h("e"), "artifacts": pins}}
    steps = [{"name": f"fixture-{i}", "status": "passed"} for i in range(25)]
    steps.append({"name": "application-auditor-read", "status": "passed"})
    auditor = {"ownerRecordVerified": True, "applicationDataHashVerified": False}
    artifacts = {"appProgram": {"sha256": h("f"), "size": 123}, "prover": {"sha256": h("0"), "size": 456}}
    runtime = {"nativeRevision": pins["customRingsSource"], "zolanaRevision": pins["zolanaSource"], "backroomsRevision": pins["backroomsReferenceHost"], "runtime": {"node": "v24", "platform": "linux", "arch": "x64"}, "artifacts": artifacts}
    cleanup = [{"name": "prover", "stopped": True}]
    supervisor = {"schema": "spawn-room-localnet-run-v1", "status": "passed", "supervisorExit": 0, "stepCount": 26, "steps": steps, "auditor": [auditor], "cleanup": cleanup, "failedCommands": [], "journeyDigest": h("1"), "vitestDigest": h("2")}
    vm = {"schema": "spawn-room-cr04-native-vm-qualification-v1", "fullCr04Accepted": False, "overlaySha256": pins["overlaySha256"], "runtime": runtime, "supervisor": supervisor}
    raw = {"schema": supervisor["schema"], "status": "passed", "finishedAt": "recorded", "setup": "experimental localnet only", "nativeRevision": runtime["nativeRevision"], "appRevision": runtime["nativeRevision"], "zolanaRevision": runtime["zolanaRevision"], "appZolanaRevision": runtime["zolanaRevision"], "backroomsRevision": runtime["backroomsRevision"], "ringProgramId": pins["programId"], "runtime": copy.deepcopy(runtime["runtime"]), "appDiffSha256": h("3"), "sources": {"unchanged": True, "appZolanaUnchanged": True, "referenceHostUnchanged": True, **{phase: {"application": {"sha256": h("4")}, "referenceHost": {"sha256": h("5")}} for phase in ("before", "after")}}, "artifacts": {k: {**v, "path": "/private/fixture"} for k, v in artifacts.items()}, "journey": {"evidenceSha256": supervisor["journeyDigest"], "vitestSha256": supervisor["vitestDigest"], "steps": copy.deepcopy(steps)}, "cleanup": copy.deepcopy(cleanup), "commands": [{"status": "passed"}], "keys": {"spawn_room_genesis_v1.key": {"sha256": h("c"), "size": 345, "path": "/private/fixture"}, "spawn_room_advance_v1.key": {"sha256": h("6"), "size": 678, "path": "/private/fixture"}}, "private": "DO-NOT-EMIT"}
    raw["journey"]["steps"][-1].update(auditor)
    return raw, vm, descriptor


class TestReconcile(unittest.TestCase):
    def test_reports_exact_mismatches_without_private_values_or_authority(self):
        report = reconcile(*fixture())
        self.assertFalse(report["historicalPinsMatch"])
        self.assertTrue(report["artifacts"]["genesisKeySha256"]["matches"])
        self.assertFalse(report["artifacts"]["programSha256"]["matches"])
        self.assertFalse(report["artifacts"]["advanceKeySha256"]["matches"])
        for key in ("actualFilesRehashed", "activationAuthorized", "productionAvailable", "independentAcceptance", "auditorApplicationDataHashVerified"):
            self.assertIs(report[key], False)
        encoded = json.dumps(report)
        self.assertNotIn("/private/fixture", encoded)
        self.assertNotIn("DO-NOT-EMIT", encoded)

    def test_matching_historical_pins_still_do_not_authorize(self):
        raw, vm, descriptor = fixture()
        pins = descriptor["profile"]["artifacts"]
        pins["programSha256"] = raw["artifacts"]["appProgram"]["sha256"]
        pins["advanceKeySha256"] = raw["keys"]["spawn_room_advance_v1.key"]["sha256"]
        report = reconcile(raw, vm, descriptor)
        self.assertTrue(report["historicalPinsMatch"])
        self.assertFalse(report["activationAuthorized"])

    def test_wrong_binary_and_journey_rejected(self):
        for field in ("binary", "journey", "steps", "cleanup", "source", "auditor", "key", "scope"):
            with self.subTest(field=field):
                raw, vm, descriptor = fixture()
                if field == "binary": raw["artifacts"]["appProgram"]["sha256"] = "0" * 64
                if field == "journey": raw["journey"]["evidenceSha256"] = "0" * 64
                if field == "steps": raw["journey"]["steps"].pop()
                if field == "cleanup": raw["cleanup"][0]["stopped"] = False
                if field == "source": raw["sources"]["after"]["application"]["sha256"] = "0" * 64
                if field == "auditor": raw["journey"]["steps"][-1]["applicationDataHashVerified"] = True
                if field == "key": raw["keys"]["spawn_room_genesis_v1.key"]["sha256"] = "invalid"
                if field == "scope": raw["ringProgramId"] = "wrong"
                with self.assertRaises(ReceiptError): reconcile(raw, vm, descriptor)

    def test_missing_key_cannot_be_filled_from_descriptor(self):
        raw, vm, descriptor = fixture()
        del raw["keys"]["spawn_room_advance_v1.key"]
        with self.assertRaises(KeyError): reconcile(raw, vm, descriptor)

    def test_pinned_input_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "input.json"
            data = b'{"test":true}\n'
            sha = hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()
            path.write_bytes(data)
            self.assertEqual(pinned_json(path, sha), {"test": True})
            path.write_bytes(b'{}')
            with self.assertRaises(ReceiptError): pinned_json(path, sha)


if __name__ == "__main__":
    unittest.main()
