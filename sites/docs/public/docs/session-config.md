# SessionConfig Reference

`SessionConfig` is the single configuration object passed to `SessionManager`. It controls every aspect of agent behavior — from adapter selection to advanced execution policies.

> **Design principle:** No globals, no environment variable reads inside lemura. Every config value is explicit and passed via constructor. This makes behavior predictable, testable, and auditable.

---

## Configuration Submodules

Deep dives into every part of the configuration system:

| Section | Covers |
|---|---|
| [Core & Adapter →](/docs/session-config/core-adapter-settings) | Adapters, Models, Context Window Size, System Prompts |
| [Execution & Loop →](/docs/session-config/execution-loop-settings) | Iterations, Steps, Goal & Continuation Planning |
| [Context & Memory →](/docs/session-config/context-memory-settings) | Compression Strategies, Token Budgets, Response Processing |
| [Tools & Extensions →](/docs/session-config/tools-media-settings) | Tool Registry, Media Bridge, Skills, RAG, Discovery |
| [Security & Logging →](/docs/session-config/security-logging-settings) | Tool Firewall, Ask/Accept Policy, Custom Logging |

---

## Configuration Presets

### Minimal (Development / Prototyping)
Best for testing a prompt or a single tool quickly.

```typescript
const session = new SessionManager({
  adapter,
  model: 'gpt-4o',
  maxTokens: 128_000,
});
```

### Production Chatbot
Focused on speed, safety, and history preservation.

```typescript
const session = new SessionManager({
  adapter,
  model: 'gpt-4o',
  maxTokens: 128_000,
  systemPrompt: 'You are a helpful support agent for Acme Corp.',
  maxIterations: 5,       // keep it snappy
  maxSteps: 10,
  tools: [lookupOrderTool, createTicketTool],
  ragAdapter: pineconeAdapter,
  compressionStrategies: [
    new SummaryInjectionStrategy({ priority: 1 }),
    new SandwichCompressionStrategy(adapter, { preserveFirst: 3, preserveLast: 6, priority: 2 }),
  ],
  logger: myProductionLogger,
});
```

### Heavy Research Agent
Designed for complex, multi-step tasks that require high reasoning depth.

```typescript
const session = new SessionManager({
  adapter,
  model: 'gpt-4o',
  maxTokens: 200_000,
  maxIterations: 20,
  maxSteps: 50,
  enableGoalPlanning: true,
  enableContinuationPlanning: true,
  continuationStrategy: 'sequential',
  compressionStrategies: [
    new SummaryInjectionStrategy({ priority: 1 }),
    new SandwichCompressionStrategy(adapter, { priority: 2, preserveFirst: 2, preserveLast: 4, triggerThreshold: 0.80 }),
    new HistoryCompressionStrategy(adapter, { priority: 3, windowSize: 6, triggerAtPercent: 0.92 }),
  ],
  toolResponseProcessor: new ToolResponseProcessor({ budgetPercent: 0.15 }),
});
```

---

## Tips & Tricks

> **Tip:** Set `maxIterations` conservatively in production. A runaway agent is expensive. Start at 5–8 and increase if tasks legitimately need more steps.

> **Tip:** `systemPrompt` vs `skills` — use `systemPrompt` for absolute rules that never change ("Always respond in English"), and skills for capabilities that might vary or compose ("You are a code review expert").

> **Tip:** When you have both `ragAdapter` and `compressionStrategies`, compression always runs *before* RAG injection. RAG results are fresh per-turn and don't need to be in the compressed history.
