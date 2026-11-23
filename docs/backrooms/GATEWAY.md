# Authenticated Rings gateway

The gateway connects a trusted native authority to the Rings process bridge. The native authority owns room membership, funded originals, and permission to accept learning. The gateway owns each room's Rings writer and viewing custody. It also retains the exact transaction frames that its signer prepared.

The current Node host is restricted to loopback localnet services and insecure test artifacts. Its release checks do not qualify a production deployment.

## Portable client

`AuthenticatedRingsGatewayClient` is exported from `@spawn-backrooms/backroom-rings/client`. It uses WebCrypto and Fetch without Node imports. The constructor takes an operator-configured endpoint, a 32-byte service authentication key, and an execution mode. `production` requires HTTPS. `synthetic_localnet` requires HTTP with a literal loopback address. Redirects, credentials in URLs, URL queries, and fragments are refused.

`bind(enrollment)` returns a `GatewayBinding`. Enrollment includes the native owner, project, and room scope, creation identity, creation nonce, seed commitment, membership commitment, and release manifest digest. A scope admits one immutable enrollment. A changed preparation or release cannot replace the retained writer.

`transport(binding)` returns a `RingsTransport` for `RingsClient`. The binding is an opaque capability selector. Its `keyRef` identifies retained custody and is stable when storage keys rotate. It is not a signer seed or a key derivation instruction.

The service authentication key grants access to the configured gateway. The native host must establish the user and room authority before making a request. The gateway does not interpret end-user tokens or decide whether a funded original deserves acceptance.

## Authenticated request boundary

Every request includes the protocol version, command kind, issuance time, and a random 32-byte nonce. A bridge command also includes the complete retained binding and the original bridge request. Strict decoding rejects extra fields, including caller-supplied URLs, process paths, and keys.

HMAC-SHA256 authenticates the exact request bytes with a request-specific domain prefix. The server accepts issuance times within 60 seconds of its clock. SQLite retains every accepted nonce through that window. A replay is rejected after a process restart.

Responses authenticate the exact response bytes and HTTP status with a different domain prefix. Each response includes the SHA256 digest of its request. The client rejects a valid response copied from another request. Request and response bodies are bounded to 1 MiB. Error responses contain fixed codes and no original request values.

## Custody and storage

`LocalnetRingsGateway` and `listenLocalnetGateway` are exported from `@spawn-backrooms/backroom-rings/gateway-host`. This export requires Node 24 or later. `LocalnetRingsGateway.open()` takes the database path, configured historical storage keys, service authentication key, approved localnet manifest digest, and pinned bridge configuration. The listener binds to `127.0.0.1` and exposes only `POST /v1/backrooms`.

Each enrollment retains a fresh Ed25519 seed. The upstream Rings keypair derives that room's viewing and nullifier keys from this seed. Different native rooms therefore have different writer and viewing custody. The gateway derives the Solana writer identity from the retained seed and checks it whenever it loads enrollment.

SQLite encrypts enrollment, signer seeds, preparation inputs, and transaction frames with AES-GCM. Each encrypted row retains its storage key version. Reads require that exact configured historical key. A missing key or corrupt ciphertext blocks access. The gateway does not generate a replacement writer for an unreadable enrollment.

The SQLite journal uses full synchronous writes. A process lock admits one gateway owner for a database. In-process requests for one binding run in order. Compare-and-swap writes retain immutable preparation and frame lineage. Different room bindings can execute concurrently.

The bridge receives a temporary configuration in an owner-only directory with an owner-only file. Normal completion and process errors remove that configuration. A host crash can leave this file until the next gateway startup. Startup takes exclusive ownership and removes abandoned bridge directories before serving requests. The host operator remains trusted with decrypted room state and signer custody.

`LocalnetBridge` verifies the executable's SHA256 digest at startup. It supplies the pinned RPC genesis, deployed program digests, tree, and artifact directory to the actual `ProcessRingsTransport`. The Rust bridge performs its existing genesis and program checks on every operation.

Optional test-writer funding is bounded to 10 billion lamports per configured balance target. Funding uses only the configured loopback RPC. The gateway verifies its pinned genesis before each funding attempt, queries the current rent-exempt minimum, and requests the larger of that minimum and the balance deficit. It waits for the confirmed target balance. No production funding path is provided.

## Retained operations

Creation reserves one operation identity before proof preparation. The gateway retains the winning prepared transaction and its Rings room identity before acknowledgment. The native room scope and the Rings room identity are different identifiers. Recovery and advancement must use the retained Rings identity and unique address.

Each operation reserves its complete preparation input before invoking the bridge. Repeating the same preparation returns the retained prepared response. A changed nonce, lesson, predecessor, or other input for that operation is a conflict. A crash before any prepared response was retained may repeat proof preparation. Such an unretained frame cannot be submitted through the gateway.

Submission requires both the exact bytes and digest of a retained frame for that binding and operation. Another room's frame, an unknown operation, or modified bytes fail before the bridge runs. The actual Rust bridge reconciles signature history and submits the retained frame only when it is still live.

Reframing first recovers the intended room. The intended checkpoint settles an already confirmed operation. Creation requires fresh absence. Advancement requires the original predecessor and revision. Pending recovery or a conflicting successor refuses reframing. The Rust bridge then verifies expiration and preserves the transaction's proofs, authorization, instructions, and encrypted state. The gateway retains the replacement and its parent digest before acknowledgment. A retry after a lost acknowledgment returns that retained replacement. One operation retains at most 64 frames.

Recovery always calls the bridge. It is never served from a response cache. The gateway checks the recovered writer, membership, seed commitment, release, room identity, and unique address before returning private memory. `RingsClient` verifies the completed scan watermark and checkpoint slot.

## Verification commands

The gateway tests use actual HTTP, WebCrypto, encrypted SQLite, and subprocess configuration. The subprocess fixture labels every transaction and proof as synthetic. These tests cover scope isolation, authentication, response substitution, restart, historical keys, corrupt ciphertext, exact frame recovery, and localnet funding restrictions.

```sh
cd backrooms
node --import tsx --test tests/gateway.test.ts
npm run check
npm run build
```

The opt-in localnet test requires the actual bridge executable and a protected configuration from a running pinned validator, Photon, prover, and compiled Backrooms circuits. The test discards the configuration's existing signer seed. It enrolls two new gateway-custodied writers, creates both rooms, rejects a cross-room frame, restarts with versioned keys, and advances one room's lesson.

```sh
BACKROOM_GATEWAY_LOCALNET_CONFIG=/absolute/protected/config.json \
BACKROOM_RINGS_BRIDGE=/absolute/backroom-rings-bridge \
node --import tsx --test tests/gateway-localnet.test.ts
```

Without both environment variables, the live test is explicitly skipped. A passing synthetic test does not establish live proof generation, chain submission, or production readiness.

The recorded qualification run passed against the actual local validator, release Photon, Rust bridge, and prover. It created two distinct custodied writers, rejected cross-room operations, recovered both bindings after a SQLite restart with historical storage keys, and advanced one room to revision 1 with its accepted lesson and scores `[40, 50]`. See [verification](VERIFICATION.md#authenticated-gateway-qualification) for the exact tested source and artifact boundary.
