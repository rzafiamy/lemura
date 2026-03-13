# Context & Memory Settings

Managing the context window is lemura's core strength. These settings define how history is compressed and tokens are allocated.

## Compression Policy

### `compressionStrategies: IContextStrategy[]`
Defines an ordered stack of strategies to reduce context size when `maxTokens` is approached.

```typescript
import { SandwichCompressionStrategy, SummaryInjectionStrategy } from 'lemura/context';

const config = {
  compressionStrategies: [
    new SummaryInjectionStrategy({ priority: 1 }), // Re-inject compression summary before every call
    new SandwichCompressionStrategy(adapter, {      // Summarize the middle of the conversation
      preserveFirst: 2,
      preserveLast: 5,
      priority: 2,
      triggerThreshold: 0.80,
    }),
  ]
};
```

---

## Token Budgets

Budgets prevent any single component from "starving" others of context window space. All values are **absolute token counts**.

### `toolResponseTokenBudget` (default: 15% of `maxTokens`)
The maximum space allowed for tool outputs. If a tool returns a 10,000 token JSON, lemura will use the `toolResponseProcessor` to compress it down to this budget.

### `skillTokenBudget` (default: 10% of `maxTokens`)
Limits the size of behavioral "Skills" injected into the prompt. High-priority skills stay "Detailed", while low-priority ones are downgraded to "Nano" versions as this budget is reached.

### `ragTokenBudget` (default: 20% of `maxTokens`)
The maximum space for retrieved RAG snippets. Older or lower-relevance snippets are dropped first if over budget.

---

## Custom Processing

### `toolResponseProcessor: IToolResponseProcessor`
Supply a custom class to handle how large tool outputs (like full web page HTML) are summarized or truncated before entering the context.
