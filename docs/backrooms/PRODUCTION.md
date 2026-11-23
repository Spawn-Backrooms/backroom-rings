# Production gateway and release inputs

The public gateway has one custody and transaction journal implementation, with explicit `synthetic_localnet` and `production` modes. Production startup requires an independently approved version 1 release manifest and verifies the runtime it will actually use. The development manifest remains readable, but cannot qualify production.

This implementation does not supply a ceremony, a production deployment, a TEE provider, or an inference attestation. Those are real operating inputs. Tests with synthetic files exercise rejection and lifecycle behavior; they do not qualify those inputs.

## Trust boundary

| Component | What production enforces | Who can see private inputs |
| --- | --- | --- |
| Gateway | Authenticated requests, encrypted durable custody and journals, retained release identity, exact frame recovery | The trusted gateway operator |
| Application prover | Local Xark proof; exact circuit, schema, PK, VK and metadata bytes; verification against the compiled application VK before pool proving | The trusted bridge host |
| Pool prover | Caller-pinned upstream `TeePolicy`, fresh TDX or Nitro evidence, encrypted requests, exact attested key inventory, pinned proof verification | The accepted confidential prover runtime |
| Indexer | Locally supervised, hash-verified Photon, loopback binding, private startup receipt, retained database identity, fresh complete scans | Encrypted on-chain data and query metadata are visible to this trusted host |
| Inference | Remains the native authority's separately configured execution path | As disclosed by that native path; this gateway makes no attested-inference claim |

The RPC endpoint is an explicit trusted chain observation source. The Rust bridge checks its genesis and both deployed program payloads before operations. Production RPC disables redirects and proxies. Application and pool programs must be immutable legacy BPF deployments or finalized upgradeable-loader deployments with no upgrade authority. Loader v4 is refused until its finalization semantics receive separate qualification. A deployment whose pool remains upgradeable is outside this production policy.

## One deployment identity

`backrooms/program/identity/development.json` preserves the existing localnet identity. A production identity has the same fields, with `mode: "production"`, a released artifact version, a new program ID, deployment number and program domain. Schema version, policy and lesson capacity remain the implemented values. The strict decoder is [`deployment.ts`](../../backrooms/client/deployment.ts).

From `backrooms/`, after `npm run build`:

```sh
node dist/releases/prepare.js profile /absolute/identity.json /absolute/new-release-directory
```

The command creates a new directory and refuses to overwrite one. The build script generates the program ID, deployment/domain constants, authority seed, artifact version and identity digest from that file.

The compile-only `release-circuits` feature permits circuit generation before the external setup exists. It includes `build-circuits`, which excludes the executable application entrypoint, instructions and client. It cannot be combined with the deployable `production` feature.

From the repository root, with an absolute release directory:

```sh
BACKROOM_RINGS_RELEASE_DIRECTORY="$RELEASE_DIRECTORY" \
zolana zk compile -p backroom-rings-program \
  --r1cs-features release-circuits --skip-keys --skip-wasm \
  --r1cs-out "$RELEASE_DIRECTORY"
```

Keep each compiled circuit's complete export for the setup ceremony. Production cannot import the repository's committed insecure keys. `zolana zk setup --test` and ordinary single-party setup do not produce eligible release inputs.

## Qualified keys and build approval

Obtain externally qualified phase-2 or MPC keys for these exact circuits. Preserve the original metadata and ceremony provenance. Follow the upstream [setup and verifier export procedure](../../sdk-libs/program/README.md). Its trusted checksum file pins `pk.bin`, `vk.bin` and `metadata.json`, and `zolana zk export-verifier` checks the PK/VK pair before exporting.

Run verifier export in a disposable checkout of the same source commit, using the completed artifact directory and its independently checked checksum file. The upstream exporter writes generated source in that checkout:

```sh
zolana zk export-verifier -p backroom-rings-program \
  --out "$RELEASE_DIRECTORY" --checksums /absolute/trusted-keys.sha256
```

Copy the two exported `.vk.rs` files into `$RELEASE_DIRECTORY/verifiers/`. Build the final binaries from the clean pinned source checkout, using those external verifier files. No committed insecure setup marker is rewritten.

The release directory must contain:

| Path | Input |
| --- | --- |
| `deployment/identity.json` | The single deployment profile |
| `create_room/` and `advance_room/` | `circuit.xbc`, `schema.json`, `pk.bin`, `vk.bin`, `metadata.json` |
| `verifiers/create_room.vk.rs` and `verifiers/advance_room.vk.rs` | Qualified verifier exports |
| `prover/policy.json` | Caller-approved upstream TDX or Nitro policy |
| `prover/pool-keys.json` | Inventory obtained over the attested encrypted catalog |

