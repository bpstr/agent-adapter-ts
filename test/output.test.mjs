import test from 'node:test';
import assert from 'node:assert/strict';
import { createOutputParser } from '../dist/index.js';

function parse(format, values, size = 1_048_576) {
  const events = [], parser = createOutputParser(format, event => events.push(event), size);
  const bytes = Buffer.from(values.map(value => JSON.stringify(value)).join('\r\n'));
  for (let i = 0; i < bytes.length; i++) parser.write(bytes.subarray(i, i + 1));
  parser.end(); parser.end();
  return events;
}

test('Codex parses split UTF-8, CRLF, final unterminated line, session, usage, errors', () => {
  const events = parse('codex-json', [
    null, [], { type: 'thread.started', thread_id: 'fixture-1' },
    { type: 'item.completed', item: { type: 'agent_message', text: 'Szia 🌍' } },
    { type: 'turn.completed', usage: { input_tokens: 9, output_tokens: 2, cached_input_tokens: 4 } },
    { type: 'turn.failed', error: { message: 'Prepared quota error' } },
  ]);
  assert.deepEqual(events.find(e => e.type === 'text'), { type: 'text', text: 'Szia 🌍' });
  assert.equal(events.find(e => e.type === 'session').sessionId, 'fixture-1');
  assert.deepEqual(events.find(e => e.type === 'usage').usage, { inputTokens: 9, outputTokens: 2, cachedInputTokens: 4 });
  assert.equal(events.find(e => e.type === 'error').message, 'Prepared quota error');
});

test('Claude emits assistant blocks once, aggregate usage, and result-only fallback', () => {
  const events = parse('claude-json', [
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Answer' }, { type: 'tool_use' }] } },
    { type: 'result', result: 'Answer', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3 } },
  ]);
  assert.equal(events.filter(e => e.type === 'text').length, 1);
  assert.equal(events.find(e => e.type === 'usage').cumulative, true);
  assert.equal(parse('claude-json', [{ type: 'result', result: 'Fallback' }]).find(e => e.type === 'text').text, 'Fallback');
  assert.equal(parse('claude-json', [{ type: 'result', subtype: 'error_max_turns', errors: ['limit'] }]).find(e => e.type === 'error').message, '["limit"]');
});

test('Gemini extracts only assistant messages and reports terminal failures', () => {
  const events = parse('gemini-json', [
    { type: 'message', role: 'user', content: 'private prompt' },
    { type: 'message', role: 'assistant', content: 'Answer' },
    { type: 'result', status: 'error', error: { message: 'Prepared outage' }, stats: { input_tokens: 3, output_tokens: 2, cached: 1 } },
  ]);
  assert.deepEqual(events.filter(e => e.type === 'text').map(e => e.text), ['Answer']);
  assert.equal(events.find(e => e.type === 'error').message, 'Prepared outage');
});

test('Gemini warning events remain diagnostic when the terminal outcome succeeds', () => {
  const events = parse('gemini-json', [
    { type: 'error', severity: 'warning', message: 'Prepared retry warning' },
    { type: 'result', status: 'success' },
  ]);
  assert.equal(events.filter(e => e.type === 'error').length, 0);
  assert.equal(events.find(e => e.type === 'diagnostic').message, 'Prepared retry warning');
});

test('malformed lines are diagnostic and oversized events are bounded and recover at newline', () => {
  const events = [], parser = createOutputParser('codex-json', event => events.push(event), 120);
  parser.write('launcher warning\n');
  parser.write('x'.repeat(1000));
  parser.write('\n{"type":"item.completed","item":{"type":"agent_message","text":"recovered"}}');
  parser.end();
  assert.equal(events.filter(e => e.type === 'error').length, 1);
  assert.equal(events.find(e => e.type === 'diagnostic').message, 'launcher warning');
  assert.equal(events.find(e => e.type === 'text').text, 'recovered');
  assert.throws(() => parser.write('late'), /ended/);
});

test('plain text preserves Unicode and ignores JSON semantics', () => {
  const events = [], parser = createOutputParser('text', event => events.push(event));
  const bytes = Buffer.from('é🌍{"type":"error"}');
  for (const byte of bytes) parser.write(Uint8Array.of(byte));
  parser.end();
  assert.equal(events.map(e => e.text).join(''), 'é🌍{"type":"error"}');
});
