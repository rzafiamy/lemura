---
trigger: always_on
---

# lemura — Context Window Management Rules

## Overview

Context window management is lemura's core differentiator. This module lives in `src/context/` and must be the most thoroughly tested part of the package.

The `ContextManager` orchestrates a **stack of strategies** applied in order when the context needs compression. Each strategy is independent and composable.

---

## The ContextWindow Type

The canonical data structure flowing through all strategies:

```
ContextWindow {
  systemPrompt: string           // injected once, never compressed
  scratchpad: string             // RLM working memory, separate from history
  turns: Turn[]                  // conversation history
  tokenCount: number             // current estimated token count
  maxTokens: number              // hard limit for this session
  compressionSummary?: string    // accumulated summary from prior compressions
  metadata: Record<string, unknown>
}

Turn {
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string | ContentBlock[]
  tokenCount: number
  turnIndex: number
  compressed: boolean            // true if this turn was summarized
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
}
```

---

## Strategy Interface

Every compression strategy must implement:

```
IContextStrategy {
  name: string                   // unique identifier, used in logs
  priority: number               // lower = applied first
  shouldApply(ctx: ContextWindow): boolean   // guard — return false to skip
  apply(ctx: ContextWindow): Promise<ContextWindow>
}
```

**Rules:**
- `apply()` must return a **new** `ContextWindow` object — never mutate the input
- `apply()` must update `tokenCount` accurately after compression
- `shouldApply()` must be a pure synchronous function — no side effects
- Strategies that call the provider to summarize must accept an `IProviderAdapter` in their constructor

---

## The Five Built-In Strategies

### 1. RLM Scratchpad (`ScratchpadStrategy`)
- Maintains a `scratchpad` field separate from the `turns` array
- The ReAct agent writes reasoning traces here
- Scratchpad is **never sent to the provider directly** — it's used to generate the next user/system turn
- Scratchpad is cleared at the start of each new user turn
- Never compress or truncate the scratchpad mid-reasoning

### 2. Sandwich Compression (`SandwichCompressionStrategy`)
- Preserves the first N turns verbatim (anchors: system context, initial instructions)
- Preserves the last M turns verbatim (recency: immediate context)
- Summarizes everything in the middle into a single `compressionSummary` string
- Config: `{ preserveFirst: number, preserveLast: number, summaryModel?: string }`
- The summary is injected as a synthetic `system` turn between the preserved head and tail

### 3. History Compression (`HistoryCompressionStrategy`)
- Operates on a rolling window of the oldest N turns
- Summarizes them and appends the summary to `compressionSummary`
- Removes the compressed turns from `context.turns`
- Marks removed turns as `compressed: true` in the summary metadata
- Config: `{ windowSize: number, triggerAtPercent: number }` (e.g. compress when 80% full)

### 4. Max Tokens Compression (`MaxTokensCompressionStrategy`)
- Emergency strategy — fires when `tokenCount >= maxTokens * threshold`
- More aggressive than history compression: can compress up to 70% of history
- Always preserves: system prompt, scratchpad, last 2 turns
- After compression, if still over limit: throws `LemuraContextOverflowError`
- Config: `{ threshold: number, aggressionFactor: number }`

### 5. Compression Summary Injection (`SummaryInjectionStrategy`)
- Not a compression strategy — a **pre-turn injection** strategy
- Before each provider call, injects `compressionSummary` as a system turn at a fixed position
- Position: after system prompt, before first user turn
- Ensures the model always has context of what was summarized

---

## ContextManager Orchestration Rules

1. Strategies are stored in priority order (ascending `priority` value)
2. Before each provider call, `ContextManager.prepare()` runs:
   - Calculates current `tokenCount`
   - Iterates strategies, calling `shouldApply()` on each
   - Applies all strategies where `shouldApply()` returns `true`, in priority order
   - Recalculates `tokenCount` after each strategy
   - Stops when `tokenCount < maxTokens * safetyMargin`
3. If after all strategies `tokenCount` is still over limit: throws `LemuraContextOverflowError`
4. `ContextManager` emits events: `'compression:start'`, `'compression:end'`, `'strategy:applied'` for observability

---

## Token Counting Rules

- Token counting is **always approximate** — use the provider adapter's `estimateTokens()` method if available, else fall back to `Math.ceil(text.length / 4)` as a conservative estimate
- Always count **before** compression to decide if compression is needed
- Always recount **after** compression to verify effectiveness
- Include system prompt and scratchpad in total count
- Tool definitions injected into the context count toward the token budget

---

## Immutability Rule

All context operations must be immutable:

```ts
// ✅ Correct
const newContext = {
  ...context,
  turns: [...context.turns.slice(0, n), summaryTurn],
  tokenCount: recalculatedCount
};

// ❌ Wrong
context.turns.splice(2, 10);
context.tokenCount = recalculatedCount;
```

This ensures strategies are safe to compose and retry without side effects.