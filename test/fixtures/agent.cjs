#!/usr/bin/env node
// Prepared transport only: no provider libraries, network, or credential reads.
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const mode = process.env.FIXTURE_MODE;
if (mode === 'hang' || mode === 'tree') {
  if (mode === 'tree') {
    const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});process.on('SIGINT',()=>{});console.log('child-ready');setInterval(()=>{},1000)"], { stdio: ['ignore', 'pipe', 'inherit'] });
    child.stdout.once('data', () => {
      fs.writeFileSync(process.env.FIXTURE_PID, String(child.pid));
      console.log('ready');
    });
  } else {
    process.on('SIGTERM', () => {});
    process.on('SIGINT', () => {});
    console.log('ready');
  }
  setInterval(() => {}, 1000);
} else {
  let input = '';
  const finish = () => {
    if (mode === 'inspect') {
      console.log(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), input, marker: process.env.FIXTURE_MARKER, ambient: process.env.ADAPTER_AMBIENT_FIXTURE }));
    } else if (mode === 'flood') {
      process.stdout.write('é'.repeat(10000));
      process.stderr.write('x'.repeat(10000));
    } else if (mode === 'codex') {
      console.log(JSON.stringify({ type: 'thread.started', thread_id: 'fixture-thread-1' }));
      console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Prepared answer ✓' } }));
      console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 12, output_tokens: 3, cached_input_tokens: 2 } }));
      console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 8, output_tokens: 2, cached_input_tokens: 1 } }));
    } else if (mode === 'claude-error') {
      console.log(JSON.stringify({ type: 'result', is_error: true, result: 'Prepared quota exhaustion' }));
    } else if (mode === 'gemini') {
      console.log(JSON.stringify({ type: 'message', role: 'assistant', content: 'Prepared Gemini answer' }));
    } else if (mode === 'exit') {
      process.stderr.write('Prepared authentication failure');
      process.exitCode = 42;
    } else {
      process.stdout.write('Prepared text answer');
    }
  };
  // Only stdin-backed adapters pipe input; the others receive /dev/null.
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', finish);
  process.stdin.resume();
}
