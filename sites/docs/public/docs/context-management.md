# Context Management

Context window management is lemura's **core differentiator**. Every production AI agent eventually hits the token limit — lemura makes sure that never crashes your system by automatically compressing conversation history using a composable strategy stack.

---

## The Problem: Token Limits Are Real

Every LLM has a finite context window. Long conversations, large tool outputs, and verbose system prompts all compete for that limited space:

```
Max context: 128k tokens
├── System prompt:     2k tokens
├── Skills injected:   1k tokens
├── Tool definitions:  3k tokens
├── Turn history:      → GROWING ←
│   ├── Turn 1:        800 tokens
│   ├── Turn 2:        1,200 tokens
│   ├── ...
│   └── Turn N:        ???? tokens
└── RAG results:       5k tokens
```

Without management, the agent crashes with `LemuraContextOverflowError` or silently truncates the beginning of the conversation, causing it to "forget" critical context.

---

## The Solution: Composable Compression Strategies

lemura manages context through a **strategy stack**. Before every provider call, `ContextManager.prepare()` calculates token usage and applies strategies in priority order until the context fits:

```typescript
┌────────────────────────────────────────────┐
│           ContextManager.prepare()         │
│                                            │
│  1. Calculate tokenCount                   │
│  2. tokenCount < maxTokens? → stop, done   │
│  3. Run strategy[0].shouldApply() → Yes?   │
│     → Apply strategy[0]                   │
│     → Recalculate tokenCount              │
│  4. Still over limit? → try strategy[1]    │
│  5. All strategies applied, still over?    │
│     → throw LemuraContextOverflowError     │
└────────────────────────────────────────────┘
```

---

## The ContextWindow Type

Everything flows through this structure:

```typescript
interface ContextWindow {
  systemPrompt: string;           // never compressed
  scratchpad: string;             // ReAct reasoning trace — never sent to provider
  turns: Turn[];                  // conversation history
  tokenCount: number;             // current estimated total
  maxTokens: number;              // hard limit
  compressionSummary?: string;    // accumulated summary from past compressions
  metadata: Record<string, unknown>;
}

interface Turn {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string | ContentBlock[];
  tokenCount: number;
  compressed: boolean;
  toolCalls?: ToolCall[];
}
```

---

## The IContextStrategy Interface

Write your own compression strategy by implementing:

```typescript
interface IContextStrategy {
  name: string;       // unique identifier, shows in logs
  priority: number;   // lower = runs first

  shouldApply(context: ContextWindow): boolean;   // pure function — no side effects
  apply(context: ContextWindow): Promise<ContextWindow>;   // must return NEW object
}
```

**Critical rule:** `apply()` must **never mutate** the input. Always return a new `ContextWindow`:

```typescript
// ✅ Immutable — correct
async apply(context: ContextWindow): Promise<ContextWindow> {
  const compressedTurns = await this.summarizeMiddle(context.turns);
  return {
    ...context,
    turns: compressedTurns,
    tokenCount: this.recount(compressedTurns, context),
  };
}

// ❌ Mutation — wrong (breaks composability and retry safety)
async apply(context: ContextWindow): Promise<ContextWindow> {
  context.turns.splice(2, 10);   // NEVER DO THIS
  return context;
}
```

---

## Built-In Strategies

lemura ships five composable strategies:

### 1. SandwichCompressionStrategy (most common)

Preserves the **head** (initial context) and **tail** (recent turns) of the conversation, summarizes everything in the middle:

```
Before:  [turn1, turn2, turn3, turn4, turn5, turn6, turn7, turn8, turn9, turn10]
After:   [turn1, turn2, ──── SUMMARY ────, turn9, turn10]
               ↑ preserveFirst:2              ↑ preserveLast:2
```

```typescript
import { SandwichCompressionStrategy } from 'lemura/context';

const sandwich = new SandwichCompressionStrategy(adapter, {
  preserveFirst: 2,     // keep initial system context + first user message
  preserveLast: 4,      // keep the most recent 4 turns verbatim
  triggerThreshold: 0.8,  // start compressing at 80% of maxTokens
});
```

**Best for:** General-purpose conversations where you need both initial context and recent history.

### 2. HistoryCompressionStrategy (rolling window)

Compresses only the oldest N turns, rolling forward as the conversation grows:

```typescript
import { HistoryCompressionStrategy } from 'lemura/context';

const history = new HistoryCompressionStrategy(adapter, {
  windowSize: 10,         // summarize the oldest 10 turns
  triggerAtPercent: 0.75, // trigger at 75% capacity
});
```

**Best for:** Long-running research agents where recent context matters most.

### 3. MaxTokensCompressionStrategy (emergency fallback)

The aggressive last resort — fires when context is critically full:

```typescript
import { MaxTokensCompressionStrategy } from 'lemura/context';

const emergency = new MaxTokensCompressionStrategy(adapter, {
  threshold: 0.95,       // fire at 95% full
  aggressionFactor: 0.7, // compress up to 70% of history
});
```

Always keeps: system prompt, scratchpad, last 2 turns. Throws `LemuraContextOverflowError` if it still can't fit.

### 4. ScratchpadStrategy (ReAct reasoning)

Not a compression strategy — it manages the agent's **working memory**. The scratchpad stores intermediate reasoning traces that guide the next action but are cleared between user turns:

```typescript
import { ScratchpadStrategy } from 'lemura/context';

const scratchpad = new ScratchpadStrategy();
// Automatically managed by ReActAgent — you rarely configure this directly
```

### 5. SummaryInjectionStrategy (context recovery)

Injects the accumulated compression summary back into the context before each provider call, ensuring the model always knows what was summarized:

