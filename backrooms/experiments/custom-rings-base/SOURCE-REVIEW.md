# Independent review: Custom Rings bootstrap and initial composition

> Historical design/review checkpoint. The implemented profile and current verification status are recorded in [APPLICATION-EVIDENCE.md](APPLICATION-EVIDENCE.md), [APPLICATION-REVIEW.md](APPLICATION-REVIEW.md) and [fork-overlay/README.md](fork-overlay/README.md). Statements below about unavailable tools or unimplemented components describe that earlier checkpoint.

Reviewer: independent `review_composition` agent, 2026-11-23.

Reviewed initial PR39 head `2d39aab0446ce55a8d31ecb5e669ca780839eb5c`; bootstrap source initially matched PR38 head `143f9726ce1061a13943ae5403a50ea1d9078f34`. Upstream Custom Rings pin `02bca33729051798834ecbb4d94e968cdc0ef9b8`, SPP pin `0fe4f952182b39464d472c52c40b3febe6cbd9ec`.

This is source review. No upstream circuit was compiled, no Gnark proof was generated, and no validator acceptance is claimed. A later patch must be reviewed separately; the findings below are not a sign-off for unpublished changes.

## Bootstrap findings

1. **Exit zero is insufficient evidence of the selected validator cases.** The initial runner inherited output and accepted only command status, then asked a human to inspect logs. Capture the validator output and require terminal PASS records for both exact names in `custom-ring-test-validator::ring`:
   - `anonymous::an_anonymous_ring_hides_owners_and_preserves_auditor_access`
   - `anonymous::an_anonymous_policy_ring_screens_its_hidden_sender`
   Require a successful child exit too. Names in echoed commands, START/SKIP lines, failure output, or unrelated test names are insufficient. Force no color and passing-test status output; accept each exact test once logically even if nextest repeats its final status. A parser test is evidence about the runner only.
2. **Source execution can silently become prebuilt execution.** `ZOLANA_NEXTEST_ARCHIVE_DIR` makes the pinned SPP `tools/ci/nextest-suite.sh` execute an archive and discard build-only feature flags. `ZOLANA_PREBUILT` makes multiple pinned just recipes skip program, prover, and CLI builds. Reject these overrides for the clean source baseline unless there is independently verified artifact provenance. Nonempty `GOFLAGS` can filter away all Go tests. Account for inherited `GOWORK` and other source overrides as well.
3. **Record the toolchain actually selected inside the Go module.** The pinned `prover/go.mod` requests `go 1.27.3`. The initial root-level `go version` command checked neither that version nor module auto-selection. Query `go env GOVERSION` or `go version` with cwd `<checkout>/prover`, require the selected pinned version, and retain the result. A launcher elsewhere on PATH does not identify the module toolchain.
4. **Verify source identity after execution.** Preflight alone does not establish the post-run source state. Some recipes omit `--locked`; a tool can update lockfiles or source. Recheck HEAD, gitlink, and tracked cleanliness before recording success. Build products are normally ignored and should not be mistaken for source changes.

### Proof feature flag: not a defect

Neither selected anonymous case needs `--features proofs`. At this pin, `program-tests/custom-ring/tests/ring.rs` includes `ring/anonymous.rs` unconditionally. Both selected functions have ordinary `#[test]` attributes and no ignore or feature gate. Only `ring/one_key.rs` is wrapped in `#[cfg(feature = "proofs")]`. Thus copying the flag from `one-key-validation` is unnecessary for these cases.

The actual invocation chain is `test-custom-ring-validator <filter> <args>` -> `tools/test-ring-controls.sh ring -E <filter> <args>` -> `zolana/tools/ci/nextest-suite.sh -p custom-ring-test-validator --test ring --no-capture <args>`. The existing profiles serialize validator tests and do not filter either selected anonymous test.

## Initial composition review

