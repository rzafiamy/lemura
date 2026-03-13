# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
