# Native SPAWN handoff: anonymous localnet room profile

## Readiness and scope

This is the public integration handoff for O05/CR05. The actual qualified state
is recorded in [APPLICATION-EVIDENCE.md](APPLICATION-EVIDENCE.md); a source
review or passing codec test must not be presented as a live-validator pass.
The public adapter is an explicit experimental source integration, not a
released npm API or activated native product mode. Canonical native host/UI
activation remains with its authorized maintainer and requires its own source
and UI evidence. No private native source is copied into this repository.

The public application journey now has a real-validator pass. Its 25 steps
include two hidden updates, fresh-process confirmation recovery, a deliberate
post-receipt interruption and retry, retained-lesson reuse, and 15 expected
ledger refusals. The [live evidence](evidence/spawn-room-live-pass.json) records
that run. Final independent review and the remaining upstream baseline gates
are still open; this run does not activate the private native host or UI.

| Boundary | Exact selection |
| --- | --- |
| Chain artifact/state format | `spawn-room.v1` |
| Dedicated program feature | `spawn-room-v1` |
| Local test keys | Explicit `spawn-room-v1-localnet-keys`; insecure single-party setup |
| Prover opt-in | `SpawnRoomLocalnetProver({ url, localnetTestKeys: true })`; loopback only |
| Native view protocol | Existing `backrooms.v0` contract, with `artifactVersion: spawn-room.v1` |
| Existing v0 program/keys | Remain separate and unchanged |
| Execution fixture | Existing seeded `FlueResidents` with deterministic local inference |
| Public mode | Localnet developer preview only; production unavailable |

The native view's protocol field is compatibility with the existing recovered
room interface. It does not reinterpret a v0 chain note or establish v0
production qualification. The experimental state has its own canonical
516-byte encoding, identity domains and proof family.

## Public source surfaces

Apply the exact patch using [fork-overlay/README.md](fork-overlay/README.md).
The resulting Custom Rings checkout includes these modules under
`sdk-libs/ts/src/experimental/spawn-room/`:

| Module | Responsibility |
| --- | --- |
| `codec.ts` | Canonical state/grant encoding and hash order; strict domains, widths, bounds and transition derivation. |
| `payload.ts` | Canonical application data for the existing recipient encryption path, and recovery checks against the published note commitment. |
| `recovery.ts` | Ring-aware indexed-note lookup with an exact slot/signature/commitment match and complete coverage. |
| `staging.ts` | One zero-value application note with the correct visible-genesis or hidden-advance rail and dummy padding. |
| `prover.ts` | Strict application request construction, exact u64 JSON serialization, separate key pins and combined proof selection. |
| `instructions.ts` | Config/root management, visible genesis and hidden advance with the agreed tags/account prefixes. |
| `native-adapter.ts` | Structural native authority/store contracts and preservation of originals, authorizations, grants and confirmed receipts. |

`tools/spawn-room-localnet.md` explains the actual contributor runner.
`sdk-tests/spawn-room/` joins the public adapter to the unmodified pinned
Backrooms reference host. The source integration imports the real native
contracts and runtime at Backrooms commit
`08822c65254cd73c5f2dccbdf182ce1df2c7510a`.

The process boundary is implemented by
`sdk-tests/spawn-room/native-worker.ts` and `native-worker.test.ts`.
`localnet-journey.test.ts` coordinates those workers and proof submission;
`native-worker-runner.test.ts` checks actual independent launches and refusal
of a missing persisted job. These are conformance helpers, not a replacement
native service or a public API for starting an unconfigured worker.

## Native lifecycle contract

The host supplies the existing `ReferenceAuthority` and `EncryptedSqliteRecords`
implementations, plus the actual resident runtime's seed manifest, verification
key membership commitment and ordered resident IDs. The adapter checks that
binding on preparation and persisted reads; a caller-supplied replacement
membership cannot silently reuse a room.

1. Establish an explicitly visible genesis with the separate key and permanent
   unique marker. Initial policy scores are `[50,50]` and accepted memory is
   empty. Preserve the canonical room binding in private native records.
