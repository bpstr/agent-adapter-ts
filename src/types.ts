export const ROADMAP_CLIENT_NAMES = ['codex', 'claude', 'gemini', 'grok', 'kimi', 'muse'] as const;
export const CLIENT_NAMES = [...ROADMAP_CLIENT_NAMES, 'opencode', 'deepseek'] as const;
export type ClientName = typeof CLIENT_NAMES[number];
export type OutputFormat = 'codex-json' | 'claude-json' | 'gemini-json' | 'opencode-json' | 'deepseek-json' | 'text';

export interface InvocationOptions {
  client: ClientName;
  prompt: string;
  workdir: string;
  model?: string;
  effort?: string;
  executable?: string;
  persistSession?: boolean;
  resumeSessionId?: string | null;
}

export interface Invocation {
  command: string;
  args: string[];
  output: OutputFormat;
  approvalFree: boolean;
}

export interface CodexPermissions {
  sandbox: 'read-only' | 'workspace-write';
  approval: 'never' | 'on-request';
}

export interface RunnerOptions extends InvocationOptions {
  /** Inherit the native policy, explicitly bypass it, or configure Codex. */
  permissions?: 'default' | 'bypass' | CodexPermissions;
}

export interface RunnerInvocation extends Invocation {
  cwd: string;
  /** Prompt supplied through stdin for clients that support it. */
  stdin?: string;
}

export interface Usage {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
}

export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'session'; sessionId: string }
  | { type: 'usage'; usage: Usage; cumulative: boolean }
  | { type: 'error'; message: string }
  | { type: 'diagnostic'; message: string }
  | { type: 'raw'; data: Record<string, unknown> };

export interface RunOptions extends RunnerOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  terminationGraceMs?: number;
  /** Tail retained per stdout, stderr and extracted text stream; default 1 MiB. */
  maxOutputBytes?: number;
  /** Maximum buffered JSON event, default 1 MiB. */
  maxEventBytes?: number;
  /** Overrides are merged with process.env. Pass undefined to remove a variable. */
  env?: NodeJS.ProcessEnv;
  /** Set false to pass only the explicitly supplied env entries to the child. */
  inheritEnvironment?: boolean;
  onEvent?: (event: AgentEvent) => void;
  onOutput?: (chunk: string, stream: 'stdout' | 'stderr') => void;
}

export interface RunResult {
  client: ClientName;
  code: number;
  signal: NodeJS.Signals | null;
  status: 'success' | 'failed' | 'spawn-error' | 'timed-out' | 'interrupted';
  stdout: string;
  stderr: string;
  text: string;
  truncated: { stdout: boolean; stderr: boolean; text: boolean };
  providerThreadId: string | null;
  usage: Usage | null;
  error: string | null;
}
