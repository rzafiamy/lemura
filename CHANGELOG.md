# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