2. Resolve the native episode and capture its exact original once. The existing
   authority decides acceptance and returns the canonical bounded proposal,
   operation ID and acceptance nonce. The adapter retains the complete original
   JSON, including additional CID/provider fields, without narrowing it to a
   fresh derived summary.
3. `prepare({ binding, room, grantEpoch })` derives and persists one exact private
   grant and successor from the verified predecessor and native authorization.
   Persistence does not mean admission: the leaf still needs membership in the
   live authenticated root for that exact epoch.
4. The native admission service's configured publisher role signs a root update
   only after that exact original and grant are retained. This is the existing
   admission authority's chain role, not a substitute reviewer or a second
   product funding/approval system. Read back the actual current config before
   proving. A changed epoch requires explicit readmission; do not silently
   replace a persisted grant or its original on retry.
5. Build the exact combined application/ring proof and SPP proof. Before
   broadcast, retain the complete signed wire transaction, its signature and
   operation ID, the immutable recovery job, and the pre-submission wallet in
   the existing encrypted store. Submit with a separate local fee payer.
   Ordinary transfers, delegate paths, visible-owner fallback and another
   verifier cannot replace this operation.
6. Recover from a complete confirmed upstream history snapshot. Verify the
   decrypted application state, data hash, owner/ring/domain, enrolled key and
   rebuilt note commitment, plus the expected accepted state. A decoded payload
   alone does not prove inclusion, finality or unspent status.
7. Reconcile an unknown submission outcome using its durable signature. Require
   successful confirmed transaction metadata, the observed slot, and exact
   equality between the saved wire bytes and the ledger transaction returned
   with base64 encoding. Extracting the first signature from saved bytes does
   not authenticate the saved message. Independently bind the recovered note
   to that transaction's ring, slot and published output commitment.
8. `retainConfirmed(operationId, room, observed)` records the exact confirmed
   successor in the existing native receipt contract. A retry validates the
   same authorization, transaction and state against the existing receipt.
   Fresh complete recovery may reach a later `contextSlot`; keep the original
   receipt and record version instead of rewriting its historical observation.
   The adapter's equality check excludes only that changing context slot.
9. On a fresh host process, reopen the encrypted store and signing material,
   reconstruct the wallet, and complete synchronization independently. Load a
   retained original before considering inference, and load an existing
   acceptance before choosing another grant epoch. Check the exact episode
   binding and recovered predecessor state. Return the same operation, grant
   and nonce on completed-job re-entry; do not silently readmit an old grant or
   manufacture a second original to resolve an uncertain outcome.

Keep existing native reservation, funding and reviewer policy at their current
boundary. This profile moves no application assets and uses local validator
funding for transaction fees only. It does not implement a new funding service.
The deterministic fixture requires no provider secret or paid inference. Any
future SPAWN-owned external inference remains subject to the existing
OpenRouter-only policy and separate authorization.

## Separate-process recovery and interruption contract

The proof coordinator and native episode host have distinct roles. The
coordinator may remain running to observe transactions and submit proofs. It
closes its encrypted store and stops its resident runtime before launching a
native episode worker. Each worker is a fresh OS process that imports the
unmodified pinned host, reopens its own store and keys, reconstructs the wallet,
verifies the actual resident binding, and reads the chain independently. No
in-memory room, original, grant, wallet or signing key crosses process IPC.

The live conformance journey requires this sequence:

