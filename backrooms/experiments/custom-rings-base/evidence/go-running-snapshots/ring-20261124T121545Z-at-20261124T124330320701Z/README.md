# Running upstream ring milestone

Captured **2026-11-24T12:43:30.160671+00:00** for the unfiltered `github.com/helius-labs/zolana-custom-rings/prover/ring` run started **2026-11-24T12:15:45.715504+00:00**. The coordinating tool session is **30876**; it is not an operating-system PID.

**This is a running prefix, not a terminal package result. No exit code or package terminal action was observed. Full-package qualification credit: 0.**

| Captured file | Bytes | SHA-256 |
|---|---:|---|
| `ring-prefix.jsonl` | 158510 | `577b36f662185b08a9ab981d76204767e84af0e68db47d9b49871f8e880b1c80` |
| `running-receipt.json` | 3862 | `20821eaddf8d07a5f0c34f82081d43f977e3a702bf4e7ffa4d07e447dc9f64ce` |

The prefix begins at byte zero and includes all **621 complete JSONL lines** available at capture. No incomplete trailing bytes were present. The atomic running receipt was copied before the log; its heartbeat is **2026-11-24T12:43:29.093855+00:00**. The receipt and later prefix are not claimed to be one atomic pair.

## Observed events

The prefix contains **149 passing test/subtest events, four observed default skips, zero failed-test events, and no package terminal event**. Sixteen top-level tests have pass events; other work remains unfinished.

| Completed parent | Parent duration | Passing child events |
|---|---:|---:|
| `TestRingKeysCompileToTheVerifiedShape` | 229.43 seconds | 26 |
| `TestRingKeysCarryTheCompiledCircuits` | 893.14 seconds | 26 |

The four skips are the partial count observed so far, not a complete-run expectation. Their notices name unset `AEGLOS_FIXTURES`, `WRITE_RING_GOLDENS`, `REQUEST_FIXTURES` and `WRITE_RING_PINS`.

## Output classification

Of **312 output events**, **308 are execution-status lines**, **four are named default-skip notices**, **zero are constraint diagnostics**, and **zero remain unknown**. Another **309 events** contain structured execution metadata. Unrecognized output would be flagged as unknown; no publication or security conclusion follows from these categories.

## Source and scope

Fresh Git status and lockfile checks at **2026-11-24T12:43:30.319549+00:00** found clean, unchanged upstream source:

- Custom Rings: `02bca33729051798834ecbb4d94e968cdc0ef9b8`.
- Zolana: `0fe4f952182b39464d472c52c40b3febe6cbd9ec`.

The application overlay is not applied. This factual log capture does not perform or replace the blocked independent application source review.

The complete command, runner/catalog hashes, parser counts, source checks and classification are in [snapshot.json](snapshot.json). These snapshot files are created separately and made read-only. The live log, receipt, runner and source were not modified. Publication remains the coordinating agent's decision.

