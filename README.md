# Backroom Rings

**Programmable private state across financial and agent workloads.**

Backroom Rings is a public fork of [Helius Privacy Rings](https://github.com/helius-labs/privacy-rings), formerly Zolana. The inherited Solana protocol, SDK, Photon indexer, prover, and operator tooling keep their financial use cases: shielded value and authorized settlement remain first-class. This fork extends the same foundations to compute and knowledge: bind an authorized operation to its original inputs and result, prove a defined state transition, and recover the accepted state without repeating the operation. An application does not have to move money to need those guarantees.

SPAWN Backrooms is the first integration. The fork is designed for other runtimes and applications as well. The public interface is the client, gateway, bridge, and application program; a third-party host supplies its own admission, execution, and acceptance policy. See the current profile and constraints below before choosing a deployment.

## What can use Rings?

| Workload | What Rings is for | Status in this fork |
| --- | --- | --- |
| **Markets and money** | Shielded value and authorized transaction transitions under the underlying Solana protocol. | Upstream programs, SDK, CLI, prover, and indexer are retained. Compatibility and deployment qualification remain distinct from fork source. |
| **Inference and agent execution** | Associate an authorized invocation with its retained input/output evidence and admit an approved outcome as a state transition. A model call is an off-chain effect, not a transaction proof. | The reference Flue host uses deterministic model fixtures. General model/provider adapters and attested or operator-blind inference are not established by this profile. |
| **Retained knowledge** | Advance a checkpoint to one accepted successor after review; a new process can recover it and use the accepted state. | The proof-backed development example uses real app and pool proofs, a local validator and Photon. The current policy is bounded to a room profile; it is not a proof that a lesson is true, useful, or lawful to transfer. |
| **Other application state** | An application can define its own admission policy and prove a transition that consumes a specific predecessor. Think research pipelines, reviewed artifacts, or stateful workflow checkpoints that need provenance. | This is the integration direction, not an application-agnostic proving SDK. Start from the reference host and bridge contract; a new transition or trust model needs its own policy, circuit or program as appropriate, and evidence. |

## Architecture and trust

```text
Application host
  owns identity, admission, original execution and acceptance
    -> TypeScript client / authenticated gateway
       binds room scope; retains original signer frames and receipts
         -> Rust bridge / application program / SPP
            checks the authorized predecessor-to-successor transition
                  -> Solana state + Photon recovery
```

- **Host policy is not delegated to a proof.** The host decides which result, provenance, and review authorize a transition. The proof checks the transition encoded in the program. It does not verify what model executed, whether its answer was correct, or whether an application ought to accept it.
- **An effect and a proof are different operations.** Keep the original execution identity and recover it before retry. The gateway retains signer frames; a reframe after expiry uses the same operation under its recovery policy. Do not resubmit a model call or financial instruction just because an acknowledgement is missing.
- **Privacy has a stated reader set.** Encryption protects journal and message bytes, not every place plaintext is processed. The authorized host and application prover can read the inputs they receive; external inference providers could read the admitted request. The reference Flue store can retain plaintext locally. Chain and indexer metadata remain visible. See the [privacy and acceptance contract](docs/backrooms/PRIVACY.md).
- **Current Backroom profile.** The v0 example has one owner, two fixed residents, one authorized writer, and one accepted episode at a time. The versioned lesson is limited to 96 UTF-8 bytes, with a bounded procedure and feedback model. A zero-value checkpoint records accepted state; advancing consumes the exact predecessor and produces one successor. Do not assume this permits arbitrary delegation, concurrent writes, generalized memory transfer, or a mainnet deployment.

## Repository map

| Path | Role |
|---|---|
| `programs/` | On-chain SPP programs, including `shielded-pool` |
| `program-libs/` | Shared Rust interface crate |
| `program-tests/` | Internal test crates and test-only SBF programs |
| `sdk-libs/` | Rust SDK, client, and indexer API crates |
| `cli/` | Zolana developer and operator CLI |
| `services/photon/` | Photon indexer, migrations, snapshots, and JSON-RPC service |
| `protocol-ops/` | Protocol operator CLI, forester, batch prover, instruction builders, smart accounts, and reference trees |
| `prover/` | Go prover server + Rust prover client |
| `xtask/` | Workspace dev tooling |
| `backrooms/` | TypeScript client, Flue adapter, reference hosts, and development examples |
| `backrooms/program/` | Rust bridge, room-transition application program, circuits, verifier and localnet test tools |
| `docs/backrooms/` | Gateway, privacy, qualification and contribution contracts |

## Choose an integration path

| I need to… | Start here |
| --- | --- |
| Integrate a host or an execution service without SPAWN | [Authenticated gateway](docs/backrooms/GATEWAY.md) and [client package](backrooms/package.json). `RingsClient` accepts a `RingsTransport`; the optional authenticated client uses Fetch and WebCrypto. The reference host can run without a SPAWN account or control plane. |
| Inspect the Flue reference and first profile | [Backrooms development guide](backrooms/README.md), including the two-process learning and recovery example. `EpisodeAuthority` and `ResidentRuntime` are the host integration boundaries; the Flue adapter supplies the reference residents. |
| Implement or inspect a transition | [Rust bridge contract](backrooms/program/bridge-contract.md). Pin the application proof, program, verifier and setup together. A host policy change is different from a circuit change. |
| Work on money movement or infrastructure | The Solana workspace below: program, SDK, indexer, prover, CLI and operator recipes. No agent runtime is required for the upstream flow. |
| Plan production operations | [Production requirements](docs/backrooms/PRODUCTION.md) and the [evidence record](docs/backrooms/VERIFICATION.md). Verify the intended deployment and exact state before using funds or production data. |

### Run the TypeScript path

Use Node.js 24 or newer. From the repository root:

```sh
cd backrooms
npm ci
npm run check
npm test
npm run build
```

This exercises client and host code, Flue conversations, SQLite retention, WebCrypto, and recovery. Tests with synthetic bridge or model responses do not prove validator execution or real inference. The package at this revision is unpublished; build from a pinned checkout rather than assuming a registry release exists.

For the proof-backed example, build the Rust bridge and start the pinned local validator, prover, and Photon as described in the [bridge contract](backrooms/program/bridge-contract.md). From `backrooms/`, point the demo at that verified local configuration:

```sh
BACKROOM_RINGS_BRIDGE=/absolute/path/to/backroom-rings-bridge \
BACKROOM_RINGS_CONFIG=/absolute/path/to/localnet-config.json \
npm run demo
```

The demo starts a process that accepts a reviewed lesson, then a second process that recovers the accepted checkpoint and uses it. Model outputs are deterministic fixtures. The [verification record](docs/backrooms/VERIFICATION.md) records exact revisions, fixtures and limitations; do not substitute the newest commit for the one the evidence actually covers.

## Build and test the protocol workspace

The following toolchain, dependency, CLI, and test guidance comes from the inherited Helius workspace. Build recipes are local entry points; workflow definitions below are not a claim about enabled publishers, fork releases, or deployed production configuration.

## Build from a fresh clone (Ubuntu / Debian)

Install Rust with rustup, then run these commands from the repository root.
`build-essential` alone is enough for the default Rust build, but the full
workspace also compiles Go libraries and native dependencies.

```bash
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  build-essential ca-certificates git curl python3 \
  clang libclang-dev cmake pkg-config libssl-dev protobuf-compiler golang-go

# Load rustup's tools in this shell if you just installed Rust.
. "$HOME/.cargo/env"
rustup toolchain install   # uses rust-toolchain.toml (currently Rust 1.98.1)
cargo install just --locked

just build                # compile the default workspace members
just check-all            # type-check all workspace members and targets
just build-cli            # target/debug/zolana
just build-photon         # target/debug/photon
```

Use `apt` on Ubuntu / Debian; `apk` is Alpine's package manager. These steps
were checked on Ubuntu 24.04, not Alpine.

The Go modules require Go 1.27.3. With the default `GOTOOLCHAIN=auto`, the Go
package supplied by Ubuntu 24.04 downloads the required toolchain on first use.
If automatic toolchain downloads are disabled, install Go 1.27.3 or newer
separately. Go, Clang, and libclang are required by `just check-all`, because
Rust build scripts compile the example prover libraries and generate bindings.
Python 3 is used when `just` evaluates the root justfile.

The first build needs network access for Rust/Go toolchains and dependencies,
including Cargo git dependencies. `just build` uses the narrow default member
set; it does not build the CLI, Photon, or deployable Solana programs. For SBF
programs and tests, install the additional tools listed below.

Dependency updates retain the Solana/SBF compatibility constraints in
`Cargo.toml`. All Go prover modules use gnark 0.16.3 and gnark-crypto 0.21.0.
Circuit-changing upgrades require rotating the proving keys, embedded Rust
verifying keys, key checksums, and circuit fingerprints together. The core
rotation workflow is `prover/server/scripts/rotate_proving_keys.sh`. The
example programs use insecure deterministic test keys, UNSAFE for production:
`regen-swap-keys` rewrites its verifying keys and checksum manifest.
`regen-dynamic-swap-keys` and `build-escrow-program` generate native proving keys
under `target/zk` and committed verifier modules in each program's `src/verifier`
directory. None of these keys is published.
`just prover-server-test` checks the committed fingerprints; do not refresh
them without rotating the matching keys.
A rotated key set requires deploying the matching on-chain programs and prover
artifacts together; proofs from the previous key set will not verify against
the new programs. Keep old key releases and object-store prefixes available
for clients still using the previous programs.

## Common entry points

All workflows go through `just`. Run `just` with no arguments for the full list.

```bash
just check-all         # cargo check across the workspace
just test-hermetic     # fast suite that needs nothing running
just test-all          # adds the prover-backed suites
just test-photon       # Photon unit and SQLite-backed integration tests
just build-photon      # Build the same Photon binary localnet tests execute
just verify-rust       # check + Rust tests
just verify            # verify-rust + prover/server go tests
```

## Fast versus full

Tests are split by what has to be running.

- `just test-hermetic` is the whole hermetic suite of SDK, ring, LiteSVM,
  Mollusk, and Photon tests. It needs no prover, no validator, no network, and no
  proving keys at test runtime. Building the suite first requires the tools
  below and may download dependencies and SBF platform tools. The upstream workspace uses these suites in CI. Verify the fork's enabled checks separately.
- `just test-all` adds the prover-backed suites. They spawn a prover server and
  pull proving keys, up to 5.4 GB for the full set. Run them when you touch a
  circuit or a proof path.
- The validator suites are separate recipes, `just test-spp-validator` and
  friends. They start a local validator, Photon, and a prover.

Everything prover-backed is behind a Cargo feature, so a plain `cargo test -p
<crate>` never starts a prover. `spr-client` uses `proofs`, and
`shielded-pool-tests` uses `proofs` and `localnet`.

The Cargo workspace's `default-members` is deliberately narrow — `forester`,
`program-libs/interface`, and `programs/shielded-pool` — so a bare `cargo check` from the root
hits the production-critical surface quickly. For full-workspace coverage use `just check-all`.

## Install the CLI

Download the prebuilt `zolana` binary for your platform from the
[`cli-v0.10.0` release](https://github.com/helius-labs/zolana/releases/tag/cli-v0.10.0)
(`zolana-linux-x64-cli-v0.10.0`, `zolana-darwin-arm64-cli-v0.10.0`; checksums in
its `SHA256SUMS`), or build it from the repository (it pulls the workspace's git
dependencies; not published to crates.io):

```bash
cargo install --git https://github.com/helius-labs/zolana --tag cli-v0.10.0 spr-cli
```

`zolana dev start` then fetches a version-pinned, pre-initialized localnet
(the deployed programs, account snapshots, prover, and Photon) from the pinned
releases. See [`cli/README.md`](cli/README.md) for commands, `zolana dev
artifacts` and the `--local` dev flow.

## CI

Workflows under `.github/workflows/`:

- `rust.yml` — fmt, clippy, machete, check-all, per-area unit tests
- `photon.yml` — Photon contract tests, migrations, schema drift, and service tests
- `publish-image.yml` — container smoke tests, and publishes photon, prover and forester images to ECR
- `prover-server.yml` — Go test suite
- `xtask-verifying-keys.yml` — xtask verifying-key smoke against the Go prover
- `gpu-deploy-scripts.yml` — GPU deployment script checks and gateway test
- `enforce-pr-only.yml` — fails direct pushes to `main`

Area-specific workflows use path filters where appropriate. The shared Rust setup lives in
`.github/actions/setup-rust` (toolchain + cache + just).

Direct push protection on `main` requires repo Settings → Branches → Branch protection rules.
The workflow is a backstop, not the enforcement.

## Local prerequisites

- Rust 1.98.1 (pinned by `rust-toolchain.toml`)
- Native build dependencies and Python 3 as installed above
- `just` — `cargo install just --locked`
- `cargo-nextest` for the Rust test recipes —
  `cargo install cargo-nextest --locked`
- Go 1.27.3 or newer (for full-workspace checks, example prover libraries,
  and `prover/server` builds/tests)
- PostgreSQL 16 for the Photon production-database migration smoke test
- Anza / Solana CLI 4.x providing `cargo build-sbf` for SBF program builds,
  including `just test-hermetic`; `just build-programs` pins platform tools to
  `v1.54` by default and downloads them on first use
- `just build-cli`, `just install-surfpool`,
  `just build-prover-server`, and `just build-programs` for local validator flows
- Go for `just xtask-create-verifying-keys-smoke`, which exports through the
  prover server. It fetches the one proving key it needs into `target/` and
  checks it against the lockfile sha256.

## Contribute to the fork

Start in the [Rings issue board](https://github.com/Spawn-Backrooms/backroom-rings/issues) and read the [Backrooms contribution guide](docs/backrooms/CONTRIBUTING.md). If a change concerns upstream program compatibility, isolate it from SPAWN and host-specific concerns. Changes to SPAWN work orders, room specifications or hosted orchestration belong in [SPAWN Core](https://github.com/Spawn-Backrooms/spawn) and its authorized integration path, not in the Rings protocol.

In a review, record the application, exact revision, input and final receipt, and which gate actually ran: client fixtures, hermetic Rust tests, prover-backed tests, local validator and Photon, actual provider, or authenticated production. Preserve upstream Git history, licenses and notices. Backrooms additions use [Apache-2.0](backrooms/LICENSE).
