# Backrooms privacy and acceptance contract

Backrooms uses Rings to carry accepted private room state. A room can retain a
lesson, apply a bounded learning rule, and recover that state for a later agent
episode. The application proof checks the state transition. The execution host
decides which original result and feedback it authorizes.

## Who can read content

| Component or observer | Visibility |
| --- | --- |
| Room participant | Content its accepted role and scope permit it to retrieve. |
| Authorized execution host | Content it decrypts to execute the episode. |
| Local application prover | Private inputs used to construct the application proof. |
| Inference provider | The content sent in the admitted request. The public example uses a deterministic local model fixture. |
| Ciphertext store | Encrypted bytes and object metadata. |
| Chain and indexer | Transaction metadata, accepted commitments, ciphertext, and identifiers exposed by the selected confidential path. |

This profile does not provide operator-blind execution or traffic anonymity.
A remote prover that receives private inputs joins the trusted execution
boundary. Stronger execution privacy requires a separately qualified compute
host and a description of its remaining visibility.

## Accepted state

The first protocol version has one owner, two fixed resident agents, one
authorized writer, and one accepted episode at a time. One unique, zero-value
room checkpoint carries the accepted state. Room identity, seed identity,
membership, and writer authority remain fixed for that room version.

The development program uses a fixed localnet namespace. Its bridge must pin
the local RPC genesis and the application and SPP binary digests, and accept
only the intended local endpoints. This host check does not make the namespace
a general proof of cross-network isolation. A production deployment needs its
own qualified identity and artifact binding.

Creation reserves the canonical room address. An advance consumes the exact
predecessor and produces one successor checkpoint. The upstream SPP shape pads
this operation to one input and two outputs: one committed room checkpoint and
one compact dummy output. The application proof and the SPP proof must describe
the same finalized transaction. The onchain handler derives writer authority
from an actual transaction signer.

An accepted episode binds its original result, proposed update, predecessor,
and next ordinal. The host retains this authorization; a retry cannot grant a
new meaning to the same episode. A failed state commit does not authorize a
second inference call. A lost submission acknowledgment requires recovery of
the existing intent before another transition is prepared.

An expired blockhash requires new transaction framing. The bridge checks the
original signature history and blockhash validity before it signs a replacement.
The replacement preserves the proofs, instructions, account permissions, fee,
and intended checkpoint. The host records its bytes and parent digest before
submission. Uncertain transport or status responses do not establish expiry.

The public authorization commitment has its own private random blinding value.
The host retains it with the authorization and reuses it for retries. This
protects short lessons and feedback from guessing even when other transition
metadata is known. Transaction blinding has a different role and does not
replace this value.

Accepted memory is committed UTXO data. Informational messages and memos do not
become accepted memory by appearing in a log. A reader must decrypt, decode,
validate the room and schema, and compare the recovered content with the
accepted state before releasing it to an agent or marking a room ready.

## What the learning proof establishes

The initial learning rule adjusts one of two procedure scores. Scores remain
between 0 and 100. Accepted feedback has magnitude at most 10; the selected
score changes under the specified saturating rule and the other stays fixed.
The next episode selects a procedure from the recovered scores.

A proof establishes the authorized bounded update. It does not establish that
the critic's judgment is correct, prove arbitrary model inference, or certify
the truth of the accepted lesson. These are separate evaluation and execution
questions.

## Keys, messages, and persistence

Signing authority, viewing authority, and application encryption keys have
different roles. Agent tools release scoped content; they do not need to hand
every resident the room's master key. Fixed membership in this version does
not provide cryptographic revocation. Stopping future retrieval cannot retract
plaintext or keys already delivered.

An authenticated message binds the room, episode, sender, recipient scope,
nonce, payload digest, and expiry when one applies. Recipient verification
uses the sender key admitted by the room configuration. A transport retry must
not make an old message into a newly accepted message.

Encrypted engine storage and runtime conversation storage are separate
surfaces. Flue conversation messages, tool results, attachments, summaries, and
diagnostics remain subject to the runtime host's stated custody and retention
profile. Encrypting a checkpoint does not encrypt those surfaces. Default
diagnostics should contain identifiers, statuses, and usage measurements;
private lesson, prompt, and tool-result content does not belong in them.

One live reference-host process owns each Flue directory. A dedicated SQLite
exclusive transaction holds that ownership through shutdown; the operating
system releases it after a process crash. Shared persistence and dispatch
idempotency alone do not establish exclusive conversation ownership.

If the privacy backend, keys, proof artifacts, or verified recovery are
unavailable, the room remains pending or reports a concrete failure. It must
not copy private memory into a plaintext fallback.

## Qualification

This is a development protocol. Local setup material is test-only. A random
single-party setup is not a production ceremony, and an artifact checksum is
not a security review.

Before any production default, qualify the exact source, circuit and verifier,
proving keys and setup provenance, deployed program identities, indexer,
prover, client package, execution route, and key-recovery procedure together.
Record the conformance evidence for those exact bytes. Public source
availability and a successful deterministic example do not satisfy that gate.

## Upstream mechanisms

The implementation builds on these upstream sources, pinned initially to
`42de575202f07adf6cfe9194ae9227445797bd8e`:

- [`UniqueDataUtxo`](../../sdk-libs/circuit/src/protocol/utxo/unique.rs) reserves and advances a unique address.
- [`ConfidentialTransaction`](../../sdk-libs/circuit/src/protocol/transaction.rs) binds the checked transaction and its private transaction hash.
- [Program-owner recovery](../../sdk-libs/program/src/client/program_owner.rs) decodes program data and checks it against commitments.
- [Custom-program instructions](../../sdk-tests/timelock-escrow/program/src/instructions/escrow.rs) demonstrate verification before an authorized SPP CPI.
- [SPP output constraints](../../prover/server/circuits/spp_transaction/shared/outputs.go) require owner authorization for data-bearing outputs, preventing an unrelated sender from creating accepted program state.

