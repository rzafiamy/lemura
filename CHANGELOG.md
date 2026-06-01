# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.4] - 2026-05-30

### Fixed

- **Goal verification could not recover an incomplete response** (significant): when the goal verifier returned `achieved: false`, the runtime ran a single **tool-less** `complete()` correction whose output was never re-verified (the run was flagged done after the first check) and, in `stream()`, was never sent to the caller. A response missing a step that required a tool (read a file, write output, …) could therefore never actually be completed. The verifier now re-enters the ReAct loop with a corrective user turn so the model has **full tool access** and the corrected answer is **streamed**, bounded by the new `maxGoalCorrections` budget (default `1`). When the budget is exhausted and the goal is still unmet, a visible Goal Verification Warning is appended/streamed as before. Applies to both `run()` and `stream()`.

### Added

- **`maxGoalCorrections`** (`SessionConfig`, default `1`): maximum goal-verification corrective re-entries per run. Set to `0` to disable corrective re-entry (a warning is surfaced instead).
- **`goalProgressReconciliation`** (`SessionConfig`, default `false`): when enabled, the agent periodically (every `goalInjectionN` tool rounds) reconciles which decomposed sub-goals are already complete and marks them done, so the re-injected goal block reflects real progress instead of always showing every sub-goal as pending. Counters goal drift on long runs at the cost of one small LLM call per reconciliation. This wires up `GoalInjector.markSubGoalDone()`, which was previously never invoked.

## [1.5.3] - 2026-05-30

### Fixed

- **Tool firewall `ask` decision could execute denied tools** (critical): when a `ToolFirewallConfig.onAsk` handler returned anything other than the exact string `'deny'` — including the boolean `false`, `undefined`, or by throwing — the tool was executed anyway. A user pressing "Stop"/deny could not actually stop the tool call. The `ask` path is now **fail-safe**: only an explicit accept signal (`'accept'` or `true`) allows execution; `'deny'`, `false`, `undefined`, `void`, and thrown errors all block the tool and inject a `Blocked by tool firewall` observation.
  - `ToolFirewallConfig.onAsk` now accepts `'accept' | 'deny' | boolean | void` (and the `Promise` thereof) for ergonomics. The previous `'accept' | 'deny'` return remains valid.

## [1.5.2] - 2026-05-30

### Changed

- **Namespaced XML delimiters for all runtime-injected blocks**: All blocks appended to the system prompt or user messages by the lemura runtime now use a consistent `lemura:` XML namespace, preventing collisions with user-supplied prompt content.
  - `GoalInjector`: `[CURRENT GOAL]…[/CURRENT GOAL]` → `<lemura:goal>` with `<lemura:statement>`, `<lemura:criteria>`, `<lemura:subgoals status="pending|done">`
  - `ContinuationPlanner`: `[CONTINUATION PLAN — Step X/Y]` (no closing tag) → `<lemura:plan step="X" total="Y">` with `<lemura:step id="…" tool="…" status="…">` children
  - `SkillInjector`: `[Skill: name (Tier: tier)]` (no closing tag) → `<lemura:skill name="…" tier="…">…</lemura:skill>`
  - `SessionManager` frozen-turn wrapper: `[System Guidance / Agent State]` (no closing tag) → `<lemura:agent-state>…</lemura:agent-state>`

## [1.5.1] - 2026-05-29

### Added

- **`SessionConfig.staticSystemPrompt`**: New boolean flag that freezes the system prompt across all ReAct iterations and redirects dynamic content (continuation plan status, goal injection) into the last user/tool message instead. This keeps the KV-cache prefix 100% stable between turns, avoiding costly re-computation on every iteration. Recommended for reasoning models and long agentic runs.

- **`IToolDefinition.timeoutMs`**: Optional per-tool timeout field on tool definitions. Falls back to `ToolRegistry.defaultTimeoutMs` when omitted, allowing individual tools to override the global timeout without touching `SessionConfig`.

- **`ToolRegistry` execution timing**: `execute()` now logs the elapsed time for every tool call (debug on success, error on timeout/failure), making it easier to identify slow tools.

- **`MCPClient` call timing and structured error logging**: `callTool()` now records elapsed time and emits structured error logs (with `problem` and `hints` fields) on timeout, mirroring `ToolRegistry`'s diagnostic output.

