# Backrooms client and reference host

This development package adds a private learning-room host to the Helius Privacy Rings fork. It includes a portable TypeScript client, two seeded Flue residents, authenticated encrypted messages, encrypted host journals, and a local process transport for the Rust application program. The package is unpublished.

## Run the client checks

Use Node.js 24 or newer.

```sh
cd backrooms
npm ci
npm run check
npm test
npm run build
```

The tests run real Flue 2.3 conversations, SQLite persistence, WebCrypto encryption and signatures. The Flue behavior test injects an accepted-state fixture. The recovery tests inject bridge errors. These checks do not supply evidence that a chain transaction or proof succeeded.

## Run the proof-backed example

Build the Rust bridge and start its pinned local validator, prover and Photon fixture first. The process protocol and the protected configuration fields are described in [the bridge contract](program/bridge-contract.md).

```sh
BACKROOM_RINGS_BRIDGE=/absolute/path/to/backroom-rings-bridge \
BACKROOM_RINGS_CONFIG=/absolute/path/to/localnet-config.json \
npm run demo
```

The runner starts two separate Node processes. The first creates a room, runs the investigator and critic, and requires a recovered accepted checkpoint. The second recovers the original episode without another inference call, then demonstrates a changed procedure using the retained policy. Initial scores of `[50, 50]` select the first procedure. Accepted negative feedback changes the scores to `[40, 50]`, so the next episode selects the second procedure. The model provider is a deterministic local fixture. The normal demo has no alternate ledger or proof implementation.

The Rust localnet test supplies the separate ledger replay gate. It must reject an already consumed predecessor under fresh transaction framing. A transport error or a client-side stale-state check does not satisfy that gate.

The default host directory is `.private-room`. Retain it across runs. `BACKROOMS_DEMO_DIRECTORY` selects another private directory. Genesis nonce, resident identities, signing keys, original results, acceptance nonce and prepared transaction bytes remain stable across retries. A failed proof or uncertain submission does not request another model result.

When the bridge conclusively reports an expired blockhash, the host first recovers the original operation. If genesis is still absent or the accepted episode's exact predecessor remains current, the host can request fresh transaction framing. The bridge preserves the application proof, instructions and authorization. The host saves the replacement bytes and previous frame in its encrypted journal with compare-and-swap before sending. It retains the original result, acceptance nonce and checkpoint. A lost response, incomplete recovery or live original blockhash leaves the operation pending. Restart resumes from the retained frame without another inference or proof preparation.

Run the reference host on a local filesystem with SQLite file locking. One live process owns each runtime directory. A dedicated SQLite database holds an [exclusive transaction](https://www.sqlite.org/lang_transaction.html) before Flue starts and releases it after Flue and the episode orchestration stop. A failed shutdown retains ownership. Process termination releases the operating-system lock, so a restarted host can recover the retained conversations.

## Privacy boundary

The engine journal and agent message log store authenticated ciphertext. Message sender keys come from the retained resident configuration. Repeated delivery recovers the original receipt; it does not create another accepted message. Decryption binds the record to its room, scope and identifier and checks the blinded content commitment.

The local host and prover are trusted with plaintext. Flue's `flue.sqlite` holds conversation messages and tool results in plaintext inside the protected host directory. The local `development.key` is a development recovery key. This example does not claim confidential compute or protection against the machine operator. The host exports only the explicit diagnostic allowlist; it installs no content-bearing observer or telemetry exporter.

## Native integration

`EpisodeAuthority` owns admitted episode bindings, captured original results and immutable acceptance authorizations. `RingsClient` owns the versioned bridge boundary. `createResidents` accepts the host's admitted model specifiers; it does not register a provider or read credentials. The reference host explicitly registers only the local fixture provider.

`AuthenticatedRingsGatewayClient` connects an authorized native host to a separately operated Rings signer. The Node `gateway-host` export retains per-room custody, encrypted operation journals, and exact signed transaction frames. Its authenticated request boundary rejects changed preparation, cross-room frames, and replayed packets. The [gateway reference](../docs/backrooms/GATEWAY.md) describes its localnet restrictions, historical key recovery, and opt-in live-chain test.

Revisions, ordinals and slots use canonical decimal strings, so values above JavaScript's safe integer limit remain exact. Transaction and ciphertext digests use SHA256. Protocol commitments use the upstream circuit hash. The client does not treat a host Boolean as proof verification. It relies on the pinned program and prover path, then validates the recovered commitment and provenance against the retained prepared transition.

## Release qualification

`releases/development.json` is an explicit local test manifest. Missing artifacts use `null`; the manifest does not invent a published package, setup ceremony or review result. Generate a completed release manifest after the final source commit and artifact build.

`productionBlockers` strictly decodes all required fields. `assertProductionEligible` also requires the SHA256 of the canonical manifest from operator-approved configuration. Evidence-shaped strings in a caller's JSON do not establish approval. Deterministic test setup and random single-party setup both remain ineligible for production.
