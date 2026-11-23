import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs, { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertExecutionEnvironment, assertToolchainVersion, run } from './baseline.mjs';

const owner = 'anonymous::an_anonymous_ring_hides_owners_and_preserves_auditor_access';
const policy = 'anonymous::an_anonymous_policy_ring_screens_its_hidden_sender';
const pass = name => `PASS [ 0.123s] custom-ring-test-validator::ring ${name}\n`;

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'custom-rings-command-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, options: { logPath: join(root, 'validator.log'), requiredPasses: [owner, policy], quiet: true } };
}

// These run real child processes. The fixture output tests the runner's evidence
// parser only; it is never proof/validator evidence and is never published as such.
test('zero-exit command with no executed cases is rejected', async t => {
  const { root, options } = fixture(t);
  await assert.rejects(async () => run(process.execPath, ['-e', "console.log('0 tests run')"], root, options), /Missing successful validator cases/);
});

test('filter echo, skipped and wrong-binary cases cannot count as success', async t => {
  const { root, options } = fixture(t);
  const output = `filter: ${owner} | ${policy}\nSKIP [ 0.000s] custom-ring-test-validator::ring ${owner}\nPASS [ 0.123s] unrelated::ring ${policy}\n`;
  await assert.rejects(async () => run(process.execPath, ['-e', `process.stderr.write(${JSON.stringify(output)})`], root, options), /Missing successful validator cases/);
});

test('both exact named passes on stdout and stderr are retained and hashed', async t => {
  const { root, options } = fixture(t);
  const result = await run(process.execPath, ['-e', `process.stdout.write(${JSON.stringify(pass(owner))});process.stderr.write(${JSON.stringify(pass(policy))})`], root, options);
  assert.deepEqual(result.passedCases, [owner, policy]);
  assert.equal(result.status, 0);
  assert.equal(result.logSha256, createHash('sha256').update(readFileSync(options.logPath)).digest('hex'));
  assert.ok(readFileSync(options.logPath, 'utf8').includes(owner));
  assert.ok(readFileSync(options.logPath, 'utf8').includes(policy));
});

test('nonzero exit rejects even when the child prints both pass records', async t => {
  const { root, options } = fixture(t);
  await assert.rejects(async () => run(process.execPath, ['-e', `process.stderr.write(${JSON.stringify(pass(owner) + pass(policy))});process.exitCode=7`], root, options), /failed: 7/);
});

test('a previous log cannot satisfy a new run or be overwritten', async t => {
  const { root, options } = fixture(t);
  await run(process.execPath, ['-e', `process.stderr.write(${JSON.stringify(pass(owner) + pass(policy))})`], root, options);
  const before = readFileSync(options.logPath, 'utf8');
  await assert.rejects(async () => run(process.execPath, ['-e', ''], root, options), /EEXIST/);
  assert.equal(readFileSync(options.logPath, 'utf8'), before);
});

for (const name of ['ZOLANA_PREBUILT', 'ZOLANA_NEXTEST_ARCHIVE_DIR', 'GOFLAGS', 'GOWORK']) {
  test(`refuses inherited ${name} that can redirect or skip source tests`, () => {
    assert.throws(() => assertExecutionEnvironment({ [name]: name === 'GOFLAGS' ? '-run=^$' : '/tmp/unverified' }), new RegExp(name));
  });
}

test('permits empty controls and explicit module-only workspace selection', () => {
  assert.doesNotThrow(() => assertExecutionEnvironment({ ZOLANA_PREBUILT: '', ZOLANA_NEXTEST_ARCHIVE_DIR: '', GOFLAGS: '', GOWORK: 'off' }));
});

test('requires the actual Go compiler and exact module-selected version', () => {
  assert.throws(() => assertToolchainVersion('go', 'Go: Unknown option: version', '1.27.3'), /Go toolchain/);
  assert.throws(() => assertToolchainVersion('go', 'go version go1.23.2 linux/amd64', '1.27.3'), /Go toolchain/);
  assert.doesNotThrow(() => assertToolchainVersion('go', 'go version go1.27.3 linux/amd64\n', '1.27.3'));
});

test('requires the Rust version pinned by the checked-out submodule', () => {
  assert.throws(() => assertToolchainVersion('rustc', 'rustc 1.97.0 (fixture)', '1.98.1'), /Rust toolchain/);
  assert.doesNotThrow(() => assertToolchainVersion('rustc', 'rustc 1.98.1 (fixture)\n', '1.98.1'));
});

test('children cannot inherit persisted Go flags or just recipe/dotenv overrides', async t => {
  const { root, options } = fixture(t);
  const result = await run(process.execPath, ['-e', 'console.log(JSON.stringify({goenv:process.env.GOENV, gowork:process.env.GOWORK, dotenv:process.env.JUST_NO_DOTENV, noDeps:process.env.JUST_NO_DEPS ?? null, justfile:process.env.JUST_JUSTFILE ?? null}))'], root, {
    ...options, requiredPasses: [], env: { ...process.env, GOENV: '/tmp/unverified-go-env', GOWORK: '/tmp/unverified-workspace', JUST_NO_DOTENV: 'false', JUST_NO_DEPS: 'true', JUST_JUSTFILE: '/tmp/unverified.just' },
  });
  assert.deepEqual(JSON.parse(result.output), { goenv: 'off', gowork: 'off', dotenv: 'true', noDeps: null, justfile: null });
});

test('short filesystem writes still retain all log bytes and the matching digest', async t => {
  const { root, options } = fixture(t);
  const output = pass(owner) + pass(policy);
  const original = fs.writeSync;
  // A full disk or interrupted write can return fewer bytes than requested.
  // Inject that at the filesystem boundary; the child and runner stay real.
  fs.writeSync = (fd, buffer, offset = 0, length = buffer.length, position = null) => original(fd, buffer, offset, Math.min(length, 1), position);
  syncBuiltinESMExports();
  try {
    const result = await run(process.execPath, ['-e', `process.stderr.write(${JSON.stringify(output)})`], root, options);
    assert.equal(readFileSync(options.logPath, 'utf8'), output);
    assert.equal(result.logSha256, createHash('sha256').update(readFileSync(options.logPath)).digest('hex'));
  } finally {
    fs.writeSync = original;
    syncBuiltinESMExports();
  }
});

test('a capture failure rejects the run instead of escaping its promise', t => {
  const { root, options } = fixture(t);
  const moduleURL = new URL('./baseline.mjs', import.meta.url).href;
  const code = `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const fail = () => { throw Object.assign(new Error('fixture log write failed'), { code: 'ENOSPC' }); };
    fs.writeSync = fail; fs.writeFileSync = fail; syncBuiltinESMExports();
    const { run } = await import(${JSON.stringify(moduleURL)});
    try {
      await run(process.execPath, ['-e', ${JSON.stringify(`process.stderr.write(${JSON.stringify(pass(owner) + pass(policy))})`)}], ${JSON.stringify(root)}, ${JSON.stringify(options)});
      process.stdout.write('incorrect success'); process.exitCode = 3;
    } catch (error) {
      process.stdout.write(JSON.stringify({ caught: error.message, code: error.code }));
    }
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 10000 });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { caught: 'fixture log write failed', code: 'ENOSPC' });
});