### Fixed

- **`OpenAICompatibleAdapter` reasoning-model compatibility**: `buildPayload()` now detects o1/o3/o4/gpt-5 and `*-mini` models via `isReasoningModel()` and uses `max_completion_tokens` instead of `max_tokens`, while omitting unsupported sampling params (`temperature`, `top_p`, etc.). This prevents API errors when targeting OpenAI reasoning models.

- **Mini-planning JSON extraction**: The planner now applies a regex fallback (`/\{[\s\S]*\}/`) after stripping code fences, so model responses that wrap the JSON object in prose no longer throw a parse error.

- **Goal-correction trace events**: `goal_correction_start`, `goal_correction_done`, and `goal_correction_failed` trace events are now emitted in both the `run()` and `stream()` paths (previously missing in `stream()`).

- **Post-correction final verification**: After a silent goal-correction loop, the verifier now re-checks the goal. If it is still unmet, a `goal_verification_result` trace event is emitted and a visible warning block is appended to the last assistant turn (in both `run()` and `stream()`).

- **Tool error trace events**: `tool_timeout` and `tool_error` trace events are now emitted for every tool failure in the parallel and sequential dispatch paths.

- **`ToolRegistry` timeout resolution**: Per-tool `timeoutMs` is now read via `tool.timeoutMs` (typed field) instead of an unsafe `Record<string, unknown>` cast.

## [1.5.0] - 2026-05-27

### Added

- **`SessionManager.stream()`**: New `async *stream(userMessage)` method that runs the full ReAct loop (tool calls, goal verification, corrections) and then streams the final assistant response token-by-token as an `AsyncIterable<string>`. All tool use and verification completes before the first token is yielded, so callers always receive a clean, final response.

- **`GoalVerifierResult` interface** (`src/types/agent.ts`): Return type for `goalVerifier` callbacks and the built-in LLM-based checker. Fields: `achieved: boolean`, `missing?: string` (injected as a follow-up user message when false), `reason?: string` (surfaced in trace events).

- **`SessionConfig.goalVerifier`**: Optional user-supplied async callback `(goal: Goal, turns: Turn[]) => Promise<GoalVerifierResult> | GoalVerifierResult`. Called after the ReAct loop reaches a `stop` finish reason when `enableGoalPlanning` is `true`. Returning `{ achieved: false, missing: '...' }` injects a silent correction loop (capped at one retry). When omitted and `successCriteria` is non-empty, Lemura falls back to a built-in LLM check.

- **`SessionConfig.enableGoalVerification`**: Boolean flag to opt out of post-run goal verification. Defaults to `true` when `enableGoalPlanning` is set. Set to `false` to skip the verifier step entirely without removing `enableGoalPlanning`.

- **`SessionManager._executeLoop()`**: Internal refactor — `run()` and `stream()` now share a single `_executeLoop()` core that handles tool dispatch, goal injection, step budgets, and verification. Only the final-response step differs between the two public methods.

- **`GoalVerification.test.ts`**: Unit tests covering the `goalVerifier` callback path, the built-in LLM verifier fallback, and the `enableGoalVerification: false` opt-out.

## [1.4.4] - 2026-05-21

### Added

- **`StepVerifier` on `ContinuationStep`** (`verify?: StepVerifier`): Optional semantic verifier called after a tool executes to confirm the sub-goal is actually satisfied — independent of the LLM's own assessment. Returns `pass`, `fail`, or `retry`. A `retry` verdict resets the step to `pending` and re-queues it for the next iteration; `fail` triggers BFS propagation to dependant steps. Supports `maxRetries?: number` (default: `0`) before a `retry` verdict is forced to `fail`. Verifier exceptions are caught and treated as `fail`.

- **`StepVerifierResult` interface**: `{ status: 'pass' | 'fail' | 'retry'; reason?: string }` — the return type of `StepVerifier.check()`.

- **`ContinuationPlanner.markStepPending(stepId)`**: Resets a step to `pending` for a retry attempt and increments its internal retry counter.

- **`ContinuationPlanner.getRetryCount(stepId)`**: Returns how many times a step has been retried.

- **`SessionManager.getPlan()`**: New public method returning a snapshot of the current `ContinuationPlan` (or `null` if no plan is active). Use this after `run()` for post-mortem inspection of step statuses without relying on `onTrace`.