Create build inputs from the supplied files and provenance document:

```sh
node backrooms/dist/releases/prepare.js build-inputs \
  "$RELEASE_DIRECTORY" /absolute/ceremony-provenance-document
```

This writes `deployment/schema.json` from the identity and actual circuit schemas, and `build-inputs.json` with measured identity, schema, circuit, PK, VK, verifier source and provenance digests. It prints a **candidate** build-input digest. An independent release review must approve that digest; the command does not approve it.

Production compilation requires both the release directory and the independently approved build-input digest:

```sh
export BACKROOM_RINGS_RELEASE_DIRECTORY="$RELEASE_DIRECTORY"
export BACKROOM_RINGS_BUILD_APPROVAL_SHA256="$APPROVED_BUILD_INPUT_DIGEST"

cargo build --release -p backroom-rings-program \
  --no-default-features --features production,bridge \
  --bin backroom-rings-bridge

cargo build-sbf --manifest-path backrooms/program/Cargo.toml -- \
  --no-default-features --features production,bpf-entrypoint

cargo build --release -p photon-indexer --bin photon
```

The build rejects absent approval, changed identity or verifier bytes, insecure setup markers, and a verifier whose embedded PK pin differs from the approved input. `production` cannot be combined with the default `insecure-test-setup` feature. Run `zolana vks check --so <application.so> --expect <trusted-keys.sha256>` as part of independent build verification.

## Confidential pool prover inventory

The bridge's inspection command uses the same upstream confidential transport as production. It sends no witness or transaction:

```sh
/absolute/backroom-rings-bridge --inspect-prover \
  https://your-prover-host /absolute/policy.json > /absolute/pool-keys.json
```

The endpoint must use HTTPS without embedded credentials, query parameters or a fragment. The policy must contain genuine caller-approved measurement pins and a maximum attestation age of 1–600 seconds. Missing, malformed or mismatched evidence fails before a witness is sent. The inventory is fetched through the attested encrypted catalog; an unauthenticated public catalog cannot supply it. Copy the approved policy and resulting inventory into `prover/` before creating a release candidate.

Each production bridge invocation attests and compares the complete key inventory. `with_proving_keys` then restricts proving to that inventory and verifies the returned proof under its pinned key. Upstream transport refuses redirects and plaintext fallback. This protects pool witnesses. The local application proof remains a separate trust claim.

## Release candidate and approval

`createReleaseCandidate` takes a JSON request with these fields:

- `directory`, `bridge`, `indexer`, `applicationProgram`, `shieldedPoolProgram`: absolute paths to supplied artifacts.
- `metadata`: the existing release metadata object, including actual source commits, released client version and package integrity, service versions, genesis, pool program ID and independent qualification evidence.
- `tree`: the exact pool tree address and ID.
- `indexerStartSlot`: the approved earliest indexed slot as a decimal string. It must include all required pool and room history; use genesis unless a later boundary has been independently justified.
- `approvedBuildInputsSha256`: the independent build approval.

The program artifacts must be the exact deployed executable payloads, including allocation padding when present. The candidate tool measures them; the runtime checks those hashes against the chain. It does not deploy or modify programs.

```sh
node backrooms/dist/releases/prepare.js manifest \
  /absolute/release-request.json /absolute/new-release-manifest.json
```

The tool measures all runtime files, checks both binaries' setup markers, checks the bridge's compiled identity and circuit pins, and derives program identity and artifact version from the profile. The printed manifest digest is a candidate, never an approval. Supply the independently approved canonical manifest digest in the gateway configuration.

## Running the gateway

Node 24 or later is required. Use an owner-only configuration file, owned by the process user, with no unknown fields. Paths below and the bracketed values are illustrative; substitute the approved release and real service configuration.

```json
{
  "version": 1,
  "mode": "production",
  "databasePath": "/srv/backrooms/gateway.sqlite",
  "releaseManifestFile": "/srv/releases/backrooms/release.json",
  "approvedManifestSha256": "<approved canonical manifest SHA256>",
  "authenticationKeyEnvironment": "RINGS_GATEWAY_AUTH_KEY",
  "storageKeys": {
    "currentKeyRef": "custody_v1",
    "keys": { "custody_v1": "RINGS_CUSTODY_KEY_V1" }
  },
  "bridge": {
    "configuration": {
      "rpcUrl": "https://your-rpc-host",
      "proverUrl": "https://your-prover-host",
      "treeAddress": "<approved tree address>",
      "treeId": 0,
      "genesisHash": "<approved genesis hash>"
    },
    "artifacts": {
      "directory": "/srv/releases/backrooms",
      "bridge": "/srv/releases/bin/backroom-rings-bridge",
      "indexer": "/srv/releases/bin/photon"
    },
    "indexer": {
      "port": 8784,
      "databasePath": "/srv/backrooms/photon.sqlite",
      "startSlot": "0"
    },
    "timeoutMs": 600000
  },
  "listener": {
    "mode": "trusted_proxy",
    "port": 8783,
    "publicOrigin": "https://your-gateway-host"
  }
}
```

