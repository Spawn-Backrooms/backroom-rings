# Readiness contract decisions

`contract.mjs` owns the public profile pins and the ordered check registry. The registry pairs each comparison with fixed reason and action copy. `descriptor.mjs` serializes that record for the maintainer. The package exports `evaluateReadiness`, `prepareEvidenceEnvelope`, and the descriptor.

The scope digest is SHA-256 over the UTF-8 JSON encoding of the tuple containing the scope schema, namespace, selection entries, artifact entries, runtime entries, and native build entries or null. Use the descriptor's field order for each entries array. Public selection and fingerprint identities come from `APPLICATION-EVIDENCE.json` and `spawn-room-live-pass.json`. The seed and membership commitments bind the public deterministic reference runtime. The canonical native build remains open.

The implementation adds an explicit input schema and compares observed runtime commitments directly. Selection also carries fixed anonymous-owner authority and provider spend fields. Optional historical and gate references are shape-checked context. The recorded upstream gate comes from the fixed 18-receipt baseline, and the published policy keeps all four joined gates open. Daybreak appears in descriptor status context.

The evaluator refuses unknown fields. It emits only fixed display text and disclosure identifiers. An invalid top-level shape returns the input blocker. A rejected selection stops profile-scoped comparisons. Each applicable observed prerequisite returns at most one blocker. For an observation, the evaluator checks its wrapper and clock, age, scope digest, then value. The native host binds recovery to the current private operation before making the observation.

Fixture scenarios use a separate scope namespace and fake fingerprints in both the open-gate and qualified cases. Qualification in that internal namespace exercises the ready branch while preserving display-only capabilities. The JSON return envelope checks allowlisted stage outcomes and digest formats. Verification and acceptance belong to the canonical maintainer and reviewers.
