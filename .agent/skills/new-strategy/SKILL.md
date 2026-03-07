---
name: lemura-new-strategy
description: Implements a new context window compression strategy in lemura. Use when adding a new IContextStrategy — a sandwich compressor, history summarizer, token-limit handler, or any other technique that transforms a ContextWindow to reduce token usage.
---

# Lemura: Implementing a New Compression Strategy

## When to use this skill

- Adding a new `IContextStrategy` implementation to `src/context/`
- Modifying how an existing strategy decides when to fire (`shouldApply`)
- Changing how turns are selected, summarized, or marked as compressed
- Adding a new strategy to the `ContextManager` default stack

## What a strategy is

A strategy is a **stateless, pure-ish transformer**:

```
shouldApply(ContextWindow): boolean       // pure, synchronous guard
apply(ContextWindow): Promise<ContextWindow>  // returns NEW object, never mutates
```

It has no mutable instance state beyond its constructor config. It never stores data between calls.

## File to create

```
src/context/MyNewStrategy.ts
tests/unit/context/MyNewStrategy.test.ts
```

## Implementation checklist

### Interface compliance
- [ ] Implements `IContextStrategy` from `src/types/`
- [ ] `readonly name: string` — unique kebab-case identifier
- [ ] `readonly priority: number` — where it sits in the execution stack

### Constructor
- [ ] Accepts a typed config object (define the interface in `src/types/`)
- [ ] If summarization calls the provider: accepts `IProviderAdapter` as a constructor arg
- [ ] No mutable instance variables — config only

### `shouldApply()`
- [ ] Synchronous, no side effects
- [ ] Returns `false` if already within token budget
- [ ] Returns `false` if insufficient turns to compress meaningfully
- [ ] Based only on `context.tokenCount`, `context.maxTokens`, `context.turns.length`

### `apply()`
- [ ] Returns a **new** `ContextWindow` via spread: `{ ...context, turns: newTurns, tokenCount: newCount }`
- [ ] Never mutates `context.systemPrompt` or `context.scratchpad`
- [ ] Marks compressed turns: `compressed: true`
- [ ] Appends (does not overwrite) to `context.compressionSummary`
- [ ] Recalculates `tokenCount` from scratch after compression — never trust the old value
- [ ] Handles edge cases: empty turns array, single turn, already compressed turns

### Token count recalculation pattern

Always recalculate after modifying turns:

```ts
const newTokenCount =
  estimateTokens(newContext.systemPrompt) +
  estimateTokens(newContext.scratchpad ?? '') +
  newContext.turns.reduce((sum, t) => sum + t.tokenCount, 0) +
  estimateTokens(newContext.compressionSummary ?? '');

return { ...newContext, tokenCount: newTokenCount };
```

### Export
- [ ] Added to `src/context/index.ts`
- [ ] If stable: added to `src/index.ts`
- [ ] If experimental: available from `lemura/context` sub-path only

## Priority reference (built-ins)

| Strategy | Priority |
|---|---|
| SummaryInjectionStrategy | 1 |
| SandwichCompressionStrategy | 10 |
| HistoryCompressionStrategy | 20 |
| MaxTokensCompressionStrategy | 99 |

New strategies pick a priority that reflects where they should fire relative to these.

## Test requirements

Tests must cover:
1. `shouldApply()` returns `false` when already within budget
2. `shouldApply()` returns `true` when over budget
3. `apply()` reduces `tokenCount`
4. `apply()` preserves `systemPrompt` and `scratchpad` unchanged
5. `apply()` preserves the first and last turns when applicable
6. `apply()` throws `LemuraContextOverflowError` when compression cannot reduce below target
7. Edge case: single turn, empty turns, all turns already compressed

Use `buildContextFixture({ turns: N, tokensPerTurn: T })` — never construct raw `ContextWindow` literals in tests.