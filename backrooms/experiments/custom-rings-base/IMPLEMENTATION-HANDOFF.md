# Anonymous Backroom application implementation handoff

> Historical design/review checkpoint. The implemented profile and current verification status are recorded in [APPLICATION-EVIDENCE.md](APPLICATION-EVIDENCE.md), [APPLICATION-REVIEW.md](APPLICATION-REVIEW.md) and [fork-overlay/README.md](fork-overlay/README.md). Statements below about unavailable tools or unimplemented components describe that earlier checkpoint.

Status: source-grounded design, not implemented or cryptographically qualified.
Custom Rings source is pinned to `02bca33729051798834ecbb4d94e968cdc0ef9b8`;
existing Backrooms source is pinned to `08822c65254cd73c5f2dccbdf182ce1df2c7510a`.
No new circuit, artifact, deployment or authority configuration is created by this document.

## Selected implementation direction

Use a dedicated versioned application ring with separate visible genesis and hidden
advance operations. Compile application constraints together with the upstream
transfer constraints, using the same note wires. This gives one combined
ring/application proof and the existing SPP proof. It does not reuse an upstream
transfer verifying key or any v0 Backroom key.

The combined circuit should preserve the upstream public input and add a second
application statement hash. `TransferCircuit.Sections.PublicInputHash` is already
public. Calling `TransferCircuit.Define` constrains it to the upstream statement.
Replacing that field with an application hash after calling `Define` is incorrect.
The Rust `RingProof` currently passes exactly `&[self.statement]` to
`Groth16Verifier::new_with_commitment`; a distinct verifier must pass the two public
inputs in the actual Gnark witness order and use the new verifying key.

The program derives the first public input with the existing validated frame and
live policy/tracking accounts. It derives the second from:

- a new application-statement domain and fixed schema;
- deployment/network identifier and actual application/ring program identity;
- the first, upstream statement hash;
- the current application authorization root and its epoch/revision, read from a
  canonical program-owned application configuration account;
- the pinned application circuit/artifact version;
- the exact element count as the statement close.

Do not publish room identity, writer identity, predecessor commitment, grant leaf,
resident IDs or a stable per-room account in the hidden-advance statement.
The note commitment and transaction already provide the binding these private
values need. A public hash of an unblinded stable room identity remains a stable
identifier; it does not fix the disclosure.

## Private state codec and transition

Create a new state type and codec; do not reinterpret `RoomStateV0` or modify its
key material. The codec must have one exact field order, no optional or ignored
bytes, and an exact decoded length. Arbitrary SHA-256 digests must retain all 256
bits: encode as bytes or two range-checked 128-bit limbs, not by reduction into a
single BN254 scalar. Circuit scalar commitments require a canonical integer below
the field modulus. Rust and Go must share golden byte and field-order vectors.

The private state needs the following values, retaining v0 semantics:

| Field | Constraint |
| --- | --- |
| Schema and deployment/network binding | Equal the new profile constants/live app configuration. |
| Creation nonce and private room identity | Genesis establishes them; advances preserve them. Room identity includes the writer and application domain. |
| Seed manifest and fixed-member commitments | Preserved exactly on every advance. |
| Writer identity | Equals the owner identity of the real input note; output owner equals input owner. |
| Authorization epoch | Consistent with the current live authorization configuration and the consumed grant. |
| Revision | Canonical u64; old revision is below `2^64 - 1`; successor equals old plus one. |
| Accepted memory | Lesson has 96-byte capacity, length in `1..96` on advance, scope zero, zero suffix; binds episode, original-result and candidate digests. |
| Learned policy | ID one, two integer scores in `0..100`; selected procedure is zero or one, feedback magnitude is `0..10`, sign is boolean. |
| Predecessor | Equals the actual input note commitment. |
| Authorization commitment | Equals the proven active grant's domain-separated commitment. |

