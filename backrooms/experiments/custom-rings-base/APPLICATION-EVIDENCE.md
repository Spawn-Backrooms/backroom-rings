# Anonymous Backroom application: implementation evidence

This checkpoint contains the implemented combined circuit and dedicated program,
actual generated proofs, strict prover endpoints, cross-language proof checks,
a successful SBF build, and the reviewed SDK/native integration and localnet runner. It supersedes the initial uncompiled two-file
candidate. **The full live validator journey is still pending.** The earlier
composition oracle remains a historical synthetic model, not proof evidence.

The source patch and resulting file digests are in
[fork-overlay/application-core.manifest.json](fork-overlay/application-core.manifest.json).
[APPLICATION-EVIDENCE.json](APPLICATION-EVIDENCE.json) records source pins,
artifact sizes, hashes, full-circuit constraint counts and verification-log
SHA-256 digests. The private requests and large proving keys are not committed.

## Completed checks

| Check | Observed result |
| --- | --- |
| Full combined hidden advance | Actual Groth16 proof generated and verified; 618,360 constraints. Mutating either public input was refused. |
| Full visible genesis | Actual Groth16 proof generated and verified; 594,484 constraints. Mutating either public input was refused. |
| Strict request boundary | Full honest Go witness → JSON → strict server assignment preserved every private/public witness byte and solved the complete relation. Missing, duplicate, unknown, malformed and noncanonical fields are refused by focused schema tests. |
| Actual SDK request construction | Both real TypeScript staging-pipeline requests passed strict decoding, assignment and the entire Go circuit relation (final fixture run: advance 8.71 seconds, genesis 9.00 seconds; exact request hashes retained). This is a circuit solve, not validator settlement. |
| Local HTTP prover | Both application endpoints produced actual proofs verified against their exact keys; wrong-family endpoint requests were refused. |
| Rust proof interoperability | Rust verified both actual Go proof vectors with their two public inputs, compiled keys and BSB22 commitment/proof-of-knowledge handling. |
| Rust regressions | 40 interface tests, 3 program entrypoint tests and 2 actual proof-vector tests passed. Generic and unkeyed application configurations built successfully. |
| Application SBF | Dedicated program built successfully; binary 526,024 bytes, SHA-256 `81e618d960fcb87d5c79b559d3c3fb16ba358ab03657b5c5dabd62fe19b2a19d`. |
| Pristine upstream source baseline | `just check-all` passed against the exact Custom Rings/Zolana pins. Program SBF, prover, Zolana CLI and Photon builds passed; remaining services and validator tests are a separate gate. |
| SDK/native integration | 10 focused SDK tests and 2 real native restart tests passed; SDK/integration type checks and focused lint passed. Independent runner checks passed 3/3. |
| Signed SDK transaction fixtures | Visible genesis: 2,740 bytes and 2 signers. Hidden advance: 2,639 bytes and 1 payer signer; writer/marker absent from decoded accounts. Both fit the pinned 4,096-byte ceiling. These use fixed-size fixture proofs; live execution is separate. |
| Overlay integrity | Patch applied to a temporary Git index at the exact base, and every resulting file matched the manifest. The portable helper also passed its clean-checkout preflight against the untouched baseline. |

Each application circuit has two ordinary public inputs and one private BSB22
commitment. The new keys use a deliberately insecure single-party setup solely
for a local validator. Their identities are pinned separately from upstream
and v0 catalogs; no existing trusted key is replaced.

The first advance proof run proved and verified successfully but failed while
exporting metadata. The corrected export run reloaded the same local key,
compared the complete compiled constraint-system fingerprint, and passed.
Likewise, an interrupted SBF attempt was retained separately; the final recorded
SBF command exited zero. These are completed reruns, not retroactive success
claims for the failed or interrupted attempts.

## What is implemented

- Same-note private state conservation, exact room/writer/domain/membership
  preservation, strict revision increment and bounded learning updates.
- Native grant membership under the currently configured authorization root and
  epoch, exact actor/predecessor/original/candidate/lesson binding, and a private
  full-width acceptance nonce.
- A separate visible genesis proof and permanent unique marker. Hidden advances
  carry no public per-room marker, writer signer or individual grant identifier.
- A dedicated fail-closed program dispatcher, immutable application/network
  configuration, authenticated root updates and mandatory application proof
  verification before SPP settlement.
- Separate strict prover registration, official verifier export and reproducible
  local key/program preparation. Normal upstream prover registration is unchanged.

The completed core received an independent source/composition review with no
established actionable Critical, Important or Minor defect. Read
[APPLICATION-REVIEW.md](APPLICATION-REVIEW.md) for the reviewed properties and
limits. This is not a formal proof of soundness or a production security audit.

## Reviewed SDK/native integration and pending live execution

The complete 52-file patch now includes the experimental SDK, native adapter,
focused tests and same-parent localnet runner. Local codec, recipient encryption,
request/frame, encrypted-record restart and deterministic seeded Flue reuse
checks passed. The actual host retains the original result and acceptance nonce
across restart without rerunning a completed episode. It then uses the accepted
lesson to switch from procedure 0 (value 9, scores `[40,50]` after feedback) to
procedure 1 (value 5, scores `[40,60]` after the next acceptance).

[SDK-NATIVE-REVIEW.md](SDK-NATIVE-REVIEW.md) records the independent review. Three
Minor findings were fixed: source provenance for new files/submodules/native
host, native retry receipt protocol compatibility, and the reported lesson
actually used. No outstanding Critical or Important defect was established.

The live runner must still settle and recover real notes for two independently
enrolled writers, then execute the primary create/hidden-advance/restart/reuse
journey. It requires a single payer signer with no explicit writer/room-marker
account in the entire hidden transaction. It also requires ledger-confirmed
duplicate genesis, generic bypass, replay and revoked-grant failures, unchanged
accepted note/account snapshots, and retained originals/grants. The revocation
test must first successfully simulate its coherent proof before removing its
live admission. These are implemented test requirements, not claimed validator
results. Source files are frozen during execution for before/after manifests.

The complete upstream Go suite is running with an explicit 60-minute package
timeout and constrained parallelism after a resource-limited run hit Go's default
600-second timeout. The policy package has now passed in 1,310 seconds under that explicit timeout; no complete-suite pass is claimed yet. The two specifically
named upstream anonymous validator cases also remain pending; build success or
an empty/skipped test selection cannot satisfy them.

## Privacy and authority boundaries

Enrollment and genesis are visible. Global application configuration and
root/epoch changes, fee payer, timing and normal chain metadata remain public.
The native host holds originals and private learning records; the designated
auditor can read the ring stream. Multiple eligible owners and operational
metadata handling still matter. A fixture does not establish anonymity against
every observer.

The root publisher admits a particular grant. The proof establishes exact
membership and transition constraints, not the external truth of the original
result. SPP binds owner authorization to encrypted external data, preventing an
untrusted prover/relay from substituting it after authorization. An authorized
malicious writer can still damage its own recoverability; availability and
correct client sealing are separate responsibilities.

No production configuration, deployed service, paid inference or real funds are
used by this checkpoint. The current fork write permission remains unavailable
(`push: false`; branch-create HTTP 403), so the exact source patch is carried in
this writable repository while review proceeds.
