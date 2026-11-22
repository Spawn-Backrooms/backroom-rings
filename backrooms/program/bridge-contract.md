# Backrooms local process contract v0

The public host invokes `backroom-rings-bridge`. It writes one JSON request to stdin and reads one JSON response from stdout. Diagnostics use stderr and contain no prompts, lessons, secrets, or proof inputs. The process exits nonzero on a validation, proof, recovery, or transport error. It emits a content-free response with `status: "error"` and `error.code` from `invalid_request`, `state_conflict`, `artifact_mismatch`, `recovery_unavailable`, `proof_failed`, `transaction_live`, or `operation_failed`. A missing checkpoint is a normal `not_found` response. A transport failure is never reported as missing state.

`BACKROOM_RINGS_CONFIG` names a local, owner-readable JSON file. Its fields are `signerSeedHex`, `rpcUrl`, `indexerUrl`, `proverUrl`, `treeAddress`, `treeId`, `artifactsDirectory`, `genesisHash`, `programBinarySha256`, and `shieldedPoolBinarySha256`. The seed is exactly 32 bytes. URLs must use loopback HTTP. The RPC genesis hash and both deployed program byte digests must match the retained configuration. Program digests hash the program bytes after their loader header, as `solana program dump` returns. The bridge is a localnet example with insecure test setup. It refuses other endpoints.

Every request has `protocolVersion: "backrooms.v0"`, `operationId`, `op`, and `input`. Every response echoes `protocolVersion` and `operationId`.

All commitments and digests are exactly 64 lowercase hex characters without a prefix. Room, unique address, checkpoint, authorization, and private transaction commitments use the upstream protocol hash. `transactionDigest` and `applicationProofDigest` use SHA256. `stateCommitment` means the complete UTXO commitment, which identifies the consumed predecessor, not only the inner state hash. Solana signatures and account addresses use base58. Revisions, ordinals, and slots are canonical unsigned decimal strings through u64::MAX. Procedure indices, feedback magnitudes, scores, and tree IDs are JSON numbers within their declared bounds.

## Prepare creation

`op: "prepare_create"` takes `input: { creationNonce, seedManifestCommitment, fixedMembersCommitment }`.

It returns `status: "prepared"`, `transactionBase64`, `transactionDigest`, `checkpoint: { roomId, uniqueAddress, stateCommitment, revision }`, `proofs: { applicationProofDigest, privateTxHash }`, and `artifactVersion: "backrooms.localnet.v0"`.

The host retains the nonce before this operation and durably stores the exact prepared response before submitting. There is one owner/writer and two fixed residents represented by the seed and membership commitments. Initial scores are `[50, 50]` and the lesson is empty.

## Prepare learning

`op: "prepare_advance"` takes the following input.

```json
{
  "roomId": "64 lowercase hex characters",
  "expectedPredecessor": "64 lowercase hex characters",
  "ordinal": "1",
  "acceptanceNonce": "64 lowercase hex characters",
  "episodeCommitment": "64 lowercase hex characters",
  "originalResultCommitment": "64 lowercase hex characters",
  "candidateCommitment": "64 lowercase hex characters",
  "lesson": "Check assumptions",
  "selectedProcedure": 0,
  "feedback": { "negative": true, "magnitude": 10 },
  "minimumConfirmedSlot": "0"
}
```

The host creates a cryptographically random, nonzero 32-byte acceptance nonce once per accepted original episode. It retains the nonce in its encrypted grant journal and reuses it across retries. The nonce blinds the public grant commitment and is never a public instruction field.

The lesson is nonempty UTF8 of at most 96 bytes. Procedure is 0 or 1. Magnitude is 0 through 10. The bridge recovers the exact predecessor and rejects a changed or stale expectation. The grant binds that predecessor, the next ordinal, all three provenance commitments, lesson, procedure, and feedback. The native writer signs the instruction containing its grant commitment. Reusing the grant with another predecessor or ordinal fails the circuit. The host retains one immutable grant per original accepted episode and must not authorize a new grant for a replayed result.

