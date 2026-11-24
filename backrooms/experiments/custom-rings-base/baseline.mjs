import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, createReadStream, existsSync, mkdtempSync, openSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

export const pin = Object.freeze({
  upstream: 'https://github.com/helius-labs/custom-privacy-rings.git',
  revision: '02bca33729051798834ecbb4d94e968cdc0ef9b8',
  zolana: '0fe4f952182b39464d472c52c40b3febe6cbd9ec',
});

export const validatorCases = Object.freeze([
  'anonymous::an_anonymous_ring_hides_owners_and_preserves_auditor_access',
  'anonymous::an_anonymous_policy_ring_screens_its_hidden_sender',
]);
const hiddenOwnerCases = validatorCases.map(name => `test(${name.split('::').at(-1)})`).join(' | ');
export const commands = Object.freeze([
  ['check-all'],
  ['test-hermetic'],
  ['test-custom-ring'],
  ['test-custom-ring-validator', hiddenOwnerCases, '--color', 'never', '--status-level', 'pass', '--final-status-level', 'pass'],
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

export async function run(command, args, cwd, { logPath, requiredPasses = [], quiet = false, env = process.env } = {}) {
  const childEnv = { ...env, GOENV: 'off', GOWORK: 'off' };
  // No ancestor dotenv, alternate justfile or dependency-skipping override may
  // replace these pinned recipes. Nested just invocations inherit this setting.
  for (const name of Object.keys(childEnv)) if (name.startsWith('JUST_')) delete childEnv[name];
  childEnv.JUST_NO_DOTENV = 'true';
  // Each invocation owns a new log. Never accept a stale file as run evidence.
  const fd = logPath ? openSync(logPath, 'wx', 0o600) : undefined;
  const digest = createHash('sha256');
  const passed = new Set();
  const startedAt = new Date().toISOString();
  const started = performance.now();
  let output = '', outputTruncated = false;
  const pending = { stdout: '', stderr: '' };
  const checkLine = line => {
    const match = stripVTControlCharacters(line).match(/^\s*PASS\s+\[[^\]\r\n]+\]\s+(?:\(\s*\d+\/\d+\)\s+)?custom-ring-test-validator::ring\s+(\S+)\s*$/);
    if (match && requiredPasses.includes(match[1])) passed.add(match[1]);
  };
  const receive = (stream, chunk) => {
    if (fd !== undefined) writeFileSync(fd, chunk);
    digest.update(chunk);
    if (!quiet) process[stream].write(chunk);
    const text = chunk.toString('utf8');
    const available = Math.max(0, 65536 - output.length);
    output += text.slice(0, available);
    if (text.length > available) outputTruncated = true;
    const lines = (pending[stream] + text).split('\n');
    pending[stream] = lines.pop();
    for (const line of lines) checkLine(line);
  };
  let result, captureError;
  try {
    result = await new Promise(done => {
      const child = spawn(command, args, { cwd, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
      const failCapture = error => { captureError ??= error; child.kill('SIGTERM'); };
      for (const stream of ['stdout', 'stderr']) {
        child[stream].on('data', chunk => {
          if (captureError) return;
          try { receive(stream, chunk); } catch (error) { failCapture(error); }
        });
        child[stream].on('error', failCapture);
      }
      child.once('error', error => { captureError ??= error; });
      child.once('close', (status, signal) => done({ status, signal }));
    });
    for (const line of Object.values(pending)) checkLine(line);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  let logSha256 = digest.digest('hex');
  if (logPath) {
    const recorded = createHash('sha256');
    for await (const chunk of createReadStream(logPath)) recorded.update(chunk);
    logSha256 = recorded.digest('hex');
  }
  const evidence = {
    command, args, cwd, startedAt, durationMs: Math.round(performance.now() - started),
    ...result, logPath, logSha256,
    passedCases: requiredPasses.filter(name => passed.has(name)), output, outputTruncated,
  };
  if (captureError) throw Object.assign(captureError, { evidence: { ...evidence, captureError: captureError.message } });
  const missing = requiredPasses.filter(name => !passed.has(name));
  const failure = result.status !== 0 ? `${command} failed: ${result.signal ?? result.status}`
    : missing.length ? `Missing successful validator cases: ${missing.join(', ')}` : null;
  if (failure) throw Object.assign(new Error(failure), { evidence });
  return evidence;
}

export function assertExecutionEnvironment(env) {
  for (const name of ['ZOLANA_PREBUILT', 'ZOLANA_NEXTEST_ARCHIVE_DIR', 'GOFLAGS']) {
    requireThat(!env[name], `Unset ${name}: the source baseline must not redirect builds or filter its test suite`);
  }
  requireThat(!env.GOWORK || env.GOWORK === 'off', 'Unset GOWORK or set it to off: use the pinned Go module');
}

export function assertToolchainVersion(tool, reported, expected) {
  const match = tool === 'go' ? reported.match(/^go version go(\d+\.\d+\.\d+)\s/m)
    : reported.match(/^rustc (\d+\.\d+\.\d+)\s/m);
  requireThat(match?.[1] === expected, `${tool === 'go' ? 'Go' : 'Rust'} toolchain must match the pinned ${expected}`);
}

export async function main(args) {
  const [checkout, flag, ...extra] = args;
  requireThat(checkout && extra.length === 0 && (!flag || flag === '--run-localnet'), 'Usage: node baseline.mjs <upstream-checkout> [--run-localnet]');
  const evidence = inspectCheckout(checkout);
  console.log(JSON.stringify({ scope: 'upstream-baseline-only', ...evidence }, null, 2));
  console.log('Preflight passed. No application composition, anonymity or production qualification inferred.');
  for (const cmd of commands) console.log(`just ${cmd.map(arg => JSON.stringify(arg)).join(' ')}`);
  if (!flag) return;
  requireThat(Number(process.versions.node.split('.')[0]) >= 24, 'Upstream requires Node >=24');
  requireThat(process.env.SPAWN_DISPOSABLE_LOCALNET === '1', 'Run on an isolated disposable test host; set SPAWN_DISPOSABLE_LOCALNET=1 only after checking isolation');
  assertExecutionEnvironment(process.env);
  const goVersion = git(evidence.root, 'show', 'HEAD:prover/go.mod').match(/^go (\d+\.\d+\.\d+)$/m)?.[1];
  const rustVersion = git(resolve(evidence.root, 'zolana'), 'show', 'HEAD:rust-toolchain.toml').match(/^channel\s*=\s*"(\d+\.\d+\.\d+)"/m)?.[1];
  requireThat(goVersion && rustVersion, 'Cannot read exact pinned Go/Rust toolchains');
  const directory = mkdtempSync(join(tmpdir(), 'spawn-custom-rings-baseline-'));
  const receipt = { scope: 'upstream-baseline-only', status: 'running', source: evidence,
    node: process.version, requiredToolchains: { go: goVersion, rustc: rustVersion }, commands: [],
    applicationComposition: 'not-run', validatorCases: [] };
  const receiptPath = join(directory, 'receipt.json');
  const save = () => writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  const execute = async (command, argv, cwd = evidence.root, requiredPasses = []) => {
    const logPath = join(directory, `${String(receipt.commands.length + 1).padStart(2, '0')}-${command}.log`);
    try {
      const result = await run(command, argv, cwd, { logPath, requiredPasses });
      const { output, outputTruncated, ...record } = result;
      receipt.commands.push(record); save();
      return result;
    } catch (error) {
      if (error.evidence) {
        const { output, outputTruncated, ...record } = error.evidence;
        receipt.commands.push(record);
      }
      throw error;
    }
  };
  console.log(`Run evidence (review before publishing): ${directory}`);
  save();
  try {
    for (const tool of ['just', 'cargo', 'jq', 'curl']) await execute(tool, ['--version']);
    const go = await execute('go', ['version'], resolve(evidence.root, 'prover'));
    assertToolchainVersion('go', go.output, goVersion);
    const rust = await execute('rustc', ['--version']);
    assertToolchainVersion('rustc', rust.output, rustVersion);
    await execute('cargo', ['nextest', '--version']);
    await execute('cargo', ['build-sbf', '--version']);
    for (const cmd of commands) {
      const required = cmd[0] === 'test-custom-ring-validator' ? validatorCases : [];
      const result = await execute('just', cmd, evidence.root, required);
      if (required.length) receipt.validatorCases = result.passedCases;
    }
    // Some upstream commands can update lockfiles: source must still match pins.
    receipt.sourceAfter = inspectCheckout(evidence.root);
    receipt.status = 'passed';
    console.log('Pinned upstream suites and both named hidden-owner validator cases passed; source remained clean. Application composition, recovery and production remain unqualified.');
  } catch (error) {
    receipt.status = 'failed'; receipt.error = error.message;
    throw error;
  } finally {
    save();
    console.log(`Evidence receipt: ${receiptPath}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
