# Backrooms v0 implementation evidence

The development example completes a private learning-room lifecycle with real
application proofs, SPP proofs, a local validator, Photon recovery, and two
seeded Flue residents. Model inference is a deterministic local fixture.
This evidence establishes the example's behavior, not production qualification
or model quality.

## Source and runtime

The inspected upstream is
`helius-labs/privacy-rings@42de575202f07adf6cfe9194ae9227445797bd8e`.
The combined client and program were exercised at integrated commit
`19dba6f66efa69a7f5457330e389ad5b9ff09987`. The later documentation and test-comment
cleanup does not change executable behavior.

| Component | Observed version or source |
| --- | --- |
| Rust | 1.98.1 |
| Zolana CLI and prover release | `cli-v0.10.0` |
| Solana toolchain / SBF platform tools | 4.2.2 / v1.54 |
| Photon | Built from the pinned upstream source |
| Node.js / npm | 24.22.3 / 11.19.1 |
| Flue | 2.3.0 |
| Pi AI | 1.1.0 |
| TypeScript | 7.0.2 |
| Client | Unpublished `@spawn-backrooms/backroom-rings@0.1.0-dev.0` |

All generated application keys use insecure deterministic test setup. The
bridge restricts its endpoints to loopback HTTP and checks the retained RPC
genesis and application/SPP program digests. The fixed localnet namespace is
not a general proof of cross-network isolation.

## What passed

| Gate | Result | What it observes |
| --- | --- | --- |
| Native circuit and transition tests | 6 passed | Zero-value genesis, unique address, exact predecessor, immutable bindings, bounded score update, grant binding, invalid recovery payloads. |
| Compiled circuit and proof tests | 2 passed | Actual Groth16 proof generation and verification, finalized transaction linkage, refusal of a rebound grant. |
| Validator lifecycle test | 1 passed | Onchain creation and advancement, encrypted indexed recovery, wrong signer, mixed proof linkage, replay with a fresh signature and blockhash. |
| Bridge expiry test | 1 passed | Natural expiry of genesis and advancement, identical retained intent after reframing, validation of original signatures/accounts/instruction tags, preserved fee configuration. |
| TypeScript client and host tests | 24 passed | Encryption, scoped messages, durable CAS, Flue continuation, single-process ownership, receipt recovery, expiry handling, release eligibility. |
| TypeScript typecheck and build | Passed | Portable client and Node reference-host compilation. |
| Two-process proof-backed Flue demo | Passed | Accepted learning, restart recovery without repeated original inference, behavior changed by the recovered policy. |
| Combined TypeScript/Rust expiry demo | Passed | Both original transactions expire naturally; the final host records replacement frames before submission and completes the same learning/restart loop. |

The validator test observes application error `8101` for an unauthorized writer
and mixed application/SPP transaction linkage. A consumed predecessor under
fresh transaction framing is rejected by SPP with `7043`
(`NullifierAlreadyQueued`). Identical transaction deduplication is not used as
the replay gate. See the [validator test](../../backrooms/program/tests/localnet.rs).

The expiry test waits for real blockhash invalidity. It validates and re-signs
the retained message with a fresh blockhash, compares the entire message after
restoring the original blockhash, submits it, and recovers the originally
authorized checkpoint. It also discovers an already confirmed original rather
than preparing a new intent. See the [bridge test](../../backrooms/program/tests/bridge.rs).

Thirteen TypeScript expiry cases use explicit transport fixtures. They cover
replacement storage before submission, a real SQLite CAS conflict, lost
persistence acknowledgement, restart, lost submit acknowledgement, confirmation
during reframing, invalid parent lineage, live transactions, unknown status, and
unavailable recovery. These fixtures establish consumer behavior; the Rust
validator tests establish ledger behavior.

An additional integration run forwarded the final demo's bridge requests and
responses unchanged while delaying only the two originally prepared
transactions until their actual blockhashes became invalid. Genesis and
advancement both returned `expired`, were reframed, and confirmed. A read-only
check of the encrypted host journal before each replacement submission
verified exact replacement bytes, parent lineage, retained proof/checkpoint
metadata, and the original authorization/nonce fingerprint. There was exactly
one creation preparation and one advancement preparation. Both the accepted
lesson and the second process's zero-repeat-inference assertion passed. This
closes the integration gap between the separate Rust and TypeScript expiry
tests; the delay harness was a verification aid, not an alternate transport
implementation shipped in the package.