| Phase | Required behavior and observation |
| --- | --- |
| First native task | A worker recovers the confirmed genesis note, captures and authorizes the first original, prepares its grant, stops the runtime, closes records and exits successfully. Its PID and observed exit are retained. |
| Submission with unresolved native confirmation | The coordinator saves the signed submission and recovery job before broadcasting the first advance. It may observe settlement for test control, but deliberately leaves the native confirmation receipt absent. The saved wallet remains the pre-submission snapshot. |
| Recovery attempt interrupted after receipt | A different worker resolves that saved signature, verifies the exact ledger bytes and actual successor, and checks the same retained original, grant and nonce with zero inference before the next task. It retains the receipt, then the explicit test control throws `spawn_worker_after_receipt_interruption`. Cleanup and a nonzero exit are recorded as a failed attempt. |
| Same-job recovery retry | A fresh process retries the identical encrypted job. It accepts only the exact existing receipt, leaving the full stored record and version unchanged, then executes the later task against the recovered lesson and prepares the next acceptance. |
| Completed-job re-entry | Another fresh process reads the already completed original and acceptance. It returns the identical prepared acceptance and operation ID, with zero additional inference and no new epoch selection or nonce. |

The controlled interruption is an exception after a durable receipt with normal
runtime/store cleanup. It is not evidence of an abrupt OS kill or power-loss
durability. The coordinator's continued existence is recorded explicitly; a
worker restart must not be described as restarting every application process.
Closing and reopening objects inside one process does not satisfy the native
process-restart requirement.

Only the successful recovery and its specific, checked interruption/retry
observations can qualify the journey. An arbitrary transport failure, timeout,
missing worker trace, skipped test or nonzero exit is not a successful restart.
The failed controlled attempt remains failed in its own trace and exit receipt.
The revocation case later uses another independent native worker to prepare a
coherent third update; that proof must succeed in simulation while admitted
and fail after its root/epoch is revoked, preserving accepted revision 2 and
the refused operation's retained original and nonce.

### Durable records and retry identity

These are the conformance host's record keys inside `EncryptedSqliteRecords`;
they are not additional on-chain identifiers or plaintext IPC fields.

| Encrypted record | Contents or invariant |
| --- | --- |
| `spawn-room-v1/writer-seed` | Signing material read independently by each worker. |
| `spawn-room-v1/wallet` | Serialized wallet and recovery checkpoints; updated using the store's versioned replacement. |
| `spawn-room-v1/acceptance/<operationId>` | Exact original, native authorization, canonical old/next state, grant and grant leaf. |
| `spawn-room-v1/submission/first` | The operation ID, signature and complete signed wire transaction saved before broadcast. |
| `spawn-room-v1/process-job/<phase>` | Immutable job identity, resident IDs, expected commitment/revision, observed signature, and prior operation/process identity where applicable. The later episode identity is fixed before recovery. |
| `spawn-room-v1/process-result/<phase>` | Immutable `{ operationId }`; repeated creation must read back the same result. An attempt PID is evidence, not a new semantic operation. |
| `receipt/<operationId>` | Existing native acceptance receipt using `protocolVersion: backrooms.v0` and `artifactVersion: spawn-room.v1`. |

Phases are `first`, `recovery` and `revocation`. A retry creates a new private
attempt directory, while using the same encrypted job/result identity. A
different currently published grant epoch is not permission to rewrite an
existing acceptance. The public adapter retains and returns the previous grant;
the normal live-root/proof check still applies. Native admission policy and any
explicit readmission mechanism remain responsibilities of the authorized
native maintainer.

## Contributor invocation and qualification

Apply the exact published overlay and follow the patched checkout's
`tools/spawn-room-localnet.md` for the exact source pins, toolchains, native
binaries and proving-key prerequisites. Install the pinned npm dependencies in
both the patched Custom Rings checkout and the pinned Backrooms `backrooms/`
directory. Prepare the local application keys/program/prover with
`tools/prepare-spawn-room-localnet.sh` as described in that guide.

From the patched Custom Rings checkout, start the complete journey with:

```sh
node tools/run-spawn-room-localnet.mjs --config /absolute/path/to/localnet-run.json
```

The run config identifies the clean native checkout, the pinned reference-host
directory, the local executable paths, and `disposableLocalnet: true`. The
runner owns validator/service startup and supplies `SPAWN_JOURNEY_CONFIG` and
`SPAWN_REFERENCE_HOST_ROOT` to the journey. The journey launches the native
workers using the same installed Node/Vitest environment, with a fresh fork
per attempt. Service processes and test descendants share the runner's local
network namespace; they do not share a native worker's JavaScript memory.
Do not run an isolated worker as a substitute for the full initialized journey.