- **`TraceEvent.type: 'verification'`**: New trace type. Emitted as `step_retry` when a verifier returns `retry`, and supplements the existing `step_failed` / `step_skipped` events now emitted by the planner.

- **`onStepFailed` / `onStepSkipped` callbacks on `ContinuationPlanner`**: Internal callbacks wired at `setPlan()` time to emit `planning/step_failed` and `planning/step_skipped` trace events — including BFS-propagated skips, which were previously invisible to `onTrace`.

### Changed

- **`maxCompletionTokens` default raised from `2_000` to `4_000`**: The previous default was too low for complex reasoning chains, causing silent mid-thought truncations. Fully backward-compatible — any explicit `maxCompletionTokens` in existing configs is unchanged.

- **`ContinuationPlanner.markStepFailed(stepId, reason?)`** and **`markStepSkipped(stepId, reason?)`**: Both methods now accept an optional `reason` string surfaced in trace events and BFS-propagated skip messages.

### Fixed

- **BFS-propagated step skips were invisible to `onTrace`**: When a step failed and its dependants were automatically skipped, no trace events were emitted for the skipped steps. The new `onStepSkipped` callback fires for every BFS-propagated skip, making silent plan collapses visible.

- **No way to inspect plan state after `run()`**: `continuationPlanner` was private with no public accessor. The new `getPlan()` method exposes a safe snapshot for post-run debugging.

### Other

- **Config coherence warning** (`maxSteps` vs `maxIterations`): The `SessionManager` constructor now logs a `warn`-level message when `maxSteps` is explicitly set without a matching `maxIterations`, or when `maxSteps` is so large relative to `maxIterations` that it can never be reached. No behavior change — purely diagnostic, fully backward-compatible.

## [1.4.3] - 2026-05-14

### Changed

- **npm package metadata**: Added `repository`, `bugs`, `homepage`, `keywords`, `author`, `license`, `engines`, `sideEffects`, and `files` fields to `package.json` to meet npm publishing standards.

## [1.4.2] - 2026-05-14

### Fixed

- **OpenAI wire format for tool calls**: `OpenAICompatibleAdapter.toOpenAIMessages()` now converts lemura's internal camelCase `toolCalls` (assistant turns) and `name`-keyed tool results (tool turns) to the proper OpenAI wire format (`tool_calls` / `tool_call_id`). Previously, providers enforcing strict OpenAI compatibility (e.g. Cerebras) would reject these messages with a 400/422 error.

## [1.4.1] - 2026-05-07

### Added

- **MCP Custom Headers**: `MCPServerConfig` now supports a `headers` field for `http` and `sse` transports. This allows passing custom headers (e.g., `Authorization: Bearer <token>`) to remote MCP servers.

### Fixed

- **MCP HTTP Authentication**: `MCPClient` now correctly includes custom headers from the server configuration in all JSON-RPC calls and initialization notifications, fixing issues where authenticated MCP servers would return 401 Unauthorized.

## [1.4.0] - 2026-03-14

### Added

- **Fixed/Dynamic skill loading strategy** (`ISkill.strategy`): Skills now support a `strategy` field — `'fixed'` (default, always active, fully backward-compatible) or `'dynamic'` (opt-in pool, activated by name or tag). This replaces the previous always-on behavior with a market-style loading model.

- **`SkillInjector.enableSkill(name)`** / **`disableSkill(name)`**: Enable or disable a named dynamic skill at runtime.

- **`SkillInjector.enableByTags(tags)`** / **`disableByTags(tags)`**: Bulk-enable or disable dynamic skills whose `tags` array intersects with the given set.

- **`SkillInjector.getActiveSkills()`**: Returns the currently active skill set (fixed skills always included; dynamic skills only when enabled).

- **`SkillInjector.getRequiredTools()`**: Returns the union of `requiredTools` from all currently active skills. Host applications can use this to expose only the tools that the active skill set actually depends on.

- **`SkillInjector.getAll()`**: Returns all registered skills regardless of activation state.

- **`ISkill.requiredTools?: string[]`**: New optional field declaring which tool names a skill depends on. Surfaced via `getRequiredTools()`.

- **`ISkill.tags?: string[]`**: New optional field for arbitrary tag-based dynamic skill selection.

