# Changelog

## 0.2.0 — 2026-11-15

- Add OpenCode CLI and DeepSeek Harness adapters with JSONL output and explicit session resumption.
- Add typed Codex sandbox and approval settings for fresh and resumed sessions.
- Describe adapter permission capabilities and support an explicit child environment allowlist.

## 0.1.0 — 2026-10-29

- Add typed subprocess adapters for Codex, Claude Code, Gemini CLI, Grok Build, Kimi Code, and Muse Code.
- Extract Roadmap Runner's invocation contract into a compatible subpath export.
- Add current CLI invocation building with explicit permission bypass, model controls, supported effort controls, and Codex resumption.
- Normalize Codex, Claude, and Gemini output; preserve plain text from the other clients.
- Add bounded capture, streaming callbacks, abort/timeout handling, and process-tree termination.
- Add deterministic subprocess tests, installed CLI help checks, packed-package consumer checks, and CI.
- Prepare the public ESM npm package with TypeScript declarations and no runtime dependencies.
