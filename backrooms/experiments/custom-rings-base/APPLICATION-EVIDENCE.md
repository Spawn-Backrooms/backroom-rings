# Anonymous Backroom application: implementation evidence

This checkpoint contains the implemented combined circuit and dedicated program,
actual generated proofs, strict prover endpoints, cross-language proof checks,
and a successful SBF build. It supersedes the initial uncompiled two-file
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
| Actual SDK request construction | Both real TypeScript staging-pipeline requests passed strict decoding, assignment and the entire Go circuit relation (advance 6.67 seconds, genesis 5.34 seconds). This is a circuit solve, not validator settlement. |
| Local HTTP prover | Both application endpoints produced actual proofs verified against their exact keys; wrong-family endpoint requests were refused. |
| Rust proof interoperability | Rust verified both actual Go proof vectors with their two public inputs, compiled keys and BSB22 commitment/proof-of-knowledge handling. |
| Rust regressions | 40 interface tests, 3 program entrypoint tests and 2 actual proof-vector tests passed. Generic and unkeyed application configurations built successfully. |
| Application SBF | Dedicated program built successfully; binary 526,024 bytes, SHA-256 `81e618d960fcb87d5c79b559d3c3fb16ba358ab03657b5c5dabd62fe19b2a19d`. |
| Pristine upstream source baseline | `just check-all` passed against the exact Custom Rings/Zolana pins. Program SBF and prover builds passed; remaining native services and validator tests are a separate gate. |
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

## Integration still being qualified

The experimental SDK/native adapter has passed local codec, encryption,
request/frame, encrypted-record restart and deterministic seeded Flue reuse
checks. Those integration files are still being finalized and independently
reviewed and are not part of this core-only checkpoint. The live runner must
settle a real genesis and hidden advance, recover the note that actually landed,
restart the native host and wallet, use the retained lesson to change the next
procedure, and settle the next authorized advance. On-chain refusal and atomic
rollback evidence remain required as well.

The complete upstream Go suite is running with an explicit 60-minute package
timeout and constrained parallelism after a resource-limited run hit Go's default
600-second timeout. No complete-suite pass is claimed yet. The two specifically
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
