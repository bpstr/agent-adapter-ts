import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { buildRunnerInvocation } from './invocation.js';
import { createOutputParser } from './output.js';
import type { AgentEvent, RunOptions, RunResult, Usage } from './types.js';

function tail(limit: number) {
  let bytes = Buffer.alloc(0);
  let truncated = false;
  return {
    push(value: string) {
      const next = Buffer.from(value);
      truncated ||= bytes.length + next.length > limit;
      bytes = Buffer.concat([bytes, next]).subarray(-limit);
      // Drop a partial UTF-8 code point at the beginning of the retained tail.
      while (bytes.length && (bytes[0]! & 0xc0) === 0x80) bytes = bytes.subarray(1);
    },
    get value() { return bytes.toString('utf8'); },
    get truncated() { return truncated; },
  };
}

function terminate(child: ChildProcess, signal: NodeJS.Signals) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', ...(signal === 'SIGKILL' ? ['/F'] : [])], { stdio: 'ignore', windowsHide: true });
  } else {
    try { process.kill(-child.pid, signal); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') child.kill(signal); }
  }
}

/** No retries, shell, global output writes, or provider SDKs. */
export async function runAgent(options: RunOptions): Promise<RunResult> {
  const invocation = buildRunnerInvocation(options);
  if (options.inheritEnvironment !== undefined && typeof options.inheritEnvironment !== 'boolean') {
    throw new Error('inheritEnvironment must be a boolean');
  }
  const env = options.inheritEnvironment === false ? { ...options.env } : { ...process.env, ...options.env };
  // OpenCode v2 resolves its workspace from PWD before falling back to process.cwd().
  if (options.client === 'opencode' && env.PWD !== undefined) env.PWD = invocation.cwd;
  const { timeoutMs, terminationGraceMs = 1000, maxOutputBytes = 1_048_576, maxEventBytes = 1_048_576 } = options;
  for (const [name, value] of Object.entries({ timeoutMs, terminationGraceMs, maxOutputBytes, maxEventBytes })) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < (name === 'terminationGraceMs' ? 0 : 1))) throw new Error(`${name} must be a ${name === 'terminationGraceMs' ? 'nonnegative' : 'positive'} safe integer`);
    if ((name === 'timeoutMs' || name === 'terminationGraceMs') && value !== undefined && value > 2_147_483_647) throw new Error(`${name} exceeds the Node timer limit`);
  }
  const stdout = tail(maxOutputBytes), stderr = tail(maxOutputBytes), text = tail(maxOutputBytes);
  const result: RunResult = { client: options.client, code: 0, signal: null, status: 'success', stdout: '', stderr: '', text: '', truncated: { stdout: false, stderr: false, text: false }, providerThreadId: null, usage: null, error: null };
  if (options.signal?.aborted) return { ...result, code: 130, status: 'interrupted' };

  return new Promise((resolve, reject) => {
    let stopped: 'timed-out' | 'interrupted' | undefined;
    let callbackError: unknown;
    let callbackFailed = false;
    let providerFailed = false;
    let spawnFailed = false;
    let closed = false;
    let timeout: NodeJS.Timeout | undefined;
    let escalation: NodeJS.Timeout | undefined;
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd, env,
      detached: process.platform !== 'win32', shell: false, windowsHide: true,
      stdio: [invocation.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    const finish = () => {
      if (!closed || escalation) return;
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abort);
      if (callbackFailed) { reject(callbackError); return; }
      result.stdout = stdout.value; result.stderr = stderr.value; result.text = text.value;
      result.truncated = { stdout: stdout.truncated, stderr: stderr.truncated, text: text.truncated };
      if (stopped) { result.status = stopped; result.code = stopped === 'timed-out' ? 124 : 130; }
      else if (spawnFailed) { result.status = 'spawn-error'; result.code = 127; }
      else if (result.code !== 0 || providerFailed) { result.status = 'failed'; if (result.code === 0) result.code = 1; }
      resolve(result);
    };
    const stop = (reason?: typeof stopped) => {
      if (reason) stopped ??= reason;
      if (escalation) return;
      terminate(child, reason === 'interrupted' ? 'SIGINT' : 'SIGTERM');
      escalation = setTimeout(() => {
        terminate(child, 'SIGKILL'); escalation = undefined; finish();
      }, terminationGraceMs);
    };
    const abort = () => stop('interrupted');
    const call = (callback: () => void) => {
      if (callbackFailed) return;
      try { callback(); }
      catch (error) { callbackFailed = true; callbackError = error; stop(); }
    };
    const emit = (event: AgentEvent) => {
      if (event.type === 'text') text.push(event.text);
      if (event.type === 'session') result.providerThreadId = event.sessionId;
      if (event.type === 'error') { providerFailed = true; result.error = event.message; }
      if (event.type === 'usage') {
        if (!result.usage || event.cumulative) result.usage = event.usage;
        else {
          const previous = result.usage;
          result.usage = Object.fromEntries(Object.keys(previous).map(key => {
            const k = key as keyof Usage, a = previous[k], b = event.usage[k];
            return [k, a === null || b === null || !Number.isSafeInteger(a + b) ? null : a + b];
          })) as unknown as Usage;
        }
      }
      if (options.onEvent) call(() => options.onEvent!(event));
    };
    const parser = createOutputParser(invocation.output, emit, maxEventBytes);
    const outDecoder = new StringDecoder('utf8'), errDecoder = new StringDecoder('utf8');
    child.stdout!.on('data', (chunk: Buffer) => {
      const value = outDecoder.write(chunk); stdout.push(value);
      if (options.onOutput) call(() => options.onOutput!(value, 'stdout'));
      parser.write(chunk);
    });
    child.stderr!.on('data', (chunk: Buffer) => {
      const value = errDecoder.write(chunk); stderr.push(value);
      if (options.onOutput) call(() => options.onOutput!(value, 'stderr'));
    });
    child.stdout!.on('end', () => { stdout.push(outDecoder.end()); parser.end(); });
    child.stderr!.on('end', () => stderr.push(errDecoder.end()));
    child.once('error', error => { spawnFailed = true; result.error = error.message; });
    child.once('close', (code, signal) => {
      closed = true; result.code = code ?? 1; result.signal = signal;
      clearTimeout(timeout); options.signal?.removeEventListener('abort', abort); finish();
    });
    child.stdin?.on('error', error => {
      // Early provider exits can close the prompt pipe before consuming it.
      if ((error as NodeJS.ErrnoException).code !== 'EPIPE') { providerFailed = true; result.error = error.message; stop(); }
    });
    if (invocation.stdin !== undefined) child.stdin!.end(invocation.stdin);
    if (timeoutMs !== undefined) timeout = setTimeout(() => stop('timed-out'), timeoutMs);
    options.signal?.addEventListener('abort', abort, { once: true });
    // Covers an abort between the preflight check and listener registration.
    if (options.signal?.aborted) abort();
  });
}
