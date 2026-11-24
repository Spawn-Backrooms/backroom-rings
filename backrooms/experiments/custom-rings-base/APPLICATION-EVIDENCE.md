# Anonymous Backroom application: implementation evidence

**The full application journey passed on the real local validator.** The third
attempt completed all 25 recorded steps, including two eligible room notes,
hidden updates, fresh-process recovery, interrupted-confirmation retry, retained
lesson reuse and 15 ledger-confirmed refusals. The command exited zero with one
executed Vitest test, no failures or pending tests, unchanged source and complete
cleanup. Final independent review, broader conformance and native
product activation are still separate gates. This is a recorded localnet pass,
not final preview release approval.

This checkpoint contains **59 source files** in the portable overlay. Its patch
SHA-256 is
`2400c9e3020c1655a448507b9e7fca77e74cc7e4b426e12a7aec58011e730462`.
The exact base commits and every resulting file digest are in
[fork-overlay/application-core.manifest.json](fork-overlay/application-core.manifest.json).
[APPLICATION-EVIDENCE.json](APPLICATION-EVIDENCE.json) records the artifact
identities, execution results and outstanding gates. The earlier synthetic
composition oracle and initial uncompiled two-file candidate are historical
checkpoints, not proof or validator evidence.

## Completed checks

| Check | Observed result |
| --- | --- |
| Full combined hidden advance | Actual Groth16 proof generated and verified; 618,360 constraints. Changing either public input was refused. |
| Full visible genesis | Actual Groth16 proof generated and verified; 594,484 constraints. Changing either public input was refused. |
| Application Go coverage | All 14 non-opt-in `TestSpawnRoom*` functions have terminal passing evidence, with the two separately named strict request functions also covered. The selected state gate passed 5 top-level functions and 57 subcases: 7 positive cases and 50 refusals, with no skips/failures and unchanged prover source. |
| Strict request boundary | Full honest Go witness → JSON → strict server assignment preserved every private/public witness byte and solved the complete relation. Focused tests refused missing, duplicate, unknown, malformed and noncanonical fields. |
| Actual SDK request construction | Both real TypeScript staging-pipeline requests passed strict decoding, assignment and the entire Go relation. The final fixture run took 8.71 seconds for advance and 9.00 seconds for genesis; exact request hashes are retained. This establishes circuit solving, not validator settlement. |
| Local HTTP prover | Both application endpoints produced actual proofs verified against their exact keys; wrong-family endpoint requests were refused. |
| Rust proof interoperability | Rust verified both actual Go proof vectors, including their two public inputs and BSB22 commitment/proof-of-knowledge handling. |
| Rust regressions | 40 interface tests, 3 program entrypoint tests and 2 actual proof-vector tests passed. Generic and unkeyed application configurations built successfully. |
| Application SBF | Dedicated program built successfully: 526,024 bytes, SHA-256 `81e618d960fcb87d5c79b559d3c3fb16ba358ab03657b5c5dabd62fe19b2a19d`. |
| Latest SDK/native checks | 18 focused SDK tests and 3 off-chain native/worker-launcher tests passed, with zero failed/pending tests. SDK and integration type checks and focused lint passed. These checks do not establish on-chain recovery. |
| Localnet runner | A fresh focused run passed all 5 runner tests, with zero failed/cancelled/skipped tests. The runner, monitor and test files also match the earlier independent worker/resource review's frozen file digests. |
| Actual signed transactions | The passing live run matched the earlier fixture sizes. Visible genesis was 2,740 bytes with 2 signers. Both hidden updates were 2,639 bytes with 1 payer signer and no explicit writer or stable room-marker account in the decoded message. All fit the pinned 4,096-byte ceiling. |
| Full application validator journey | `journey-KXteXY` passed all 25 steps and its one unskipped Vitest test. Both hidden updates settled; fresh native processes recovered the first accepted update, retried an interrupted confirmation and reused the retained lesson for the second update. All 15 named refusal transactions failed as expected without changing accepted state. |
| Pristine upstream checks/builds | `just check-all`, all eight native build stages and `just test-hermetic` passed at the exact clean source pins. The three hermetic nextest groups reported 149/1,497/40 passes and 0/33/4 canonical default skips. Both exact upstream anonymous-validator cases also passed with full command exit 0. All 18 upstream Go packages now have fresh verified terminal evidence. |
| Overlay integrity | The patch applied to a temporary Git index at the exact base and every resulting file matched the manifest. The portable helper passed its clean-checkout preflight against the untouched baseline. |

