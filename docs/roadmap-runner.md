# Roadmap Runner extraction and migration

Inspected Roadmap Runner 0.12.4 at `3e6478644d727404bd4317f1723d6e11e3b0f3aa` and Campfire at `8d1aaae5dc414bd47162827612b8ffa49e38bd57`.

## Existing techniques

Roadmap Runner's `lib/clients.js` builds invocations for all six clients. `lib/runner.js` spawns a detached process group with ignored stdin, decodes Codex/Claude JSONL, and owns interruption, checkpoints, usage limits, and transient failure classification. `lib/telemetry.js` tracks provider identities, usage, and activity. `lib/continuation.js` decides when a task can reuse a Codex thread. Prompt content is passed in argv.

Campfire's `agents/*.sh` wrappers use the same six executables with Bash `exec`; they construct prompts from handoff files. Codex uses headless `exec`, Claude uses print mode and bypass permissions, Gemini uses headless YOLO mode, Grok uses the historical `--yolo` flag, Kimi uses `-p`, and Muse uses `exec --yolo`. Optional JSON modes exist for Claude, Gemini, and Muse. Gemini's `lib/gemini-output.cjs` extracts assistant text from stream-json. Campfire also owns provider-specific MCP configuration and Docker isolation.

There are no additional distinct runner names in the inspected Campfire wrappers beyond the six already listed by Roadmap Runner. All six are implemented here; Campfire contributes output and headless execution evidence rather than speculative extra clients.

## Package boundary

The shared package owns command arguments, prompt transport, subprocess lifetime, bounded output, basic provider events, and Codex explicit-ID invocation support. It does not own roadmap prompts, task selection, checkpoint requests/acknowledgements, continuation eligibility, recovery/retry policy, capacity backoff, MCP registration, container isolation, or application telemetry. Consumers retain those policies.

Two entry points keep the migration bounded:

1. Add `@bpstr/agent-adapter` as a dependency after npm publication, or install a local `npm pack` tarball before publication. Replace `lib/clients.js` with the re-export shown in the README. No changes to `lib/runner.js` are required. All established flags and continuation behavior remain intact, including legacy limitations.
2. Adopt `buildRunnerInvocation` when updating the runner integration. Pass `permissions: 'bypass'` to retain unattended behavior. Set spawn `cwd` from `invocation.cwd` and `stdio[0]` to `pipe` when `invocation.stdin` is present, then call `child.stdin.end(invocation.stdin)`. Handle early `EPIPE` when a provider rejects before reading the prompt. Add Gemini JSON handling or use `createOutputParser`. The new API fixes current Grok flags, supports model options for all six clients, effort where known, and explicit Kimi `--auto` mode.

Do not replace Roadmap Runner's complete `runClient` with `runAgent` without adapting checkpoint and recovery hooks. The shared process helper intentionally does not reproduce those application policies. Existing `usageTracker` and `providerIdentityTracker` can continue observing the raw events passed by the parser.

The sibling source checkouts were inspected without modification. `npm run check:roadmap -- /path/to/roadmap-runner` creates a disposable copy of its `lib` directory and two affected test files, substitutes only the compatibility export, runs its invocation/continuation checks, and removes the copy.

## Research

- [Roadmap Runner clients at the inspected revision](https://github.com/bpstr/roadmap-runner/blob/3e6478644d727404bd4317f1723d6e11e3b0f3aa/lib/clients.js)
- [Campfire agent wrappers at the inspected revision](https://github.com/bpstr/campfire/tree/8d1aaae5dc414bd47162827612b8ffa49e38bd57/agents)
- [Official Codex CLI reference](https://developers.openai.com/codex/cli/reference/#codex-exec): headless execution, JSONL, stdin prompts, explicit resume.
- [Node.js child processes](https://nodejs.org/api/child_process.html): spawning without a shell, detached POSIX process groups, piped input/output, and process close semantics.
- [Gemini headless reference](https://geminicli.com/docs/cli/headless/): stream event types, terminal results, and nonfatal warning events. Token field names were also checked against the installed 0.46.0 stream formatter.
- [Claude headless reference](https://code.claude.com/docs/en/headless): print mode, structured output, and failure reporting.
- [npm package metadata](https://docs.npmjs.com/cli/v11/configuring-npm/package-json): published file allowlist and package entry points.

Installed CLI help was checked on 2026-10-29 and is the version-specific reference for non-Codex flags. CLI interfaces can change; supported behavior is bounded by the local evidence in `docs/validation.md`.
