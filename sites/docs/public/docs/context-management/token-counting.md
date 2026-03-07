# Token Counting & Budgets

Accurate token counting is the foundation of all context management. This page explains how lemura counts tokens, why it's always approximate, and how to plan your token budgets effectively.

---

## Why Token Counting Is Always Approximate

The exact token count of any text depends on the **tokenizer**, which is model-specific and often not publicly available as a standalone library. Different models tokenize the same text differently:

```
Text: "Hello, world!"

GPT-4 tokenizer:  4 tokens  ["Hello", ",", " world", "!"]
Llama tokenizer:  5 tokens  ["Hello", ",", " ", "world", "!"]
Claude tokenizer: 4 tokens  ["Hello", ",", " world", "!"]
```

lemura's approach: **always approximate conservatively** so you never get surprised by an overflow.

---

## The Counting Hierarchy

```typescript
// ContextManager token counting priority:
function countTokens(text: string, adapter: IProviderAdapter): number {
  // 1. Use adapter's estimateTokens() if available (most accurate)
  if (typeof adapter.estimateTokens === 'function') {
    return adapter.estimateTokens(text);
  }

  // 2. Fallback: conservative approximation
  // 4 chars per token is a safe lower bound for English text.
  // Real ratio is 3.5–4.0, so this overestimates slightly.
  return Math.ceil(text.length / 4);
}
```

The fallback is deliberately conservative — overestimating token count means compression fires slightly early rather than too late.

---

## Implementing `estimateTokens()` in Custom Adapters

Providing an accurate estimate significantly improves compression timing. For OpenAI-compatible models, use `tiktoken`:

```typescript
import { encoding_for_model, TiktokenModel } from '@dqbd/tiktoken';

export class OpenAICompatibleAdapter implements IProviderAdapter {
  private encoder: ReturnType<typeof encoding_for_model> | null = null;

  constructor(private config: OpenAICompatibleAdapterConfig) {
    try {
      // Try to use the model-specific tokenizer
      this.encoder = encoding_for_model(config.defaultModel as TiktokenModel);
    } catch {
      // Fall back to cl100k_base (used by GPT-4 and most modern models)
      this.encoder = encoding_for_model('gpt-4');
    }
  }

  estimateTokens(text: string): number {
    if (!this.encoder) return Math.ceil(text.length / 4);
    
    try {
      const encoded = this.encoder.encode(text);
      return encoded.length;
    } catch {
      return Math.ceil(text.length / 4);
    }
  }
}
```

For Anthropic-compatible models:
```typescript
estimateTokens(text: string): number {
  // Anthropic uses a slightly lower chars/token ratio (~3.5)
  return Math.ceil(text.length / 3.5);
}
```

---

## What Counts Toward the Token Budget

`ContextManager` counts *everything* before making a provider call:

| Component | Counted? | Notes |
|---|---|---|
| System prompt | ✅ Yes | Fixed overhead — never changes |
| Skills injected | ✅ Yes | Variable with skillTokenBudget |
| Tool definitions | ✅ Yes | Each tool's schema has a token cost |
| Turn history | ✅ Yes | Grows with the conversation |
| Scratchpad | ✅ Yes (internal only) | Not sent to provider |
| RAG results | ✅ Yes | Injected as tool turns |
| `compressionSummary` | ✅ Yes | Injected as system turn |

---

## Viewing Real-Time Token Utilization

```typescript
// After any session.run() call:
const context = session.getContext();

const utilization = context.tokenCount / context.maxTokens;
console.log(`Token utilization: ${(utilization * 100).toFixed(1)}%`);
console.log(`Used: ${context.tokenCount.toLocaleString()} / ${context.maxTokens.toLocaleString()}`);

// Detailed breakdown by turn:
context.turns.forEach((turn, i) => {
  console.log(`Turn ${i} [${turn.role}]: ${turn.tokenCount} tokens`);
});
```

---

## Budget Planning Calculator

Here's how to plan your `maxTokens` allocation:

```
Model context window:     128,000 tokens
─────────────────────────────────────────
System prompt:            -   2,000 tokens (your base instructions)
Skills:                   -   8,000 tokens  (skillTokenBudget)
Tool definitions:         -   3,000 tokens  (depends on number/size of tools)
RAG results (topK=5):     -  10,000 tokens  (ragTokenBudget)
Tool response buffer:     -  15,000 tokens  (toolResponseTokenBudget)
Safety margin (5%):       -   6,400 tokens

Available for conversation: ~83,600 tokens
─────────────────────────────────────────
At 500 tokens/turn:  → ~167 turns before compression fires
At 80% trigger:      → compression fires at ~66,880 tokens
```

---

## The `safety_margin` Concept

After compression, lemura verifies the result is below `maxTokens × safetyMargin` (default: 0.90):

```typescript
// In ContextManager.prepare():
do {
  currentStrategy = strategies.find(s => s.shouldApply(context));
  if (currentStrategy) {
    context = await currentStrategy.apply(context);
  }
} while (context.tokenCount > context.maxTokens * 0.90 && currentStrategy);

if (context.tokenCount > context.maxTokens) {
  throw new LemuraContextOverflowError(...);
}
```

The 10% buffer protects against the approximation error in token counting — a response that generates 10% more tokens than estimated won't overflow.

---

## Cost Estimation Utilities

Since tokens map directly to API costs, you can estimate cost per session:

```typescript
// OpenAI GPT-4o pricing (as of early 2025)
const COST_PER_1K_INPUT_TOKENS  = 0.005;  // $5/1M
const COST_PER_1K_OUTPUT_TOKENS = 0.015;  // $15/1M

session.on('turn:complete', ({ usage }) => {
  const inputCost  = (usage.promptTokens    / 1000) * COST_PER_1K_INPUT_TOKENS;
  const outputCost = (usage.completionTokens / 1000) * COST_PER_1K_OUTPUT_TOKENS;
  const totalCost  = inputCost + outputCost;

  console.log(`Turn cost: $${totalCost.toFixed(6)}`);
});

// After session:
const history = session.getHistory();
const totalTokens = history.reduce((sum, turn) => sum + (turn.usage?.totalTokens ?? 0), 0);
console.log(`Total session tokens: ${totalTokens}`);
```

---

## Tips & Tricks

> **Tip:** If you're optimizing for cost, set `triggerThreshold` lower (e.g., 0.60) to compress more aggressively and earlier. This reduces the size of each provider call but introduces compression LLM call costs. Run the math for your use case.

> **Tip:** Tool definitions are often surprisingly large. A complex tool with an extensive JSON Schema might cost 500–1000 tokens. Audit your tool token footprint: `const toolTokens = tools.reduce((sum, t) => sum + adapter.estimateTokens(JSON.stringify(t.parameters)), 0)`.

> **Tip:** When `tokenCount` is unexpectedly high, check if compression summaries are growing too large. Each compression cycle appends to `compressionSummary` — without `SummaryInjectionStrategy` keeping it bounded, it can drift upward.