- **`ISkill.enabled?: boolean`**: Activation flag for `dynamic` skills. Defaults to `false` — dynamic skills must be explicitly enabled. Ignored on fixed skills.

- **`ISkill.content?: string`**: New optional field accepting the full skill body (without frontmatter). Used as the `standard`-level content when `standard` is absent, enabling the `{ content: markdownBody }` shorthand pattern documented in the skills guide.

- **`ISkill.tier` is now optional**: Was incorrectly required. The injection block header shows `'standard'` when `tier` is absent — no breaking change to runtime behavior.

- **`SessionConfig.activeDynamicSkills?: string[]`**: Names of dynamic skills to enable automatically at session construction.

- **`SessionConfig.activeDynamicTags?: string[]`**: Tags used to bulk-enable dynamic skills at session construction.

- **`TraceEvent.type: 'skill'`**: New trace type emitted during `session_init` — one `skill_load` event per active skill, carrying `name`, `version`, `strategy`, `inject`, `priority`, `tags`, and `requiredTools`.

- **`SessionManager.skills` accessor**: Public getter returning the session's `SkillInjector` instance for runtime skill management (`session.skills.enableSkill(...)`, `session.skills.getRequiredTools()`, etc.).

- **`SessionManager.tools` accessor**: Public getter returning the session's `ToolRegistry` instance for runtime tool management (`session.tools.register(...)`, `session.tools.unregister(...)`, `session.tools.getAll()`). Previously the registry was private — docs referenced this API but it wasn't accessible.

- **`session_init` trace now includes skill summary**: The `system / session_init` trace metadata includes `skills: { total, active, fixed, dynamic }` counts.

### Changed

- `SkillInjector.getSkillsForInjection()` — now returns only **active** skills (fixed + enabled dynamic). Previously returned all registered skills regardless of state.
- `SkillInjector._pickContent()` — fallback chain now includes `content` field between `standard` and `description`, fixing the silent empty-injection bug when skills were passed via `{ content: '...' }`.
- `SkillInjector.buildInjectionBlock()` — tier label in block header now falls back to `'standard'` instead of rendering as `undefined`.

### Fixed

- **Silent empty skill injection**: When a skill was constructed with only a `content` field (the `{ content: markdownBody }` shorthand), none of `nano/micro/standard` were set, causing `_pickContent` to return `description` (often empty) — the model never saw the skill content. Fixed by adding `content` to the resolution chain.
- **`ISkill.tier` rendering as `undefined`**: The injection block header `[Skill: name (Tier: undefined)]` is now `[Skill: name (Tier: standard)]` when `tier` is absent.

### Documentation

- `skills-system.md` — Fully rewritten to document `strategy: 'fixed' | 'dynamic'`, the `requiredTools` / `tags` fields, `session.skills` accessor, and the `activeDynamicSkills` / `activeDynamicTags` config options. Removed references to non-existent `autodiscoverTools` from Option 3.
- `tool-discovery.md` — Removed references to `session.on('tools:discovered')` (EventEmitter API, not implemented). Documented correct tool registration patterns and the `"lemura"` package.json convention.
- `tools-and-skills.md` — Fixed `session.tools.list()` → `session.tools.getAll()` (correct `ToolRegistry` method name).
- `session-config/tools-media-settings.md` — Removed non-existent `autodiscoverTools` config option; replaced with the correct manual import pattern. Fixed `session.tools.list()` → `session.tools.getAll()`.
- `getting-started/error-handling.md` — `session.tools.register()` example now works via the new `session.tools` public accessor.

> **Note:** Several other doc files (`observability.md`, `sandwich-compression.md`, `max-steps.md`, etc.) reference a `session.on(event, handler)` EventEmitter API that was planned but never implemented. These files are flagged for a follow-up documentation pass to replace with the `onTrace` callback pattern.

## [1.3.0] - 2026-03-13

### Added

- **`SummaryInjectionStrategy`** (`src/context/SummaryInjectionStrategy.ts`): New built-in context strategy that re-injects `ctx.compressionSummary` as a system turn before every provider call — ensuring the model always sees what was compressed. Idempotent (updates in-place on repeated runs). Configurable `priority` and `label`. Pair with `SandwichCompressionStrategy` or `HistoryCompressionStrategy`.

