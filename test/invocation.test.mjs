import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { CLIENT_NAMES, CLIENT_CAPABILITIES, buildRunnerInvocation, buildClientInvocation } from '../dist/index.js';

const base = { prompt: 'Implement the actual request', workdir: '.', model: 'fixture-model' };

for (const client of CLIENT_NAMES) {
  test(`${client}: current command uses safe defaults and supports explicit bypass and model`, () => {
    const result = buildRunnerInvocation({ ...base, client });
    assert.equal(result.cwd, resolve('.'));
    assert.equal(result.command, client);
    assert.equal(result.approvalFree, false);
    assert.ok(result.args.includes('fixture-model'));
    assert.ok(!result.args.includes('--yolo'));
    const bypass = buildRunnerInvocation({ ...base, client, permissions: 'bypass' });
    assert.equal(bypass.approvalFree, true);
    if (client === 'kimi') assert.ok(bypass.args.includes('--auto'));
    if (client === 'grok') assert.ok(bypass.args.includes('bypassPermissions'));
    assert.equal(CLIENT_CAPABILITIES[client].model, true);
  });
  test(`${client}: prompts with flags, Unicode, newlines and shell syntax stay data`, () => {
    const prompt = '--help\n$(touch should-not-exist) `echo nope` café';
    const result = buildRunnerInvocation({ ...base, client, prompt });
    if (client === 'codex' || client === 'claude') {
      assert.equal(result.stdin, prompt);
      assert.ok(!result.args.some(arg => arg.includes(prompt)));
    } else assert.ok(result.args.some(arg => arg === prompt || arg.endsWith(`=${prompt}`)));
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
  for (const client of ['gemini', 'kimi']) assert.throws(() => buildRunnerInvocation({ ...base, client, effort: 'high' }), /effort override/);
  for (const client of ['codex', 'claude', 'grok', 'muse']) assert.ok(buildRunnerInvocation({ ...base, client, effort: 'high' }).args.includes(client === 'codex' ? 'model_reasoning_effort="high"' : 'high'));
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
  for (const client of CLIENT_NAMES) assert.deepEqual(buildClientInvocation({ ...options, client }).args, expected[client]);
});
