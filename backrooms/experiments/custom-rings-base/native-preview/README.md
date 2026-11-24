# Anonymous localnet readiness

Use this contract to render the anonymous localnet developer preview described in the [native adapter handoff](../NATIVE-ADAPTER-HANDOFF.md). The current checkpoint has 18 of 18 upstream Go package receipts. CR02 independent acceptance, CR03 dependency acceptance, CR04 independent acceptance, and exact native integration remain open. The historical 25-step public application journey is context. Daybreak remains outstanding status context.

## Render the local preview

After the user explicitly selects the profile, collect fresh observations in the native host and pass the selected profile and observations to `evaluateReadiness`.

```js
import { evaluateReadiness } from "./readiness.mjs";
import descriptor from "./descriptor.json" with { type: "json" };

const result = evaluateReadiness({
	schema: descriptor.inputSchema,
	nowMs: Date.now(),
	selection: userSelectedProfile,
	observations: hostObservations,
});

renderPreview(result.status, result.primaryAction, result.reasons,
	result.disclosures.map((code) => descriptor.disclosures[code]));
```

Use [the descriptor](descriptor.json) for the exact selection, public fingerprint pins, scope digest, observation values, reason order, and disclosure text. Wrap each observation in `{ scopeSha256, observedAtMs, value }`. Use the matching profile scope and the actual time of observation. Artifacts and runtime values contain the measured public fingerprints. Each service value contains its actual `endpoint` and observed `status`. Use HTTP or HTTPS with explicit `localhost`, `127.0.0.1`, or `[::1]` authority. Keep any probe redirects loopback. The recovery value describes the current host operation. Invalidate it when the room or operation changes and keep those identifiers private.

The fixed maximum observation age is 60 seconds for display. The host owns the trusted clock, probe authenticity, room binding, and recovery guarantees. The result has one primary action and every applicable blocker in order. Render it as display text. The host retains all authority, funding, retry, and recovery decisions. All results have `activationAuthorized: false` and `productionAvailable: false`.

## Prepare the maintainer return record

Use `prepareEvidenceEnvelope` on a digest-only `cr05-maintainer-evidence.v1` record. Include the public profile scope, exact native source commit, artifact fingerprint digest, toolchain digest, and one or more scoped dispositions from the descriptor. Use an individual `outcome` and `reviewedExtractSha256` for each stage. A `valid` result confirms record shape only.

Digest reviewed extracts safe to disclose. Keep raw records, signed transactions, private originals, learning state, stable identifiers, secrets, and individual hashes of low-entropy private values in access-controlled native records.

## Verify the contract

Run both commands from this directory with Node 24.

```sh
node --test readiness.test.mjs
node fixtures/run.mjs
```

The [historical execution evidence](evidence/README.md) records the commands, outputs, and source digests for the overlay before recovery pagination was bounded. These checks exercise the display contract with constructed inputs. The current descriptor pins the revised overlay.

The CLI accepts a JSON pack path or `-` for stdin. The default pack is in [fixtures/cases.mjs](fixtures/cases.mjs). Every report and result is explicitly synthetic and non-qualifying. The CLI exits with code 1 for a malformed pack, an empty pack, or an expectation mismatch. The behavior suite checks the generated descriptor against its source. Regenerate it with `node descriptor.mjs > descriptor.json` after an approved contract edit.
