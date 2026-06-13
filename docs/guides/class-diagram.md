# Class Diagram

## What this is

The structural view of the lemura runtime: the classes and interfaces that make up a
session, and how they relate. `SessionManager` is the composition root — it owns one
each of the core collaborators and orchestrates them through the ReAct loop.

Signatures below are simplified (key members only) but match the real source. The
authoritative definitions live in [`src/types/`](../../src/types/) and the
implementations under [`src/`](../../src/).

---

## Core composition

```mermaid
classDiagram
    direction LR

    class SessionManager {
        +run(message) Promise~string~
        +stream(message) AsyncIterable~string~
        +loadHistory(history) void
        +setGoal(goal) void
        +setPlan(steps, strategy) void
        +getPlan() ContinuationPlan
        +getContext() ContextWindow
        +getHistory() Turn[]
        +reset() void
        +close() Promise~void~
        +tools ToolRegistry
        +skills SkillInjector
        +getMedia() MediaBridge
        -_executeLoop(message, opts) Promise~string~
        -_runRoutingStep(msg) RouterDecision
        -_runMiniPlanningStep(msg) void
        -_verifyGoal(turns) GoalVerifierResult
        -executeSingleToolCall(tc) string
        -buildSystemPrompt(msg, it) string
        -buildMessages(prompt, it) NormalizedMessage[]
    }

    class SessionConfig {
        <<interface>>
        +adapter IProviderAdapter
        +model string
        +maxTokens number
        +maxIterations? number
        +maxSteps? number
        +tools? IToolDefinition[]
        +skills? ISkill[]
        +compressionStrategies? IContextStrategy[]
        +ragAdapter? IRAGAdapter
        +router? IRouterAdapter
        +enableRouting? boolean
        +enableGoalPlanning? boolean
        +enableContinuationPlanning? boolean
        +toolFirewall? ToolFirewallConfig
        +mcpServers? MCPServerConfig[]
    }

    SessionManager ..> SessionConfig : configured by
    SessionManager *-- ContextManager
    SessionManager *-- ToolRegistry
    SessionManager *-- SkillInjector
    SessionManager *-- StepCounter
    SessionManager *-- ToolResponseProcessor
    SessionManager *-- MediaBridge
    SessionManager o-- GoalInjector
    SessionManager o-- ContinuationPlanner
    SessionManager o-- MCPClientRegistry
    SessionManager --> IProviderAdapter : uses
    SessionManager --> IRouterAdapter : uses
    SessionManager ..> ContextWindow : owns state
```

