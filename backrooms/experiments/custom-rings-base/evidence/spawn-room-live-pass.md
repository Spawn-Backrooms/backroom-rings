# Observed localnet application pass

This is a public-safe extract of the synthetic local run journey-KXteXY. It records executed results and does not replace the separately blocked final independent review.

The same-parent harness exited zero. One complete Vitest journey passed with no failed, skipped or todo tests; all 25 evidence steps passed. All five owned cleanup groups stopped, and the frozen 59-file application overlay, both Zolana pins and the pinned Backrooms host remained unchanged.

## Runtime and source identity

- Overlay SHA256: 2400c9e3020c1655a448507b9e7fca77e74cc7e4b426e12a7aec58011e730462
- Application program: 2t8SPCrLAxKjhYjY1Yy1Dwx2ktRaKZ6fGf5khcY5zb5Y
- Program artifact SHA256: 81e618d960fcb87d5c79b559d3c3fb16ba358ab03657b5c5dabd62fe19b2a19d
- Native Custom Rings: 02bca33729051798834ecbb4d94e968cdc0ef9b8
- Zolana: 0fe4f952182b39464d472c52c40b3febe6cbd9ec
- Backrooms host: 08822c65254cd73c5f2dccbdf182ce1df2c7510a
- Supervisor wall time: 334.208 seconds.
- Measured Node harness/services/descendants: 331.313 seconds; sampled concurrent RSS peak 4145344 KiB (3.953 GiB).
- Measurement samples: 1322, every 250 ms; 35 observed processes.
- The lastSamplingError field is absent in the authoritative measurement object; it was not emitted as null.

The resource scope excludes unrelated Go/build work and the lightweight outer Python supervisor. The JSON preserves sampled-RSS and per-process OS-high-water distinctions, limits, actual command durations, and worker self-reported peaks. All five worker PIDs and all direct service PIDs were observed; Surfpool and Photon were observed after the CLI launcher exited.

## All recorded steps

