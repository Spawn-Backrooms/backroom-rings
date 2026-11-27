# Reconcile the retained native VM artifact set

The 26-step VM record and the historical readiness descriptor name different
program bytes. The quickstart explicitly states that fresh randomized local
setup generates new proving keys, verifier constants and program digests.
That explains why such differences can be legitimate, but does not establish
which setup occurred in this run.

The existing runner records both application proving-key fingerprints in its
private run-receipt.json. On the original isolated VM, use this exact-checkpoint
extractor rather than re-running proofs solely to recover omitted fingerprints:

```sh
cd backrooms/experiments/custom-rings-base/native-preview
python3 -m unittest -v test_reconcile_vm_artifacts
python3 reconcile_vm_artifacts.py /private/path/run-receipt.json > artifact-comparison.json
```

The extractor checks the exact published descriptor and VM receipt Git blobs,
then compares the raw receipt's run scope, artifact inventory, journey/test
digests, steps, auditor and cleanup observations against that public record.
Only the explicit digest-and-size projection is emitted. Keep the private
receipt and all key files, paths, logs and other records on the VM; review
the generated projection before publishing it.

Exit zero means the comparison was extracted, not that the pins match or
the raw receipt was independently authenticated. A mismatch stays a mismatch.
The utility does not rehash actual files, verify on-chain deployment, change
pins, re-execute tests or grant activation. Use the extracted identities as
input to independent actual-file and deployed-identity qualification, including
the remaining auditor-data-hash and conformance requirements. If the raw run
receipt was not retained, this extractor cannot recover its missing evidence.

Local regression: Python standard library unittest, five tests passed on
synthetic receipt fixtures (including eight mismatch/rejection subcases).
The original private VM receipt was unavailable in the reviewing environment;
no real-run fingerprint extraction is claimed.
