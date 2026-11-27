# Independent native-worker and resource-evidence review

**Author provenance and scope note:** The independent report below is reproduced
from the retained worker/resource review without changing its findings or frozen
source identities. It predates the ring-aware indexed-note helper and expanded
live refusal corpus. Its source-review result and five passing runner tests do
not approve those later changes or establish a completed live journey. A fresh
runner test run passed 5/5 at the same runner/monitor/test file digests, and the
complete 25-step application validator journey subsequently passed. The latest
independent review remains blocked; execution does not extend this historical
review. Consult
[APPLICATION-EVIDENCE.md](APPLICATION-EVIDENCE.md) for the current qualification.

Review date: 2026-11-24. Scope: the fresh-process and interrupted-commit additions in `custom-rings-app/sdk-tests/spawn-room/native-worker.ts`, `native-worker.test.ts`, `native-worker-runner.test.ts`, and `localnet-journey.test.ts`; plus `tools/localnet-resource-monitor.mjs` and its runner integration. Earlier circuit/program and SDK/native reviews remain in `independent-application-review.md` and `independent-sdk-native-review.md`.

## Final source-review result

**No outstanding Critical, Important, or Minor defect was established in the final reviewed delta. The two Important recovery findings below were corrected by the owner and independently source-verified.** No new on-chain authorization, circuit, or commitment bypass was established. Positive execution of the complete local-validator journey remains pending and must not be inferred from this review or from launcher-negative tests.

## Concrete recovery findings

1. **Important acceptance-evidence gap, corrected: saved transaction bytes were not authenticated by signature extraction.** The original recovery worker decoded the retained wire frame and compared `getSignatureFromTransaction` with the saved signature. The pinned helper merely returns the first signature bytes; it does not verify their relationship to the message. A wire frame with altered message bytes and an unchanged signature prefix passes that check. Actual status/indexed-note checks still protected the observed accepted state, but the claimed exact interrupted submission was not independently verified. The final worker additionally fetches the transaction with confirmed commitment and base64 encoding, requires successful metadata and the observed slot, and compares the complete decoded wire bytes with the retained frame.

2. **Important recovery-liveness gap, corrected: retry after durable confirmation was rejected.** A worker could persist `retainConfirmed`, then exit before writing its operation result or successful trace. Re-entering the same encrypted job originally failed on the required absence of the receipt; fixed per-phase log creation and create-only phase results also prevented retry. The final launcher creates a fresh private directory per attempt. The worker invokes the adapter's exact idempotent receipt check, and the journey compares the full retained receipt record and version before/after retry. Phase results retain an immutable operation ID independently of attempt PID and are checked exactly on repeated creation. The worker loads an existing original before invoking inference and an existing acceptance before choosing any epoch; it checks the exact binding, original, and recovered predecessor state. Thus a completed phase returns its original grant and nonce rather than silently rebuilding a later-epoch grant. The journey now requires a controlled failed post-receipt attempt, a successful fresh-process retry of the same encrypted job, and another completed-job re-entry with an identical prepared acceptance and zero inference calls.

These findings concern the local orchestration and the strength of its acceptance evidence. The application proof and on-chain profile were not changed to address them.

## Source boundaries already checked

- The coordinator closes its encrypted store and native runtime before launching each native episode worker. Each worker reconstructs signing keys and wallet from encrypted disk records, starts the pinned real Flue residents, fetches authenticated application configuration, and recovers the actual unspent indexed note with complete coverage at or after the observed confirmed slot.
- A worker binds recovered state to the retained expected commitment/revision and independently checks the observed transaction's ring, slot, and output commitment. The resident binding still comes from the real pinned runtime; the native adapter enforces exact seed/member digests and ordered resident IDs.
- The first exact signed submission, immutable recovery job, and pre-submission wallet are persisted before broadcast. The coordinator deliberately omits its native confirmation receipt. Its continued existence is disclosed; no claim that the coordinator itself was killed is made.
- Native traces distinguish the actual worker PID from the Vitest launcher and coordinator. Passing evidence requires a successful child test and exit, a distinct worker PID, explicit runtime stop/store close, operation identity, and positive measured process resource values. Controlled interruption must remain a failed attempt, separately identified in the eventual passing recovery evidence.
- The controlled interruption is an explicit exception after the durable receipt, with normal native/store cleanup and a recorded nonzero process exit. It is not presented as an abrupt OS kill or power-loss durability test. The retry uses a new process and the same encrypted job. The trace labels the receipt as retained, records whether it was absent on entry, and does not imply another write on an existing-receipt retry.

## Resource-monitor verdict

No actionable blocking defect was established in the resource-monitor delta. The harness registers its detached command/service process groups; the pinned native CLI's Surfpool/Photon children inherit its group and remain in scope after the launcher exits. Ancestry traversal includes observed worker subgroups. Reads are limited to `/proc` process metadata (`stat` and `status`), without command lines, environments, request bodies, or memory contents. Per-process records use PID plus start ticks.

The receipt correctly distinguishes sampled concurrent RSS from each process's observed process-lifetime `VmHWM`, records the interval and measurement duration, keeps configured limits separate, and states that short-lived processes/later peaks can be missed and shared pages can be counted more than once. Command durations use a monotonic clock. Sampling continues through cleanup. This supports local-run measurements, not an exact instantaneous process-tree peak or production performance claim.

Independent validation: **all five lightweight runner tests passed, with zero failures/skips**. A small isolated pinned-Vitest countercheck sent SIGTERM only to a slow test's launcher; the launcher exited 143 and its worker was absent one second later. No orphan was established in that observed path; the check was cleaned up by its own process group and did not touch application services. The owner reported final integration typecheck/lint passing and all three focused native/launcher tests passing in 14.21 seconds, including two failed-job launches with distinct OS worker PIDs and attempt directories. I reviewed their assertions and source rather than duplicating expensive proof or chain work.

The eventual live receipt still needs inspection for actual validator/Photon/prover/worker coverage, any `lastSamplingError`, measured wall time/RSS, exact saved-wire reconciliation, independently exited worker attempts, and all required successful and negative journey outcomes.

## Frozen source identities

Paths below are relative to `custom-rings-app`; SHA256 values identify the final files reviewed, before the actual live gate.

| File | SHA256 |
| --- | --- |
| `sdk-tests/spawn-room/native-worker.ts` | `a922a28238382485ec84a68e7659a16fef128e9d1f32b7eba80dd158401ff950` |
| `sdk-tests/spawn-room/native-worker.test.ts` | `e2a91ddc759ff5b9bfae8cbafc15c808a603deb009ca7e8870040e73372c5a52` |
| `sdk-tests/spawn-room/native-worker-runner.test.ts` | `1248f1b4e29ac48ac48d2cbdfc75c0f6c3a825138f65b965a97aeba726895f2a` |
| `sdk-tests/spawn-room/localnet-journey.test.ts` | `47a5989c98d8699fd6d85e3e6cf63b8b2b860a86d1a978fac2970c9f9238af10` |
| `tools/localnet-resource-monitor.mjs` | `6c7fafcbea91738b6955575b2e1f164a332a21c1b0707bd401c5df2a7c4fb646` |
| `tools/run-spawn-room-localnet.mjs` | `4dd310b5f17598b70b4b8b1d81a9c0f2fa35c64aeac072bac78ca5e7e4beefe3` |
| `tools/run-spawn-room-localnet.test.mjs` | `e5bf10ff3e0f612134a966f046e48ce428a803d005ee5e3fdc2082c41a5486aa` |
