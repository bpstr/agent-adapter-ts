import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'adapter-package-'));
const evidence = resolve('.evidence');
mkdirSync(evidence, { recursive: true });
function command(bin, args, cwd = root) {
  const result = spawnSync(bin, args, { cwd, encoding: 'utf8', timeout: 60000, maxBuffer: 2_097_152 });
  if (result.status !== 0) throw new Error(`${bin} ${args.join(' ')} failed: ${result.error?.message || result.stderr || result.stdout}`);
  return result.stdout;
}
try {
  const packed = JSON.parse(command('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', root], process.cwd()))[0];
  const names = packed.files.map(file => file.path);
  for (const name of ['dist/index.js', 'dist/index.d.ts', 'dist/roadmap-runner.js', 'README.md', 'LICENSE']) assert.ok(names.includes(name), `Missing ${name}`);
  assert.ok(names.every(name => /^(dist\/|package.json$|README.md$|LICENSE$)/.test(name)), 'Unexpected package contents');
  writeFileSync(join(root, 'package.json'), '{"type":"module","private":true}');
  command('npm', ['install', '--ignore-scripts', '--offline', '--no-audit', '--no-fund', join(root, packed.filename)]);
  writeFileSync(join(root, 'consumer.mjs'), "import {buildRunnerInvocation} from '@bpstr/agent-adapter';\nimport {buildClientInvocation,CLIENT_NAMES} from '@bpstr/agent-adapter/roadmap-runner';\nif(CLIENT_NAMES.length !== 6 || buildRunnerInvocation({client:'codex',prompt:'fixture',workdir:'.'}).stdin !== 'fixture' || !buildClientInvocation({client:'kimi',prompt:'fixture',workdir:'.'}).args.includes('-p')) throw Error('Invalid exports');\n");
  command(process.execPath, ['consumer.mjs']);
  writeFileSync(join(root, 'consumer.ts'), "import {buildRunnerInvocation,runAgent,type RunResult,type ClientName} from '@bpstr/agent-adapter';\nimport {buildClientInvocation} from '@bpstr/agent-adapter/roadmap-runner';\nconst client:ClientName='codex';\nconst invocation=buildRunnerInvocation({client,prompt:'fixture',workdir:'.'});\nconst result:Promise<RunResult>=runAgent({client,prompt:'fixture',workdir:'.',signal:AbortSignal.abort()});\nbuildClientInvocation({client,prompt:invocation.stdin!,workdir:'.'});\n");
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  command(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--typeRoots', resolve('node_modules/@types'), 'consumer.ts']);
  const report = { name: pkg.name, version: pkg.version, files: names, bytes: packed.size, unpackedBytes: packed.unpackedSize, checks: ['packed ESM imports', 'compatibility subpath imports', 'TypeScript declarations'], inferenceRequests: 0 };
  writeFileSync(resolve(evidence, 'package.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`${pkg.name}@${pkg.version}: ${names.length} files, ${packed.size} bytes; packed ESM and TypeScript consumers passed`);
} finally { rmSync(root, { recursive: true, force: true }); }