The ten complete, content-safe application Go logs and their exact hashes are
published under [evidence/application-go/](evidence/application-go/). Their
[manifest](evidence/application-go/manifest.json) distinguishes request/circuit/
proof execution from chain settlement. Private witness requests and large
proving keys are not committed.

The latest SDK, native and harness terminal logs and receipts are published in
[evidence/focused-checks/](evidence/focused-checks/), with a hash manifest. These
focused checks retain their off-chain and runner-only scopes.

Each application circuit has two ordinary public inputs and one private BSB22
commitment. The separate application keys use an explicitly insecure
single-party setup solely for a local validator. They replace neither the
upstream catalog nor the existing v0 artifacts.

Earlier failed and interrupted attempts remain part of the record. The first
advance proof verified but its metadata export failed; the successful export
rerun reloaded the same key and compared the entire compiled constraint-system
fingerprint. An interrupted SBF attempt is also retained separately from the
later command that exited zero.

## Actual validator attempts

| Attempt | Observed chain progress | Terminal result |
| --- | --- | --- |
| `journey-y16s2B` | Setup and visible genesis confirmed at slot 365; genesis was 2,740 bytes with two signers. | **Failed** while recovering primary revision 0, before the peer room was created. Fresh viewing history had omitted application-ring registration. |
| `journey-Xcz1rl` | Primary genesis confirmed at slot 343; the second eligible room confirmed at slot 427; both room notes were recovered. Duplicate genesis failed on the ledger at slot 429 with the expected error and unchanged accepted account/note snapshots. | **Failed** in the first native worker's indexed-transaction binding check. The pinned by-signature Photon query did not return ring metadata. |
| `journey-KXteXY` | Primary genesis confirmed at slot 321 and the second eligible room at slot 385. The first hidden update settled at slot 615. Fresh native processes recovered its exact accepted state and retained records. The later task used the retained lesson and settled the second hidden update at slot 711. All 15 named refusal transactions passed their expected-failure checks; revoked admission at slot 798 retained accepted revision 2. | **Passed**, 25/25 steps, one executed Vitest test, zero failures/pending tests and supervisor exit 0. |

The two earlier failed attempts recorded unchanged source and completed cleanup
of all five owned service groups. Their measured durations, including sampled cleanup,
were 395.518 and 193.003 seconds. Sampled concurrent owned-process RSS peaks
were 2,291,320 and 2,860,316 KiB respectively. These are measurements of failed
attempts using periodic `/proc` sampling; they are not whole-journey performance
qualification or exact instantaneous memory peaks.

The first recovery correction adds `.withRing(ringProgramId)` to each fresh
viewing history. An actual encrypted-output regression reproduced the omission
and then recovered the exact state after registration and wallet reopen; that
correction received an independent source review. The later worker correction
uses a ring-aware, slot-bounded indexed-note query and checks complete coverage,
transaction identity, ring and commitment. Its eight focused tests are included
in the 18 passing SDK tests. The third complete validator run passed with both
corrections. **The latest helper and expanded live corpus still lack a completed
independent review.**

## Observed create, recovery and reuse

The passing run used two independently enrolled writers and two actually
settled eligible notes. Both hidden transactions contained only the payer
signature and no explicit writer or stable room-marker account. The first
native episode ran in worker PID 468, persisted its original and exact grant,
closed its encrypted records and native runtime, and exited successfully before
the recovery workers started.

Before broadcasting the first update, the coordinator retained its complete
signed submission, immutable recovery job and pre-submission wallet. Recovery
worker PID 528 reconciled the exact ledger bytes and slot and persisted the
confirmation receipt. It then exited 1 after the deliberate post-receipt
exception. A fresh retry in PID 575 recovered revision 1 with complete index
coverage, retained the same original, grant and nonce, and left the durable
receipt and its stored version unchanged. Confirmation recovery invoked no
inference. Another fresh process, PID 622, re-entered the completed job with
zero repeated inference calls and identical original, grant, nonce and receipt.
All five observed native worker attempts stopped their runtime and closed their
records. The coordinator remained running; the controlled exception does not
establish abrupt OS-kill or power-loss durability.

