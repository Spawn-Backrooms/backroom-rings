import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { assertProductionEligible, decodeReleaseManifest, productionBlockers } from '../client/release.js';

test('development setup and incomplete manifest cannot qualify production', async () => {
  const development: unknown = JSON.parse(await readFile(new URL('../releases/development.json', import.meta.url), 'utf8'));
  const manifest = decodeReleaseManifest(development);
  assert.ok(productionBlockers(manifest).includes('setup_not_qualified'));
  assert.deepEqual(productionBlockers({ ...manifest, circuits: {}, services: {}, evidence: {} }), ['invalid_manifest']);
  await assert.rejects(assertProductionEligible(manifest, 'a'.repeat(64)), /production_release_blocked/);
});

test('descriptive release metadata cannot qualify a production runtime', async () => {
  const hash = 'a'.repeat(64);
  const manifest = {
    manifestVersion: 0, protocolVersion: 'backrooms.v0', artifactVersion: '1.0.0',
    source: { upstreamCommit: 'a'.repeat(40), forkCommit: 'b'.repeat(40) }, schemaSha256: hash,
    client: { version: '1.0.0', packageIntegrity: `sha512-${'A'.repeat(86)}==` },
    circuits: { createRoom: { circuitSha256: hash, provingKeySha256: hash, verifyingKeySha256: hash }, advanceRoom: { circuitSha256: hash, provingKeySha256: hash, verifyingKeySha256: hash } },
    setup: { kind: 'ceremony', provenance: 'https://audit.invalid/setup' },
    network: { cluster: 'mainnet-beta', genesisHash: '2'.repeat(44), applicationProgramId: '3'.repeat(44), shieldedPoolProgramId: '4'.repeat(44) },
    services: { prover: { version: '1.0.0', sourceCommit: 'c'.repeat(40), binarySha256: hash, imageDigest: null }, indexer: { version: '1.0.0', sourceCommit: 'd'.repeat(40), binarySha256: hash, imageDigest: null } },
    evidence: { circuitReview: 'https://audit.invalid/circuit', programReview: 'https://audit.invalid/program', publicDemo: 'https://audit.invalid/demo', nativeInference: 'https://audit.invalid/inference', runtimePrivacy: 'https://audit.invalid/privacy' },
  };
  assert.ok(productionBlockers(manifest).includes('runtime_not_pinned'));
  await assert.rejects(assertProductionEligible(manifest, 'b'.repeat(64)), /runtime_not_pinned/);
});