The prepared response has the same shape as creation, plus `authorizationCommitment`.

## Submit

`op: "submit"` takes `input: { transactionBase64, transactionDigest }`.

It validates the digest, original writer signature, and canonical Backrooms v1 instruction and accounts. Before sending, it reconciles the signature through full RPC history. A confirmed response has `status: "confirmed"`, `signature`, and `slot`. An unresolved submission has `status: "unknown"` and `signature`. Only a still-live transaction without a known signature is submitted, using those exact signed bytes.

An expired transaction returns `status: "expired"` and `signature` only when the pinned RPC reports its blockhash invalid and full history lookups both before and after that observation find no transaction. A pending or failed transaction status, incomplete status response, or RPC error remains `unknown`; it never establishes expiration. The host recovers before retrying the retained intent. Neither a proof failure nor an unresolved submission authorizes another inference attempt.

## Reframe an expired transaction

`op: "reframe"` takes `input: { transactionBase64, transactionDigest }` for the exact retained transaction. Before requesting it, the host must recover the room: creation requires a complete `not_found` result, and learning requires the exact original predecessor. A recovered intended checkpoint settles the operation; a different successor is a conflict. Incomplete recovery remains pending.

The bridge repeats the signature, instruction, account, and expiration checks. A live blockhash returns `error.code: "transaction_live"`. A known successful signature returns `confirmed` with its signature and slot. Uncertain evidence returns `unknown` with the original signature.

Successful reframing returns the following fields:

```json
{
  "protocolVersion": "backrooms.v0",
  "operationId": "retained caller identifier",
  "status": "reframed",
  "transactionBase64": "new exact signed transaction bytes",
  "transactionDigest": "new SHA256 digest",
  "parentTransactionDigest": "SHA256 digest of the retained input",
  "signature": "new base58 signature"
}
```

Only the recent blockhash and transaction signature change. All instructions, account ordering and permissions, budget and fee settings, proofs, encrypted checkpoint, and authorization remain byte-for-byte unchanged. This operation neither generates proofs nor submits a transaction. The host must retain the original prepared metadata and atomically persist the replacement bytes, digest, and parent-digest lineage before submitting them. Retries preserve the original accepted grant and nonce and never repeat inference.

## Recover

`op: "recover"` takes `input: { roomId, minimumConfirmedSlot }`.

The bridge paginates Photon history, checks the indexer's minimum slot, decrypts program-owned notes, removes spent notes, validates the state codec and commitment, and rejects duplicate live checkpoints for one room. A match returns the following.

```json
{
  "protocolVersion": "backrooms.v0",
  "operationId": "retained caller identifier",
  "status": "recovered",
  "checkpoint": {
    "roomId": "64 lowercase hex characters",
    "uniqueAddress": "64 lowercase hex characters",
    "stateCommitment": "64 lowercase hex characters",
    "revision": "1"
  },
  "memory": {
    "lesson": "Check assumptions",
    "episodeCommitment": "64 lowercase hex characters",
    "originalResultCommitment": "64 lowercase hex characters",
    "candidateCommitment": "64 lowercase hex characters",
    "predecessorCommitment": "64 lowercase hex characters",
    "authorizationCommitment": "64 lowercase hex characters"
  },
  "policy": { "policyId": "1", "scores": [40, 50] },
  "writerIdentity": "base58 actual writer signer",
  "seedManifestCommitment": "64 lowercase hex characters",
  "fixedMembersCommitment": "64 lowercase hex characters",
  "signature": "base58",
  "slot": "123",
  "artifactVersion": "backrooms.localnet.v0"
}
```

No match after a complete fresh scan returns `status: "not_found"`. An indexer behind the required slot, an incomplete scan, corrupt ciphertext, a wrong commitment, or an invalid state produces an error. These conditions do not authorize a new genesis or plaintext fallback.