Open `oldState` against `Inputs[0].DataHash` and `newState` against
`Outputs[0].Output.DataHash`, using the same constrained openings the ring and SPP
transaction hash bind. Hold ring-specific data to a specified fixed encoding
(zero in a profile that does not use it). A separately supplied old note or state
hash is not a substitute for this equality.

Keep exactly one real input and one real output. All other shape slots must be
canonical dummies. The counts and address chain need exact constraints appropriate
to the actual chosen SPP shape; a list of dummy witnesses alone does not establish
the published counts. Require zero amounts, same asset/owner/nonzero enrolled
nullifier key, no exit, no address operation, no public asset legs, no voucher,
hidden-owner authorization, and no public owner signer run. Refuse the public
zero-secret nullifier key as well as literal zero.

For policy learning, update only the selected score:
`next = min(100, old + magnitude)` for positive feedback and
`next = max(0, old - magnitude)` for negative feedback. Bound every arithmetic
operand before comparison; modular field subtraction is not integer comparison.

## Native grant and revocation boundary

Existing v0 `AcceptanceGrant` is a commitment, not an independently signed grant.
V0 authorization ultimately uses the public writer's Solana signature. Its
`ReferenceAuthority` preserves originals and grants in a private CAS record store.
Removing the public writer check therefore requires an explicit replacement.

SPP's hidden-owner signature supplies note ownership. It does not establish that
the native authority currently approves one particular original result. To meet
the stated current-grant/revocation acceptance cases, introduce an authenticated
authorization set whose root is read live by the dedicated application program.
Recommended minimal relation: a private grant leaf plus membership proof under
that current root. The leaf binds application/deployment, private room identity,
admitted actor, epoch, exact predecessor, ordinal, complete accepted memory,
procedure/feedback, and a fresh private acceptance nonce. The native authority
publishes authorized root changes and persists one original before inserting a
leaf. Root updates must be authenticated and independently reviewed.

The hidden circuit proves grant membership, the current epoch, equality between
the grant actor/state writer/input owner, and all transition fields. Revocation
removes a leaf or changes the applicable epoch. This first profile must reject
stale authorization roots rather than borrowing upstream policy-root grace.
SPP consumes the exact predecessor; together with unique genesis and a grant bound
to room/predecessor/ordinal, that prevents reusing the grant for a second advance.
It does not prove that the native authority captured the correct real-world
original; that remains the authority service's authenticated persistence duty.

An authenticated root is a proposed new integration, not an existing Custom Rings
feature. If a signed-grant alternative is chosen, live revocation and epoch checks
still need a program-owned current source. A prover-supplied `active=true`, epoch,
authorization commitment, or signature by an unpinned key cannot provide it.

## Visible genesis and exclusion of bypasses

The upstream hidden-owner rail requires a live input, so genesis is explicit and
visible. A distinct genesis key establishes zero revision, empty memory, scores
`[50, 50]`, authorized writer/fixed membership and the zero-value room output.
Create a canonical one-time marker derived from application domain and creation
identity in the same atomic operation. Refuse an existing marker, never close it,
and bind the creation proof's private state to that identity. Advances must not
include this per-room marker in their public account lists.

The exact zero-value genesis SPP shape still requires a real qualification run.
The ring circuit does not open SPP addresses; do not assume v0
`UniqueDataUtxo::new_init` can be inserted unchanged into this custom ring.

The dedicated application dispatcher must refuse ordinary transfer,
authority/delegate transfer, merge, permanent-delegate setup, unrestricted
deposit and any generic operation that can mint, consume or replace application
notes. Genesis and advance are the only settlement entrances. Upstream account
validation, proof validation and the single placed `ring_auth` CPI remain intact.
Application-configuration and authorization-root updates need their own explicit
access checks and cannot select arbitrary verifier keys or remove constraints.

## Recovery and public metadata

