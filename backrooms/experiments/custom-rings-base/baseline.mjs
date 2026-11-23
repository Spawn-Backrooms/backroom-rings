import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const pin = Object.freeze({
  upstream: 'https://github.com/helius-labs/custom-privacy-rings.git',
  revision: '02bca33729051798834ecbb4d94e968cdc0ef9b8',
  zolana: '0fe4f952182b39464d472c52c40b3febe6cbd9ec',
});

const hiddenOwnerCases = 'test(an_anonymous_ring_hides_owners_and_preserves_auditor_access) | test(an_anonymous_policy_ring_screens_its_hidden_sender)';
export const commands = Object.freeze([
  ['check-all'],
  ['test-hermetic'],
  ['test-custom-ring'],
  ['test-custom-ring-validator', hiddenOwnerCases],
].map(Object.freeze));

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
}

function requireThat(condition, message) {
  if (!condition) throw new Error(message);
}

export function inspectCheckout(path, expected = pin) {
  const root = realpathSync(resolve(path));
  requireThat(realpathSync(git(root, 'rev-parse', '--show-toplevel')) === root, 'Pass the upstream checkout root');
  requireThat(git(root, 'rev-parse', 'HEAD') === expected.revision, 'Wrong Custom Rings revision');
  const gitlink = git(root, 'ls-tree', 'HEAD', '--', 'zolana');
  requireThat(gitlink === `160000 commit ${expected.zolana}\tzolana`, 'Wrong Zolana gitlink');
  requireThat(existsSync(resolve(root, 'zolana', '.git')), 'Initialize the pinned Zolana submodule');
  const submodules = git(root, 'submodule', 'status', '--recursive');
  requireThat(submodules.split('\n').every(line => line.startsWith(' ')), 'Submodule missing, changed or conflicted');
  requireThat(git(resolve(root, 'zolana'), 'rev-parse', 'HEAD') === expected.zolana, 'Wrong Zolana checkout');
  requireThat(!git(root, 'status', '--porcelain=v1', '--untracked-files=all', '--ignore-submodules=none'), 'Use a clean disposable upstream checkout');
  requireThat(!existsSync(resolve(root, '.env')) && !existsSync(resolve(root, 'zolana', '.env')), 'Remove local .env files; use a disposable test checkout');
  const keyLockBlob = git(root, 'rev-parse', 'HEAD:prover/ring/proving-keys.lock');
  return { root, revision: expected.revision, zolana: expected.zolana, keyLockBlob };
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed: ${result.signal ?? result.status}`);
}

export function main(args) {
  const [checkout, flag, ...extra] = args;
  requireThat(checkout && extra.length === 0 && (!flag || flag === '--run-localnet'), 'Usage: node baseline.mjs <upstream-checkout> [--run-localnet]');
  const evidence = inspectCheckout(checkout);
  console.log(JSON.stringify({ scope: 'upstream-baseline-only', ...evidence }, null, 2));
  console.log('Preflight passed. No application composition, anonymity or production qualification inferred.');
  for (const cmd of commands) console.log(`just ${cmd.map(arg => JSON.stringify(arg)).join(' ')}`);
  if (!flag) return;
  requireThat(Number(process.versions.node.split('.')[0]) >= 24, 'Upstream requires Node >=24');
  requireThat(process.env.SPAWN_DISPOSABLE_LOCALNET === '1', 'Run on an isolated disposable test host; set SPAWN_DISPOSABLE_LOCALNET=1 only after checking isolation');
  for (const tool of ['just', 'cargo', 'jq', 'curl']) run(tool, ['--version'], evidence.root);
  run('go', ['version'], evidence.root);
  for (const cmd of commands) run('just', cmd, evidence.root);
  console.log('Upstream commands exited successfully. Inspect non-skipped named validator cases and retain logs before recording CR01 acceptance. CR02–CR05 remain separate.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
