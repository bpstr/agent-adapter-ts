import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { CLIENT_NAMES, CLIENT_CAPABILITIES, buildRunnerInvocation, buildClientInvocation, runnerPermissionCapabilities } from '../dist/index.js';
import { CLIENT_NAMES as ROADMAP_CLIENT_NAMES } from '../dist/roadmap-runner.js';

const base = { prompt: 'Implement the actual request', workdir: '.', model: 'fixture-model' };

test('the primary client list adds OpenCode and DeepSeek to the compatibility clients', () => {
  assert.deepEqual(CLIENT_NAMES, [...ROADMAP_CLIENT_NAMES, 'opencode', 'deepseek']);
  assert.deepEqual(Object.keys(CLIENT_CAPABILITIES), CLIENT_NAMES);
});

for (const client of CLIENT_NAMES) {
  test(`${client}: current command uses safe defaults and supports explicit bypass`, () => {
    const options = { ...base, client, model: CLIENT_CAPABILITIES[client].model ? base.model : undefined };
    const result = buildRunnerInvocation(options);
    assert.equal(result.cwd, resolve('.'));
    assert.equal(result.command, client === 'deepseek' ? 'dsh' : client);
    assert.equal(result.approvalFree, false);
    assert.equal(result.args.some(arg => arg === base.model || arg === `--model=${base.model}`), CLIENT_CAPABILITIES[client].model);
    assert.ok(!result.args.includes('--yolo'));
    const bypass = buildRunnerInvocation({ ...options, permissions: 'bypass' });
    assert.equal(bypass.approvalFree, true);
    if (client === 'kimi') assert.ok(bypass.args.includes('--auto'));
    if (client === 'grok') assert.ok(bypass.args.includes('bypassPermissions'));
  });
  test(`${client}: prompts with flags, Unicode, newlines and shell syntax stay data`, () => {
    const prompt = '--help\n$(touch should-not-exist) `echo nope` café';
    const result = buildRunnerInvocation({ ...base, client, prompt, model: undefined });
    if (['codex', 'claude', 'opencode', 'deepseek'].includes(client)) {
      assert.equal(result.stdin, prompt);
      assert.ok(!result.args.some(arg => arg.includes(prompt)));
    } else assert.ok(result.args.some(arg => arg === prompt || arg.endsWith(`=${prompt}`)));
  });
}

test('OpenCode runs standalone and resumes the explicit session using native auto approval', () => {
  const options = { ...base, client: 'opencode', model: 'provider/model#variant' };
  const fresh = buildRunnerInvocation(options);
  assert.equal(fresh.output, 'opencode-json');
  assert.deepEqual(fresh.args, ['--standalone', 'run', '--format', 'json', '--model=provider/model#variant']);
  const resumed = buildRunnerInvocation({ ...options, persistSession: true, resumeSessionId: 'ses_123', permissions: 'bypass' });
  assert.deepEqual(resumed.args, ['--standalone', 'run', '--format', 'json', '--auto', '--model=provider/model#variant', '--session=ses_123']);
});

test('DeepSeek uses the headless profile and passes session IDs verbatim', () => {
  const options = { prompt: base.prompt, workdir: '.', client: 'deepseek' };
  const fresh = buildRunnerInvocation(options);
  assert.equal(fresh.output, 'deepseek-json');
  assert.deepEqual(fresh.args, ['--profile', 'headless', '--json', '-']);
  const resumed = buildRunnerInvocation({ ...options, persistSession: true, resumeSessionId: 'session with spaces', permissions: 'bypass', executable: '/custom/dsh' });
  assert.equal(resumed.command, '/custom/dsh');
  assert.deepEqual(resumed.args, ['--profile', 'headless', '--json', '--permission-mode', 'danger-full-access', '--approval-policy', 'never', '--session-id=session with spaces', '-']);
  assert.throws(() => buildRunnerInvocation({ ...options, model: 'fixture-model' }), /model override/);
});

for (const client of ['opencode', 'deepseek']) {
  test(`${client}: resumption requires persistence and a valid explicit ID`, () => {
    const options = { prompt: base.prompt, workdir: '.', client };
    assert.throws(() => buildRunnerInvocation({ ...options, resumeSessionId: 'session' }), /Resume requires/);
    for (const resumeSessionId of ['', '\0', 123]) {
      assert.throws(() => buildRunnerInvocation({ ...options, persistSession: true, resumeSessionId }), /Resume requires/);
    }
  });
}

