# Context Management

Context window management is lemura's **core differentiator**. Every production AI agent eventually hits the token limit — lemura prevents crashes by automatically compressing conversation history using a composable strategy stack.

> **Makix context:** Makix runs on Qwen 3.5 4B with a **16K token context window**. A typical session uses ~3K tokens for system prompt + skill + tool definitions. That leaves ~13K for conversation — which fills up after a few days of daily use. This section shows how to keep Makix running indefinitely.

![Context Management — Sandwich Compression Strategy](/images/context-management-diagram.png)

---

## The Problem at a Glance

```
Makix session budget (16,000 tokens total)
├── System prompt + skill:   1,000 tokens
├── 4 tool definitions:      1,200 tokens
├── RAG results:               800 tokens
├── Turn history:            → GROWING ←
│   Day 1 (5 turns):       2,500 tokens
│   Day 2 (8 turns):       4,000 tokens  ← strategy fires here
│   Day 3+:                compressed ✅
```

Without compression → `LemuraContextOverflowError`. With lemura's strategy stack → Makix runs forever.

---

## In This Section

| Page | What it covers |
|---|---|
| [Sandwich Compression →](/docs/context-management/sandwich-compression) | Preserve head + tail, summarize the middle — the go-to strategy for Makix |
| [Custom Strategies →](/docs/context-management/custom-strategies) | Write your own `IContextStrategy` (e.g., prune stale search results) |
| [Scratchpad →](/docs/context-management/scratchpad) | How the ReAct agent's working memory is managed separately from history |
| [Token Counting →](/docs/context-management/token-counting) | How lemura estimates tokens and what "approximate" means in practice |
| [Observability →](/docs/context-management/observability) | `compression:start`, `strategy:applied`, `compression:end` events |

---

## Quick Reference — Makix Daily Setup

```typescript
import { SandwichCompressionStrategy, SummaryInjectionStrategy } from 'lemura';

const session = new SessionManager({
  adapter, model: 'qwen3.5-4b', maxTokens: 16_000,
  compressionStrategies: [
    new SummaryInjectionStrategy({ priority: 1 }),
    new SandwichCompressionStrategy(adapter, {
      priority: 2,
      preserveFirst: 3,    // system prompt + skill + first turn
      preserveLast: 6,     // recent conversation
      triggerThreshold: 0.80,  // fires at 12,800 / 16,000 tokens
    }),
  ],
});
```

See [Sandwich Compression →](/docs/context-management/sandwich-compression) for configuration options and the other built-in strategies.
