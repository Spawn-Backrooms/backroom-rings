# Reproducing the Backrooms development package

The public package at Rings main `3dc650d532708e36c467481350dd7e80029af0fe` reproduced the retained development archive byte for byte. The integrated source combines the Photon-exit handling from PR #4 with the knowledge contract from PR #28. Its unpublished package is `0.1.0-dev.3`. The previously consumed development archive remains `0.1.0-dev.2`. The bridge wire protocol is `backrooms.v0` in both builds.

| Development package | Packed files | Archive bytes | SHA-256 |
| --- | ---: | ---: | --- |
| Main, dev.2 | 105 | 80,939 | `2d4aa49ddb4cb9e7a327961cac486217e1f33f182f3989451e9b99220a2c7d18` |
| Integrated candidate, dev.3 | 109 | 95,249 | `7d1a7c4013bfdedbc5503c89790332ea4d7c9ba0ec1a379cb602b370a97b3f16` |

The independently fetched native consumer dev.2 archive from public source `b61f57b1c553d2f39399cc2d1db5d0ade43c67f9` has the same Git blob ID, SHA-256, SHA-512 integrity and 105 file hashes as the main rebuild. The consumer lockfile pins that SHA-512 integrity. This check covered retained package inputs.

The baseline exports `CLIENT_VERSION` as dev.1 despite declaring dev.2 in its package, lockfile and development manifest. The new release test first failed on this difference. The candidate aligns the four declarations and the exported constant at dev.3. Its additional archive entries are compiled knowledge client and test JavaScript and declarations. Other changes include the gateway runtime, public index exports and release tests. Native consumption of dev.3 requires a separately coordinated pin.

## Reproduce the archive

Use Node 24.22.3, npm 11.19.1 and Python 3.11 or later. Set `BASELINE` to the absolute root of a fresh checkout at `3dc650d532708e36c467481350dd7e80029af0fe`, `CANDIDATE` to the absolute root of the dev.3 candidate checkout, and `REFERENCE_TGZ` to the absolute path of the independently retained dev.2 archive. Build both with their checked-in lockfiles.

```sh
for checkout in "$BASELINE" "$CANDIDATE"; do
  (cd "$checkout/backrooms" &&
    npm ci --ignore-scripts --no-audit --no-fund &&
    npm run check && npm run build && npm test) || exit 1
done
```

Compare the retained dev.2 archive with a new pack from the **dev.2 checkout**. The checker lives in the dev.3 checkout. This invocation works from any directory.

```sh
python3 "$CANDIDATE/backrooms/releases/compare-package.py" "$REFERENCE_TGZ" \
  --package-root "$BASELINE/backrooms"
```

To check dev.3 repeatability, create an archive outside the checkout and compare it with a second pack from the candidate.

```sh
PACK_DIR=$(mktemp -d)
(cd "$CANDIDATE/backrooms" && npm pack --ignore-scripts --json --pack-destination "$PACK_DIR")
python3 "$CANDIDATE/backrooms/releases/compare-package.py" \
  "$PACK_DIR/spawn-backrooms-backroom-rings-0.1.0-dev.3.tgz" --package-root "$CANDIDATE/backrooms"
python3 "$CANDIDATE/backrooms/releases/test_compare_package.py"
```

The comparator runs a fresh offline npm pack in a temporary directory. It compares the gzip archive digests and the names, modes and SHA-256 values of every regular file. It rejects ambiguous member names, including backslashes, duplicate members and files used as containing directories in either order. A changed archive exits nonzero and reports added, removed and changed paths. To verify a candidate's repeatability before another consumer retains its archive, point the comparator at the preceding local pack and identify the result as a repeat pack. Two local packs do not establish native installation.

## Checks and remaining qualification

The verification used isolated package directories restored from hash- and mode-checked public source, including all 85 tracked files under the baseline's `backrooms/` subtree. The installs used `npm ci --offline --ignore-scripts --no-audit --no-fund` against a populated cache. Both candidates passed typecheck and build. The main suite passed 68 tests and skipped the three opt-in cases. The actual workerd test then passed separately. On dev.3, setting `BACKROOM_WORKERD_EXECUTABLE` ran the actual executable as part of the suite. Of 128 tests, 126 passed and two skipped.

| Fresh candidate check | What it exercised |
| --- | --- |
| 52 focused knowledge tests and a packed export check | Canonical knowledge vectors, a consumer import through the archived package export, and round-trip of a context-only envelope. |
| Four focused gateway recovery tests | The actual CLI stopped on an unexpected synthetic child exit, closed its HTTP listener and allowed reuse of its SQLite paths. A normal SIGTERM exited cleanly. An active response completed before ownership release. A caller disconnecting during admitted work also retained gateway ownership until its handler finished, in localnet and production-proxy listener fixtures. |
| Actual workerd transport | The built client enrolled through default fetch and an explicit transport against a MAC-authenticated loopback fixture. |
| Version agreement | The built client and package metadata report dev.3. Both lockfile version fields and the development manifest declare the same version. |

Two tests remained skipped. Actual Photon migration and resume require a compatible Photon executable. The authenticated two-room localnet test requires a compatible bridge and local-chain fixture. Fresh application and SPP proofs, a validator, real indexed recovery and a two-process learning demonstration against that chain remain outstanding. The synthetic restart checks exercise the host without supplying that evidence. The development manifest retains insecure test setup. Native dev.3 adoption and production qualification remain open.

The machine-readable record contains the parent commits and trees, candidate package subtree, lockfile and bridge contract digests, package SHA-512 integrities, workerd executable digest and exact skipped test names. See [the evidence record](evidence/q03-package-reproduction.json) and [the existing local-chain procedure](VERIFICATION.md).
