# Anonymous Backroom application: implementation evidence

**The application is implemented, but the full local-validator preview is not
qualified yet.** Real combined proofs, the dedicated SBF program, strict prover
endpoints, SDK/native integration and the complete journey runner exist. The
second actual validator attempt created and recovered two eligible room notes
and confirmed a duplicate-genesis refusal; it then failed in the first native
worker. No completed hidden-update/restart/reuse journey is claimed.

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
| Signed SDK transaction fixtures | Visible genesis: 2,740 bytes and 2 signers. Hidden advance: 2,639 bytes and 1 payer signer, with no explicit writer or room-marker account in the decoded message. Both fit the pinned 4,096-byte ceiling. These measurements use fixed-size fixture proofs; actual visible genesis also matched its size/signers. |
| Pristine upstream checks/builds | `just check-all`, all eight native build stages and `just test-hermetic` passed at the exact clean source pins. The three hermetic nextest groups reported 149/1,497/40 passes and 0/33/4 canonical default skips. Both exact upstream anonymous-validator cases also passed with full command exit 0. Complete upstream Go coverage remains incomplete. |
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

Both attempts recorded unchanged source and completed cleanup of all five
owned service groups. Their measured durations, including sampled cleanup,
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
in the 18 passing SDK tests. **The latest helper and expanded live corpus have
not completed independent review or a passing full validator run.**

## Implemented journey still requiring execution

The runner requires one complete create/hidden-update/restart/reuse sequence
with two independently enrolled writers and two actually settled eligible
notes. Hidden transactions must contain only the payer signature and no explicit
writer or stable room-marker account. The first native episode runs in a fresh
OS process, persists the original and exact grant, closes its records and exits.

Before broadcasting the first update, the coordinator persists its complete
signed submission, immutable recovery job and pre-submission wallet. A different
native process must independently reconcile the exact ledger bytes and slot,
recover the accepted successor and retain the same original, grant and nonce
without inference. The journey deliberately throws after durable confirmation,
then retries the same job in another fresh process and checks the complete
receipt and its stored version remain unchanged. Completed-job re-entry must
return the identical operation and acceptance with zero additional inference.
The coordinator continues running; this controlled exception with cleanup does
not establish abrupt OS-kill or power-loss durability.

Actual seeded Flue off-chain execution already demonstrates the bounded lesson
transition: procedure 0 yields value 9 and accepted scores `[40,50]`; the retained
lesson makes the later episode choose procedure 1, yielding value 5 and proposed
next scores `[40,60]`. The full live journey must still settle and recover both
accepted updates using that native flow.

In addition to duplicate genesis, the implemented validator corpus includes
generic transfer/authority/merge/delegate bypass attempts, replay and a revoked
third grant. The third proof must first simulate successfully while admitted.
The latest added cases cover a wrong application-config account, wrong ring
policy account, unapproved settlement program, wrong operation key, reordered
audit frame, peer-room input, substituted bound output and substituted ciphertext.
Each case requires its exact ledger failure and unchanged accepted state; an
off-chain solver refusal does not satisfy that requirement. Except for the
duplicate-genesis result above, these cases have no completed live pass in this
checkpoint. This named set does not establish every variant in the broader
CR02/CR04 acceptance bullets.

Use [QUICKSTART.md](QUICKSTART.md) for source preparation and invocation, and
[NATIVE-ADAPTER-HANDOFF.md](NATIVE-ADAPTER-HANDOFF.md) for the native persistence,
retry, process and product-readiness contracts.

## Review and baseline gates

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

CR01 also remains incomplete. Fifteen of 18 upstream Go packages now have retained terminal coverage: nine
test packages passed and six explicitly reported no test files. Transfer, ring
and ringtest remain incomplete. The latest transfer-package attempt ended with
`signal: killed` after 130 passing test events; its package command exited 1,
and the cause of the kill is not established. The original default-timeout and
interrupted extended whole-suite attempts remain recorded. Neither partial
results nor completed builds establish a whole-suite pass. Both exact upstream
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
