import { StringDecoder } from 'node:string_decoder';
import type { AgentEvent, OutputFormat, Usage } from './types.js';

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
const count = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

/** Incremental UTF-8/JSONL decoding. Unknown events remain available as raw events. */
export function createOutputParser(format: OutputFormat, emit: (event: AgentEvent) => void, maxEventBytes = 1_048_576) {
  if (!Number.isSafeInteger(maxEventBytes) || maxEventBytes <= 0) throw new Error('maxEventBytes must be a positive safe integer');
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  let dropping = false;
  let ended = false;
  let sawText = false;
  const text = (value: unknown) => {
    if (typeof value === 'string' && value) { sawText = true; emit({ type: 'text', text: value }); }
  };
  const failure = (value: unknown) => {
    const error = object(value);
    emit({ type: 'error', message: typeof value === 'string' ? value : typeof error.message === 'string' ? error.message : JSON.stringify(value ?? 'Unknown provider error') });
  };
  const usage = (raw: ObjectValue, cumulative: boolean, cached: unknown = raw.cached_input_tokens) => {
    const value: Usage = { inputTokens: count(raw.input_tokens), outputTokens: count(raw.output_tokens), cachedInputTokens: count(cached) };
    if (value.inputTokens !== null && value.outputTokens !== null) emit({ type: 'usage', usage: value, cumulative });
  };
  const consume = (line: string) => {
    if (!line.trim()) return;
    let value: unknown;
    try { value = JSON.parse(line); }
    catch { emit({ type: 'diagnostic', message: line }); return; }
    const event = object(value);
    if (!Object.keys(event).length) { emit({ type: 'diagnostic', message: 'Ignored non-object JSON event' }); return; }
    emit({ type: 'raw', data: event });
    const item = object(event.item);
    if (format === 'codex-json') {
      if (event.type === 'thread.started' && typeof event.thread_id === 'string') emit({ type: 'session', sessionId: event.thread_id });
      if (event.type === 'item.completed' && item.type === 'agent_message') text(item.text);
      if (event.type === 'turn.completed') usage(object(event.usage), false);
      if (event.type === 'error' || event.type === 'turn.failed') failure(event.error ?? event.message);
    } else if (format === 'claude-json') {
      if (event.type === 'system' && typeof event.session_id === 'string') emit({ type: 'session', sessionId: event.session_id });
      if (event.type === 'assistant') {
        const blocks = object(event.message).content;
        if (Array.isArray(blocks)) for (const block of blocks) { const b = object(block); if (b.type === 'text') text(b.text); }
      }
      if (event.type === 'result') {
        if (event.is_error === true || (typeof event.subtype === 'string' && event.subtype.startsWith('error'))) failure(event.result ?? event.errors ?? event.subtype);
        else if (!sawText) text(event.result);
        const raw = object(event.usage);
        usage(raw, true, raw.cache_read_input_tokens);
      }
      if (event.type === 'error') failure(event.error ?? event.message);
    } else if (format === 'gemini-json') {
      if (event.type === 'init' && typeof event.session_id === 'string') emit({ type: 'session', sessionId: event.session_id });
      if (event.type === 'message' && event.role === 'assistant') text(event.content);
      if (event.type === 'error') {
        if (event.severity === 'warning' || event.severity === 'info') {
          const detail = event.message ?? object(event.error).message ?? 'Gemini warning';
          emit({ type: 'diagnostic', message: String(detail) });
        } else failure(event.error ?? event.message);
      }
      if (event.type === 'result') {
        if (event.status === 'error') failure(event.error ?? event.message ?? 'Gemini failed');
        const stats = object(event.stats);
        usage({ input_tokens: stats.input_tokens, output_tokens: stats.output_tokens, cached_input_tokens: stats.cached }, true);
      }
    }
  };
  const decode = (chunk: string) => {
    if (format === 'text') { text(chunk); return; }
    // Scan each segment without ever retaining an unbounded partial event.
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf('\n', start);
      const segment = chunk.slice(start, newline < 0 ? chunk.length : newline);
      if (!dropping) {
        if (Buffer.byteLength(buffer) + Buffer.byteLength(segment) > maxEventBytes) {
          buffer = ''; dropping = true;
          emit({ type: 'error', message: `JSON event exceeds maxEventBytes (${maxEventBytes})` });
        } else buffer += segment;
      }
      if (newline < 0) break;
      if (!dropping) consume(buffer.replace(/\r$/, ''));
      buffer = ''; dropping = false; start = newline + 1;
    }
  };
  return {
    write(chunk: string | Uint8Array) {
      if (ended) throw new Error('Parser is already ended');
      decode(typeof chunk === 'string' ? chunk : decoder.write(Buffer.from(chunk)));
    },
    end() {
      if (ended) return;
      ended = true; decode(decoder.end());
      if (buffer && !dropping) consume(buffer.replace(/\r$/, ''));
      buffer = '';
    },
  };
}