- **`SessionManager.setPlan(steps, strategy?)`**: New public method to register a `ContinuationPlan` before a `run()` call. The plan is stored in `context.metadata['continuationPlan']`, injected as a status block before every ReAct iteration, and survives context compression. Supports `'sequential'`, `'parallel'`, and `'conditional'` strategies.

- **`SessionManager.setGoal(goal)`**: New public method to manually set the agent's goal (statement, sub-goal decomposition, success criteria) without the automatic mini-planning LLM call. Goal is stored in `context.metadata['goal']`.

- **Goal mini-planning step**: When `enableGoalPlanning: true` and no manual goal is set, `run()` and `stream()` automatically make one LLM call before the first iteration to decompose the user's message into sub-goals and success criteria (stored in `GoalInjector` and `context.metadata['goal']`).

- **`GoalInjector.getFormattedBlock()`**: New method returning just the `[CURRENT GOAL]` block string — used internally for `pre_turn` injection (fixes empty-message bug when `goalInjectionPosition: 'pre_turn'`).

- **`GoalInjector.shouldInjectThisTurn(turnIndex, compressionOccurred, injectionN)`**: Properly implements all three `goalInjectionFrequency` values (`'always'`, `'every_N_turns'`, `'on_compression'`).

- **`GoalInjector.updateDecomposition(subGoals, successCriteria?)`**: Update sub-goals and criteria after mini-planning.

- **`GoalInjector.markSubGoalDone(subGoal)`**: Mark a sub-goal as completed so it appears in the `[/CURRENT GOAL]` completed section on subsequent injections.

- **`SessionConfig.maxCompletionTokens`**: New config field controlling the `maxTokens` argument passed to each `complete()` call (default: `2_000`). Previously this was hardcoded to `1000`.

- **`SessionConfig.goalInjectionN`**: New config field for `goalInjectionFrequency: 'every_N_turns'` — controls how often the goal is re-injected (default: `3`).

- **`ContinuationStep.condition`**: New optional field `{ step: string; outputContains: string }` that gates a step's execution on a substring check of a prior step's output. When not met, the step (and all dependants) are automatically marked `skipped`.

- **`ContinuationPlanner` state management methods**: `markStepRunning()`, `markStepDone(stepId, output?)`, `markStepFailed()`, `markStepSkipped()`, `getReadySteps()`, `isComplete()`, `getOutput(key)`, `resolveInputs(step, baseArgs)`. Dependency failure propagation is now BFS-based and fully correct.

- **`outputKey` / `inputMapping` wiring**: When a `ContinuationStep` defines `outputKey`, its tool result is stored in `context.metadata['toolOutputs'][outputKey]`. When the next step defines `inputMapping`, lemura resolves the prior step's output and passes it to the tool's arguments automatically.

- **`ToolResponseProcessor` config** (`ToolResponseProcessorConfig`): Constructor now accepts `smallMaxTokens` (default: 200), `mediumMaxTokens` (default: 800), `largeMaxTokens` (default: 2000), and `budgetPercent`. The `compress()` method now uses smarter extractive (head+tail) and line-level strategies instead of a fixed 1000-char truncation. Soft-error detection now catches more patterns (`"error"`, `connection refused`, `timed out`, etc.).

- **`SkillInjector` token budget**: `buildInjectionBlock(position, tokenBudget?)` now accepts an optional `tokenBudget`. Skills are added in priority order until the budget would be exceeded; compact tier variants (`nano` → `micro` → `standard`) are preferred when budgeting.

- **`SandwichCompressionStrategy` config improvements**: `triggerThreshold` now has a default (0.80). New optional `summaryMaxTokens` field passed to the summarization LLM call. New optional `priority` field (default: 20) — priority is now configurable at construction time instead of hardcoded.

- **`HistoryCompressionStrategy` priority config**: `priority` is now configurable at construction time (default: 30).

- **`lemura/mcp` sub-export**: `MCPClient` and `MCPClientRegistry` are now available via `import ... from 'lemura/mcp'` in addition to the main entry point.

### Changed

