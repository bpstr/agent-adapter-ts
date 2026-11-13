import { CLIENT_NAMES, type InvocationOptions, type RunnerInvocation, type RunnerOptions } from './types.js';
import { resolve } from 'node:path';
import { buildClientInvocation } from './roadmap-runner.js';

export const CLIENT_CAPABILITIES = {
  codex: { continuation: true, structuredOutput: true, model: true, effort: true },
  claude: { continuation: false, structuredOutput: true, model: true, effort: true },
  gemini: { continuation: false, structuredOutput: true, model: true, effort: false },
  grok: { continuation: false, structuredOutput: false, model: true, effort: true },
  kimi: { continuation: false, structuredOutput: false, model: true, effort: false },
  muse: { continuation: false, structuredOutput: false, model: true, effort: true },
} as const;

/** Describes the adapter boundary. OS containment needs separate native qualification. */
export function runnerPermissionCapabilities(client: InvocationOptions['client']) {
  return {
    nativeInherit: 'advisory',
    codexPolicy: client === 'codex' ? 'advisory' : 'unsupported',
    childEnvironmentAllowlist: 'enforced',
  } as const;
}

export function validateOptions(options: InvocationOptions): void {
  if (!CLIENT_NAMES.includes(options.client)) throw new Error(`Unsupported client: ${options.client}`);
  for (const field of ['prompt', 'workdir'] as const) {
    if (typeof options[field] !== 'string' || !options[field].trim() || options[field].includes('\0')) {
      throw new Error(`${field} must be a nonempty string without NUL bytes`);
    }
  }
  for (const field of ['model', 'effort', 'executable'] as const) {
    const value = options[field];
    if (value !== undefined && (typeof value !== 'string' || value.includes('\0'))) throw new Error(`Invalid ${field}`);
  }
}

/** Build a current CLI invocation without launching a process. */
export function buildRunnerInvocation(options: RunnerOptions): RunnerInvocation {
  validateOptions(options);
  const { client, prompt, model = '', effort = '', permissions = 'default' } = options;
  const workdir = resolve(options.workdir);
  const policy = typeof permissions === 'object' && permissions !== null ? permissions : undefined;
  if (policy) {
    if (client !== 'codex') throw new Error(`${client} does not support a Codex permission policy`);
    if (Object.keys(policy).some(key => key !== 'sandbox' && key !== 'approval') ||
        !['read-only', 'workspace-write'].includes(policy.sandbox) ||
        !['never', 'on-request'].includes(policy.approval)) {
      throw new Error('Unsupported Codex sandbox or approval policy');
    }
  } else if (permissions !== 'default' && permissions !== 'bypass') {
    throw new Error('Invalid permissions');
  }
  if (effort && !CLIENT_CAPABILITIES[client].effort) throw new Error(`${client} does not support an effort override`);
  const bypass = permissions === 'bypass';
  // Reuse the extracted continuation checks and established command construction.
  const legacy = buildClientInvocation({ ...options, workdir, model: '', effort: '' });
  let args: string[];
  let stdin: string | undefined;
  let output = legacy.output;
  switch (client) {
    case 'codex':
      args = legacy.args.slice(0, -1).filter(arg => arg !== '--dangerously-bypass-approvals-and-sandbox');
      if (bypass) args.splice(1, 0, '--dangerously-bypass-approvals-and-sandbox');
      if (policy) args.splice(1, 0, '--sandbox', policy.sandbox, '-c', `approval_policy=${JSON.stringify(policy.approval)}`);
      // Model and config options must precede the resume subcommand.
      { const index = args.indexOf('resume'); const at = index < 0 ? args.length : index;
        const overrides = [...(model ? ['--model', model] : []), ...(effort ? ['-c', `model_reasoning_effort=${JSON.stringify(effort)}`] : [])];
        args.splice(at, 0, ...overrides); }
      args.push('-'); stdin = prompt;
      break;
    case 'claude':
      args = ['-p', ...(bypass ? ['--permission-mode', 'bypassPermissions'] : []), '--output-format', 'stream-json', '--verbose'];
      if (model) args.push('--model', model);
      if (effort) args.push('--effort', effort);
      stdin = prompt;
      break;
    case 'gemini':
      args = [`--prompt=${prompt}`, ...(bypass ? ['--skip-trust', '--approval-mode=yolo'] : []), '--output-format', 'stream-json'];
      if (model) args.push('--model', model);
      output = 'gemini-json';
      break;
    case 'grok':
      // Current Grok CLI uses permission-mode; the old Campfire --yolo flag is gone.
      args = [`--single=${prompt}`, ...(bypass ? ['--permission-mode', 'bypassPermissions'] : [])];
      if (model) args.push('--model', model);
      if (effort) args.push('--reasoning-effort', effort);
      break;
    case 'kimi':
      args = [`--prompt=${prompt}`, ...(bypass ? ['--auto'] : [])];
      if (model) args.push('--model', model);
      break;
    case 'muse':
      args = ['exec', ...(bypass ? ['--yolo'] : [])];
      if (model) args.push('--model', model);
      if (effort) args.push('--reasoning-effort', effort);
      args.push('--', prompt);
      break;
  }
  return { command: legacy.command, args, cwd: workdir, output, approvalFree: bypass || policy?.approval === 'never', ...(stdin === undefined ? {} : { stdin }) };
}
