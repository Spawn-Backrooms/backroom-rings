# K02 compact manifest experiment

**Decision, November 23, 2026.** Keep one writer and test a 32-byte ordered-log commitment in a separate relation. A fresh Node model can append an accepted-knowledge envelope, preserve the bounded two-score update, and recover the tip by replay. In the measured case a 32-byte root refers to a 3,201-byte envelope and a 4,260-byte journal entry. The next feasibility question is whether proving, encrypted recovery and transaction construction fit the existing lifecycle budgets. Circuit adoption remains deferred. [K02 issue](https://github.com/Spawn-Backrooms/backroom-rings/issues/9)

## Baseline and scope

The [v0 circuit](https://github.com/Spawn-Backrooms/backroom-rings/blob/3dc650d532708e36c467481350dd7e80029af0fe/backrooms/program/src/circuits/advance_room.rs) spends one unique zero-amount checkpoint, verifies its actual predecessor UTXO hash, binds the next ordinal and blinded grant, then updates one score within 0–100. Each move has magnitude 0–10. The room identity commits its versioned room binding and writer. The state retains fixed membership and the seed manifest. Accepted memory has 96 lesson bytes, one length byte, one scope byte and three 32-byte commitments. Its v0 application verifier also binds the shielded transaction hash, and its instruction requires the writer signer. [State and codec](https://github.com/Spawn-Backrooms/backroom-rings/blob/3dc650d532708e36c467481350dd7e80029af0fe/backrooms/program/src/circuits/state.rs)

This experiment uses the K01 canonical wire decoder with Q03’s strict-field correction (knowledge.ts Git blob `1d91efe42689d718dcef9cf6e131804cec5f2b61`). The room admits its run-backed subset. A single run entry must contain both the requested episode digest and the requested original-result digest. A separate candidate digest identifies the proposed result. The envelope binds its K01 owner-acceptance subject, receipt, policy, rights, provenance and distinct evaluation channels. The writer authenticates the append transcript. Authenticating original receipts, authorizing the writer and the current operation, checking disclosure/expiry/retraction, and protecting originals remain native responsibilities. A writer signature confers no new grants or claims about the truth of a lesson. [K01 contract pin](https://github.com/Spawn-Backrooms/backroom-rings/blob/60faf6515257a95a5f53699cb1e7a1057ff1df54/docs/backrooms/KNOWLEDGE.md)

## Reference relation

The protocol string is `backrooms.manifest.experiment.v1` (`P`). Define `H(tag, ...args)` as lowercase hexadecimal SHA-256 over UTF-8 of the repository's canonical JSON array `[P, tag, ...args]`. Objects have keys ordered by JavaScript UTF-16 code units. Hash values in these arrays are 64 lowercase hex characters. An ordinal is a canonical decimal string, bounded through 2^64−1. Scores, the selected index and magnitude are JSON integers. The sign flag is a boolean. `Z` is 32 zero bytes rendered as 64 hex digits. JSON property names and hash tags below are literal.

| Symbol | Exact definition |
| --- | --- |
| C | A strict object with protocol = P, knowledgeSchema = `backrooms.knowledge.v1`, plus 32-byte hex fields roomId, deployment, program, roomOwner, creationNonce, seedManifest, fixedMembers and writerKey. The writer key is raw Ed25519. The trusted caller supplies C. |
| D | H("domain", C). Every state binds the same logical K01 room, deployment, program, owner, nonce, seed, fixed membership commitment, writer and schemas. Deployment identities and membership commitments are opaque caller pins in this model. |
| R₀, S₀ | R₀ = H("empty", D). S₀ = H("checkpoint", D, "0", R₀, 50, 50, Z, Z). Fresh creation is the sole initializer. |
| L | H("envelope", C.knowledgeSchema, W). W is the exact **canonical JSON string** from K01, embedded as a string in the outer array. Its roomId must equal C.roomId. |
| E | A strict object with nonce (nonzero), episode, original and candidate as 32-byte hex, selected (0 or 1), negative (boolean), magnitude (integer 0–10). The episode and original must appear together in at least one run source. |
| A | H("authorize", D, S_old, n, L, E). Require the supplied predecessor to equal S_old, n = old revision + 1, and a valid Ed25519 signature from C.writerKey on the **32 decoded bytes of A**. |
| R_new | H("append", D, R_old, n, L, A). Ordering and membership in this append history can be checked by replay of a prefix or the whole journal. |
| S_new | H("checkpoint", D, n, R_new, first_new, second_new, S_old, A). Change only the selected score by signed magnitude and saturate at 0 or 100. |

The exact external statement returned by the reference transition is **(domain D, predecessor S_old, ordinal n, authorization A, successor S_new)**, in that order. The fixture includes genesis, the envelope leaf, the writer signature and the expected first successor. The SHA-256 and signature vectors were generated independently using Python hashlib and cryptography. All keys, nonces, receipts and openings in these examples are synthetic public data.

A future circuit must open the old and new states against the actual consumed and produced unique UTXOs, enforce the above equations (or assign a new relation/version), and bind the same authenticated writer, room owner, zero amount, unique address and SPP transaction into both verifiers. The model's S values are logical commitments, distinct from v0 UTXO hashes. For a circuit candidate, specify lossless digest encoding, e.g. two range-constrained 128-bit big-endian limbs per digest, one range-constrained 64-bit ordinal. Pin the full external input order including the SPP transaction linkage with verifier vectors before setup. Mapping a 256-bit SHA digest modulo a smaller scalar field loses information. There is presently no circuit public-input ABI, verified SPP linkage or qualified setup for this relation.

A room instance applies each synchronous transition atomically after all validation. A replay or competing successor of its consumed head fails with `stale_predecessor`. Re-recovering the same canonical journal against the same independently pinned tip returns the same state. Across machines, a writer can fork two separate memory instances. Future admission needs one atomic unique UTXO consume or a durable compare-and-swap on that head. There is no global record-ID uniqueness or cross-ordinal native acceptance deduplication in this reference. Additional partitions, inclusion proofs and dynamic membership would require another relation.

Direct admission and recovery require each config, request, event, evidence and journal wrapper to have exactly its declared own enumerable JSON data properties. Recovery starts from C, takes strict canonical journal strings of shape `{request, evidence}`, rechecks the K01 wire and every signature in order, and compares the computed commitment to the supplied trusted tip. A truncated valid prefix fails that final comparison. A raw restored mutable head has no ingress. Full replay is linear in the number and size of entries, and the root alone cannot supply missing bytes. A history can retain an expired/retracted record without authorizing present retrieval. The journal here models private reference data in synthetic fixtures. Production requires separately qualified encryption, availability and disclosure controls.

## Continuity and release

| Input or operation | Decision |
| --- | --- |
| A v0 proof, v0 Groth16 proving/verifying key, recovered v0 state, or renamed v0 artifact/manifest | Reject at experimental ingress. Fresh creation only accepts the strict config. Advance accepts exactly writer-signature evidence and verifies its bytes against the prebound writer. No proof/key import or metadata-driven verifier selection exists. |
| Fresh experimental room | Create the version-specific domain and revision zero. A shared logical K01 roomId cannot carry a previous signature, commitment or qualified release across domains. |
| Future migration of an authoritative v0 head | First qualify the exact v0 release and verify its final checkpoint, owner, writer, deployment, schema, membership and provenance under v0. Define a separate migration relation committing that old identity, revision and state into a new genesis, obtain fresh native consent and atomically consume or retire the old writable head. Define how the fixed lesson and policy are carried via authenticated openings. If unavailable, preserve v0 history and refuse migration. |
| Circuit or key rotation | Create version-specific circuit identities, distinct proving/verifying keys, setup provenance, schema and client pins, deployment and verifier bindings. Select them from a trusted version-to-release mapping and reject every mixed tuple. Require Q06 qualification for that version before adoption. |

## Measurements

One Linux x64 run on an Intel Xeon Platinum 8573C with Node v24.22.3 used public synthetic “yes” content and the same logical acceptance input. After 20 warm-up cycles per path, 51 samples per path alternated ordering within each pair. Each sample reports elapsed wall time divided by three cycles. The v0 path runs real TypeScript prepare, submit and fresh-client recover codecs against in-memory canned bridge responses. The experiment prepares the authorization transcript, applies one verified signature and root update, then replays the entry from fresh genesis against the pinned tip. The two paths perform different validation work. The results measure these client/reference operations and do not estimate the relative cost of two circuits.

| One prepared acceptance and recovery | Median ms | p95 ms |
| --- | ---: | ---: |
| v0 public client with synthetic bridge | 0.242 | 0.701 |
| Experimental manifest reference | 1.582 | 2.111 |

The v0 lesson field with length and scope occupies 98 bytes. Its complete AcceptedMemory payload is 194 bytes. The proposed root is 32 bytes. Other state fields, encryption, signatures and serialized transactions have independent costs. No whole-state or transaction savings are inferred from the field comparison.

The second run phase replays distinct synthetic record subjects from genesis. Each size used one warm-up followed by 11 three-replay samples. Journal byte counts sum canonical entry lengths before framing/encryption.

| Entries | Journal bytes | Median ms | p95 ms |
| ---: | ---: | ---: | ---: |
| 1 | 4,248 | 0.618 | 0.884 |
| 8 | 33,984 | 4.132 | 5.682 |
| 32 | 136,051 | 18.160 | 23.995 |

The source and deterministic fixture are under `backrooms/experiments/manifest-v1`. Run these commands from `backrooms`.

```sh
./node_modules/.bin/tsc -p experiments/manifest-v1/tsconfig.json
node --import tsx --test experiments/manifest-v1/manifest.test.ts
node --import tsx experiments/manifest-v1/benchmark.ts
npm run check
npm test
```

The experiment has no package export, native adapter, circuit artifacts or chain instruction. Remaining measurements require the pinned Rust/Xark toolchain, distinct experimental keys and an isolated localnet with the real prover, validator and indexer. Compare create, advance, competing freshly framed advances and restart recovery side-by-side with v0 on the same host. Record constraint/witness counts, proving/verification times and peak memory, signed transaction bytes and compute units, confirmed/indexed latency, decrypted recovery costs and exact release pins. Run migration refusal with real v0 artifacts and independently test binding to the same SPP transaction before deciding feasibility.