test('Codex continuation uses only an explicit provider ID and keeps parent options before resume', () => {
  const result = buildRunnerInvocation({ ...base, client: 'codex', persistSession: true, resumeSessionId: 'thread-123', effort: 'high' });
  assert.ok(!result.args.includes('--ephemeral'));
  assert.deepEqual(result.args.slice(-3), ['resume', 'thread-123', '-']);
  assert.ok(result.args.indexOf('--cd') < result.args.indexOf('resume'));
  assert.ok(result.args.indexOf('--model') < result.args.indexOf('resume'));
  assert.ok(result.args.includes('model_reasoning_effort="high"'));
  assert.throws(() => buildRunnerInvocation({ ...base, client: 'codex', resumeSessionId: 'thread-123' }), /Resume requires/);
  assert.throws(() => buildRunnerInvocation({ ...base, client: 'codex', persistSession: true, resumeSessionId: '--last' }), /Resume requires/);
  assert.throws(() => buildRunnerInvocation({ ...base, client: 'claude', persistSession: true }), /only by the Codex/);
});

test('unsupported controls and invalid inputs fail before spawning', () => {
  for (const bad of [{ client: 'unknown' }, { workdir: '' }, { prompt: '\0' }, { executable: '\0' }, { permissions: 'magic' }]) {
    assert.throws(() => buildRunnerInvocation({ ...base, client: 'codex', ...bad }));
  }
  for (const client of ['gemini', 'kimi', 'opencode', 'deepseek']) assert.throws(() => buildRunnerInvocation({ ...base, client, effort: 'high' }), /effort override/);
  for (const client of ['codex', 'claude', 'grok', 'muse']) assert.ok(buildRunnerInvocation({ ...base, client, effort: 'high' }).args.includes(client === 'codex' ? 'model_reasoning_effort="high"' : 'high'));
});

test('Codex policy is explicit on fresh and resumed sessions', () => {
  const options = { ...base, client: 'codex' };
  const readOnly = buildRunnerInvocation({ ...options, permissions: { sandbox: 'read-only', approval: 'never' } });
  assert.deepEqual(readOnly.args.slice(0, 5), ['exec', '--sandbox', 'read-only', '-c', 'approval_policy="never"']);
  assert.equal(readOnly.approvalFree, true);
  assert.ok(!readOnly.args.includes('--dangerously-bypass-approvals-and-sandbox'));
  const resume = buildRunnerInvocation({ ...options, persistSession: true, resumeSessionId: 'thread-123',
    permissions: { sandbox: 'workspace-write', approval: 'on-request' } });
  assert.deepEqual(resume.args.slice(0, 5), ['exec', '--sandbox', 'workspace-write', '-c', 'approval_policy="on-request"']);
  assert.deepEqual(resume.args.slice(-3), ['resume', 'thread-123', '-']);
  assert.equal(resume.approvalFree, false);
  assert.deepEqual(runnerPermissionCapabilities('codex'), {
    nativeInherit: 'advisory', codexPolicy: 'advisory', childEnvironmentAllowlist: 'enforced',
  });
  for (const client of CLIENT_NAMES.filter(name => name !== 'codex')) {
    assert.equal(runnerPermissionCapabilities(client).codexPolicy, 'unsupported');
    assert.throws(() => buildRunnerInvocation({ ...options, client, permissions: { sandbox: 'read-only', approval: 'never' } }), /does not support/);
  }
  assert.throws(() => buildRunnerInvocation({ ...options, permissions: { sandbox: 'read-only', approval: 'always' } }), /Unsupported/);
  assert.throws(() => buildRunnerInvocation({ ...options, permissions: { sandbox: 'read-only', approval: 'never', network: 'deny' } }), /Unsupported/);
});

test('compatibility exports preserve the established six-client contract', () => {
  const options = { prompt: 'PROMPT', workdir: '/workspace' };
  const expected = {
    codex: ['exec', '--dangerously-bypass-approvals-and-sandbox', '--json', '--skip-git-repo-check', '--ephemeral', '--cd', '/workspace', 'PROMPT'],
    claude: ['-p', '--permission-mode', 'bypassPermissions', '--output-format', 'stream-json', '--verbose', 'PROMPT'],
    gemini: ['-p', 'PROMPT', '--skip-trust', '--approval-mode=yolo', '--output-format', 'text'],
    grok: ['-p', 'PROMPT', '--yolo'],
    kimi: ['-p', 'PROMPT'],
    muse: ['exec', '--yolo', 'PROMPT'],
  };
  assert.deepEqual(ROADMAP_CLIENT_NAMES, Object.keys(expected));
  for (const client of ROADMAP_CLIENT_NAMES) assert.deepEqual(buildClientInvocation({ ...options, client }).args, expected[client]);
});
