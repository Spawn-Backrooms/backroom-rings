#!/usr/bin/env python3
"""Extract public artifact identities from the retained 26-step localnet run."""
import argparse
import hashlib
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
DESCRIPTOR_BLOB = "f24f8fcd044290f66f8da6ea67eed0fca27c4291"
VM_BLOB = "ad579e19a301b0fe570eabff27f6dd203f924322"
KEY_NAMES = {"genesisKeySha256": "spawn_room_genesis_v1.key",
             "advanceKeySha256": "spawn_room_advance_v1.key"}


class ReceiptError(ValueError):
    pass


def require(condition, code):
    if not condition:
        raise ReceiptError(code)


def is_digest(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def pinned_json(path, expected):
    raw = path.read_bytes()
    blob = hashlib.sha1(f"blob {len(raw)}\0".encode() + raw).hexdigest()
    require(blob == expected, "published-input-identity-mismatch")
    return json.loads(raw)


def artifact(value):
    require(isinstance(value, dict) and is_digest(value.get("sha256"))
            and type(value.get("size")) is int and value["size"] > 0,
            "invalid-artifact-identity")
    return {"sha256": value["sha256"], "size": value["size"]}


def reconcile(raw, vm, descriptor):
    profile = descriptor["profile"]
    pins = profile["artifacts"]
    runtime, supervisor = vm["runtime"], vm["supervisor"]
    require(descriptor["schema"] == "cr05-readiness-contract.v1"
            and profile["selection"]["profile"] == "anonymous-localnet-v1"
            and profile["selection"]["network"] == "localnet"
            and all(is_digest(pins[k]) for k in ("overlaySha256", "programSha256", *KEY_NAMES))
            and is_digest(profile["scopeSha256"])
            and vm["schema"] == "spawn-room-cr04-native-vm-qualification-v1"
            and vm["fullCr04Accepted"] is False
            and vm["overlaySha256"] == pins["overlaySha256"], "unsupported-checkpoint")
    require(raw["schema"] == supervisor["schema"] == "spawn-room-localnet-run-v1"
            and raw["status"] == supervisor["status"] == "passed"
            and supervisor["supervisorExit"] == 0 and bool(raw["finishedAt"])
            and raw["setup"] == "experimental localnet only", "incomplete-run")
    require(raw["nativeRevision"] == raw["appRevision"] == runtime["nativeRevision"] == pins["customRingsSource"]
            and raw["zolanaRevision"] == raw["appZolanaRevision"] == runtime["zolanaRevision"] == pins["zolanaSource"]
            and raw["backroomsRevision"] == runtime["backroomsRevision"] == pins["backroomsReferenceHost"]
            and raw["ringProgramId"] == pins["programId"]
            and raw["runtime"] == runtime["runtime"], "run-scope-mismatch")
    sources = raw["sources"]
    require(all(sources[k] is True for k in ("unchanged", "appZolanaUnchanged", "referenceHostUnchanged"))
            and is_digest(raw["appDiffSha256"]), "unstable-run-source")
    source_digests = {}
    for name in ("application", "referenceHost"):
        before, after = (sources[phase][name]["sha256"] for phase in ("before", "after"))
        require(is_digest(before) and before == after, "unstable-run-source")
        source_digests[name] = before
    recorded = {k: artifact(v) for k, v in raw["artifacts"].items()}
    require(recorded == {k: artifact(v) for k, v in runtime["artifacts"].items()}, "wrong-run-artifacts")
    journey = raw["journey"]
    require(is_digest(journey["evidenceSha256"]) and journey["evidenceSha256"] == supervisor["journeyDigest"]
            and is_digest(journey["vitestSha256"]) and journey["vitestSha256"] == supervisor["vitestDigest"],
            "wrong-run-journey")
    steps = [{"name": s["name"], "status": s["status"]} for s in journey["steps"]]
    require(len(steps) == supervisor["stepCount"] == 26 and steps == supervisor["steps"]
            and len({s["name"] for s in steps}) == 26 and all(s["status"] == "passed" for s in steps),
            "wrong-run-steps")
    auditor = [{k: s[k] for k in ("ownerRecordVerified", "applicationDataHashVerified")}
               for s in journey["steps"] if s["name"] == "application-auditor-read"]
    require(auditor == supervisor["auditor"] and len(auditor) == 1
            and auditor[0]["ownerRecordVerified"] is True
            and auditor[0]["applicationDataHashVerified"] is False, "wrong-run-auditor")
    cleanup = [{"name": s["name"], "stopped": s["stopped"]} for s in raw["cleanup"]]
    require(cleanup == supervisor["cleanup"] and all(s["stopped"] is True for s in cleanup)
            and not any("error" in s for s in raw["cleanup"])
            and bool(raw["commands"]) and all(s["status"] == "passed" for s in raw["commands"])
            and supervisor["failedCommands"] == [], "incomplete-run-cleanup")
    observed = {"programSha256": recorded["appProgram"]}
    observed.update({field: artifact(raw["keys"][name]) for field, name in KEY_NAMES.items()})
    comparisons = {k: {"recorded": v, "historicalPin": pins[k], "matches": v["sha256"] == pins[k]}
                   for k, v in observed.items()}
    return {
        "schema": "spawn-room-vm-artifact-reconciliation-v1",
        "scope": "retained-receipt-comparison-only",
        "profileScopeSha256": profile["scopeSha256"],
        "programId": pins["programId"],
        "overlaySha256": pins["overlaySha256"],
        "applicationDiffSha256": raw["appDiffSha256"],
        "sourceManifestSha256": source_digests,
        "journeySha256": supervisor["journeyDigest"],
        "vitestSha256": supervisor["vitestDigest"],
        "artifacts": comparisons,
        "historicalPinsMatch": all(v["matches"] for v in comparisons.values()),
        "auditorApplicationDataHashVerified": False,
        "actualFilesRehashed": False,
        "independentAcceptance": False,
        "activationAuthorized": False,
        "productionAvailable": False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("receipt", type=Path, help="private run-receipt.json (never upload it)")
    args = parser.parse_args()
    try:
        vm = pinned_json(HERE.parent / "evidence/cr04-native-vm-qualification.json", VM_BLOB)
        descriptor = pinned_json(HERE / "descriptor.json", DESCRIPTOR_BLOB)
        result = reconcile(json.loads(args.receipt.read_bytes()), vm, descriptor)
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
        parser.exit(1, "Receipt rejected: " + (str(error) if isinstance(error, ReceiptError) else "invalid-or-incomplete-input") + "\n")
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