The actual seeded Flue execution settled its bounded lesson transition on the
validator. Procedure 0 produced value 9 and accepted scores `[40,50]`. The
retained lesson, "Sort inputs before selecting the median.", made the later
episode choose procedure 1, which produced value 5 and accepted scores `[40,60]`.
The later native task and second settlement used that retained lesson.

The run confirmed all 15 named refusal transactions on the ledger. These cover
duplicate genesis, four generic transfer/authority/merge/delegate bypasses,
replay, a revoked third grant, a wrong application-config account, a wrong ring
policy account, an unapproved settlement program, a wrong operation key,
reordered audit data, a peer-room input, a substituted bound output and substituted
ciphertext. Each recorded the expected instruction error and unchanged accepted
account, wallet-note and peer-room snapshots. The third proof first simulated
successfully while admitted; after revocation, its refusal retained accepted
revision 2 and the original and nonce for pending revision 3. This executed
named set does not establish every variant in the broader CR02/CR04 acceptance
bullets or replace independent conformance review.

The [public live evidence](evidence/spawn-room-live-pass.json) retains synthetic
transaction identities, exact slots and errors, unchanged-state snapshots,
separate worker exits and source/key/program identities. Its
[reading guide](evidence/spawn-room-live-pass.md) describes the measured scopes.
The authoritative private run receipt has SHA-256
`2733c25234cbc478d1ef186274dbb3fa5a83d7dea7507d6a5a46ec8764dfb7cd`.
The extract does not publish signing material, private witness requests,
encrypted jobs or databases.

The harness measured itself, its owned services and observed descendants for 331.313
seconds, including cleanup. It took 1,322 samples at a 250 ms interval and
observed 35 process records. The sampled concurrent RSS peak was 4,145,344 KiB.
The separate outer supervisor command took 334.208 seconds and is outside that
memory scope. No `lastSamplingError` field was present in the recorded resource
data. Sampling may miss short-lived peaks, and shared pages can be counted more
than once. These are measurements of this local run, not an exact instantaneous
process-tree peak or production performance qualification.

Use [QUICKSTART.md](QUICKSTART.md) for source preparation and invocation, and
[NATIVE-ADAPTER-HANDOFF.md](NATIVE-ADAPTER-HANDOFF.md) for the native persistence,
retry, process and product-readiness contracts.

## Public CR05 readiness contract

The [native preview package](native-preview/README.md) now supplies the explicit
anonymous localnet profile, ordered readiness blockers, action labels, privacy
disclosures, and a digest-only maintainer return envelope. The descriptor pins
the existing public source, program, proving keys, and seeded runtime. This
package sits outside the unchanged 59-file application overlay.

The [execution evidence](native-preview/evidence/README.md) records **16 passing
behavior tests and 47 passing synthetic fixtures**, with zero failures or skips.
One fixture exercises the ready display. A direct call with constructed matching
host observations still reports CR02, CR03, CR04, and native integration as open;
optimistic references and synthetic inputs cannot upgrade that policy. All
results retain display-only capabilities, with native activation and production
availability false.

The generated descriptor is byte-identical to its source. Eight artifact
identities and both runtime commitments match the existing public application
records. The exact commands, raw outputs, source hashes, and corrected attempts
are retained in the evidence packet. This work adds display-contract checks;
it does not add proof execution, validator evidence, independent application
acceptance, or native host/UI activation.

## Review and baseline gates

The [acceptance status map](ACCEPTANCE-STATUS.md) links all five CR02 and four
CR04 acceptance bullets to the existing records and names the portions not yet
established. The 15 live refusals cover the named cases in this run; broader
conformance and final independent acceptance remain open.

[APPLICATION-REVIEW.md](APPLICATION-REVIEW.md),
[SDK-NATIVE-REVIEW.md](SDK-NATIVE-REVIEW.md) and
[NATIVE-WORKER-REVIEW.md](NATIVE-WORKER-REVIEW.md) preserve the independent reviews
of their earlier source checkpoints. The worker/resource review corrected
exact-signed-wire confirmation and post-receipt retry findings. Those completed
reviews do not approve the latest indexed-note helper or expanded live corpus.

