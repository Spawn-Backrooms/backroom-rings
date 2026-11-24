# Anonymous Custom Rings base: upstream reproduction

> **Current Go evidence:** [fresh qualification packet](evidence/go-requalification/README.md) — **17/18 whole packages** verified (11 passing test packages and 6 explicit no-test-file packages). Full Go qualification remains incomplete. The [recovery checkpoint](evidence/go-recovery-checkpoint/recovery-checkpoint.md) explains the lost unpublished logs and preserves the observed history. The earlier execution status below is a frozen checkpoint; its running-process references are no longer current.

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

The bootstrap suite exercises real temporary Git repositories/submodules and actual child processes emitting controlled fixture output. **Twenty-three tests passed**, with zero failures/skips, under Node 24.22.3. The cases include regressions first observed failing for missing validator evidence, ignored build/test overrides, short log writes, capture errors and nextest progress counters. The parser now accepts an optional numeric `(1/2)` field while still requiring the exact binary, complete case names and a successful command exit. The latest parser run took 2.503 seconds; its complete log SHA-256 is `68c577e87b53d81d3d173c39f5eb5ae4bec00a9296b120da0461190bf9d00bde`.

These controlled child-output tests qualify bootstrap behavior only. [RUNNER-REVIEW.md](RUNNER-REVIEW.md) preserves the independent source review and distinguishes the author's later corrections from new independent sign-off.

The parser regression's failing-before and passing-after logs, terminal receipt and hash manifest are in [evidence/runner-checks/](evidence/runner-checks/).

## Actual execution checkpoint

The pinned Go/Rust/Solana toolchains and downloaded native keys are now available, and actual source builds and tests have run. Earlier toolchain-unavailable notes describe the initial authoring environment and no longer describe this checkpoint. **CR01 remains incomplete.**

| Gate | Retained result |
| --- | --- |
| Exact source | Custom Rings `02bca33729051798834ecbb4d94e968cdc0ef9b8` and Zolana `0fe4f952182b39464d472c52c40b3febe6cbd9ec`; source/cleanliness checks retained around completed stages. |
| `just check-all` | Passed, exit 0, 38.226 seconds. |
| Native builds | All eight stages passed: program SBF, prover, Zolana CLI, Photon, ring indexer, ring CLI, RingRPC and xtask. |
| `just test-hermetic` | Passed, exit 0, 1,877.123 seconds. The three nextest groups reported 149/1,497/40 passes and 0/33/4 canonical default skips. Log SHA-256 `c1a9971ecce62079275096303676b7902f1d502e879a79fb927c38d461bb6c5e`. |
| Complete Go coverage | **Incomplete: 15/18 whole packages have terminal results**, comprising 9 passing test packages and 6 explicitly reported `[no test files]` packages. The latest completed transfer attempt hit the actual Go one-hour timeout and exited 1. A new sequential run has ring active, with ringtest and transfer queued; none of these three packages has a new terminal pass. |
| Two exact anonymous-validator cases | **Passed**, full command exit 0 at unchanged clean pins. Policy hidden sender: 137.717 seconds. Hidden owners and auditor access: 270.612 seconds. The full recipe took 495.928 seconds; the deliberate filter ran 2 cases and excluded 59 others. |

The completed transfer retry reached `panic: test timed out after 1h0m0s` and exited 1 after 3,605.007 seconds. It recorded 191 passing test/subtest events, zero failed-test events and zero skips, with 28 of 44 top-level tests completed. This is a **failed/incomplete package result**, not a pass. Source pins and cleanliness remained unchanged. The complete JSONL log SHA-256 is `eba591fb26ef6a9ef772f93c6195346dd928897d1e0c3f0f9ae993a599f4c234`.

The [timeout checkpoint](evidence/go-timeout-checkpoint/) publishes the full
JSONL, terminal receipt, attempt summary, recorded retry budget and qualification
checks. Its manifest explicitly records the failed incomplete outcome.

The new attempt raises the per-package timeout ceiling from 60 to 180 minutes and runs **ring → ringtest → transfer** sequentially, without test filters. Only ring is active at this checkpoint. It preserves `GOMAXPROCS=1`, `GOMEMLIMIT=1GiB`, `GOGC=25`, `-p 1`, `-parallel 1`, the source-pinned Go version and disabled persisted overrides. The timeout-adjustment record SHA-256 is `7cffec775b9c00eaa48cb8b3393f2abc5cc4c0d04622d3908bb5e868bd6e3662`; the new coordinator's runner SHA-256 is `5c93544aa349af7a05393c7709c37e776bd205c0bf62418613f4ca3b817b7ec1`. The longer ceiling is not a runtime estimate. Coverage stays 15/18 until verified terminal results add completed packages.

Terminal completed packages are retained at unchanged source; equivalent full package coverage requires every required package to complete. This does not claim the interrupted original whole-suite command exited successfully. The original default-timeout run, interrupted extended run, transfer process killed after 130 passing events, and subsequent one-hour transfer timeout remain separate failed/incomplete history. The earlier killed process exited 1, and its underlying cause is not established.

Builds and fetched keys do not substitute for the complete Go suite, hermetic tests or exact validator cases. Application proof and native journey evidence is separately maintained in [PR 39](https://github.com/Spawn-Backrooms/backroom-rings/pull/39); this runner retains its upstream-baseline-only scope.

## Boundary and next pickup

- [CR02](https://github.com/Spawn-Backrooms/backroom-rings/issues/35): the separate application overlay implements a combined application/ring relation, strict prover and dedicated SBF profile with real proof interoperability. Its complete 25-step application validator journey passed, including both hidden updates. Final independent review and full acceptance reconciliation remain open; see [PR 39](https://github.com/Spawn-Backrooms/backroom-rings/pull/39). The original public-writer Backrooms bridge and artifacts are unchanged.
- [CR03](https://github.com/Spawn-Backrooms/backroom-rings/issues/36): the real local-validator run settled a bounded lesson, recovered it in fresh native processes, retried a controlled interrupted confirmation and settled a later task that used the retained lesson. The coordinator stayed running. Private native host/UI activation remains a separate handoff.
- [CR04](https://github.com/Spawn-Backrooms/backroom-rings/issues/37): the named live corpus passed 15 ledger-confirmed refusal checks with unchanged accepted state. Final independent review remains blocked, and the named corpus does not establish every variant in the broader acceptance requirements.
- [CR05](https://github.com/Spawn-Backrooms/spawn/issues/78): native developer-preview integration after real composition; no production activation.

Upstream anonymous transactions do not hide public enrollment, all transaction metadata, or activity from the designated auditor. See [privacy by mode](https://github.com/helius-labs/custom-privacy-rings/blob/02bca33729051798834ecbb4d94e968cdc0ef9b8/docs/design/privacy.md). This tool checks a baseline, not an anonymity guarantee. Production, stronger confidentiality, and dynamic membership retain their separate release gates.

The exact anonymous-validator terminal receipt, full command log and hash manifest are in [evidence/anonymous-validator/](evidence/anonymous-validator/). The earlier interrupted attempts remain recorded separately and are not counted as passes.

The [baseline evidence packet](evidence/baseline-checkpoint/) contains the complete check-all, native build and hermetic command logs, terminal receipts, source/toolchain pins, and recorded key/program identities. The successful validator run used 31 cached keys: 28 from the canonical fetch, two hidden-owner SPP keys, and one additional pinned `merge_ring_8_1.key` fetched by the canonical test recipe. The packet records all key digests and a read-back of the 12 native runtime artifacts. No full SPP catalog download was required.
