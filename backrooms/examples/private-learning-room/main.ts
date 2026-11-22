import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProcessRingsTransport } from '../../reference-host/bridge.js';
import { ReferenceHost } from '../../reference-host/host.js';

const directory = resolve(process.env.BACKROOMS_DEMO_DIRECTORY ?? '.private-room');
const bridge = process.env.BACKROOM_RINGS_BRIDGE;
const config = process.env.BACKROOM_RINGS_CONFIG;
if (!bridge || !config) {
  console.error('Set BACKROOM_RINGS_BRIDGE and BACKROOM_RINGS_CONFIG to the built local bridge and its pinned localnet configuration. This demo requires real proofs, a validator, and Photon.');
  process.exitCode = 1;
} else if (!process.argv[2]) {
  for (const phase of ['learn', 'recover']) {
    await new Promise<void>((accept, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), phase], {
        env: { PATH: process.env.PATH, BACKROOM_RINGS_BRIDGE: resolve(bridge), BACKROOM_RINGS_CONFIG: resolve(config), BACKROOMS_DEMO_DIRECTORY: directory },
        stdio: 'inherit',
      });
      child.on('error', reject);
      child.on('close', code => code === 0 ? accept() : reject(new Error(`demo_${phase}_failed`)));
    });
  }
} else {
  const host = await ReferenceHost.open({ directory, transport: new ProcessRingsTransport(resolve(bridge), resolve(config)) });
  try {
    if (process.argv[2] === 'learn') {
      const outcome = await host.episode('learn');
      assert.equal(outcome.status, 'accepted', 'The real proof-backed checkpoint must be recovered before the room is ready.');
      if (outcome.status !== 'accepted') throw new Error('learning_not_accepted');
      const candidate = JSON.parse(outcome.originalResult.investigator) as { selectedProcedure: number; value: number };
      assert.equal(candidate.selectedProcedure, 0);
      assert.equal(candidate.value, 9);
      assert.deepEqual(outcome.room.policy.scores, [40, 50]);
      console.log(JSON.stringify({ phase: 'learn', state: 'accepted', revision: outcome.room.checkpoint.revision, selectedProcedure: candidate.selectedProcedure, value: candidate.value, signature: outcome.room.signature, inferenceCalls: host.residents.inferenceCalls }));
    } else if (process.argv[2] === 'recover') {
      const original = await host.episode('learn');
      assert.equal(original.status, 'accepted');
      assert.equal(host.residents.inferenceCalls, 0, 'Restart must recover the original result without new inference.');
      const next = await host.inspectNextEpisode('next');
      assert.equal(next.selectedProcedure, 1);
      assert.equal(next.value, 5);
      console.log(JSON.stringify({ phase: 'recover', state: 'learned', revision: next.room.checkpoint.revision, selectedProcedure: next.selectedProcedure, value: next.value, chainReplayEvidence: 'run Rust localnet gate separately', inferenceCalls: host.residents.inferenceCalls }));
    } else throw new Error('unknown_demo_phase');
  } finally { await host.close(); }
}
