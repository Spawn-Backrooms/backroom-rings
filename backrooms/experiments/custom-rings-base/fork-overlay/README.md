# Pinned Custom Rings circuit overlay

The public fork [Spawn-Backrooms/custom-privacy-rings](https://github.com/Spawn-Backrooms/custom-privacy-rings) exists and is pinned to upstream commit `02bca33729051798834ecbb4d94e968cdc0ef9b8` with Zolana gitlink `0fe4f952182b39464d472c52c40b3febe6cbd9ec`. This directory stages additive files for CR02 because the connected integration receives HTTP 403 creating a branch on the new fork. No upstream file has been edited. This is an unqualified circuit candidate, not a usable Backroom or deployable key.

## What the source adds

`SpawnRoomAdvanceCircuit` wraps the existing pinned `TransferCircuit` and adds a separate constraint relation for one same-owner, zero-amount note advance. The original circuit still verifies the ordered settlement, audit and policy; the wrapper constrains hidden-owner mode, no public co-owners/voucher/delegate/entry path, no withdrawals or public net/gross amounts, an empty address chain, and one live input and output in the same ring, with unchanged owner, nonzero enrolled nullifier key and asset. All other slots must be dummy. The note commitments must differ. It does not assert a particular lesson, revision, owner grant, unique genesis, or useful intelligence. The dedicated onchain program must reject alternate settlement paths and all interface legs, including no-op legs, and pin a new qualified verifier. Do not register this partial circuit in the existing key catalog.

The wrapper calls the existing circuit first and reopens the exact same constrained note wires, rather than trusting separate supplied note metadata. This duplicates some constraints; measure the overhead during actual compilation. It assumes the pinned SPP empty-address chain and note semantics; qualify both using the actual submodule.

The standalone Gnark tests exercise the note-pair predicate in isolation: one matching pair and 16 negative cases. They use synthetic field openings. They do not exercise the full transfer proof, state relation, settlement, or Solana. One live note does not mean one published slot: dummy padding and fixed circuit capacity are separate counts and require full-witness qualification.

## Run on the isolated build host

After CR01 reproduces the exact pins, use a clean disposable checkout of the fork. Copy the two overlay files into `prover/circuits/transfer/` only if those paths do not exist, and use a new review branch. Do not overwrite existing files. Run from `prover/`:

```sh
go test ./circuits/transfer -run '^TestSpawnRoomNotePair$' -count=1
```

Then build an actual zero-value hidden-owner transfer witness using upstream fixture builders and solve the full wrapper. Include changed rail, public legs, voucher, address-chain, extra note and unbound state negatives. Only after that implement the state codec/grant relation, explicit genesis, program dispatch and verifier/key selection, and prove the entire atomic transition on a real local validator. Do not activate the circuit on its own or reuse an upstream verifying key.

## Evidence

At initial authoring, Go 1.23.2 `gofmt -e -l` reported no syntax or formatting errors on the two source files; remote Git blobs matched the formatted local files. The current Go files are unchanged. Actual Gnark compilation and tests have still not run: the current workspace lacks the pinned Go 1.27.3, upstream dependencies, Rust/Solana and package-download access. An independent source review of the initial overlay found no immediate escape in its narrowly described note-pair predicate, but identified the missing application statement, live native authorization, genesis/dispatch and public-metadata work. That review is not proof verification or integration approval. Keep CR02 and CR04 open.