For focused checks without starting the validator, use the installed pinned
reference host and run:

```sh
npm exec --workspace @heliuslabs/zolana-custom-rings -- vitest run test/experimental --maxWorkers=1
SPAWN_REFERENCE_HOST_ROOT=/absolute/path/to/backroom-rings/backrooms/reference-host \
  npm exec -- vitest run --config sdk-tests/spawn-room/vitest.config.ts \
  sdk-tests/spawn-room/native-restart.test.ts \
  sdk-tests/spawn-room/native-worker-runner.test.ts --maxWorkers=1
```

The launcher-negative test checks real process creation, distinct retry attempts
and refusal of a missing job. It does not execute successful on-chain recovery.
The separate full validator journey passed successful recovery, a controlled
post-receipt failure, a fresh retry and completed-job re-entry. Use
[APPLICATION-EVIDENCE.md](APPLICATION-EVIDENCE.md) for the observed run and its
remaining qualification gates.

Each full run retains `run-receipt.json`, `journey-evidence.json` and
`vitest-results.json`, plus one `native-process-<phase>-*/` directory per worker
attempt. Each attempt contains `trace.json`, `exit.json`, `worker.log` and its
Vitest result. Inspect distinct worker/coordinator/launcher PIDs, start and exit
ordering, exact saved-wire reconciliation, receipt disposition and retained
original/grant/nonce identities. The trace's `maxRssKiB` is the worker's own
Linux process high-water mark; process-lifetime and task elapsed time have
separate scope labels. They must not be presented as the whole service stack's
instantaneous peak or as production performance measurements.

Keep full worker records, signing keys, wire submissions, logs and encrypted
databases private. Return a reviewed evidence extract with source/artifact
digests and content-safe trace references. Source review, focused tests, actual
proof verification, live chain execution and native product activation remain
separate qualification levels.

## Readiness and UI handoff

The native maintainer should select this profile explicitly in a developer
preview. Enable local actions only for a matching qualified profile with the
expected program, key fingerprints, native runtime binding, reachable local
services and complete recovery. Keep the actual source/toolchain/receipt hashes
with the qualification record.

When those prerequisites are missing, show an actionable blocked state such as
“Start the local validator” or “Finish room recovery.” Do not automatically
switch to a public-owner or ordinary confidential operation. A successful local
fixture must not enable production controls. No Cloudflare or production
configuration is changed by this handoff.

Disclosure details must explain that enrollment and genesis are visible,
normal payer/timing metadata remains public, the designated auditor can inspect
the ring stream, and the native host holds private originals/learning state.
The public-chain hidden-owner property does not establish operator/provider or
network anonymity. Multiple eligible note owners matter; merely registering a
second owner without a live eligible note is insufficient for that fixture.

## Evidence the native maintainer should return

After the remaining independent review and baseline gates pass, use the exact
approved public overlay and qualified key/program digests.
Return content-safe references to the actual native source revision, explicit
profile selection/readiness behavior, create/work/review/remember/restart/reuse
trace, actual proof/chain signatures and recovered revision, and UI checks for
local readiness and blocked states. Separate code review, proof verification,
validator execution and native product activation in those records.

The public conformance sources include coherent circuit/state/grant negatives,
strict request tests, real encrypted payload recovery, original/grant retry
checks, actual native runtime tests and the live-validator journey. Read
[APPLICATION-REVIEW.md](APPLICATION-REVIEW.md),
[SDK-NATIVE-REVIEW.md](SDK-NATIVE-REVIEW.md), and
[NATIVE-WORKER-REVIEW.md](NATIVE-WORKER-REVIEW.md) for the historical independent
scope and limits. The latest indexed-note helper and named live corpus passed
the recorded validator journey but still require final independent review.
Production setup,
independent production cryptographic audit, custody and the stronger
Q06/D08/D09/O06 gates remain separate.
