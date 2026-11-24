# Portable read-only verification

Use this entry point from any checkout:

```sh
python3 backrooms/experiments/custom-rings-base/evidence/go-requalification/verify_retained_packet.py --require-complete
```

The original `verify_and_stage.py` is the frozen build-host staging program, not a checkout-independent replay tool. Its bytes are bound by the original summary and manifest. This follow-up deliberately leaves that entire historical packet unchanged, including its README, all 72 manifest entries and every raw receipt/log. It adds a separate read-only verifier, which validates every original manifest file, retains the recorded executable/cwd/output relationships as provenance, opens logs exclusively from the published packet, and reconstructs every summary row without rewriting any evidence. It does not run Go or establish new execution evidence.

Regression command:

```sh
cd backrooms/experiments/custom-rings-base/evidence/go-requalification
python3 -m unittest -v test_verify_retained_packet
```

Five local synthetic regression cases passed (relocated full 18-package fixture, changed log, redirected historical log, altered command and missing package). All 18 real package receipts were separately inspected for their recorded build-root and output-path relationships. The entire original raw packet has not been replayed using this new Python entry point in the current environment; run the command above from a checkout for that acceptance check. Independent review remains required.