The v0 bridge uses the writer as transaction fee payer and only signer, and scans
a stable confidential authority view tag. Both require migration. Use the pinned
upstream hidden-owner client recovery path and a distinct payer for the anonymous
profile. Preserve the frozen scan watermark, complete pagination before accepting
an unspent successor, reject multiple live room checkpoints, and preserve
prepared transactions/originals/grants across process restart. A local private
room identifier may remain in the host's encrypted records; it must not leak into
the public transaction or diagnostic output.

Auditor and prover visibility remain explicit limitations. A distinct payer and
hidden witness do not establish protection against host, auditor, provider or
network metadata observation.

## Small, meaningful qualification vectors

These are required expected behaviors, not executed proofs:

| Case | Expected |
| --- | --- |
| Revision 0, scores `[50,50]`, select 0, positive 7 | Revision 1, scores `[57,50]`; exact grant memory accepted. |
| Scores `[97,50]`, select 0, positive 10 | Scores `[100,50]`. |
| Scores `[50,3]`, select 1, negative 10 | Scores `[50,0]`. |
| Old revision `18446744073709551615` | Refuse overflow. |
| 96-byte lesson, length 96 | Accept if all other constraints hold. |
| 97-byte lesson, nonzero byte after claimed length, scope 1, magnitude 11 | Refuse each independently. |
| Coherently recomputed note with changed seed, member set, writer or room identity | Refuse immutable-state change, even when note hash is otherwise valid. |
| Valid ring/SPP witness with a different old/new `DataHash` than app state | Refuse same-note binding. |
| Valid grant at prior root or epoch, removed current grant, changed original/candidate/procedure | Refuse current authorization. |
| Generic upstream transfer proof on new operation | Refuse under distinct combined verifying key. |
| Ordinary/authority transfer, merge, duplicate genesis, public-owner selection, zero public no-op leg | Refuse at dispatch/profile checks; no application state change. |
| Valid operation followed by process restart | Recover exactly the accepted successor and original; later learning reads that memory. |

Test mutations must be coherent: recompute dependent hashes/witnesses so a failure
tests the intended predicate, not merely a stale fixture hash. Verify actual
public-input ordering with a real generated proof and the Rust verifier. Perform
validator rollback checks by reading chain state before and after refusal.

## Minimal source surfaces

Existing behavior reference:

- `backrooms/program/src/circuits/{state,create_room,advance_room}.rs`
- `backrooms/program/src/instructions/{mod,shared}.rs`
- `backrooms/program/src/bin/bridge.rs`
- `backrooms/reference-host/authority.ts`
- `backrooms/client/{contracts,learning}.ts`

New custom-ring integration:

- `prover/circuits/transfer/transfer.go` and additive application circuit files;
- `prover/ring/{ring,keys,params,assign}.go` for constructor/witness registration;
- separate artifact lock/catalog/export for the new two-input keys;
- `program-libs/interface/src/proof/{statement,key_catalog,verification}.rs` plus
  new application codecs/configuration, without changing existing key behavior;
- `programs/custom-ring/src/{lib.rs,instructions/transfer/{processor,verify}.rs}`
  in a distinct application program/profile and its root/genesis administration;
- SDK transaction/witness builder, hidden scan/recovery adapter, local validator
  demo and negative integration cases.

Source basis: the pinned files above, upstream
`docs/design/proof-composition.md`, `prover/circuits/shared/utxo.go`,
`prover/circuits/transfer/shapes.go`, and
`programs/custom-ring/src/instructions/runtime/instruction_runtime.rs`.

## Gates still requiring concrete implementation decisions

1. Exact new state field/byte codec and hash order, with shared Rust/Go vectors.
2. Authenticated native grant root ownership, current-epoch meaning and updates.
3. Exact visible zero-value genesis shape and permanent unique-marker lifecycle.
4. New two-public-input proving/verifying artifacts and program-side key selection.
5. Actual pinned hidden scan/payload codec and relay/payer integration.

These cannot be validated by the synthetic fact oracle or the existing note-pair
helper test. A networked pinned toolchain and writable fork are still required
for implementation, artifact generation and full validator qualification.