Set each named secret environment variable to an independently provisioned 32-byte key encoded as 64 lowercase hexadecimal characters. Keep historical custody keys configured while their retained rows exist. The CLI does not log keys, original requests or bridge diagnostics.

```sh
chmod 600 /absolute/gateway.json
node backrooms/dist/gateway-host/serve.js /absolute/gateway.json
```

`trusted_proxy` explicitly binds HTTP to `127.0.0.1`; operate the TLS terminator on that same trusted host. For direct TLS, replace `listener` with `{ "mode": "tls", "host": "0.0.0.0", "port": 8783, "publicOrigin": "https://your-gateway-host", "certificateFile": "/absolute/certificate.pem", "keyFile": "/absolute/key.pem" }`. The key must be owner-only; direct TLS requires TLS 1.3.

Startup copies verified bytes into a new owner-only runtime directory and runs those retained copies. Replacing source files after admission cannot change the files being executed. Photon receives a private readiness-file path and reports only after its loopback server binds. The gateway also checks its live JSON-RPC slot. A second process cannot own the same indexer database. Its retained identity binds the genesis, pool binary and history floor; an existing unbound or mismatched database is rejected.

The supervised path explicitly passes `--migrate` to initialize or update its supplied persistent database before indexing. Ordinary Photon invocations with `--db-url` retain operator-managed migration semantics unless they opt in. The supervisor also passes `--resume-from-database`: a new database begins at the approved `--start-slot` floor, while a retained database at or above that floor resumes after its highest indexed slot. The approved floor stays in the database identity across restarts.

Before listening, the bridge checks the real network and programs, attests the prover, and validates its complete key inventory. No witness is sent during this check. Failed startup releases ownership and stops its child processes. SIGTERM/SIGINT abort startup or drain the running listener and journal. The bridge supervisor kills Photon when the gateway's control pipe closes, including gateway process termination. Abandoned private runtime directories are removed on the next exclusively owned startup.

If Photon exits unexpectedly after startup, the gateway rejects new commands, closes its listener and drains active operations before releasing custody and indexer ownership. The CLI logs `gateway_indexer_unavailable` and exits nonzero; an external supervisor should restart the gateway against the same persistent database paths. Give the supervisor a termination grace period that accommodates the configured bridge timeout; a worker already in flight may need to reach that bound. This path never starts a replacement operation or replays a journal entry in-process. An intentional signal still uses normal shutdown without reporting indexer failure.

Enrollment creates a distinct writer and returns its Solana identity. Fund that fee account with real SOL before preparing genesis. Production has no airdrop path and rejects localnet funding options. Retrying the enrollment or preparation retains its original identity and operation. Production deployment, SOL funding and paid prover operation are not performed by these release tools.

## Verification boundary

Run `npm --prefix backrooms run check`, `npm --prefix backrooms test`, and `cargo test -p backroom-rings-program --features bridge --bin backroom-rings-bridge`. Production tests reject every runtime file swap, binary replacement, insecure metadata, changed identity, wrong tree/genesis/history floor, cross-network indexer database reuse, unsafe transport, config exposure and listener mode confusion. They verify retained-byte use and failed-startup lock cleanup.

Run the persistent-database regression against the actual freshly built Photon executable:

```sh
cd backrooms
BACKROOM_PHOTON_EXECUTABLE=/absolute/target/debug/photon \
  node --import tsx --test tests/photon-startup.test.ts
```

This test starts the real executable with a fresh supplied SQLite file and a synthetic loopback chain. It checks actual migrations and indexed blocks, then restarts twice and verifies that block fetching resumes beyond the retained high-water mark without re-fetching the release floor. It preserves and compares migration rows and indexed data across processes. Without the explicit executable path, this test is skipped; it does not contact a production network.

Real localnet proof and recovery tests retain their prior commands and explicit opt-in environment variables. Hardware-backed attestation, genuine ceremony provenance, production source/package release, deployed immutable programs and funded production writer accounts require their real inputs and separate evidence. Their absence is not bypassed by metadata or by a passing synthetic test.
