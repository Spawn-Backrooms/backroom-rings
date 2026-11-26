# Anonymous room localnet preview: contributor quickstart

This guide assembles the public source used by the O05 preview. Check
[APPLICATION-EVIDENCE.md](APPLICATION-EVIDENCE.md) for the current qualification
and [NATIVE-ADAPTER-HANDOFF.md](NATIVE-ADAPTER-HANDOFF.md) for the native contract.
The exact-source upstream baseline has its separate evidence in
[PR 38](https://github.com/Spawn-Backrooms/backroom-rings/pull/38).

Use an isolated development environment with the pinned upstream build tools.
The profile operates on synthetic, zero-value application state and local
validator fee funding. Its inference is the existing deterministic Flue fixture;
no provider account or inference secret is needed.

## 1. Obtain the public sources

Choose a new working directory. The native Custom Rings checkout stays clean;
the application checkout receives the experimental overlay. The Backrooms host
stays at its exact source pin while a separate worktree supplies this preview's
documentation and patch.

```sh
export SPAWN_PREVIEW_DIR="$PWD/spawn-anonymous-preview"
mkdir -p "$SPAWN_PREVIEW_DIR"
cd "$SPAWN_PREVIEW_DIR"

git clone https://github.com/Spawn-Backrooms/backroom-rings.git backroom-rings
git -C backroom-rings checkout --detach 08822c65254cd73c5f2dccbdf182ce1df2c7510a
git -C backroom-rings worktree add ../backroom-preview \
  origin/experiment/cr02-anonymous-advance-conformance-20261123

git clone --no-recurse-submodules \
  https://github.com/Spawn-Backrooms/custom-privacy-rings.git custom-rings-native
git -C custom-rings-native checkout --detach 02bca33729051798834ecbb4d94e968cdc0ef9b8
git -C custom-rings-native submodule update --init --recursive

git clone --no-recurse-submodules \
  https://github.com/Spawn-Backrooms/custom-privacy-rings.git custom-rings-app
git -C custom-rings-app checkout --detach 02bca33729051798834ecbb4d94e968cdc0ef9b8
git -C custom-rings-app submodule update --init --recursive

python3 backroom-preview/backrooms/experiments/custom-rings-base/fork-overlay/apply-overlay.py \
  "$SPAWN_PREVIEW_DIR/custom-rings-app" --apply
```

The helper checks the exact Custom Rings commit, Zolana commit
`0fe4f952182b39464d472c52c40b3febe6cbd9ec`, clean source, patch digest and every
resulting file. Record the preview worktree's commit and patch manifest with
your own run. Fork write access is unnecessary to clone or apply this patch.
The public fork retains upstream history and Apache-2.0 attribution.

## 2. Install dependencies and build native services

At these pins, Go is `1.27.3`, Rust is `1.98.1`, Node is at least `24`, and the
application SBF build uses platform tools `v1.54`. Follow the pinned upstream
toolchain instructions for Agave/SBF, Surfpool, `just`, `cargo-nextest`, and
native compiler dependencies, plus `lsof` and the external `kill` command for
scoped shutdown. On Debian, install `lsof` and `procps`. Both JavaScript projects
have committed lockfiles.
The actual qualification environment and downloaded artifact identities are
recorded with the evidence; a newer toolchain needs its own verification.

```sh
npm --prefix "$SPAWN_PREVIEW_DIR/custom-rings-app" ci
npm --prefix "$SPAWN_PREVIEW_DIR/backroom-rings/backrooms" ci

cd "$SPAWN_PREVIEW_DIR/custom-rings-native"
CARGO_BUILD_JOBS=1 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 \
  JUST_NO_DOTENV=true just build-programs build-localnet-tools fetch-custom-ring-keys

RING_EXTRA_SPP_KEY='transfer_eddsa_ring_1_2.key transfer_eddsa_ring_2_2.key' \
  JUST_NO_DOTENV=true just fetch-custom-ring-keys
```

The last command fetches only the two additional hidden-owner SPP keys needed
by this journey. The pinned fetch recipe and the application runner check key
sizes and SHA-256 values. Do not download the full SPP catalog for this profile.

The upstream validator baseline additionally needs the separately locked Squads
program artifact. Download and verify the exact release artifact used in the
recorded environment:

```sh
cd "$SPAWN_PREVIEW_DIR/custom-rings-native"
mkdir -p zolana/target/deploy
curl --fail --location \
  --output zolana/target/deploy/squads_smart_account_program.so \
  https://github.com/helius-labs/zolana/releases/download/cli-v0.10.0/squads_smart_account_program-cli-v0.10.0.so
printf '%s  %s\n' \
  1c95bd7be140589d2aec38a85d7ecfe70ec69639277f622c898f821ab1d636fa \
  zolana/target/deploy/squads_smart_account_program.so | sha256sum --check
```

The file is 1,651,997 bytes and its identity is pinned in
`zolana/cli/release-artifacts.lock`. A digest mismatch must stop preparation.

## 3. Prepare the separate application profile

```sh
cd "$SPAWN_PREVIEW_DIR/custom-rings-app"
GOMAXPROCS=1 GOMEMLIMIT=3GiB CARGO_BUILD_JOBS=1 \
  CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 \
  tools/prepare-spawn-room-localnet.sh
JUST_NO_DOTENV=true just build-ring-rpc
npm run build:ts
```

First preparation performs the two full application setups/proofs, exports
their verifier constants with the pinned upstream exporter, updates the SDK
key fingerprints and public proof vectors, verifies Go/Rust interoperability,
and builds the separate prover and SBF program. It is substantially more
expensive than launching a previously prepared run.

Fresh setup is randomized. Your new proving keys, verifier constants, public
proofs and program digest will differ from this preview's recorded run. The
preparation script updates the matching artifacts together; preserve its own
ignored `target/spawn-room-keys` directory and record your resulting source and
artifact hashes. Explicit reuse verifies the complete compiled R1CS fingerprint
before reusing a local key. These are insecure single-party localnet setups.

No application preparation step replaces the native baseline's keys/program
or the existing Backrooms v0 artifacts. Private witness requests, signing
material and large proving keys stay in ignored working directories.

## 4. Start one complete journey

Create `localnet-run.json` outside tracked source, replacing the absolute paths:

```json
{
  "disposableLocalnet": true,
  "nativeRepo": "/absolute/path/spawn-anonymous-preview/custom-rings-native",
  "referenceHostRoot": "/absolute/path/spawn-anonymous-preview/backroom-rings/backrooms/reference-host",
  "binaries": {
    "surfpool": "/absolute/path/to/surfpool",
    "solana": "/absolute/path/to/solana",
    "solanaKeygen": "/absolute/path/to/solana-keygen"
  }
}
```

Then, from `custom-rings-app`:

```sh
node tools/run-spawn-room-localnet.mjs --config /absolute/path/to/localnet-run.json
```

This single command starts its validator, Photon, ring indexer, separate
application prover, local KMS and RingRPC; executes the actual journey; and
stops its owned services. The runner uses `custom-rings-app/target/debug/ring-rpc`
by default. Build it in step 3 to include the application auditor decoder.
The clean checkout supplies Zolana, Photon and the ring indexer. For ports,
binary overrides, dependencies, evidence paths and failure handling, see the
patched `tools/spawn-room-localnet.md`.
All client URLs use loopback. Pinned Photon binds to `0.0.0.0`, so keep this
runtime isolated without publishing its listener.

The journey must create two eligible room notes for distinct enrolled writers,
settle the primary room's authorized hidden update, exit its first native
process, recover the exact transaction and successor in another process, and
settle a later task that uses the retained lesson. It also exercises a
controlled stop after durable confirmation, another fresh retry and completed
job re-entry without additional inference. The coordinator stays running;
the controlled interruption is not presented as a power-loss test.

The same run requires duplicate-genesis, generic-bypass, replay and revoked
grant transactions to fail with unchanged accepted state. A coherent third
proof must simulate successfully before its admission is revoked.

## 5. Inspect the result

A fresh private run directory contains `run-receipt.json`,
`journey-evidence.json`, `vitest-results.json`, separate native process traces
and exit records, measured runtime/resource data, and diagnostic logs. A pass
requires executed, unskipped tests, all 26 named journey steps passing exactly
once, source stability and completed service cleanup. The auditor must open
the confirmed room output and return the successor state hash after its
enrollment index catches up. A missing or mismatched hash cannot pass.
The retained 26-step run verified the owner record only. Its data-hash result
remains false pending a fresh run of this harness.

Do not publish the entire directory: it also contains local signing material,
databases and private logs. Publish a reviewed synthetic evidence extract with
the source/patch/key/program hashes, chain transaction identities, test results,
separate process exits, runtime/resource scope and public disclosure findings.

Enrollment and genesis remain public. Payer/timing metadata and global
configuration changes remain visible, the designated auditor can read the ring
stream, and the native host retains private learning records. This preview does
not activate a native production UI or qualify stronger operator/provider,
membership or network anonymity. Native product activation and production
qualification have their own acceptance gates.
