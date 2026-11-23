# Independent review of the Custom Rings baseline runner

The first review covered `bootstrap/backrooms/experiments/custom-rings-base/{baseline.mjs,baseline.test.mjs,execution.test.mjs}` and `base/backrooms/experiments/custom-rings-base/{reference-gate.mjs,reference-gate.test.mjs}`. Locations below refer to the initially reviewed patch.

## Critical

None found.

## Important

1. **Go can skip the circuit suite through persisted configuration.** `baseline.mjs` lines 101–105 and 137 check the process environment and leave Go’s per-user defaults enabled. On a Go host, an isolated `GOENV` file containing `GOFLAGS=-run=^$` supplies the flag even with `GOFLAGS` absent from the calling environment. The pinned `justfile` line 246 runs `go test ./... -count=1`, which can then exit zero without exercising a case. Force `GOENV=off` for every command and retain the explicit `GOFLAGS` rejection. [Go command environment](https://pkg.go.dev/cmd/go#hdr-Environment_variables)

2. **Just can reintroduce build or test overrides after the preflight.** `baseline.mjs` lines 46, 124 and 137 check only repository-local `.env` files and the parent process environment. The upstream `justfile` line 2 enables ancestor `.env` discovery. A `.env` one directory above a clean checkout can set `GOFLAGS=-run=^$` or `ZOLANA_PREBUILT=1`. Separately, inherited `JUST_NO_DEPS=true` skips every test in the dependency-only `test-hermetic` recipe (upstream line 129), and can reuse artifacts for the validator recipe. Run with dotenv explicitly disabled, including recursive just invocations, and enforce the pinned recipe file and its dependencies. [Just dotenv behavior](https://just.systems/man/en/dotenv-settings.html) · [Just CLI source](https://docs.rs/crate/just/latest/source/src/arguments.rs)

3. **The receipt can hash bytes missing from its stored log.** `baseline.mjs` lines 65–66 ignore the byte count returned by `writeSync`, then hash and parse the full chunk. In a disposable fault-injection subprocess, a one-byte short write of the last validator line returned status zero and two recorded passes, with a digest differing from the file's actual SHA-256. Use an all-bytes write operation, or loop on a short write. Also propagate a thrown write error from the child `data` event into the awaited command so the enclosing catch can mark the receipt failed. The initial `execution.test.mjs` line 36 checks only the digest’s shape.

## Minor

The parser at `baseline.mjs` line 61 expects the binary name immediately after the duration. Newer nextest reporters can put `(1/2)` there when output is piped. Explicitly disable progress counters or accept that optional numeric field while still requiring the exact binary and full case names. This concerns compatibility with a successful run. [Nextest progress reporting](https://nexte.st/docs/reporting/)

## Evidence and scope

The initial targeted Node run passed all 57 tests. The Rust toolchain path in the root Git tree is a symlink to `zolana/rust-toolchain.toml`, consistent with checking the submodule's pin. The Go version is read within the prover module. The runner awaits each foreground command and rechecks checkout identity before setting `passed`. The upstream validator wrappers forward the filter and reporter options to `cargo nextest run`. The synthetic oracle's new live count is consistent with a padded published prefix. Its outcome grants no program or circuit authority.

No Go circuit or validator ran in this review. O05 remains open. The initial findings above require correction and verification before sign-off.

## Author resolution after the review

All three Important findings were addressed in one fix pass. Every child now uses `GOENV=off` and `GOWORK=off`; inherited `JUST_*` settings are removed and `JUST_NO_DOTENV=true` is set. Log capture uses complete writes, records SHA-256 of the stored file, and routes callback I/O failures through the awaited command so the run cannot succeed.

Three added regression tests were observed failing before these fixes and passing afterward: effective child environment overrides, injected short filesystem writes, and injected log-capture failure. The full available experiment suite then passed 60 tests (7 checkout tests, 15 execution tests and 38 synthetic conformance cases), zero failed or skipped, on Node 24.22.3. The execution tests use real child processes with fixture text; none is a proof or validator result. No additional reviewer sign-off is implied by this author-written resolution.

The Minor nextest progress-counter compatibility finding remains deferred until actual pinned-host qualification. The runner requests plain passing final statuses; it fails closed if the required plain records are absent. Upstream compilation, actual anonymous validator cases, artifact digests, complete application composition and recovery are still outstanding.
