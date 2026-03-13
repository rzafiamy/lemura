# Context & Memory Settings

Context management is the mechanism that keeps your agent working reliably over long sessions. Without it, every LLM has a hard token limit beyond which it simply fails. Lemura's context settings let you configure *how* the available token budget is divided among different components, and *when* compression fires to reclaim space.

There are two concerns here: **budgeting** (how many tokens each component is allowed to consume from the shared pool) and **compression** (what happens when the pool runs low). Budgeting ensures no single component — a large tool result, an over-specified RAG query, or an over-stuffed skill set — crowds out the conversation history. Compression is the fallback: when the conversation grows despite budgeting, structured strategies summarize and prune the context to make room.

---

## Compression Strategies

### `compressionStrategies?: IContextStrategy[]`

An ordered stack of context compression strategies. When `context.tokenCount` approaches `maxTokens`, each strategy's `shouldApply()` method is evaluated in priority order. The first applicable strategy runs, then the loop checks again — applying strategies until the context fits within the target threshold.

```typescript
import {
  SummaryInjectionStrategy,
  SandwichCompressionStrategy,
  HistoryCompressionStrategy,
} from 'lemura/context';

const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  compressionStrategies: [
    // Priority 1: Always inject any prior compression summary at the top
    new SummaryInjectionStrategy({ priority: 1 }),

    // Priority 2: At 80% usage, summarize the middle of the conversation
    new SandwichCompressionStrategy(adapter, {
      priority: 2,
      preserveFirst: 2,         // keep the first 2 turns verbatim
      preserveLast: 4,          // keep the last 4 turns verbatim
      triggerThreshold: 0.80,   // fire at 80% of maxTokens
      summaryMaxTokens: 500,    // max tokens for the generated summary
    }),

    // Priority 3: Emergency fallback at 92% — summarize oldest turns
    new HistoryCompressionStrategy(adapter, {
      priority: 3,
      windowSize: 6,            // summarize oldest 6 turns
      triggerAtPercent: 0.92,
    }),
  ],
});
```

**Strategy execution flow:**

```
Before every provider call:
  context.tokenCount / maxTokens = 0.85 → above 0.80 threshold

  SummaryInjectionStrategy.shouldApply()  → true (priority 1, always)
  SandwichCompressionStrategy.shouldApply() → true (0.85 > 0.80, priority 2)

  → Apply SandwichCompressionStrategy: 85,000 → 52,000 tokens ✅
  → Re-evaluate: 52,000 / 128,000 = 0.41 — all strategies return false
  → Done. Provider call proceeds.
```

**Available built-in strategies:**

| Class | What it does | Import |
|---|---|---|
| `SummaryInjectionStrategy` | Re-injects the accumulated `compressionSummary` before every call | `lemura/context` |
| `SandwichCompressionStrategy` | Keeps head + tail, summarizes the middle | `lemura/context` |
| `HistoryCompressionStrategy` | Summarizes the oldest N turns in a rolling window | `lemura/context` |

> See [Sandwich Compression →](/docs/context-management/sandwich-compression) and [Custom Strategies →](/docs/context-management/custom-strategies) for full guides.

---

## Token Budgets

Budgets cap how many tokens each component may consume from the shared `maxTokens` pool. All values are **absolute token counts** (not percentages).

### `skillTokenBudget?: number`

Maximum tokens the skill injection block may consume. When the combined size of all skills exceeds this, skills are downgraded tier-by-tier: `extended → standard → micro → nano → skipped`. Skills with `priority < 5` are **never downgraded or skipped**.

```typescript
// 10% of 128k
skillTokenBudget: 12_800

// 10% of 16k (small local model)
skillTokenBudget: 1_600
```

### `ragTokenBudget?: number`

Maximum tokens for RAG retrieval results injected per turn. The oldest or lowest-relevance results are dropped first when over budget.

```typescript
// 8% of 128k
ragTokenBudget: 10_000

// 20% of 16k (knowledge-heavy agent on a small model)
ragTokenBudget: 3_200
```

### `toolResponseTokenBudget?: number`

Maximum total tokens across all tool responses in one iteration. When cumulative tool results exceed this, the `toolResponseProcessor` compresses the oldest results first.

```typescript
// 15% of 128k
toolResponseTokenBudget: 19_200

// 20% of 16k
toolResponseTokenBudget: 3_200
```

**Budget planning worksheet:**