```typescript
import { SummaryInjectionStrategy } from 'lemura/context';

const summary = new SummaryInjectionStrategy({
  position: 'after_system_prompt',  // where to inject the summary
});
```

---

## Composing Strategies

Strategies stack in priority order. Lower priority number = applied first:

```typescript
import {
  SessionManager,
  SandwichCompressionStrategy,
  MaxTokensCompressionStrategy,
  SummaryInjectionStrategy,
} from 'lemura';

const session = new SessionManager({
  adapter,
  model: 'gpt-4o',
  maxTokens: 128_000,
  compressionStrategies: [
    // Priority 1: Always inject summary (fires before every call)
    new SummaryInjectionStrategy({ priority: 1 }),
    // Priority 2: Regular sandwich compression at 80% capacity
    new SandwichCompressionStrategy(adapter, { priority: 2, triggerThreshold: 0.80, preserveFirst: 2, preserveLast: 4 }),
    // Priority 3: Emergency compression if still over limit
    new MaxTokensCompressionStrategy(adapter, { priority: 3, threshold: 0.95 }),
  ],
});
```

---

## Writing a Custom Strategy

Example: a strategy that removes tool observations older than 5 turns:

```typescript
import type { IContextStrategy, ContextWindow } from 'lemura/types';

class PruneOldToolResultsStrategy implements IContextStrategy {
  name = 'prune_old_tool_results';
  priority = 10;

  constructor(private keepRecent: number = 5) {}

  shouldApply(context: ContextWindow): boolean {
    // Only run if we're over 70% capacity AND have old tool turns to prune
    const utilizationRate = context.tokenCount / context.maxTokens;
    const oldToolTurns = context.turns.slice(0, -this.keepRecent)
      .filter(t => t.role === 'tool').length;
    return utilizationRate > 0.70 && oldToolTurns > 0;
  }

  async apply(context: ContextWindow): Promise<ContextWindow> {
    const recentCutoff = context.turns.length - this.keepRecent;

    const prunedTurns = context.turns.map((turn, index) =>
      index < recentCutoff && turn.role === 'tool'
        ? { ...turn, content: '[Tool result pruned to save context]', compressed: true }
        : turn
    );

    const newTokenCount = prunedTurns.reduce((sum, t) => sum + t.tokenCount, 0)
      + Math.ceil(context.systemPrompt.length / 4)
      + Math.ceil(context.scratchpad.length / 4);

    return { ...context, turns: prunedTurns, tokenCount: newTokenCount };
  }
}
```

---

## Token Counting

Token counting in lemura is always approximate — the exact count depends on the tokenizer, which is model-specific. lemura uses:

1. **Adapter's `estimateTokens()`** if available (most accurate)
2. **Fallback:** `Math.ceil(text.length / 4)` — conservative estimate

```typescript
// Token utilization at any time:
const context = session.getContext();
const utilization = context.tokenCount / context.maxTokens;
console.log(`Using ${(utilization * 100).toFixed(1)}% of context window`);
```

---

## Observability Events

Subscribe to compression events for monitoring:

```typescript
const session = new SessionManager({ adapter, model: 'gpt-4o', maxTokens: 128_000 });

session.on('compression:start', ({ tokenCount, maxTokens }) => {
  console.log(`Compressing: ${tokenCount}/${maxTokens} tokens used`);
});

session.on('strategy:applied', ({ strategyName, tokensBefore, tokensAfter }) => {
  const saved = tokensBefore - tokensAfter;
  console.log(`[${strategyName}] saved ${saved} tokens`);
});

session.on('compression:end', ({ tokenCount }) => {
  console.log(`After compression: ${tokenCount} tokens`);
});
```

---

## Real-World Configuration Recipes

### High-stakes research agent (long sessions)
```typescript
compressionStrategies: [
  new SummaryInjectionStrategy({ priority: 1 }),
  new HistoryCompressionStrategy(adapter, {
    priority: 2,
    windowSize: 8,
    triggerAtPercent: 0.75,
  }),
  new MaxTokensCompressionStrategy(adapter, {
    priority: 3,
    threshold: 0.92,
    aggressionFactor: 0.5, // gentler — preserve more
  }),
],
```

### Customer support chatbot (current context matters most)
```typescript
compressionStrategies: [
  new SandwichCompressionStrategy(adapter, {
    priority: 1,
    preserveFirst: 3,    // initial greeting + rules
    preserveLast: 6,     // recent customer context
    triggerThreshold: 0.80,
  }),
],
```

### Code review agent (big tool outputs)
```typescript
compressionStrategies: [
  new PruneOldToolResultsStrategy(3),   // custom — keep only 3 recent tool calls
  new SandwichCompressionStrategy(adapter, { preserveFirst: 1, preserveLast: 2 }),
],
```

---

## When Things Go Wrong

**Context keeps growing despite compression**
Ensure tool responses aren't bypassing compression. Use `toolResponseTokenBudget` in `SessionConfig` to cap how many tokens tool results can consume.

**Lost initial instructions after compression**
Increase `preserveFirst` in `SandwichCompressionStrategy`. Initial turns containing system rules should always be preserved.

**`LemuraContextOverflowError` after all strategies run**
Your content is genuinely too large to fit. Options: increase `maxTokens` (use a larger context model), add `MaxTokensCompressionStrategy` with higher `aggressionFactor`, or reduce `topK` in your RAG adapter to inject fewer documents.

**Compression summary is inaccurate**
The LLM doing the summarization is the same as your `adapter`. If it's a small/fast model, summaries may be low quality. Consider using a separate high-quality model just for summarization by passing a dedicated `summaryAdapter` to compression strategies.