| Step | Status | Slot | Transaction signature / result |
| --- | --- | --- | --- |
| setup | passed | — | 4MtKFis1eFbFt5KztbL2wxUgSCowcgJ9sJ7zyh67TN1HM85RZNWbSJwKYZnF2hZnhBsTW3LjDvwDzwyCa5A9fTHw |
| create | passed | 321 | 4kbtPeFKnrk8fCVrdzobH7r93jWsUYsoYSQz64rkTipqAFTKUXjcV9VJ2qiwwhcvbpbaz9fJqFZAwgvi4FvYxTy6 |
| eligible-second-room | passed | 385 | 5vueWwJExSAxLaw8BeUSQRMwJ4qDd9Jtivob65P9m7cqFyxo1Q1b2GLgFnvtX6rHn1osfrXNbGDZLprLt9aF9zDC |
| reject-duplicate-genesis | passed | 388 | 5Qvz1mC4pYuakmCR6E6jQ76ESCxSubocaf3Zy2ZTUnhi2vTRznS2vZTCJmAeHq2PJTpezo1Coa9bLSeYfPv6MkgU ; error="AccountAlreadyInitialized" |
| native-process-first | passed | — | Process/state assertion recorded in JSON |
| adversarial-valid-control | passed | — | Process/state assertion recorded in JSON |
| reject-wrong-application-config | passed | 586 | 66yWyUvNxWAdh7mfP7CSVrqGs8p7VsvRppDkYXjRh8vyFHSomU1t6FRqTjTA7Z8uBgfsqCYak9J9NFQWRLLWrB7q ; error="InvalidAccountData" |
| reject-wrong-ring-policy | passed | 588 | 5N48rHLX1xv5xPuNVMAfZLDgDaynZ1gswm2Mw3bmehaHWHF6NkF3wboupsACVxJbGScN5uGKRAET43ehVYXzkmY5 ; error={"Custom":8300} |
| reject-unapproved-settlement-program | passed | 592 | 39nDrXQJqKj4ycr573NgnmUo1DrsvPbEPBn4Ya5SBdmNkCUUo6Ym4x8mQBci984CyWbJhGq6d7kWCECgzx82mocR ; error={"Custom":8103} |
| reject-wrong-operation-key | passed | 594 | 5SSzzRPQ4akF4a5m225QpXh9r4N85SDghyBNVgwJA2bZxZ2KCengKqs4a513fB3buFMAFSKVBVF3Ddec71HCBnBx ; error={"Custom":8101} |
| reject-reordered-audit-frame | passed | 597 | 5qLqz5e1TYPYVa3arZUTxuTGDzevnLtsnuEsbWNJjyJETRTz7wQ1jZie3n8zZCioqXX9BYxWVW9NjNhqQEzpAkKk ; error={"Custom":8101} |
| reject-peer-room-input | passed | 599 | 27ebJ4fE5pGbMeDDwvvnx15tuxVdaQrFbqMj7BuNBpj1GfLEQuBaoPKfErHLqXHCeoMq4yYvLT2Wt5hUnfY18wup ; error={"Custom":8101} |
| reject-bound-output-substitution | passed | 602 | QfVuQpTZUQa6TeDD3TekWH11rCtzkKF8aRYFZCq4R1EF4FUdso3Vya3vBuUBRywD8zwfpyB2iwvwaNNGm5jaUGC ; error={"Custom":7008} |
| reject-ciphertext-substitution | passed | 604 | i8EJZoTT5hSAkDKVjsAaDVS8qp5WNP7jcvFprLE8HfFLUvDhpgAbt1oAoLvpK3hS1iVeeW1xnt9EiqUJkucCYED ; error={"Custom":7008} |
| reject-generic-transfer | passed | 607 | 4JnfmCwgxiakQbQnNbQX4DDfa2HSrbc9PcYzJWq5qenJasDWHi4d61nsTySTsByRHeDypxhKMEVFQ4rwDy8sgksJ ; error="InvalidInstructionData" |
| reject-generic-authority-transfer | passed | 609 | 3sogFTmQuCTJzmDJmGK8qa8V6VYJGLFQkXqLQD1bNQRZ21ApNoCP4Ywg7aCWP2knDeAtotVMzkBYWytSkpg9T65v ; error="InvalidInstructionData" |
| reject-generic-merge | passed | 612 | 3fv2gPoGs7aTEBy3yHAo5EUceXwM2gs4isuCC62arqt6QBJVV9sVS561xFi5gknyAPM7qYFN2CKddYaMvXb1Tamc ; error="InvalidInstructionData" |
| reject-generic-set-delegate | passed | 613 | 5gRjSUwSJWY9HMFC1umQdS1no4oLNHaEso3g6VDBuUABDYcworwdHWGddE8ZVCGnKNYGZzBeir9H1rsqLjQU29S6 ; error="InvalidInstructionData" |
| advance | passed | 615 | 4yEc4oadxMPJxFrbfAfy4QDBat5vgtibPAN8ABgHxmYsT2t8HdihchCbp9msS8puPwChshYydXUSaJPxF1NLa1M6 |
| reject-replay | passed | 617 | 2sEWmFL684UFtmXQqWBqNTLYpYadsVnVj9WgCRPAN2pyvzoMp69YoEXt3vTR29BRZQpiQeDLNcUqPLe8bVtHLqeN ; error={"Custom":7043} |
| recovery | passed | — | Process/state assertion recorded in JSON |
| native-worker-idempotent-reentry | passed | — | Process/state assertion recorded in JSON |
| reuse | passed | 711 | 2BBFRnfmECWgrmJgWXQPB2atwwRCnkBG5ua6fgrKPXXA9Etr9PcxwjzJWQbtGEJe7ASvxBTY2gCrkUB2mLRGoywB |
| reject-revoked-grant | passed | 798 | 5K3SocoYuNaajQ9SQ6ynpNtVCStofV5izpWibMGj99WtTYKBQ79uSiyYkQ1VPG7QHxz2yoYrbLP3w797jPutuzWe ; error={"Custom":8101} |
| revocation-retention | passed | — | Process/state assertion recorded in JSON |

The JSON retains every refusal case’s unchanged six-account data hashes, wallet-note spent/commitment snapshot, and peer-room snapshot. Account bytes, note plaintext and signing data are omitted.

## Independent worker processes

| Role | Worker PID | Exit | Launcher wall ms | Worker max RSS KiB |
| --- | ---: | ---: | ---: | ---: |
| first-episode | 468 | 0 | 4040 | 205204 |
| recovery-interruption-after-receipt | 528 | 1 | 3214 | 202888 |
| recovery-retry-and-later-episode | 575 | 0 | 2647 | 257304 |
| completed-job-reentry | 622 | 0 | 3000 | 204864 |
| revocation-preparation | 675 | 0 | 3294 | 213768 |

The recovery-interruption worker intentionally exited 1 after retaining the confirmation receipt. A distinct worker retried the same saved submission, and another distinct worker re-entered the completed job. The successful checks retained the original result, grant and nonce relationships and performed zero repeated inference before resumed work / completed re-entry.

The retained signed frame matched the confirmed ledger frame, including the saved signature and observed slot. Receipt preservation is reported separately from authorization retention: complete storage-record equality, including its version, passed after retry and completed re-entry; workers asserted protocolVersion backrooms.v0. Numeric storage-version values were not separately recorded and are not invented here.

## Publication boundary

The companion JSON includes all source, program, executable and proving-key fingerprints, synthetic transaction IDs and slots, instruction errors, scoped resource evidence, and private-receipt hashes. It omits private jobs, witnesses, raw signed frames, signing keys, prompt/lesson content and raw logs. The original private run directory must not be published.

Public JSON SHA256: 057b96ccfffc3b6d04980ff26fda758665b6eaf5bf6f45df4a83c7321a1bff52
