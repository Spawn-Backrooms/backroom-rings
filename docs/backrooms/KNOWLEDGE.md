# Accepted-knowledge envelope

`backrooms.knowledge.v1` is a portable metadata contract for accepted observations, hypotheses, procedures, failures, preferences and policy context. It describes records retained in existing workflow, research and artifact stores. It does not introduce a second canonical store or change the v0 bridge, circuit, checkpoint or acceptance protocol.

The [client module](../../backrooms/client/knowledge.ts) exports `KnowledgeRecord`, `KnowledgeRights`, `KnowledgeEvaluation` and `KnowledgeEnvelope`, their Valibot schemas, canonical wire helpers and blinded-reference helpers. Use `decodeKnowledgeEnvelope` for objects and `decodeCanonicalKnowledgeEnvelope` for wire input. The exported schemas check shape; the decoders also check revision lineage, evidence subjects, set ordering and duplicate references.

## Keep content and authority outside the metadata

Every record has a room, opaque record identity, exact revision, creation time, immutable content binding, original source references, producer, derivation references and correction state. Run references bind both the run and its original result. Artifact references support existing work that does not have a run identifier. The adapter must resolve and authenticate these references against the original records; a syntactically valid digest alone does not establish provenance.

Public envelopes contain blinded bindings for content, source runs, original results, evidence receipts, policy and licenses. They have no plaintext content, URL, arbitrary metadata, credential or private-opening field. Identifiers must be opaque ASCII tokens. Validation cannot detect a secret disguised as an allowed identifier, so producers must apply the existing public-export allowlist before releasing metadata. Source contents and openings remain in their existing protected stores under the applicable access and retention policy.

Every envelope declares `authority: "context_only"`. A policy record additionally declares `enforcement: "native_grant_contract"` and identifies its policy binding. This states where enforcement belongs; it does not prove that a native grant exists. Rights declare audience, allowed knowledge purposes, policy, license reference, expiry and retention constraints. They must be intersected with current native authority before any use. Neither a signed envelope nor an accepted policy record can grant tools, spending, publication, delegation or fresh access. Unknown fields are rejected at every schema object, including nested rights and bindings.

## Keep acceptance and evidence distinct

An accepted envelope requires an owner-acceptance claim and keeps other evidence in separate channels:

| Channel | Meaning | Required verification outside this decoder |
| --- | --- | --- |
| `ownerAcceptance` | The identified owner accepted this exact record revision and content commitment. | Authenticate the receipt and owner identity; check the referenced acceptance authority. |
| `deterministicChecks` | A named checker reported `pass`, `fail` or `inconclusive`. | Resolve the immutable checker and receipt; verify the actual check and its scope. |
| `modelOpinions` | A model offered `supports`, `opposes` or `uncertain`. | Authenticate the report and preserve its status as an opinion. |
| `externalAcceptances` | A separate system reported `accepted`, `rejected` or `pending`. | Verify the external receipt against that system's acceptance rules. |

Each entry binds room, record, revision and content commitment. The decoder rejects evidence for a different subject. Owner acceptance may coexist with a failed deterministic check or a supportive model opinion; neither result is silently promoted into the other channel. An empty external-acceptance array makes no external-success claim.

Decoding establishes a well-formed contract, not authenticated owner acceptance, observed checker execution, native policy enforcement, chain acceptance or delivery. Authenticating a signature establishes the signed bytes under a separately trusted key. The consuming adapter still verifies each referenced receipt and authority against its actual trust roots. Do not render an unverified envelope as observed or qualified evidence.

## Encode one wire representation

`encodeKnowledgeEnvelope` produces one exact UTF-8 representation. The wire decoder rejects duplicate keys, extra whitespace, alternate escapes, unsorted object keys, a byte-order mark and invalid UTF-8. It checks that the parsed envelope re-encodes to exactly the input bytes. A caller receiving wire data must use this decoder before verifying a signature; parsing JSON independently loses duplicate-key evidence.

The restricted canonical JSON profile uses the existing client codec without changing v0 behavior:

- Object keys are ordered lexicographically by UTF-16 code units. String quoting follows `JSON.stringify`; strings and keys must contain well-formed Unicode. No Unicode normalization is performed.
- Arrays preserve order. Sparse arrays, extended arrays, array subclasses, custom object prototypes, accessors, symbols, hidden properties and cycles are rejected.
- Numbers in private opening values must be safe integers. Fractional numbers, negative zero, non-finite numbers and `BigInt` are rejected. Use an explicitly defined string representation if a source record needs exact decimals or larger integers. This profile does not claim to support every JSON number or every JCS input.
- Revisions and timestamps use canonical unsigned decimal strings in the full u64 range. Timestamps are Unix milliseconds. Revision zero has no predecessor; every later revision identifies the previous revision of the same room and record.
- `audience` and `purposes` are sorted unique sets. Other arrays retain their stated order. Duplicate sources, duplicate run identities, duplicate derivation identities and duplicate identical evaluation entries are rejected.
- Envelopes are limited to 65,536 UTF-8 bytes. Private openings are limited to 1,048,576 UTF-8 bytes. The JSON tree may be at most 64 levels deep. Collection limits also apply in the schemas.

The exact signing input is the UTF-8 encoding of `backrooms.knowledge.signature.v1`, one LF byte, and the canonical envelope. `knowledgeSigningBytes` supplies this domain-separated input. A signature container and signer trust policy belong to the adapter; a signature is deliberately not a field of the envelope.

## Bind low-entropy private values

