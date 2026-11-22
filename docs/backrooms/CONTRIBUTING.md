# Contributing to the Backrooms engine

The Backrooms extension adds private persistent intelligence to the Rings
workspace. Keep application changes under `backrooms/` and documentation under
`docs/backrooms/` whenever possible. Preserve the upstream history, license,
component licenses, notices, and protocol layout.

The first contribution target is a complete private learning room: two stable
resident agents accept a lesson, commit a bounded policy update, recover after
a restart, and change the next episode's procedure. Only the example's model
inference is synthetic. The proof, encryption, runtime, validator, and indexed
recovery paths must be exercised before claiming the full example works.

## Work from the implementation boundary

| Area | Responsibility |
| --- | --- |
| Protocol and program | Canonical state, commitments, bounded learning, authorization, custom proof verification, and SPP linkage. |
| Client | Versioned operations, exact prepared intent, submission, and verified recovery. |
| Flue adapter | Stable resident agents, scoped tools, durable continuation, and admitted execution. |
| Reference host | Local authority, original-result retention, scoped encrypted storage, and deterministic model fixture. |
| Production host adapter | Existing identity, work, inference admission, funding, original responses, and acceptance authority. |
| Release artifacts | Exact source, compiled circuits, keys, setup provenance, program identities, and verification evidence. |

The public engine must run without a private product checkout, private model
credentials, or a production account. A host adapter translates existing
authority into the public contract; the engine does not create a second
financial ledger or grant itself provider access.

Read the repository's [contributor rules](../../CLAUDE.md) before changing code.
Use the pinned toolchains and dependency versions. New example programs should
consume the existing SDK; changing upstream protocol math requires its own
review and matching artifact changes.

## Evidence expected in a change

Run the smallest check that observes the behavior you changed. Record the
command, result, and the boundary it exercised. Distinguish native circuit
execution, a generated proof, an actual onchain verifier result, and indexed
decryption. Passing one does not establish the others.

Changes to state acceptance should cover unauthorized writers, wrong room or
deployment bindings, consumed predecessors, mismatched application and SPP
proofs, and repeated learning authorization. A replay check must use fresh
transaction framing; sending identical signed bytes can test transaction
deduplication instead of state replay resistance.

Changes to recovery should cover an ambiguous submit, delayed indexing,
pagination, corrupt ciphertext, a wrong scope key, and a process restart.
Retain the original episode and result across every retry. An unavailable
privacy service must not cause a plaintext fallback.

Learning changes should show a behaviorally different next procedure caused by
the recovered update. Test the range boundaries and the unchanged score as
well as the happy path. A fixture that directly changes a score in memory does
not establish a proved state update.

## Public and production work

Do not add private host source, internal documents, secrets, runtime state,
viewing keys, or generated local proving data to the public repository. Keep
generated artifacts in their documented build directories and record digests
in the release evidence when the artifact exists.

Reviewable source changes do not authorize a deployment or default rollout.
Use the [privacy and acceptance contract](PRIVACY.md) to describe a change's
actual guarantees. An unfinished gate should remain visible, with the exact
failure and the next executable step.

## Expansion after the base

New interfaces can build on the same accepted-history contract: separate agent
checkpoints for concurrent work, private retrieval, delegated task claims,
room branches and accepted merges, collective learning, portable execution
hosts, and confidential compute. Each needs an explicit authority and recovery
rule before it becomes a new operation.

For example, parallel agents should own separate checkpoints before sharing a
mutable note. Dynamic membership needs a current membership epoch and key
rotation. A room branch needs a new identity and an explicit provenance and
disclosure policy. These are useful contributor directions once the complete
base lifecycle is verified.