- `SessionManager` — `buildSystemPrompt()` now accepts `iteration` parameter and correctly gates goal injection via `shouldInjectThisTurn()`. The continuation plan status block is now injected into the system prompt when `enableContinuationPlanning` is true.
- `SessionManager` — `buildMessages()` now correctly injects the goal for `pre_turn` position using `goalInjector.getFormattedBlock()` instead of `injectInto('')` (fixes empty system message bug).
- `SessionManager.reset()` — now also resets `totalTokens` and `continuationPlanner`.
- `GoalInjector.injectInto()` — now always appends the goal block to the given prompt string regardless of position (position logic moved to `shouldInjectThisTurn()` + caller). Sub-goals in/completed sections included.
- `SessionConfig.toolResponseProcessor` — type updated to accept `IToolResponseProcessor` (interface) for custom implementations; built-in `ToolResponseProcessor` class is used by default.

### Fixed

- **`goalInjectionPosition: 'pre_turn'` bug**: Previously `goalInjector.injectInto('')` returned an empty string for `pre_turn` position, causing an empty system message to be pushed into the message list. Fixed by using `getFormattedBlock()` directly.
- **Hardcoded `maxTokens: 1000`** in `complete()` calls inside `run()` and `stream()`: Now uses `config.maxCompletionTokens ?? 2_000`.
- **`goalInjectionFrequency: 'every_N_turns'` / `'on_compression'`** were defined as enum values but never checked. Now fully implemented via `GoalInjector.shouldInjectThisTurn()`.
- **`SandwichCompressionStrategy.triggerThreshold`** was required but now correctly defaults to `0.80` if omitted.
- **`ToolResponseProcessor.compress()`** no longer truncates error responses (preserves them verbatim so the model can react to errors).

### Documentation

- All references to non-existent `MaxTokensCompressionStrategy` replaced with `HistoryCompressionStrategy`.
- All `SandwichCompressionStrategy` constructor calls in docs now include the required `adapter` first argument.
- `continuation-planning.md` fully rewritten to match `setPlan()` API, `condition` field, `outputKey`/`inputMapping` behavior.
- `goal-planning.md` rewritten to accurately describe `setGoal()`, the mini-planning step, `goalInjectionFrequency` options, `goalInjectionN`, and sub-goal tracking.
- `advanced-execution.md` quick-reference updated with `HistoryCompressionStrategy` and correct strategy signatures.
- `session-config.md` production preset examples fixed (correct adapter args, removed non-existent classes).

## [1.2.0] - 2026-03-12

### Added
- **MCP Support** (`MCPClient.ts`, `MCPRegistry.ts`): Model Context Protocol support integrated. You can now register tools from remote MCP servers.
- **Improved Traces & Observability**: Session traces now include detailed metadata for token usage, execution budget consumption, and planning states for every turn.
- **Tool Firewall — fully wired** (`ToolFirewall.ts`): The ask/accept/deny policy layer is now fully integrated into the `SessionManager` ReAct loop. Parallel batches respect firewall decisions per-call. No external dependencies.
- **Standalone JSON Schema Validator** (`SchemaValidator.ts`): Tool parameter validation now enforces the tool's JSON Schema at runtime before execution. Supports `type`, `required`, `properties`, `additionalProperties`, `enum`, `const`, `minLength`/`maxLength`/`pattern` (string), `minimum`/`maximum`/`exclusiveMinimum`/`exclusiveMaximum` (number), `minItems`/`maxItems`/`items` (array), `minProperties`/`maxProperties` (object), and `allOf`/`anyOf`/`oneOf`/`not` composition — zero external dependencies.
- **Tool execution timeout enforcement**: Every `ToolRegistry.execute()` call now races against a configurable timeout (`toolRegistryTimeoutMs`, default 30 s) via `Promise.race`. Throws `LemuraToolTimeoutError` on expiry.
- **Tool execution budget** (`ToolExecutionBudget` type + wired in `SessionManager`): Per-session and per-tool call quotas (`maxCallsPerSession`, `maxCallsPerTool`) and a concurrency cap (`maxConcurrentCalls`) are now enforced in the ReAct loop.
- **Parallel tool calls** (`parallelToolCalls: boolean`): When enabled, independent tool calls within a single assistant turn are executed in parallel via `Promise.all`, batched by `maxConcurrentCalls`. Falls back to sequential execution when disabled (default).
- **maxSteps guard wired**: `StepCounter` is now active in the ReAct loop. When `toolCallCount >= maxSteps`, tool definitions are removed from the provider payload and a forced-conclusion prompt + `FinalResponseFormatter` structure is injected.
- **Tool Response Compression wired**: `ToolResponseProcessor` is now applied to every tool result in the loop. Large/oversized responses are compressed before being appended to the context.
- **Goal Injection wired** (`enableGoalPlanning: true`): When enabled, a `GoalInjector` is initialised on the first `run()` call and injects the `[CURRENT GOAL]` block into the system prompt (or as a `pre_turn` message) on every iteration.
- **`SessionManager.stream()`**: New `AsyncIterable<string>` method streams the final LLM response token-by-token. Tool calls within the loop are completed synchronously before streaming the conclusion.
- **`SessionManager.reset()`**: New method clears conversation history, resets iteration counters, and clears tool execution budget tallies without losing the adapter or config.
- **`ToolRegistry.unregister()`**: New method to remove a registered tool by name at runtime.
- **`ToolRegistry.executeParallel()`**: New method for executing a batch of named tool calls in parallel with per-call error isolation.