Plain hashes of short answers, preferences or common procedures can be guessed. `createKnowledgeBinding` uses 32 fresh cryptographically random bytes for every binding. It returns a public binding and a separate private opening:

```text
binding = { scheme: "sha256-blinded-v1", context: { purpose, id }, digest }
opening = { blinding: <64 lowercase hex characters>, value: <canonical JSON value> }
digest = SHA256(canonical JSON of {
  domain: "backrooms.knowledge.binding.v1",
  context,
  opening
})
```

The purpose separates content, source runs, artifacts, evidence, policy, license and record-revision references. The opaque context identity prevents reuse under a different reference identity. Keep the random blinding and value together in an approved encrypted store; neither helper automatically stores or exports them. Do not publish a production opening or derive its blinding from the content.

`verifyKnowledgeBinding` requires the expected context from the caller, verifies the digest against the private opening, and returns a stable snapshot of the verified value. Both helpers snapshot values before asynchronous cryptography so later caller mutation cannot change what was verified. A raw `sha256` scheme is rejected, and a raw unblinded hash relabeled with the supported scheme fails opening verification.

A digest cannot reveal whether its creator used secret random blinding. Validation of public metadata alone therefore cannot certify entropy or secrecy. Qualified producers must use the helper or a conforming CSPRNG implementation and preserve evidence of the production boundary. Deterministic blinding in the public vectors is synthetic test data only and must never be reused for production.

## Retain history without granting fresh access

The revision chain records the exact predecessor; `derivedFrom` identifies other immutable source revisions. A same-record derivation must point backward. A same-record supersession must point forward. Revision bindings must ultimately resolve to the referenced immutable record, not merely to an unverified identity label. A fork uses its own identity and current authority while retaining authorized source lineage.

Lifecycle states are `retained`, `superseded` with a replacement and reason binding, and `retracted` with a reason binding. Rights separately carry `expiresAt` and `retainUntil`; `null` expresses no bound declared in this envelope, not unlimited native permission. These fields describe the accepted historical record. The adapter must authenticate later corrections, revocations and retention decisions through the authoritative current state rather than trust an old snapshot as current.

Expired and retracted records remain decodable for authorized historical receipt verification. Decoding does not authorize retrieval, continued retention, reuse or execution. The native boundary checks current grants, audience, purpose, revocation, expiry, retention and correction state when serving or using knowledge. This module intentionally provides no `canExecute`, `canSpend`, `canPublish` or current-access decision API.

## Adopt through an explicit adapter

| Source or consumer | Compatibility behavior | Adoption requirement |
| --- | --- | --- |
| Existing v0 bounded lesson and checkpoint | Unchanged; the new envelope is not implicitly a v0 circuit input. | Keep existing v0 hashing, proofs and release gates intact. |
| Existing workflow, research and artifact records | Adapt their identities, immutable originals, rights and evidence into this envelope. | Resolve the original canonical stores and authenticate each mapping; do not copy them into a new authority store. |
| Legacy plaintext knowledge without sufficient provenance or rights | No automatic upgrade into accepted knowledge. | Perform an explicit protected migration and obtain missing acceptance or rights evidence; do not invent history. |
| `backrooms.knowledge.v1` envelope | Strict shape, semantic checks and exact canonical encoding. | Verify openings, acceptance receipts and current native policy through a qualified adapter. |
| Unknown schema version, kind, field or commitment scheme | Reject; no silent stripping or permissive fallback. | Introduce a reviewed version and explicit compatibility adapter when semantics change. |
| Future circuit-committed envelope or manifest | Not supplied or proven by this module. | Qualify its own circuit/setup, binding, release manifest and acceptance path; a v0 checkpoint does not commit this entire envelope. |

Public schemas and synthetic vectors can ship independently. Production adoption remains gated on a native adapter that decodes these same vectors, authenticates the mapped evidence, exercises current authority decisions and pins the exact compatible public/native artifacts in a release manifest. This contract does not claim that gate has passed.

## Run the conformance checks

Use the pinned dependencies and Node.js 24 or newer:

```sh
cd backrooms
npm ci
npm run check
node --import tsx --test tests/knowledge.test.ts
npm run build
```

The [portable vector pack](../../backrooms/tests/fixtures/knowledge-v1.vectors.json) contains a complete accepted observation, exact canonical encoding, a signing-input SHA256, blinded-reference examples and positive/negative mutations. The positive cases cover all six record kinds, an accepted revision with its predecessor, separate external acceptance and a historical retraction. The base observation deliberately combines owner acceptance, a failed check and a supportive model opinion. A Unicode binding checks UTF-16 ordering independently of ASCII envelope keys.

Each vector in `validEnvelopes` or `invalidEnvelopes` starts with a fresh copy of `baseEnvelope` and applies its ordered `changes`. A change addresses a property with its `path` array and either sets `value` (`op: "set"`) or removes the property (`op: "remove"`). The resulting object must be accepted or rejected, respectively, by the full envelope decoder. Negative cases cover authority escalation, wrong subjects, unknown fields, unblinded schemes, invalid revision encoding, duplicate references and rights ambiguity. Tests also exercise real WebCrypto signatures, random low-entropy commitments, mutation during asynchronous crypto, wire ambiguity, historical decoding and encoding bounds.

This is synthetic contract and cryptography evidence. It does not establish native authorization, storage lifecycle enforcement, provider behavior, chain proofs, confidential execution or production readiness. Native consumers must run the same vectors and their own authority/integration checks before adopting the format.
