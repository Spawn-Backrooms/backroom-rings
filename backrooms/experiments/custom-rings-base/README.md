# Anonymous Custom Rings base: upstream reproduction

This is the first contributor bootstrap for [O05](https://github.com/Spawn-Backrooms/backroom-rings/issues/26) and [CR01](https://github.com/Spawn-Backrooms/backroom-rings/issues/34). It is intentionally separate from the published Backroom Rings v0 package and does not change its build, exports, circuits or release manifests. It does not implement anonymous Backroom operations yet.

## Reproduce the baseline

Use a disposable isolated development VM with no production secrets, wallets, provider credentials, or other localnet workloads. Some upstream localnet recipes clean their work directories and stop local services. Review the pinned upstream commands, install the Rust/Solana toolchain pinned by Zolana, Go from the upstream prover module (1.27.3 at this pin), Node 24+, just, jq and curl. Upstream dependencies and proving-key downloads require network access. The assertion environment variable is a human acknowledgement, not an isolation mechanism.

In the disposable VM:

```bash
git clone --no-recurse-submodules https://github.com/helius-labs/custom-privacy-rings.git custom-rings
git -C custom-rings checkout --detach 02bca33729051798834ecbb4d94e968cdc0ef9b8
git -C custom-rings submodule update --init --recursive
# From the Backroom Rings checkout:
node backrooms/experiments/custom-rings-base/baseline.mjs /absolute/path/to/custom-rings
# After inspecting the planned commands and confirming isolation:
set -o pipefail
SPAWN_DISPOSABLE_LOCALNET=1 node backrooms/experiments/custom-rings-base/baseline.mjs /absolute/path/to/custom-rings --run-localnet 2>&1 | tee /tmp/custom-rings-baseline.log
```

The preflight checks the exact pinned upstream commit and Zolana gitlink/checkouts, clean tracked and untracked working trees, and the absence of root/submodule dotenv files. It reports the proving-key lockfile Git blob identity, not a validation of downloaded key bytes. It does not certify environment isolation or audit source. Use a fresh checkout for each baseline run. The separate public fork is tracked by CR01; the detached upstream checkout unblocks reproduction before the fork exists. Changes to upstream pins need review.

The runner executes the upstream `check-all`, `test-hermetic`, `test-custom-ring` and focused `test-custom-ring-validator` recipes. The exact validator cases are in [anonymous.rs](https://github.com/helius-labs/custom-privacy-rings/blob/02bca33729051798834ecbb4d94e968cdc0ef9b8/program-tests/custom-ring/tests/ring/anonymous.rs). Inspect test output to verify both named tests ran and passed, not just that a filter returned success. Record actual artifact digests, source, toolchain and sanitized logs as required by CR01.

## Verify the bootstrap

```bash
node --test backrooms/experiments/custom-rings-base/baseline.test.mjs
```

Seven tests exercise real temporary Git repositories with synthetic content and a real Git submodule. The tests do not download keys, prove, settle or qualify upstream. At authoring, all seven passed under Node 22.16.0; the upstream build/validator commands were not run because the authoring environment had no network/Rust/Solana toolchain or Node 24. Independent review is outstanding.

## Boundary and next pickup

- [CR02](https://github.com/Spawn-Backrooms/backroom-rings/issues/35): upstream [spec question 8](https://github.com/helius-labs/custom-privacy-rings/blob/02bca33729051798834ecbb4d94e968cdc0ef9b8/docs/spec.md#open-questions-for-the-maintainer) leaves third-party ZK program access to ring notes unresolved. The existing Backrooms bridge uses a public writer signer. Implement the smallest actual onchain composition in separate artifacts and bind the exact ordered settlement and current native authorization.
- [CR03](https://github.com/Spawn-Backrooms/backroom-rings/issues/36): one nonfinancial room, fixed members, one accepted lesson, process restart, later reuse. No fallback to the existing confidential path.
- [CR04](https://github.com/Spawn-Backrooms/backroom-rings/issues/37): independently verify the application and ring proof linkage, state transition and public visibility; publish a reproducible conformance pack.
- [CR05](https://github.com/Spawn-Backrooms/spawn/issues/78): native developer-preview integration after real composition; no production activation.

Upstream anonymous transactions do not hide public enrollment, all transaction metadata, or activity from the designated auditor. See [privacy by mode](https://github.com/helius-labs/custom-privacy-rings/blob/02bca33729051798834ecbb4d94e968cdc0ef9b8/docs/design/privacy.md). This tool checks a baseline, not an anonymity guarantee. Production, stronger confidentiality, and dynamic membership retain their separate release gates.