### Changed
- `ToolRegistry.execute()` — now validates params, enforces timeout, and wraps errors in `LemuraError` subclasses instead of raw `Error`.
- `ToolRegistry` constructor — accepts an optional `ToolRegistryOptions` second argument (`defaultTimeoutMs`).
- `SessionConfig` — new fields: `toolExecutionBudget`, `parallelToolCalls`, `toolRegistryTimeoutMs`.
- `ToolFirewallRule` and `ToolFirewallConfig` — all fields now have TSDoc inline documentation.

### Fixed
- Tool errors in the ReAct loop now correctly distinguish timeout (`LemuraToolTimeoutError`) from execution failures, with accurate structured log output and hints.
- `any`-typed variables in `ToolRegistry.execute()` replaced with typed `LemuraError` subclasses for full strict-mode compliance.

## [1.1.0] - 2026-03-08

### Added
- `MediaBridge` — unified API for ASR, TTS, Vision, and Image Generation over `IProviderAdapter`.
- Built-in media tools (`media_transcribe`, `media_synthesize`, `media_describe_image`, `media_generate_image`) enabled via `SessionConfig.media.enableTools`.
- `ToolFirewall` — ask/accept/deny rule-based gating for tool calls (`SessionConfig.toolFirewall`).
- Advanced execution classes: `StepCounter`, `GoalInjector`, `ContinuationPlanner`, `FinalResponseFormatter`, `ToolResponseProcessor` (in `src/agent/execution/`).
- `ToolExecutionBudget` type for per-session and per-tool call quotas.


## [1.0.0] - 2026-03-07

### Added
- Structured logging system with colors and severity levels (FATAL, ERROR, WARN, INFO, DEBUG).
- Integrated logging into `SessionManager` and `OpenAICompatibleAdapter`.
- Added `problem` and `hints` to `LemuraError` for better end-user feedback.
- Dedicated `ILogger` interface and `DefaultLogger` implementation.
- Short Term Memory (STM) system for persistent memory across session boundaries
- Scratchpad tools for managing agent's internal reasoning state
- `ShortTermMemoryRegistry` for memory item lifecycle management
- `summarize_sandwich` tool for context compression using sandwich strategy

### Changed
- `SessionManager` — Core ReAct runtime integration entry point, now integrated with logging.
- `OpenAICompatibleAdapter` — Reference adapter for OpenAI, now integrated with logging.

### Added (Core)
- `OpenAICompatibleAdapter` — Reference adapter for OpenAI and standard API-compatible providers.
- `ContextManager` — Core context logic coordinating multiple string reduction behaviors.
- `SandwichCompressionStrategy` — Strategy for preserving recency and foundation context.
- `HistoryCompressionStrategy` — Strategy for compressing history via summarization.
- `SessionManager` — Core ReAct runtime integration entry point.
- `ToolRegistry` — Standardized tooling implementation.
- `SkillInjector` — Advanced dynamic system prompting mechanism.
- `ToolResponseProcessor` — Evaluates and handles heavy responses.
- `ContinuationPlanner` — Multi-step sequential tool handling abstraction.
- `InMemoryRAGAdapter` — Minimal in-memory document ingestion/query layer.