Automated content review rejected the requested final independent review,
including a narrower read-only recovery review, citing possible cybersecurity
risk. That review remains blocked; the rejection itself establishes no code
finding. Daybreak setup can see the repository and GitHub connection, but
reported `credits_exhausted` and no Cloud environment containing this repository.
**No Daybreak scan has launched.** Any eventual scan must cover the exact applied
overlay, rather than treating a scan of the unmodified base as review of this
profile. This checkpoint carries no final independent sign-off or merge approval.

CR01 has complete fresh Go package coverage. The [fresh qualification packet](https://github.com/Spawn-Backrooms/backroom-rings/blob/25439b26fcbaa1d938ea2be4c23b7ced132037ec/backrooms/experiments/custom-rings-base/evidence/go-requalification/README.md)
contains verified terminal evidence for **18/18 whole packages**: 12
passing test packages and 6 packages explicitly reporting no test files.
The [machine-readable summary](https://github.com/Spawn-Backrooms/backroom-rings/blob/25439b26fcbaa1d938ea2be4c23b7ced132037ec/backrooms/experiments/custom-rings-base/evidence/go-requalification/summary.json) records every exact unfiltered
command, complete raw-log digest, terminal exit and unchanged clean source pins.
Default fixture/service/population opt-ins remain unset, with named skips retained.

The [recovery checkpoint](https://github.com/Spawn-Backrooms/backroom-rings/blob/25439b26fcbaa1d938ea2be4c23b7ced132037ec/backrooms/experiments/custom-rings-base/evidence/go-recovery-checkpoint/recovery-checkpoint.md) preserves the prior history. Public
summaries had recorded 15/18 and later local observations reached 17/18, but the
unpublished working files became unavailable before the final ring result was
observed. The final old ring attempt has no recovered terminal receipt. Those
historical summaries receive no credit in the fresh qualification. Each completed
package is now checkpointed before the next long package.

The actual one-hour transfer timeout remains preserved with full JSONL SHA-256
`eba591fb26ef6a9ef772f93c6195346dd928897d1e0c3f0f9ae993a599f4c234`.
The larger proof packages retain the recorded 180-minute ceiling, two already-
allowed CPUs, `GOMAXPROCS=1`, `GOMEMLIMIT=1GiB`, `GOGC=25` and bounded test
parallelism. The ceiling is not a runtime estimate. Earlier interrupted and killed
attempts remain historical; the underlying cause of the earlier kills is not
established. This qualification does not close independent review, broader CR04
acceptance or native activation gates.

Both exact upstream
anonymous-validator cases passed at unchanged clean source pins. The hidden-sender
policy case took 137.717 seconds, and the owner-hiding/auditor case took 270.612
seconds. The full recipe exited zero after 495.928 seconds. Its exact log SHA-256
is `15c4fb7fb095239398bdf19a9a75cf4256ee597c215ccf774140b1592a5c183b`.
The deliberate filter ran the two required cases and excluded 59 other cases. See the separate
[baseline PR](https://github.com/Spawn-Backrooms/backroom-rings/pull/38).

## Privacy and authority boundaries

Enrollment and genesis are visible. Global application configuration and
root/epoch changes, fee payer, timing and normal chain metadata remain public.
The native host holds originals and private learning records; the designated
auditor can read the ring stream. Two eligible local owners are a limited
fixture, not a general unlinkability guarantee.

The root publisher admits an exact grant. The proof establishes membership and
transition constraints, not the external truth of the original result. SPP
binds owner authorization to encrypted external data, preventing substitution
by an untrusted prover/relay after authorization. An authorized writer can
still damage its own recoverability; availability and client sealing remain
separate responsibilities.

This work uses deterministic inference and local validator funding. It changes
no production configuration or deployed service. The Custom Rings fork remains
read-only to the active integration (`push: false`; branch-create HTTP 403), so
the exact source patch is carried in this writable repository. Native product
activation, production setup and the stronger privacy gates remain separate.
