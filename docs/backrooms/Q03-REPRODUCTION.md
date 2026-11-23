# Reproducing the Backrooms development package

Rings main at `d30b53b2bc3736b993cc55f9838a255d67fc0fd1` reproduces the sealed dev.4 archive. The combined dev.5 candidate retains the atomic Photon SQLite migrations from PR #32, the package-version checks from PR #33, and the reviewed gateway drain and accepted-knowledge changes from PR #30. Each label identifies a distinct archive. All three entries below use the `backrooms.v0` bridge wire protocol.

| Public source | Version | Files | Bytes | SHA-256 |
| --- | --- | ---: | ---: | --- |
| Historical main `3dc650d5` | dev.2 | 105 | 80,939 | `2d4aa49ddb4cb9e7a327961cac486217e1f33f182f3989451e9b99220a2c7d18` |
| Current baseline `d30b53b2` | dev.4 | 105 | 84,179 | `b768e0055aed33717f02bdd5d3fefdcd8a2f4497bc57bc8277fc283eab02e8a0` |
| Combined package subtree `04c303c6` | dev.5 | 109 | 95,994 | `89128f59626663eb6eff096658a913bfd79f4571a902c6417fec0677b144047a` |

An earlier comparison verified dev.2 against its retained native consumer archive and lockfile. The current run rebuilt dev.4 from its public source and matched the sealed dev.4 reference byte for byte, including every member's content and mode. A repeat pack verified dev.5 locally. Its package metadata, both lockfile version fields, development manifest and exported `CLIENT_VERSION` agree on `0.1.0-dev.5`. The packed client preserves all 34 dev.4 exports and adds 15 knowledge exports.

## Reproduce and compare

Use Node 24.22.3, npm 11.19.1 and Python 3.11 or later. Set `BASELINE` to an absolute checkout of the dev.4 commit above, `CANDIDATE` to an absolute checkout of the combined dev.5 source, and `REFERENCE_TGZ` to the absolute path of the independently retained dev.4 archive. Use fresh package directories. The clean verification here used the checked-in lockfiles and a populated npm cache.

```sh
for checkout in "$BASELINE" "$CANDIDATE"; do
  (cd "$checkout/backrooms" &&
    npm ci --ignore-scripts --no-audit --no-fund &&
    npm run check && npm run build) || exit 1
done

python3 "$CANDIDATE/backrooms/releases/compare-package.py" "$REFERENCE_TGZ" \
  --package-root "$BASELINE/backrooms"

PACK_DIR=$(mktemp -d)
(cd "$CANDIDATE/backrooms" && npm pack --ignore-scripts --json --pack-destination "$PACK_DIR")
python3 "$CANDIDATE/backrooms/releases/compare-package.py" \
  "$PACK_DIR/spawn-backrooms-backroom-rings-0.1.0-dev.5.tgz" --package-root "$CANDIDATE/backrooms"
python3 "$CANDIDATE/backrooms/releases/test_compare_package.py"
```

The comparator checks compressed archive digests, member names, file modes and content hashes. For a historical dev.2 comparison, point `BASELINE` at `3dc650d532708e36c467481350dd7e80029af0fe`, build its checked-in package and set `REFERENCE_TGZ` to its retained dev.2 archive.

## Runtime verification

Run `npm test` in the built candidate. Set `BACKROOM_WORKERD_EXECUTABLE` and `BACKROOM_PHOTON_EXECUTABLE` to the verified local binaries to exercise all three corresponding opt-in tests. Executable hashes and archive integrities are in [the evidence record](evidence/q03-package-reproduction.json).

With both binaries enabled, **128 of 129 tests passed** and the actual-chain two-room gateway test skipped. Actual Photon exercised an intentionally failed file-backed SQLite migration, rollback and retry on the repaired database. A second test migrated a fresh database and resumed persisted progress across process restarts against a loopback RPC fixture. Actual workerd exercised the built client through default fetch and a custom transport against a MAC-authenticated loopback fixture. Separate synthetic-child gateway cases covered unexpected exit, clean SIGTERM, disconnected callers and in-flight response drain.

The remaining gateway case requires the compatible Rust bridge and local-chain fixture. Fresh application/SPP proofs, validator-backed two-room recovery and two-process learning, native dev.5 adoption, production deployment and paid inference remain outside this package qualification. Development setup remains explicitly insecure. See [the local-chain procedure](VERIFICATION.md).