The ownership regression uses separate OS processes. It refuses a live
competitor, terminates the owner with `SIGKILL`, then recovers the same resident
identities and original result without another inference call. Startup failure
also releases ownership. See the [ownership tests](../../backrooms/tests/runtime-ownership.test.ts).

## Observed learning loop

1. Genesis creates one unique zero-value room checkpoint with scores `[50, 50]`.
2. The investigator uses procedure 0, `take-first`, and returns `9` for the
   fixture task. The critic proposes sorting before selecting the median.
3. The host retains the original result and one blinded acceptance grant. The
   proof advances the exact predecessor to revision `1`, scores `[40, 50]`.
4. A second Node process recovers the accepted original episode. An assertion
   requires zero additional inference calls at that point.
5. The next episode selects procedure 1, `sort-and-take-median`, from the
   recovered policy and returns `5`.

Each new investigator/critic episode uses four local fixture model calls,
including the tool round trips. Recovery of the completed original uses none.
The changed procedure demonstrates that accepted private state influences
later execution. The proof checks the authorized bounded update; it does not
prove arbitrary inference or certify the critic's judgment.

The chain transaction uses one input and two outputs. One output is the
authoritative room checkpoint; the second is compact padding for the supported
SPP shape. The room is not holding a financial balance.

## Artifact measurements

| Artifact | Measurement |
| --- | --- |
| Application program | `7nA1Dh53c8eUZudEj7vDSvoT9rHapHHuF9NvHRLqjNmi` |
| Application binary | 87,264 bytes |
| Application binary SHA256 | `2c1f20098eb3612b9733c672513353dce8d2f46e1b109fdc6ee3a0bc2d838a17` |
| Create circuit | 8,103 constraints |
| Advance circuit | 22,964 constraints |
| Bridge signed creation / advancement | 1,551 / 1,583 bytes |
| Explicit flat-fee test creation / advancement | 1,559 / 1,591 bytes |

These are measurements of this local test build. They do not establish fees,
throughput, production costs, or performance across other configurations.

## Reproducing the checks

Install the pinned tools and dependencies described in the
[workspace README](../../README.md). Build the same-source Photon and provision
the upstream SPP/prover artifacts before starting the local fixtures. Override
`ZOLANA_CLI_BIN`, `SHIELDED_POOL_PROGRAM_PATH`, `PROVER_BIN`,
`ZOLANA_PHOTON_BIN`, and `SURFPOOL_BIN` when using binaries outside their normal
workspace locations.

The Backrooms recipes are:

```sh
just build-backrooms
just test-backrooms
just test-backrooms-proofs
just test-backrooms-validator
```

The verification environment invoked the corresponding Zolana and Cargo
commands directly because `just` was unavailable. The new recipes were source
reviewed; the recipe runner itself was not exercised.

Run the client checks separately:

```sh
cd backrooms
npm ci
npm test
npm run check
npm run build
```

From the workspace root, run the actual integrated demo with fresh fixture and
host directories:

```sh
BACKROOM_RINGS_RUN_DIR="$PWD/target/backrooms-demo-run" \
BACKROOMS_DEMO_DIRECTORY="$PWD/target/backrooms-demo-host" \
target/debug/backroom-rings-localnet npm --prefix backrooms run demo
```

The launcher supplies the protected bridge configuration and executable to its
child. It refuses to reset a fixture with a retained configuration. Recovering
a real retained room requires reconnecting to its original ledger; replacing
the ledger while keeping host records is not a recovery test.

## Review and limits

Independent implementation review identified two required fixes: overlapping
Flue runtime ownership and expiry of retained signed transactions. Both have
dedicated regressions. Review of this application extension is not an audit of
the entire upstream protocol, runtime, dependencies, or cryptographic setup.

The full upstream workspace suite was not run. No live paid inference,
deployment, public package release, or default rollout is established by this
evidence. Flue conversation storage remains plaintext within the trusted host;
the host and application prover can see authorized plaintext. See the
[privacy contract](PRIVACY.md) for the exact boundary and the separate
production qualification requirements.