```
maxTokens = 128,000
─────────────────────────────────────────────
System prompt:          -  2,000   (systemPrompt)
Skills:                 -  8,000   (skillTokenBudget)
Tool definitions:       -  3,000   (~4 tools × 750 tokens each)
RAG results:            - 10,000   (ragTokenBudget)
Tool response buffer:   - 15,000   (toolResponseTokenBudget)
Safety margin (5%):     -  6,400
─────────────────────────────────────────────
Available for turns:    ~83,600 tokens

At 500 tokens/turn:  → ~167 turns before sandwich compression fires
At triggerThreshold 80%: → fires at 66,880 tokens used
```

---

## Custom Tool Response Processing

### `toolResponseProcessor?: IToolResponseProcessor`

Replaces the default `ToolResponseProcessor` with your own implementation. Use this when the default classification thresholds don't suit your workload — for example, agents that routinely process large structured data files or API responses.

```typescript
import { ToolResponseProcessor } from 'lemura';

const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  toolResponseProcessor: new ToolResponseProcessor({
    smallMaxTokens:  300,    // verbatim if ≤ 300 tokens
    mediumMaxTokens: 1_000,  // verbatim if ≤ 1000 tokens (flagged)
    largeMaxTokens:  3_000,  // LLM-summarized if ≤ 3000 tokens
    budgetPercent: 0.12,     // all responses combined ≤ 12% of maxTokens
  }),
});
```

> See [Tool Response Compression →](/docs/advanced-execution/tool-response-compression) for the full guide including custom processor implementations.

---

## Short-Term Memory (STM)

### `stmRegistry?: ShortTermMemoryRegistry`

Enables Short Term Memory — a mechanism for storing large intermediate data (documents, search results, binary blobs) outside the prompt and referencing them by a compact token ID. Instead of injecting a 50KB JSON response into the context, STM stores it under a UUID and injects only `[STM:uuid]`.

```typescript
import { ShortTermMemoryRegistry } from 'lemura/context';

const stm = new ShortTermMemoryRegistry({ maxEntries: 20, maxSizeBytes: 10 * 1024 * 1024 });

const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  stmRegistry: stm,
});

// The built-in STM tools are auto-registered:
// stm_read_chunk, stm_search_chunk, stm_list_chunks, stm_update_chunk
```

STM is transparent to the agent — it naturally uses `stm_read_chunk` to dereference a stored blob when it needs to process it.

---

## Scratchpad Persistence

### `scratchpadAdapter?: IScratchpadAdapter`

Optional persistent storage for the scratchpad. By default the scratchpad is in-memory and lost when the process restarts. Provide an adapter to persist it across sessions or process restarts.

```typescript
import type { IScratchpadAdapter } from 'lemura/types';

// Example: Redis-backed scratchpad
class RedisScratchpadAdapter implements IScratchpadAdapter {
  constructor(private redis: Redis, private sessionId: string) {}

  async read(): Promise<string> {
    return (await this.redis.get(`scratchpad:${this.sessionId}`)) ?? '';
  }

  async write(content: string): Promise<void> {
    await this.redis.setex(`scratchpad:${this.sessionId}`, 3600, content);
  }

  async clear(): Promise<void> {
    await this.redis.del(`scratchpad:${this.sessionId}`);
  }
}

const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  sessionId: `user_${userId}`,
  scratchpadAdapter: new RedisScratchpadAdapter(redis, `user_${userId}`),
});
```

---

## Tips & Tricks

> **Tip:** Always pair `SandwichCompressionStrategy` with `SummaryInjectionStrategy` at a lower priority number. Without `SummaryInjectionStrategy`, the accumulated `compressionSummary` is not re-injected before calls — the agent effectively loses its compressed history.

> **Tip:** Set `triggerThreshold` between `0.75` and `0.85` for most use cases. A threshold of `0.90` is too late — by the time compression fires, there may not be enough headroom for the compression summary to fit. A threshold of `0.60` fires too early and wastes money on unnecessary LLM summarization calls.

> **Tip:** Monitor token utilization with the `turn:complete` trace event: `event.tokenCount / maxTokens`. If it regularly spikes above `0.80` before compression fires, lower your `triggerThreshold`.

> **Tip:** Use `ShortTermMemoryRegistry` for agents that process large documents. It prevents a single large file read from consuming your entire context budget. The agent can read chunks on demand rather than loading the full document at once.