No immediate constraint escape was identified in the narrowly documented same-owner, same-enrolled-key, zero-amount one-live-note predicate. Upstream `TransferCircuit` reopens the same wires for auditing and policy and binds ordered note/output chains through `PrivateTxHash`; SPP supplies the owner signature, membership, nullifier uniqueness, and settlement checks. SPP already requires the default-owner public field to be zero for hidden ring-only inputs and excludes the hidden identity from published owner tags.

The overlay is intentionally incomplete and must not be registered as an application key. Before integration:

- Prove the canonical old/new state relation using the same note wires. Different note commitments alone can mean only different blindings, without a revision, lesson, or grant update.
- Bind current grant/epoch and deployment context through a deliberately specified application public statement derived from validated live accounts. The embedded public hash currently means exactly the upstream transfer statement; private added fields do not automatically bind current native authorization.
- Deny every alternative `ring_auth` settlement path, including `AuthorityTransfer`, `Merge`, and unrestricted genesis/deposit. A hook only in normal transfer does not establish application conservation.
- Keep the stable room identity and writer binding private. The v0 creation publicly names writer plus room identity; repeating that room identity on an anonymous advance directly joins the advance to its visible writer. Do not carry the v0 public room identity/PDA scheme into the new version.
- Preserve a meaningful eligible-owner set. A ring admitting one publicly enrolled writer leaves sender identity inferable despite a correct hidden-owner proof. One writer per private room can coexist with multiple owners across an application ring.
- Resolve count vocabulary. The overlay enforces one live note but not one published nullifier/output slot; the synthetic oracle requires `inputCount === 1`. Distinguish live counts, published padding, and compiled capacity, then test the selected policy coherently.

## Primary source references

- [Pinned test module](https://github.com/Spawn-Backrooms/custom-privacy-rings/blob/02bca33729051798834ecbb4d94e968cdc0ef9b8/program-tests/custom-ring/tests/ring.rs)
- [Actual anonymous validator cases](https://github.com/Spawn-Backrooms/custom-privacy-rings/blob/02bca33729051798834ecbb4d94e968cdc0ef9b8/program-tests/custom-ring/tests/ring/anonymous.rs)
- [Validator launcher](https://github.com/Spawn-Backrooms/custom-privacy-rings/blob/02bca33729051798834ecbb4d94e968cdc0ef9b8/tools/test-ring-controls.sh)
- [Pinned recipes](https://github.com/Spawn-Backrooms/custom-privacy-rings/blob/02bca33729051798834ecbb4d94e968cdc0ef9b8/justfile)
- [Archive/source selection](https://github.com/helius-labs/privacy-rings/blob/0fe4f952182b39464d472c52c40b3febe6cbd9ec/tools/ci/nextest-suite.sh)
- [Transfer relation](https://github.com/Spawn-Backrooms/custom-privacy-rings/blob/02bca33729051798834ecbb4d94e968cdc0ef9b8/prover/circuits/transfer/transfer.go)
- [Public instruction dispatch](https://github.com/Spawn-Backrooms/custom-privacy-rings/blob/02bca33729051798834ecbb4d94e968cdc0ef9b8/programs/custom-ring/src/lib.rs)
- [SPP hidden-owner rules](https://github.com/helius-labs/privacy-rings/blob/0fe4f952182b39464d472c52c40b3febe6cbd9ec/prover/server/circuits/spp_transaction/shared/signers.go)
- [v0 room arguments and public signer](https://github.com/Spawn-Backrooms/backroom-rings/blob/08822c65254cd73c5f2dccbdf182ce1df2c7510a/backrooms/program/src/instructions/mod.rs)
- [Privacy limitations](https://github.com/Spawn-Backrooms/custom-privacy-rings/blob/02bca33729051798834ecbb4d94e968cdc0ef9b8/docs/design/privacy.md)

The canonical current repository name of the pinned Zolana submodule is `helius-labs/privacy-rings`, confirmed by repository ID `1235775078` through the supported GitHub repository API.
