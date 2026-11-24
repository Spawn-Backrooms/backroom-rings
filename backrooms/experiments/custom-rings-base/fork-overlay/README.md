# Anonymous Backroom application overlay

This directory carries the implemented experimental application profile for
[Spawn-Backrooms/custom-privacy-rings](https://github.com/Spawn-Backrooms/custom-privacy-rings).
It is published here because the active GitHub integration can read that fork
but branch creation is denied (HTTP 403; repository metadata reports `push: false`).
The overlay retains the upstream repository and license history and does not
modify the existing Backrooms v0 source or artifacts.

The actual combined genesis and hidden-advance proofs have been generated and
verified in Go and Rust, and the dedicated program has built to SBF. The live
validator create/advance/restart/reuse journey remains a separate delivery gate.
See [APPLICATION-EVIDENCE.md](../APPLICATION-EVIDENCE.md) for the exact completed
checks and limitations. The earlier synthetic oracle and initial two-file
candidate are historical checkpoints; the complete patch supersedes them.

## Apply to the pinned fork

Use a clean recursive checkout on an isolated review branch with these exact pins:

| Source | Commit |
| --- | --- |
| Custom Rings | `02bca33729051798834ecbb4d94e968cdc0ef9b8` |
| Zolana / Privacy Rings submodule | `0fe4f952182b39464d472c52c40b3febe6cbd9ec` |
| Backrooms native runtime used by integration | `08822c65254cd73c5f2dccbdf182ce1df2c7510a` |

`application-core.patch` includes the dedicated program dispatcher changes and
additive Go/Rust sources. Its manifest records the patch SHA-256 and every
resulting file's SHA-256. Apply it once to the clean base; do not copy the
obsolete initial two-file candidate first.

```sh
python3 backrooms/experiments/custom-rings-base/fork-overlay/apply-overlay.py /path/to/custom-privacy-rings
python3 backrooms/experiments/custom-rings-base/fork-overlay/apply-overlay.py /path/to/custom-privacy-rings --apply
```

The first command checks source pins, cleanliness, digest and applicability. The
second performs those checks again, applies the patch, and verifies all resulting
file hashes. It does not regenerate keys, install dependencies or run services.

## Implemented proof and program boundary

The application wraps the complete pinned transfer circuit and binds the actual
old/new note DataHash to the private state and currently admitted grant. Hidden
advances require one live zero-value input/output, immutable owner and room
binding, a bounded accepted lesson, exact revision increment, and bounded policy
score update. All other slots are dummy; public legs, visible owner signers,
voucher/delegate/entry/address/exit paths are refused.

Each new proof has two public inputs in order: the upstream transfer statement
and the application statement. The latter binds the deployment domain and the
live authorization root/epoch. The dedicated program reads those values from its
canonical configuration account and selects the corresponding compiled key.
Its restricted dispatcher excludes alternate generic settlement entrances.

Visible genesis has its own key, canonical initial state and permanent unique
marker. Hidden advances do not include that room marker, public writer or
individual grant identifier. Enrollment, genesis, global authorization updates,
fee payer, timing and other transaction metadata remain visible; the designated
auditor and private native authority retain their documented access.

## Local key preparation

After installing the pinned toolchains and dependencies, run from the patched
Custom Rings checkout:

```sh
tools/prepare-spawn-room-localnet.sh
```

This creates or explicitly reuses two local experimental keys, checks the full
compiled constraint-system fingerprint on reuse, proves both circuits, exports
Rust verifier constants and public proof vectors, builds the separate prover,
checks Rust proof verification, and builds the dedicated SBF profile. It uses
the upstream exporter. Cached upstream keys are reused without altering their
catalogs. Private witness requests and large proving keys remain in ignored
`target/` directories.

The committed keys and proof vectors are from an **insecure single-party localnet
setup**. They require the explicit `spawn-room-v1-localnet-keys` feature and must
never authorize a production deployment. Ordinary upstream and v0 keys are
unchanged. The profile without its explicit key feature fails closed.

## Review and remaining integration

[APPLICATION-REVIEW.md](../APPLICATION-REVIEW.md) records the independent core
source review and its scope. The SDK/native runtime and full validator journey
require their own final evidence. A native root publisher admits exact grants;
the circuit does not prove the truth of an original external result. Owner
authorization binds encrypted transaction data, but a malicious authorized
writer can still withhold or corrupt its own recovery payload.

Keep CR01–CR04 open until their actual acceptance gates are met. A passing local
fixture does not establish anonymity against every host, auditor or network
observer, and it does not qualify a production trusted setup.
