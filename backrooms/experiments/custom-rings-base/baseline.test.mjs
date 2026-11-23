import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commands, inspectCheckout } from './baseline.mjs';

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function init(root) {
  mkdirSync(root, { recursive: true });
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'Fixture');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(root, 'README.md'), 'fixture\n');
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'fixture');
}
function fixture(t) {
  const tmp = mkdtempSync(join(tmpdir(), 'custom-rings-preflight-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const sub = join(tmp, 'sub'), root = join(tmp, 'root');
  init(sub); init(root);
  git(root, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub, 'zolana');
  mkdirSync(join(root, 'prover', 'ring'), { recursive: true });
  writeFileSync(join(root, 'prover', 'ring', 'proving-keys.lock'), '{}\n');
  writeFileSync(join(root, '.gitignore'), '.env\n');
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'pin submodule and fixture lock');
  return { root, expected: { revision: git(root, 'rev-parse', 'HEAD'), zolana: git(sub, 'rev-parse', 'HEAD') } };
}

test('accepts clean exact root and gitlink', t => {
  const { root, expected } = fixture(t);
  assert.equal(inspectCheckout(root, expected).revision, expected.revision);
});
test('rejects a different upstream revision', t => {
  const { root, expected } = fixture(t);
  assert.throws(() => inspectCheckout(root, { ...expected, revision: '0'.repeat(40) }), /Wrong Custom Rings revision/);
});
test('rejects a different submodule pin', t => {
  const { root, expected } = fixture(t);
  assert.throws(() => inspectCheckout(root, { ...expected, zolana: '0'.repeat(40) }), /Wrong Zolana gitlink/);
});
test('rejects dirty tracked content', t => {
  const { root, expected } = fixture(t);
  writeFileSync(join(root, 'README.md'), 'changed');
  assert.throws(() => inspectCheckout(root, expected), /clean disposable/);
});
test('rejects dirty submodule', t => {
  const { root, expected } = fixture(t);
  writeFileSync(join(root, 'zolana', 'README.md'), 'changed');
  assert.throws(() => inspectCheckout(root, expected), /clean disposable/);
});
test('rejects ignored dotenv files', t => {
  const { root, expected } = fixture(t);
  writeFileSync(join(root, '.env'), 'SYNTHETIC=1');
  assert.throws(() => inspectCheckout(root, expected), /Remove local .env/);
});
test('includes both concrete hidden-owner validator cases', () => {
  const validator = commands.find(cmd => cmd[0] === 'test-custom-ring-validator');
  assert.match(validator[1], /an_anonymous_ring_hides_owners_and_preserves_auditor_access/);
  assert.match(validator[1], /an_anonymous_policy_ring_screens_its_hidden_sender/);
});
