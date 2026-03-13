# Context Management

Every LLM has a finite context window — a fixed maximum number of tokens it can process at once. For a short single-turn query this limit is irrelevant, but for any real agent that accumulates conversation history, tool results, and RAG data across many turns, it becomes the central engineering constraint. Without a strategy to manage this budget, agents either crash with overflow errors or degrade in quality as old context is discarded naively.

Lemura's context management system is built around a **composable strategy stack**: a prioritized list of compression algorithms that evaluate and transform the context window before each provider call. Each strategy checks whether it should run (based on current utilization and configured thresholds), transforms the context immutably if so, and returns a new, smaller context. The runtime re-evaluates the stack after each transformation until the context fits within the target threshold. This design means compression is always transparent, composable, and safe to combine.

The key insight is that conversation history is not uniformly valuable. The **beginning** of a session (initial instructions, the first user message) anchors the session's purpose. The **recent turns** (last 4–8 exchanges) provide the immediate working context. The **middle** is often iterative back-and-forth and tool call results that can be summarized without significant information loss. Lemura's compression strategies exploit this structure — preserving head and tail while compressing the middle — rather than blindly truncating from either end.

> 🌿 **Makix Context** 🧠: Makix runs on Qwen 3.5 4B with a **16K token context window**. A typical session uses ~3K tokens for system prompt + skill + tool definitions. That leaves ~13K for conversation — which fills up after a few days of daily use. This section shows how to keep Makix running indefinitely.

---

## The Context Window Structure

The `ContextWindow` is lemura's single source of truth for all session state:

```typescript
interface ContextWindow {
  systemPrompt: string;        // Never compressed — always visible to the model
  scratchpad: string;          // Internal reasoning trace — never sent to provider
  turns: Turn[];               // Conversation history — the part that grows
  tokenCount: number;          // Current estimated total size
  maxTokens: number;           // Hard limit set in SessionConfig
  compressionSummary?: string; // Accumulated summary from prior compressions
  metadata: Record<string, unknown>; // Goals, plans, custom data — survives compression
}
```

**Critical invariant:** The `ContextWindow` is **immutable**. Every compression strategy must return a *new* object. This makes compression safe to retry, compose, and test.

**What grows over time:**

```
Turn 1  (user)      → 150 tokens
Turn 2  (assistant) → 300 tokens
Turn 3  (tool call) →  50 tokens
Turn 4  (tool result) → 2,000 tokens  ← often the biggest contributor
Turn 5  (assistant) → 200 tokens
...
Turn N  → context fills up → compression fires
```

---

## Strategy Stack

Compression strategies run in priority order before every provider call:

```
context.tokenCount / maxTokens = 0.85 (above 0.80 threshold)

Strategy evaluation (priority order):
  1. SummaryInjectionStrategy   shouldApply? → always true
     → Inject accumulated compression summary into context
  2. SandwichCompressionStrategy shouldApply? → 0.85 > 0.80 → true
     → Summarize middle turns: 85,000 → 54,000 tokens (-37%)
  3. HistoryCompressionStrategy  shouldApply? → 0.42 < 0.92 → false
     → Skip

Result: context now at 42% utilization → provider call proceeds ✅
```

---

## In This Section

| Page | What it covers |
|---|---|
| [Sandwich Compression →](/docs/context-management/sandwich-compression) | Preserve head + tail, summarize the middle — the go-to strategy |
| [Token Counting →](/docs/context-management/token-counting) | How lemura estimates tokens and how to plan token budgets |
| [Custom Strategies →](/docs/context-management/custom-strategies) | Write your own `IContextStrategy` (e.g., prune stale tool results, deduplicate RAG) |
| [Scratchpad →](/docs/context-management/scratchpad) | How the ReAct agent's working memory is managed separately from history |
| [Observability →](/docs/context-management/observability) | `compression:start`, `strategy:applied`, `compression:end` events |

---

## Quick Setup — Production Compression Stack

This is the recommended default for any production agent:

```typescript
import {
  SessionManager,
  SummaryInjectionStrategy,
  SandwichCompressionStrategy,
  HistoryCompressionStrategy,
} from 'lemura';

const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  compressionStrategies: [
    // 1. Always re-inject accumulated summaries first
    new SummaryInjectionStrategy({ priority: 1 }),

    // 2. Primary compression: summarize the middle at 80% usage
    new SandwichCompressionStrategy(adapter, {
      priority: 2,
      preserveFirst: 2,         // keep first 2 turns (session anchor)
      preserveLast: 6,          // keep last 6 turns (recent context)
      triggerThreshold: 0.80,   // fire at 80% of maxTokens
      summaryMaxTokens: 600,    // summary budget
    }),

    // 3. Emergency fallback: aggressive summary at 92% usage
    new HistoryCompressionStrategy(adapter, {
      priority: 3,
      windowSize: 6,            // summarize oldest 6 turns
      triggerAtPercent: 0.92,
    }),
  ],
});
```

---

## Makix Daily-Use Setup (16K Context)

```typescript
const session = new SessionManager({
  adapter, model: 'qwen3.5-4b', maxTokens: 16_000,
  compressionStrategies: [
    new SummaryInjectionStrategy({ priority: 1 }),
    new SandwichCompressionStrategy(adapter, {
      priority: 2,
      preserveFirst: 3,
      preserveLast: 4,
      triggerThreshold: 0.75,  // fire earlier on small context window
      summaryMaxTokens: 300,   // smaller summaries for small model
    }),
  ],
});
```

---

## How `compressionSummary` Accumulates

Each time `SandwichCompressionStrategy` runs, it summarizes the compressed middle and appends the result to `context.compressionSummary`. The `SummaryInjectionStrategy` re-injects this accumulated summary at the top of the context before every call:

```
First compression (Day 3):
  compressionSummary = "User set up weather integration and asked about Tokyo, Paris, NYC."

Second compression (Day 7):
  compressionSummary = "User set up weather integration... [Day 3 summary]
    + Later: User asked about flight tracking and configured 3 alerts."

Each turn → model always sees the full history summary + recent turns
```

This is why `SummaryInjectionStrategy` must always have the lowest priority number in your stack — it needs to run first to establish the baseline context before other strategies evaluate whether to compress further.

---

## Tips & Tricks

> **Tip:** Set `triggerThreshold` between `0.75` and `0.85`. Lower means more frequent compression (more LLM calls = higher cost but better context quality). Higher means less compression but risk of overflow if a large tool result suddenly appears.

> **Tip:** `preserveLast` should be at least 4–6 turns. Compressing too aggressively leaves the agent without enough context to understand what was just discussed. A good rule of thumb: `preserveLast` should cover at least 2 full exchanges (4 turns = 2 user + 2 assistant).

> **Tip:** For agents that make many tool calls, monitor `turn:result` events' `tokenCount` field. Tool results are often the biggest context consumers — a single large API response can consume 5,000+ tokens. Use `toolResponseProcessor` to cap individual results.
