# Anonymous Custom Rings base: upstream reproduction

This is the first contributor bootstrap for [O05](https://github.com/Spawn-Backrooms/backroom-rings/issues/26) and [CR01](https://github.com/Spawn-Backrooms/backroom-rings/issues/34). It is intentionally separate from the published Backroom Rings v0 package and does not change its build, exports, circuits or release manifests. It does not implement anonymous Backroom operations yet.

## Reproduce the baseline

Use a disposable isolated development VM with no production secrets, wallets, provider credentials, or other localnet workloads. Some upstream localnet recipes clean their work directories and stop local services. Review the pinned upstream commands, install the Rust/Solana build toolchain pinned by Zolana (Rust 1.98.1 at this pin), Go from the upstream prover module (1.27.3), Node 24+, just, cargo-nextest, jq and curl. Upstream dependencies, the local validator backend and proving-key downloads require network access. The assertion environment variable is a human acknowledgement, not an isolation mechanism.

In the disposable VM:

```bash
git clone --no-recurse-submodules https://github.com/Spawn-Backrooms/custom-privacy-rings.git custom-rings
git -C custom-rings checkout --detach 02bca33729051798834ecbb4d94e968cdc0ef9b8
git -C custom-rings submodule update --init --recursive
# From the Backroom Rings checkout:
node backrooms/experiments/custom-rings-base/baseline.mjs /absolute/path/to/custom-rings
# After inspecting the planned commands and confirming isolation:
set -o pipefail
SPAWN_DISPOSABLE_LOCALNET=1 node backrooms/experiments/custom-rings-base/baseline.mjs /absolute/path/to/custom-rings --run-localnet 2>&1 | tee /tmp/custom-rings-baseline.log
```

The preflight checks the exact pinned upstream commit and Zolana gitlink/checkouts, clean tracked and untracked working trees, and the absence of root/submodule dotenv files. It reports the proving-key lockfile Git blob identity, not a validation of downloaded key bytes. It does not certify environment isolation or audit source. Use a fresh checkout for each baseline run. The public organization fork now exists. Its parent, visibility, exact main commit and Zolana gitlink were verified. The connected integration has read-only access; branch creation returned HTTP 403. Detached reproduction can proceed on the build host without write access. Changes to upstream pins need review.

The runner executes the upstream `check-all`, `test-hermetic`, `test-custom-ring` and focused `test-custom-ring-validator` recipes sequentially and stops at the first failure. It requires successful nextest `PASS` records for both exact cases in the `custom-ring-test-validator::ring` binary:

- `anonymous::an_anonymous_ring_hides_owners_and_preserves_auditor_access`
- `anonymous::an_anonymous_policy_ring_screens_its_hidden_sender`

The cases in [anonymous.rs](https://github.com/helius-labs/custom-privacy-rings/blob/02bca33729051798834ecbb4d94e968cdc0ef9b8/program-tests/custom-ring/tests/ring/anonymous.rs) are unconditional; they do not need the `proofs` feature used by the separate one-key suite. Filter echoes, skipped tests, wrong-binary passes, missing cases and nonzero command exits do not satisfy the runner.

The runner checks Go from inside `prover/`, where automatic toolchain selection reads the module, and requires the exact source-pinned Go and Rust versions. It refuses nonempty `ZOLANA_PREBUILT`, `ZOLANA_NEXTEST_ARCHIVE_DIR` and `GOFLAGS`, and a `GOWORK` override other than `off`. Every child runs with `GOENV=off` and `GOWORK=off`; inherited `JUST_*` settings are removed and `JUST_NO_DOTENV=true` disables ancestor dotenv loading, including nested recipes. These controls can otherwise bypass source builds, select unrelated test archives or filter away tests. It rechecks source pins and checkout cleanliness after all commands before recording success.

Each execution creates a fresh private temporary evidence directory and prints its path. `receipt.json` records source pins, commands, statuses, durations, exact successful case names and SHA-256 digests of individual logs. A failed run records `status: "failed"`; no previous log is reused. The receipt always states `scope: "upstream-baseline-only"` and `applicationComposition: "not-run"`. Review logs for sensitive content before publishing them, and retain actual compiled-program and proving-key digests separately as CR01 requires. Log parsing establishes that the runner observed named tests, not independent cryptographic attestation.

## Verify the bootstrap

```bash
node --test backrooms/experiments/custom-rings-base/baseline.test.mjs backrooms/experiments/custom-rings-base/execution.test.mjs
```

The bootstrap suite exercises real temporary Git repositories/submodules and actual child processes emitting controlled fixture output. Twenty-two tests passed under Node 24.22.3, including regression cases first observed failing for missing validator evidence, ignored build/test overrides, short log writes and capture errors. These tests qualify the bootstrap behavior only. No upstream circuit compilation, key download or validator execution was possible in the current authoring workspace: the actual Go/Rust/Solana toolchains and package-download access are unavailable. [RUNNER-REVIEW.md](RUNNER-REVIEW.md) records the independent source review and the author's verified fixes. CR01 remains open for real execution and artifact evidence. The parser requires plain terminal PASS records; compatibility with progress-prefixed nextest output remains a documented minor qualification item and fails closed if no plain final records appear.

## Boundary and next pickup

- [CR02](https://github.com/Spawn-Backrooms/backroom-rings/issues/35): upstream [spec question 8](https://github.com/helius-labs/custom-privacy-rings/blob/02bca33729051798834ecbb4d94e968cdc0ef9b8/docs/spec.md#open-questions-for-the-maintainer) leaves third-party ZK program access to ring notes unresolved. The existing Backrooms bridge uses a public writer signer. Implement the smallest actual onchain composition in separate artifacts and bind the exact ordered settlement and current native authorization.
- [CR03](https://github.com/Spawn-Backrooms/backroom-rings/issues/36): one nonfinancial room, fixed members, one accepted lesson, process restart, later reuse. No fallback to the existing confidential path.
- [CR04](https://github.com/Spawn-Backrooms/backroom-rings/issues/37): independently verify the application and ring proof linkage, state transition and public visibility; publish a reproducible conformance pack.
- [CR05](https://github.com/Spawn-Backrooms/spawn/issues/78): native developer-preview integration after real composition; no production activation.

Upstream anonymous transactions do not hide public enrollment, all transaction metadata, or activity from the designated auditor. See [privacy by mode](https://github.com/helius-labs/custom-privacy-rings/blob/02bca33729051798834ecbb4d94e968cdc0ef9b8/docs/design/privacy.md). This tool checks a baseline, not an anonymity guarantee. Production, stronger confidentiality, and dynamic membership retain their separate release gates.
