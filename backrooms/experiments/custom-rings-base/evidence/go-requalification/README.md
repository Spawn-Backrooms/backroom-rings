# Fresh Go qualification

**18/18 whole packages have verified terminal evidence. Status: passed.**

This packet records fresh unfiltered package commands after unpublished working files became unavailable. Historical success summaries do not replace a new raw log or exit receipt. Every completed package has exact argv, clean source pins, complete log hashes and terminal event checks. The complete gate remains open until all 18 actual catalog entries qualify.

| Package | Result | Pass events | Default test skips | Duration (s) |
| --- | --- | ---: | ---: | ---: |
| `circuits` | passed | 56 | 0 | 34.959 |
| `circuits/audit` | passed | 106 | 0 | 37.856 |
| `circuits/policy` | passed | 404 | 0 | 933.091 |
| `circuits/registry` | passed | 147 | 1 | 115.283 |
| `circuits/ringgadget` | passed | 8 | 0 | 2.227 |
| `circuits/shared` | passed | 5 | 0 | 1.222 |
| `circuits/transfer` | passed | 244 | 0 | 3203.231 |
| `cmd/catalog` | no-tests | 0 | 0 | 101.472 |
| `cmd/prover` | no-tests | 0 | 0 | 65.997 |
| `ring` | passed | 197 | 6 | 3192.277 |
| `ringtest` | passed | 2 | 0 | 422.435 |
| `ringtest/ringaudit` | passed | 1 | 0 | 3.532 |
| `ringtest/ringkey` | no-tests | 0 | 0 | 21.194 |
| `ringtest/ringmerge` | no-tests | 0 | 0 | 1.121 |
| `ringtest/ringpolicy` | no-tests | 0 | 0 | 0.823 |
| `ringtest/ringprotocol` | passed | 13 | 0 | 0.975 |
| `ringtest/ringregistry` | passed | 16 | 0 | 2.027 |
| `ringtest/ringtransfer` | no-tests | 0 | 0 | 0.619 |

Pass-event counts include top-level tests and subtests; the JSON summary separately records top-level passes. Explicit no-test-file packages are coverage entries, not executed tests. Canonical fixture/service/population opt-ins remain unset, and their named skips are retained.

Heavy packages use the already documented 180-minute ceiling, based on the preserved actual one-hour timeout. It is not a runtime estimate. The process sees two already-allowed CPUs with GOMAXPROCS=1, GOMEMLIMIT=1GiB and GOGC=25. RSS values are sampled concurrent process-tree observations, not hard memory caps or production performance claims.

This packet establishes no latest independent application review, broader CR04 acceptance, native UI activation, merge or deployment. Earlier failed/interrupted attempts remain in the historical checkpoint. The application overlay and live result are unchanged.
