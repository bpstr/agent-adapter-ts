// Read-only CLI help/version checks. Never send a prompt to a model.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CLIENT_CAPABILITIES, CLIENT_NAMES, buildRunnerInvocation } from '../dist/index.js';

const evidence = resolve('.evidence/installed');
mkdirSync(evidence, { recursive: true });
let failed = false;
const results = [];
const helpIndexes = { codex: 1, muse: 1, opencode: 2, deepseek: 2 };
for (const client of CLIENT_NAMES) {
  const options = { client, prompt: 'CLI argument inspection only', workdir: process.cwd() };
  const executable = process.env[`AGENT_${client.toUpperCase()}_BIN`];
  const { command } = buildRunnerInvocation({ ...options, executable });
  const version = spawnSync(command, ['--version'], { encoding: 'utf8', timeout: 15000, maxBuffer: 1_048_576 });
  const entry = { client, command, version: (version.stdout || '').trim().slice(0, 200), checks: [] };
  if (version.error?.code === 'ENOENT') {
    entry.available = false; results.push(entry); console.log(`${client}: not installed (skipped)`); continue;
  }
  entry.available = true;
  const model = CLIENT_CAPABILITIES[client].model ? 'fixture/model' : undefined;
  for (const permissions of ['default', 'bypass']) {
    const invocation = buildRunnerInvocation({ ...options, executable, permissions, model });
    // Insert help before the positional delimiter, especially for Muse. No inference.
    const args = [...invocation.args];
    args.splice(helpIndexes[client] ?? 0, 0, '--help');
    const probe = spawnSync(command, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 20000, maxBuffer: 1_048_576 });
    const output = (probe.stdout || '') + (probe.stderr || '');
    writeFileSync(resolve(evidence, `${client}-${permissions}.log`), output);
    const ok = probe.status === 0 && /^\s*(usage\b|options:)/im.test(output);
    entry.checks.push({ permissions, ok, code: probe.status, error: probe.error?.message ?? null });
    failed ||= !ok;
    console.log(`${client} ${permissions}: ${ok ? 'help accepted' : 'FAILED'} (${probe.status})`);
  }
  results.push(entry);
}
writeFileSync(resolve(evidence, 'results.json'), JSON.stringify({ checkedAt: new Date().toISOString(), inferenceRequests: 0, results }, null, 2) + '\n');
console.log(`Evidence: ${evidence}`);
process.exitCode = failed ? 1 : 0;