> `*--` = composition (created and owned for the session's lifetime).
> `o--` = aggregation (optional, created on demand / from config).
> `-->` = dependency via interface.

---

## Provider, context & tooling layer

```mermaid
classDiagram
    direction TB

    class IProviderAdapter {
        <<interface>>
        +name string
        +version string
        +complete(req) Promise~CompletionResponse~
        +stream(req) AsyncIterable~CompletionChunk~
        +transcribe(req) Promise~TranscriptionResponse~
        +synthesize(req) AsyncIterable~AudioChunk~
        +describeImage(req) Promise~VisionResponse~
        +generateImage(req) Promise~ImageGenResponse~
        +estimateTokens(text) number
        +healthCheck() Promise~boolean~
    }
    class OpenAICompatibleAdapter
    IProviderAdapter <|.. OpenAICompatibleAdapter

    class CompletionResponse {
        +content string
        +toolCalls? ToolCall[]
        +finishReason "stop|tool_call|max_tokens|error"
        +usage TokenUsage
    }
    IProviderAdapter ..> CompletionResponse

    class ContextManager {
        -strategies IContextStrategy[]
        +registerStrategy(s) void
        +prepare(ctx, margin) Promise~ContextWindow~
    }
    class IContextStrategy {
        <<interface>>
        +name string
        +priority number
        +shouldApply(ctx) boolean
        +apply(ctx) Promise~ContextWindow~
    }
    ContextManager o-- IContextStrategy : stack (by priority)
    IContextStrategy <|.. SandwichCompressionStrategy
    IContextStrategy <|.. HistoryCompressionStrategy
    IContextStrategy <|.. SummaryInjectionStrategy

    class ContextWindow {
        +systemPrompt string
        +scratchpad string
        +turns Turn[]
        +tokenCount number
        +maxTokens number
        +compressionSummary? string
        +metadata Record
    }
    ContextManager ..> ContextWindow : transforms (immutable)

    class ToolRegistry {
        -tools Map
        +register(tool) void
        +unregister(name) boolean
        +get(name) IToolDefinition
        +getAll() IToolDefinition[]
        +execute(name, params, ctx) Promise~unknown~
    }
    class IToolDefinition {
        <<interface>>
        +name string
        +description string
        +parameters JSONSchema
        +category? string
        +execute(params, ctx) Promise~unknown~
    }
    ToolRegistry o-- IToolDefinition

    class SkillInjector {
        -skills ISkill[]
        +register(skill) void
        +enableSkill(name) void
        +enableByTags(tags) void
        +getActiveSkills() ISkill[]
        +buildInjectionBlock(pos, budget) string
    }
    class ISkill {
        <<interface>>
        +name string
        +inject "system_prompt|pre_turn|post_history"
        +priority number
        +strategy? "fixed|dynamic"
        +tags? string[]
    }
    SkillInjector o-- ISkill
```

---

## Advanced execution helpers

```mermaid
classDiagram
    direction TB

    class StepCounter {
        +increment(count) void
        +count number
        +isMaxReached() boolean
        +getForcedConclusionPrompt() string
    }

    class FinalResponseFormatter {
        +isValid(response)$ boolean
        +getRequiredStructure()$ string
    }

    class ToolResponseProcessor {
        +evaluate(resp, tool, ctx) ToolResponseEvaluation
        +compress(resp, eval) string
    }
    class IToolResponseProcessor {
        <<interface>>
        +evaluate(resp, tool, ctx) ToolResponseEvaluation
        +compress(resp, eval) string
    }
    IToolResponseProcessor <|.. ToolResponseProcessor

    class GoalInjector {
        +getGoal() Goal
        +getFormattedBlock() string
        +injectInto(prompt) string
        +shouldInjectThisTurn(it, comp, n) boolean
        +updateDecomposition(sub, crit) void
        +markSubGoalDone(sg) void
        +incrementTurn() void
    }
    class Goal {
        <<interface>>
        +id string
        +statement string
        +decomposition string[]
        +successCriteria string[]
        +injectionFrequency "always|every_N_turns|on_compression"
        +injectionPosition "system_prompt|pre_turn"
    }
    GoalInjector *-- Goal

    class ContinuationPlanner {
        +getPlan() ContinuationPlan
        +getPlanStatusString() string
        +getReadySteps() ContinuationStep[]
        +markStepRunning(id) void
        +markStepDone(id, out) void
        +markStepFailed(id) void
        +resolveInputs(step, args) Record
        +isComplete() boolean
    }
    class ContinuationPlan {
        <<interface>>
        +steps ContinuationStep[]
        +currentStepIndex number
        +strategy "sequential|parallel|conditional"
    }
    ContinuationPlanner *-- ContinuationPlan

    class IRouterAdapter {
        <<interface>>
        +route(msg, categories) RouterDecision
    }
    class LLMRouter
    IRouterAdapter <|.. LLMRouter

    class MCPClientRegistry {
        +register(name, config) Promise~void~
        +discoverTools() Promise~IToolDefinition[]~
        +disconnectAll() Promise~void~
    }
    class MediaBridge {
        +transcribe() ...
        +synthesize() ...
        +describeImage() ...
        +generateImage() ...
    }
    LLMRouter ..> IProviderAdapter : uses
    MediaBridge ..> IProviderAdapter : uses
    MCPClientRegistry ..> IToolDefinition : bridges
```

---

## Notes on key relationships

- **`SessionManager` is the only orchestrator.** Everything else is a focused
  collaborator it composes — there is no separate `ReActAgent` class.
- **`ContextManager` is immutable in/out.** `prepare()` returns a *new* `ContextWindow`;
  strategies never mutate their input (see [Context-management rules](../../.agent/rules/Context-management.md)).
- **Tools, skills, strategies, adapters, and the router are all interface-typed**, so
  consumers can supply custom implementations — the core stays provider-agnostic
  ([Project rules](../../.agent/rules/Project.md)).
- **MCP tools are bridged into the same `ToolRegistry`** as native tools, so the loop
  treats them uniformly.

---

## See also

- [Use case diagram](use-case-diagram.md) — who uses these classes and why.
- [Sequence diagram](sequence-diagram.md) — how these objects collaborate over time.
- [Request flow](request-flow.md) — the staged narrative of a request.
