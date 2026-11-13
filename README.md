# Agent Adapter

Run Codex, Claude Code, Gemini CLI, Grok Build, Kimi Code, and Muse Code through one TypeScript API. The package builds CLI arguments, starts a subprocess, streams events, and handles cancellation. It has no runtime dependencies.

Version **0.2.0**. Requires Node.js 20+ and separately installed, configured agent CLIs. ESM only. Prepared for publication as `@bpstr/agent-adapter`.

```sh
# After publication:
npm install @bpstr/agent-adapter
```

```ts
import { runAgent } from '@bpstr/agent-adapter';

const result = await runAgent({
  client: 'codex',
  prompt: 'Read src/invocation.ts and explain its public API.',
  workdir: process.cwd(),
  timeoutMs: 120_000,
  onEvent(event) {
    if (event.type === 'text') process.stdout.write(event.text);
  },
});

if (result.status !== 'success') {
  throw new Error(result.error || result.stderr || `Agent exited with ${result.code}`);
}
```

Calling `runAgent` can consume your agent account's allowance. The package never retries a call.

| Client | Headless mode | Output parsed by this package | Model | Effort | Resume |
| --- | --- | --- | --- | --- | --- |
| `codex` | `exec` | JSONL | Yes | Yes | Explicit provider thread ID |
| `claude` | `-p` | stream-json | Yes | Yes | — |
| `gemini` | `--prompt` | stream-json | Yes | — | — |
| `grok` | `--single` | Text | Yes | Yes | — |
| `kimi` | `--prompt` | Text | Yes | — | — |
| `muse` | `exec` | Text | Yes | Yes | — |

The matrix describes adapter support. Unknown model IDs and effort values are passed to the CLI for validation. Unsupported adapter controls fail before launch.

`permissions` defaults to `'default'`, which inherits the CLI's configured policy. For unattended work in a trusted, appropriately isolated workspace, set `permissions: 'bypass'` explicitly. This disables approval gates and, for some CLIs, their sandbox. It does not guarantee that authentication, missing configuration, or tool questions can never block; use a timeout.

```ts
import { buildRunnerInvocation, runAgent } from '@bpstr/agent-adapter';

// Inspect a command without launching it.
const invocation = buildRunnerInvocation({
  client: 'grok', prompt: 'Implement the requested change', workdir: '.',
  model: 'your-model-id', permissions: 'bypass',
});

const controller = new AbortController();
const result = await runAgent({
  client: 'codex', prompt: 'Continue the same task', workdir: '.',
  persistSession: true, resumeSessionId: 'explicit-provider-thread-id',
  signal: controller.signal,
  executable: '/path/to/codex',
  env: { MY_PROJECT_SETTING: 'value' },
});
```

Codex sessions are ephemeral by default. Resumption requires `persistSession: true` and an explicit provider ID from an earlier result's `providerThreadId`; the adapter never chooses `--last`. Other adapters reject continuation requests. Their CLIs may still persist their own normal session files.

Results include `status`, `code`, termination `signal`, raw `stdout` and `stderr`, extracted assistant `text`, `truncated` flags, provider-reported session ID, and usage when recognized. Missing usage stays `null`; prepared test usage is never evidence of real provider consumption. Codex usage is summed across turns; Claude and Gemini terminal receipts replace previous aggregate receipts.

`onEvent` receives `text`, `session`, `usage`, `error`, `diagnostic`, and `raw` events. `onOutput(chunk, stream)` receives raw decoded output. Raw events and output may contain prompts, paths, tool arguments, and other private data; choose what to persist. No output is written to the console by the library.

The retained tail of each output stream defaults to 1 MiB (`maxOutputBytes`); the JSON event buffer has a separate 1 MiB limit (`maxEventBytes`). Oversized JSON events produce an error and are discarded until the next newline. Malformed lines are diagnostics. Capture limits do not stop streaming callbacks. Callback exceptions reject the run after child teardown.

Timeouts return code `124`; cancellation returns `130`; spawn failures return `127`. Other nonzero exits are preserved. Recognized provider error events produce a failed result even when the CLI exits zero. Invalid options reject before spawning. Cancellation signals the process group, then escalates after `terminationGraceMs` (default 1 second). Children that deliberately detach into a separate process group are outside this boundary. Windows uses `taskkill /T`; it has not been qualified locally. Use a native executable there, rather than a `.cmd` shim.

Codex and Claude receive prompts over stdin. Other adapters use an argv value and can hit operating-system argument limits for very large prompts. Arguments are passed without a shell, including prompts beginning with `-`. `workdir` is resolved to an absolute path. Environment overrides merge with the parent process; set a value to `undefined` to remove it.

Codex accepts a typed `permissions` object with `sandbox: 'read-only' | 'workspace-write'` and `approval: 'never' | 'on-request'`. The adapter passes both choices on fresh and resumed invocations. `runnerPermissionCapabilities(client)` reports the Codex policy and inherited native configuration as advisory pending native OS qualification. Other clients reject the typed Codex policy before spawn. Set `inheritEnvironment: false` and pass an explicit `env` to limit the child to those entries. The allowlist applies to the process environment. Files, OS identities and credential stores have their own access controls.

For TypeScript consumers, install `@types/node` in your Node project. Public types include `ClientName`, `InvocationOptions`, `RunnerOptions`, `RunOptions`, `RunResult`, `AgentEvent`, and `Usage`.

## Roadmap Runner compatibility

Replace `lib/clients.js` with:

```js
export {
  CLIENT_NAMES,
  CLIENT_CAPABILITIES,
  buildClientInvocation,
} from '@bpstr/agent-adapter/roadmap-runner';
```

This entry point preserves Roadmap Runner 0.12.4's argument arrays, return shape (`command`, `args`, `output`, `approvalFree`), Codex continuation checks, and existing unattended defaults. It deliberately retains the legacy Grok `--yolo` and Kimi approval behavior. Use `buildRunnerInvocation` for current Grok flags and explicit Kimi unattended mode. See [the migration guide](docs/roadmap-runner.md) for that second step and the responsibilities that remain in Roadmap Runner.

The root export also exposes `buildClientInvocation` for existing callers; its legacy defaults differ from `buildRunnerInvocation`.

## Development and verification

```sh
npm ci --ignore-scripts
npm test
npm run check:package
npm run check:installed                 # Help/version only; no inference
npm run check:roadmap -- ../roadmap-runner
```

Tests use prepared responses and local fixture processes. They never call providers or read credentials. Installed CLI checks inspect version/help with both permission configurations; they establish executable and argument availability, not authentication or model availability. Local logs are written under `.evidence/` and excluded from the npm package. See [v0.1.0 verification](docs/validation.md).

Build with `npm run build`. `npm pack` rebuilds the ESM JavaScript and declaration files; the tarball contains only `dist`, this README, the license, and package metadata. When ready to publish, run `npm publish --access public` from the checked-out release tag after running the checks above. GitHub release creation does not publish to npm.
