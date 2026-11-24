# Public readiness contract: execution evidence

The final verification ran with Node v24.22.3. All 16 behavior tests and all 47
synthetic fixtures passed. There were no failed, cancelled, skipped, or pending
behavior tests. The fixture pack contains one explicitly synthetic ready case.

These records exercise the display contract with constructed inputs. They add
no live service probe, proof, validator run, independent application acceptance,
or native activation. The current public policy still reports CR02, CR03, CR04,
and native integration as open.

## Observed commands

Run these from `backrooms/experiments/custom-rings-base/native-preview`.

| Command | Observed result | Complete output |
| --- | --- | --- |
| `node --version` | v24.22.3 | [Runtime](node-version.stdout) |
| `node --test --test-reporter=tap readiness.test.mjs` | 16 passed; zero failed, cancelled, skipped, or todo | [Behavior TAP](behavior.stdout) |
| `node fixtures/run.mjs` | 47 passed; zero failed; one synthetic ready case | [Fixture report](fixtures.stdout) |
| `node descriptor.mjs` | Byte-identical to the package descriptor | [Generated descriptor](descriptor.stdout) |

The [verification receipt](verification-receipt.json) retains each exact argv,
observed exit, start/end time, stdout/stderr digest, and all 11 package file
digests before and after execution. Every final command exited zero and emitted
empty stderr. The package files were unchanged during verification.

The receipt also records the exact direct host-API assertion command. Its
[constructed-input result](constructed-host-input.stdout) shows that matching
local observations and optimistic references retain all four open gates.
Passing a qualified synthetic scenario through the public API remains blocked.
All returned capabilities retain `activationAuthorized: false` and
`productionAvailable: false`.

The [public pin comparison](public-profile-comparison.json) matches eight
artifact identities and two runtime commitments to the existing public
application records at `d1abad088b9d6f9ed80330b5c002b6d733fd3dca`. It also
compares the program, proving keys, and overlay with the published live extract.
This comparison reads public metadata; it does not review application source.

## Corrected attempts

The implementation owner's [initial behavior output](owner-initial-behavior.log)
records 14 passes and one failure in the CLI expectation-mismatch test. The
implementation owner diagnosed the `/dev/stdin` open on a subprocess socket;
that underlying file-open error is absent from the saved test output. The final
implementation reads file descriptor 0 for `-` input and includes a successful
custom-stdin case alongside malformed-pack and expectation-mismatch cases.

The first root collector produced [complete default-reporter output](collector-initial-behavior.log)
showing 16 passes, but its parser expected TAP and the collector exited 1.
The [collector failure record](collector-failure.json) retains that distinction.
The final collector explicitly selected TAP and saved each command receipt
before parsing. Only the final verification receipt supplies terminal-command
evidence for this checkpoint.

The [file manifest](manifest.json) records exact bytes and SHA-256 digests for
the evidence files. Empty stderr files are retained because the command
receipts reference them.
