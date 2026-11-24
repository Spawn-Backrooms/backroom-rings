# Independent SDK, native integration, and localnet-runner review

Completed a focused source review on 2026-11-24 of `custom-rings-app/sdk-libs/ts/src/experimental/spawn-room/`, its focused SDK/native tests, `sdk-tests/spawn-room/localnet-journey.test.ts`, and `tools/run-spawn-room-localnet.mjs`. Core circuit/program findings remain in `independent-application-review.md`.

Source identities: Custom Rings `02bca33729051798834ecbb4d94e968cdc0ef9b8`; Zolana `0fe4f952182b39464d472c52c40b3febe6cbd9ec`; Backrooms `08822c65254cd73c5f2dccbdf182ce1df2c7510a`. The application changes are an uncommitted additive overlay at review time.

## Result

**No outstanding Critical or Important defect was established in the reviewed SDK/native composition. Three Minor findings were corrected by their owners and the corrections were source-verified.** This report approves neither production keys nor a claim that the live validator journey has already passed. Its actual run remained a separate gate.

## Findings corrected during review

| Severity | Concrete counterexample | Correction verified |
| --- | --- | --- |
| Minor — source provenance | `git diff --binary HEAD` excluded every new/untracked circuit, verifier, SDK, test, and runner file. Editing those files left the original revision/diff receipt unchanged. The SDK also loads the app checkout's Zolana source, distinct from the native binary checkout. | The runner now records before/after manifests of tracked and nonignored untracked source, checks stability, and independently checks the app Zolana pin/clean status. The claimed pinned native host now requires the exact Backrooms pin and clean status before/after, with its actual source and dependency manifests recorded. |
| Minor — persisted native receipt version | `retainConfirmed` wrote `room.protocolVersion = spawn-room.v1`, although the unchanged native `RecoveredRoom` contract and new view adapter require `backrooms.v0`. `LearningCoordinator` returns stored receipts directly on retry, so that path returned an object violating its contract. | `retainConfirmed` now builds its room through `spawnRoomNativeView`; protocol version remains `backrooms.v0`, while artifact version remains `spawn-room.v1`. Native restart tests assert both persisted fields. |
| Minor — reuse evidence label | The reuse receipt's `lessonUsed` contained the second episode's newly proposed lesson, not the prior lesson actually consumed by the investigator. The test asserted real reuse but reported a different value. | Evidence now records the parsed investigator's actual `lessonUsed`, with the new proposal separately named `proposedLesson`. |

## Composition checked

- **Canonical encoding and requests:** Fixed-length state/grant codecs preserve all raw digest bits. Scalars reject values at or above the BN254 modulus; u64 values stay bigint until `JSON.rawJSON` emits exact Go integer tokens, including `18446744073709551615`. Lesson bytes, padding, policy bounds, flags, grant-path width/index, and trailing data are checked. The state, identity, grant, and application hash field order matches the previously reviewed Go relations.
- **Actual note/proof wiring:** Staging requires one zero-value application output and the exact genesis or advance input profile. It changes only dummy padding that the stock SDK would otherwise promote into sender change. Live note fields and blinding construction remain in the upstream pipeline. The proof adapter requires the application shape, old/output state hashes, owner/key/asset continuity, grant membership, and the exact derived next state, then selects the separately pinned application key. Unchanged SPP methods remain bound to their original client. Final instructions retain the original proof-carrying frame bytes and add only the dedicated tag/prefix.
- **Payload recovery:** The canonical bytes are sealed through the real recipient-output cipher. Recovery checks decrypted application hash, owner/ring/domain, zero-value profile, enrolled nullifier key, and rebuilt published commitment. The helper explicitly does not manufacture chain inclusion, finality, or unspent evidence; the live journey gets those from confirmed submissions and `syncRingWallet` with a required slot and complete recovery coverage.
- **Native authority/persistence:** The adapter consumes the real existing authority and encrypted-record contracts. It snapshots the runtime's seed/member digests and ordered resident IDs, checks them on prepare and persisted read, retains the complete canonical original and authorization including additional CID fields, and reconstructs the exact grant/next state on read. Epoch changes do not silently replace a persisted revoked grant. Real seeded Flue execution, encrypted close/reopen, nonce/original retention, zero new inference on completed-episode replay, and the learned procedure transition are covered by focused native tests.
- **Privacy scope:** The final journey creates two independently enrolled writers with two real recovered, unspent genesis notes; enrollment alone was not counted as a spend candidate. Hidden transactions decode the entire signed v1 message and require one payer signature with no writer or genesis marker among its accounts. This is a limited local candidate set, explicitly not a production anonymity claim.
- **Specific negative outcomes:** The final journey requires ledger-confirmed duplicate-genesis, generic-tag, and replay failures with exact expected program errors and application failure logs. Unique priority fees prevent a replay from merely retrieving a cached successful signature. Before/after snapshots compare the accepted room commitment, wallet spent flags, and relevant account ownership/lamports/data, excluding only the fee payer. The revocation case is written to require a successful simulation of a coherent third application/SPP proof before revoking its grant and requiring application error 8101, no accepted revision advance, and retained native original/nonce without a receipt.

## Runner and evidence boundaries

The runner uses a fresh private work directory, isolated service configuration, explicit loopback client URLs, fresh local role keys, an allowlisted child environment, pinned key hashes, fixed local KMS behavior, and scoped process ownership. It refuses occupied ports rather than killing their owners. Direct children are stopped by their own process groups; the pinned Zolana CLI uses scoped process-identity receipts for validator/Photon cleanup. A passing receipt requires executed, unskipped passing tests, all required successful journey steps, completed cleanup, released ports, and unchanged reviewed source inputs.

The pinned Photon implementation itself binds `0.0.0.0` and has no bind override. This inherited behavior is now explicitly recorded and documented: the runner's supported scope is an isolated runtime without publishing that port. No claim that every native service binds loopback remains.

## Validation evidence and limits

I independently ran the three lightweight runner tests after the provenance changes: **3 passed, 0 failed/skipped**. I inspected the generated signed-transaction size receipts:

| Fixture | Signed v1 bytes | Instruction bytes | Signers | Accounts | Limit |
| --- | ---: | ---: | ---: | ---: | ---: |
| Genesis | 2,740 | 2,085 | 2 | 14 | 4,096 |
| Hidden advance | 2,639 | 2,117 | 1 | 12 | 4,096 |

These measurements use fixed-size fixture proofs with the actual SDK encrypted payload/audit stream, not a claim of successful chain execution. The implementation owner reported 10 focused SDK tests, 2 native tests, type checks, and focused lint passing. Root separately solved both final serialized TypeScript requests through strict Go decoding and the full circuits; I inspected `context/typescript-go-final-request-solve.json`, which records exit code 0, the exact two request SHA256 values, and unchanged fixture files. I reviewed those test assertions and request construction rather than duplicating expensive proof work.

The runner still must produce its actual passing local-validator receipt. Until that occurs, SBF execution, live account layout, compute usage, indexing, confirmed recovery, and every live negative remain required execution evidence rather than inferred successes. Included proving keys remain explicitly insecure and local-validator-only.
