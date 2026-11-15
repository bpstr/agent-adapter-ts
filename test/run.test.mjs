import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLIENT_NAMES, runAgent } from '../dist/index.js';

const executable = fileURLToPath(new URL('./fixtures/agent.cjs', import.meta.url));
chmodSync(executable, 0o755);
const base = { workdir: process.cwd(), executable, prompt: 'Prepared real subprocess input', timeoutMs: 5000, terminationGraceMs: 50 };
const fixture = (client, mode, more = {}) => ({ ...base, client, env: { FIXTURE_MODE: mode }, ...more });

for (const client of CLIENT_NAMES) {
  test(`${client}: real offline subprocess uses correct cwd and prompt transport`, async () => {
    let captured = '';
    const result = await runAgent(fixture(client, 'inspect', { env: { FIXTURE_MODE: 'inspect', FIXTURE_MARKER: 'merged-env' }, onOutput: (chunk, stream) => { if (stream === 'stdout') captured += chunk; } }));
    assert.equal(result.status, 'success');
    const data = JSON.parse(result.stdout);
    assert.equal(data.cwd, base.workdir);
    assert.equal(data.marker, 'merged-env');
    assert.equal(result.stdout, captured);
    if (['codex', 'claude', 'opencode', 'deepseek'].includes(client)) assert.equal(data.input, base.prompt);
    else assert.ok(data.args.some(arg => arg === base.prompt || arg.endsWith(`=${base.prompt}`)));
  });
}

test('OpenCode receives the requested workdir in PWD when it is present', async () => {
  const env = { PATH: process.env.PATH, FIXTURE_MODE: 'inspect', PWD: tmpdir() };
  const result = await runAgent(fixture('opencode', 'inspect', { inheritEnvironment: false, env }));
  assert.equal(JSON.parse(result.stdout).pwd, base.workdir);
  assert.equal(env.PWD, tmpdir());
});

test('explicit child environment excludes ambient values', async () => {
  process.env.ADAPTER_AMBIENT_FIXTURE = 'dummy';
  try {
    const result = await runAgent(fixture('codex', 'inspect', {
      inheritEnvironment: false,
      env: { PATH: process.env.PATH, FIXTURE_MODE: 'inspect', FIXTURE_MARKER: 'allowed' },
    }));
    assert.equal(result.status, 'success');
    const data = JSON.parse(result.stdout);
    assert.equal(data.marker, 'allowed');
    assert.equal(data.ambient, undefined);
  } finally {
    delete process.env.ADAPTER_AMBIENT_FIXTURE;
  }
});

test('structured output gives session, text, raw events and summed usage', async () => {
  const events = [];
  const result = await runAgent(fixture('codex', 'codex', { onEvent: event => events.push(event) }));
  assert.equal(result.text, 'Prepared answer ✓');
  assert.equal(result.providerThreadId, 'fixture-thread-1');
  assert.deepEqual(result.usage, { inputTokens: 20, outputTokens: 5, cachedInputTokens: 3 });
  assert.ok(events.some(e => e.type === 'raw'));
});

for (const [client, sessionId] of [['opencode', 'ses_fixture'], ['deepseek', 'session-fixture']]) {
  test(`${client}: structured output reports the answer, session and step usage`, async () => {
    const events = [];
    const result = await runAgent(fixture(client, client, { onEvent: event => events.push(event) }));
    assert.equal(result.status, 'success');
    assert.equal(result.text, 'Prepared answer ✓');
    assert.equal(result.providerThreadId, sessionId);
    assert.deepEqual(events.filter(event => event.type === 'session'), [{ type: 'session', sessionId }]);
    assert.deepEqual(result.usage, { inputTokens: 20, outputTokens: 5, cachedInputTokens: 3 });
    assert.ok(events.some(event => event.type === 'raw'));
  });

  test(`${client}: a structured failure overrides exit zero`, async () => {
    const result = await runAgent(fixture(client, `${client}-provider-error`));
    assert.equal(result.status, 'failed');
    assert.equal(result.error, 'Prepared failure');
  });
}

test('provider failures override zero exit and nonzero exits preserve stderr', async () => {
  const provider = await runAgent(fixture('claude', 'claude-error'));
  assert.equal(provider.status, 'failed'); assert.equal(provider.code, 1);
  assert.match(provider.error, /quota/);
  const exit = await runAgent(fixture('kimi', 'exit'));
  assert.equal(exit.code, 42); assert.equal(exit.status, 'failed');
  assert.match(exit.stderr, /authentication/);
});

test('missing executable and invalid cwd settle as spawn errors', async () => {
  for (const more of [{ executable: '/not/a/cli' }, { workdir: '/not/a/workspace' }]) {
    const result = await runAgent(fixture('codex', 'codex', more));
    assert.equal(result.status, 'spawn-error'); assert.equal(result.code, 127);
  }
});

test('capture limits bound all retained streams on UTF-8 boundaries', async () => {
  const result = await runAgent(fixture('kimi', 'flood', { maxOutputBytes: 101 }));
  for (const name of ['stdout', 'stderr', 'text']) {
    assert.ok(Buffer.byteLength(result[name]) <= 101);
    assert.equal(result.truncated[name], true);
    assert.ok(!result[name].includes('�'));
  }
});

test('already aborted signals never launch a child', async () => {
  const signal = AbortSignal.abort();
  const result = await runAgent(fixture('codex', 'hang', { signal, executable: '/not/a/cli' }));
  assert.equal(result.status, 'interrupted'); assert.equal(result.code, 130);
});

test('running abort and callback failures terminate the child before settling', async () => {
  const controller = new AbortController();
  const result = await runAgent(fixture('kimi', 'hang', { signal: controller.signal, onOutput: () => controller.abort() }));
  assert.equal(result.status, 'interrupted'); assert.equal(result.code, 130);
  await assert.rejects(runAgent(fixture('kimi', 'hang', { onOutput: () => { throw new Error('observer failed'); } })), /observer failed/);
});

test('timeout kills a stubborn child and descendants even when the parent exits first', async () => {
  const root = mkdtempSync(join(tmpdir(), 'adapter-tree-'));
  const pidFile = join(root, 'child.pid');
  try {
    const result = await runAgent(fixture('kimi', 'tree', { timeoutMs: 800, env: { FIXTURE_MODE: 'tree', FIXTURE_PID: pidFile } }));
    assert.equal(result.status, 'timed-out'); assert.equal(result.code, 124);
    const pid = Number(readFileSync(pidFile, 'utf8'));
    assert.throws(() => process.kill(pid, 0), error => error.code === 'ESRCH');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('invalid limits reject before any subprocess starts', async () => {
  for (const invalid of [{ timeoutMs: 0 }, { timeoutMs: 2 ** 32 }, { maxOutputBytes: 0 }, { maxEventBytes: -1 }, { terminationGraceMs: -1 }]) {
    await assert.rejects(runAgent(fixture('kimi', 'hang', invalid)), /must be|timer limit/);
  }
});
