// Rewire only clients.js in a temporary copy; never modify the source checkout.
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const source = resolve(process.argv[2] || '../roadmap-runner');
if (!existsSync(join(source, 'lib/clients.js'))) throw new Error(`Roadmap Runner checkout not found: ${source}`);
const root = mkdtempSync(join(tmpdir(), 'adapter-roadmap-'));
const evidence = resolve('.evidence');
mkdirSync(evidence, { recursive: true });
try {
  cpSync(join(source, 'lib'), join(root, 'lib'), { recursive: true });
  mkdirSync(join(root, 'test'));
  for (const name of ['runner', 'continuation']) cpSync(join(source, `test/${name}.test.js`), join(root, `test/${name}.test.js`));
  writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
  writeFileSync(join(root, 'lib/clients.js'), `export * from ${JSON.stringify(pathToFileURL(resolve('dist/roadmap-runner.js')).href)};\n`);
  const result = spawnSync(process.execPath, ['--test', 'test/runner.test.js', 'test/continuation.test.js'], { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 2_097_152 });
  const output = (result.stdout || '') + (result.stderr || '');
  writeFileSync(resolve(evidence, 'roadmap.log'), output);
  const version = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).version;
  console.log(`Roadmap Runner ${version}: exit=${result.status}; ${output.split('\n').filter(line => /^(?:#|ℹ) (tests|pass|fail|skipped)/.test(line)).join('; ')}`);
  console.log(`Evidence: ${resolve(evidence, 'roadmap.log')}`);
  if (result.status !== 0) { console.error(output.slice(-2500)); process.exitCode = 1; }
} finally { rmSync(root, { recursive: true, force: true }); }
