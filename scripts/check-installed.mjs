// Read-only CLI help/version checks. Never send a prompt to a model.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CLIENT_NAMES, buildRunnerInvocation } from '../dist/index.js';

const evidence = resolve('.evidence/installed');
mkdirSync(evidence, { recursive: true });
let failed = false;
const results = [];
for (const client of CLIENT_NAMES) {
  const command = process.env[`AGENT_${client.toUpperCase()}_BIN`] || client;
  const version = spawnSync(command, ['--version'], { encoding: 'utf8', timeout: 15000, maxBuffer: 1_048_576 });
  const entry = { client, command, version: (version.stdout || '').trim().slice(0, 200), checks: [] };
  if (version.error?.code === 'ENOENT') {
    entry.available = false; results.push(entry); console.log(`${client}: not installed (skipped)`); continue;
  }
  entry.available = true;
  for (const permissions of ['default', 'bypass']) {
    const invocation = buildRunnerInvocation({ client, prompt: 'CLI argument inspection only', workdir: process.cwd(), executable: command, permissions, model: 'fixture-model' });
    // Insert help before the positional delimiter, especially for Muse. No inference.
    const args = [...invocation.args];
    args.splice(client === 'codex' || client === 'muse' ? 1 : 0, 0, '--help');
    const probe = spawnSync(command, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 20000, maxBuffer: 1_048_576 });
    const output = (probe.stdout || '') + (probe.stderr || '');
    writeFileSync(resolve(evidence, `${client}-${permissions}.log`), output);
    const ok = probe.status === 0 && /usage:|options:/i.test(output);
    entry.checks.push({ permissions, ok, code: probe.status, error: probe.error?.message ?? null });
    failed ||= !ok;
    console.log(`${client} ${permissions}: ${ok ? 'help accepted' : 'FAILED'} (${probe.status})`);
  }
  results.push(entry);
}
writeFileSync(resolve(evidence, 'results.json'), JSON.stringify({ checkedAt: new Date().toISOString(), inferenceRequests: 0, results }, null, 2) + '\n');
console.log(`Evidence: ${evidence}`);
process.exitCode = failed ? 1 : 0;
