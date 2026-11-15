# Version 0.1.0 validation

Date: 2026-10-29. Local host: macOS, Node.js 24.19.0, npm 11.17.0.

## Scope and completion condition

This is an entirely new package: all invocation, parsing, process execution, and publishing code requires initial qualification. The initial 34-test run covers those new behaviors. Completion requires passing affected tests, an installed tarball consumed by JavaScript and TypeScript, compatibility with the affected Roadmap Runner tests, and installed CLI help checks. Live inference is excluded by the user's paid-inference testing policy.

After the initial run, Gemini warning classification changed and the Codex fixture gained a second usage receipt. Only output parsing and subprocess tests were rerun (20 tests); the 15 unaffected invocation tests retain their earlier passing evidence. This covers all 35 current tests without a redundant local full-suite rerun. No tests failed or were skipped in either run.

CI runs the package checks on Node 20, 22, and 24 on Linux and macOS. The runtime/OS changes affect process signals, stream decoding, ESM loading, and declarations across this new package, so each environment needs its own initial full-package check. Those hosted results are separate from the local evidence below.

## Results

| Check | Result | Local evidence |
| --- | --- | --- |
| Dependency install | 3 development packages; audit reports 0 vulnerabilities; no runtime dependencies | `/tmp/agent-adapter-evidence/install.log` |
| TypeScript build | Pass | `/tmp/agent-adapter-evidence/build-final.log` |
| Initial package tests | 34 pass, 0 fail, 0 skip | `/tmp/agent-adapter-evidence/tests.log` |
| Affected parser/process tests after final changes | 20 pass, 0 fail, 0 skip; retain 15 unaffected invocation results | `/tmp/agent-adapter-evidence/affected-tests.log` |
| Roadmap Runner 0.12.4 invocation/continuation checks with replacement export | 19 pass, 0 fail, 0 skip | `.evidence/roadmap.log` |
| Packed ESM import, compatibility subpath, TypeScript consumer | Pass; 21 allowlisted files | `.evidence/package.json` |
| Installed CLI checks | All six executables found; 12 help checks pass | `.evidence/installed/results.json` |

The package check installs the actual tarball into a disposable consumer project using npm's offline mode. It imports both exports and compiles a TypeScript consumer. The temporary projects are removed in `finally` blocks. No source changes were made in Roadmap Runner or Campfire.

## Installed executables

| CLI | Installed version | Checked mode |
| --- | --- | --- |
| Codex | 0.160.0 | `exec` help, default and bypass arguments |
| Claude Code | 2.1.306 | Print-mode help, default and bypass arguments |
| Gemini CLI | 0.46.0 | Headless help, default and bypass arguments |
| Grok Build | 1.0.62 (`1474f9cbdd91`, stable) | Single-prompt help, default and bypass arguments |
| Kimi Code | 2.4.0 | Prompt help, default and `--auto` arguments |
| Muse Code | 1.4.14 (`1.4.14-R7309.1`) | `exec` help, default and bypass arguments |

Help/version checks consume no model request. Some CLIs short-circuit flag parsing on `--help`, so flags were also compared with their published local help text. This evidence does not prove authentication, available credits, model support, provider output fidelity, or successful live task completion. No token outage or provider success was observed because no inference was attempted.

Prepared fixtures cover all six prompt transports, model/effort construction, explicit-ID continuation, UTF-8/JSONL framing, text extraction, usage accumulation, provider failure with exit zero, nonzero exit propagation, spawn failures, capture limits, already-aborted signals, running cancellation, observer exceptions, and timeout escalation against a stubborn descendant. Synthetic usage values are fixtures and are not real consumption receipts.

## Remaining limits

- Windows process-tree handling is implemented but unqualified locally; `.cmd` launchers require consumer-side handling.
- Grok, Kimi, and Muse output is passed through as text. Their richer JSON modes are outside v0.1.0 normalization.
- No live-content dogfood was authorized with an exact scope and hard request/spend cap. Automated provider tests remain forbidden; meaningful manual dogfood would be a separate authorization and workflow.
- npm publication is a later action. This release prepares metadata, declarations, tarball contents, and a manual publish command; it does not publish the npm package.

## OpenCode and DeepSeek adapters in 0.2.0

On 2026-11-15, macOS with Node.js 24.19.0 verified discovery, invocation arguments, stdin and workdir handling, JSONL normalization, explicit resumption options, and the six-client compatibility export. The shared client list affects the invocation and process suites, so `npm test` ran once and passed 52 tests. A focused `node --test --test-name-pattern='primary client list' test/invocation.test.mjs` run passed the added export assertion. The other 52 results were reused. The full fixture run took about two seconds. Validation also included authoring the fixture cases, inspecting the versioned contracts, and recording the results.

- `node scripts/check-package.mjs` passed the packed ESM and TypeScript checks for both entry points. The tarball contained 21 files.
- `scripts/check-roadmap.mjs` passed all 19 compatibility tests against a disposable copy of Roadmap Runner 0.12.4 at `22979d9`. Evidence is in `.evidence/adapter-additions-roadmap.log`.
- `node scripts/check-installed.mjs` passed 14 help checks across the seven installed clients, including OpenCode v2.3.0 with default and explicit bypass flags. `dsh` was absent. Flags and payloads were verified against the tagged [OpenCode renderer](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/cli/src/run/noninteractive.ts) and [DeepSeek headless documentation](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/packages/bundle/headless/README.md). Evidence is in `.evidence/adapter-additions-installed/`.

These checks issued zero inference requests. Authentication, live resumption, native permissions and provider response fidelity require separate verification. The hosted OS and Node matrix remains a release gate.
