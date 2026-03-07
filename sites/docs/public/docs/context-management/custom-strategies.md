# Custom Compression Strategies

When the built-in strategies don't fit your use case, implement `IContextStrategy` directly. This guide walks you through building strategies from first principles.

---

## The Strategy Interface

```typescript
interface IContextStrategy {
  name: string;        // unique identifier — appears in logs and events
  priority: number;    // lower number = applied first in the stack

  // Pure function — no side effects, no async
  shouldApply(context: ContextWindow): boolean;

  // Must return a NEW ContextWindow — never mutate the input
  apply(context: ContextWindow): Promise<ContextWindow>;
}
```

**Two absolute rules:**
1. `shouldApply()` must be a pure synchronous function — no API calls, no state
2. `apply()` must be immutable — spread the context, don't mutate it

---

## Example 1: Prune Old Tool Results

A common optimization: tool call results from many turns ago are rarely relevant. Prune them to save tokens while keeping the conversation natural.

```typescript
import type { IContextStrategy, ContextWindow, Turn } from 'lemura/types';

class PruneOldToolResultsStrategy implements IContextStrategy {
  name = 'prune_old_tool_results';
  priority = 5;

  constructor(
    private readonly keepRecentTurns: number = 5,  // keep tool results from last N turns
    private readonly triggerUtilization: number = 0.70  // trigger at 70% capacity
  ) {}

  shouldApply(context: ContextWindow): boolean {
    const utilization = context.tokenCount / context.maxTokens;
    if (utilization < this.triggerUtilization) return false;

    // Only apply if there are old tool turns to prune
    const recentCutoff = context.turns.length - this.keepRecentTurns;
    return context.turns.slice(0, recentCutoff).some(t => t.role === 'tool');
  }

  async apply(context: ContextWindow): Promise<ContextWindow> {
    const recentCutoff = context.turns.length - this.keepRecentTurns;

    const newTurns = context.turns.map((turn, index): Turn => {
      // Prune tool results older than keepRecentTurns
      if (index < recentCutoff && turn.role === 'tool') {
        const prunedContent = '[Tool result pruned — see conversation history]';
        return {
          ...turn,
          content: prunedContent,
          tokenCount: Math.ceil(prunedContent.length / 4),
          compressed: true,
        };
      }
      return turn;
    });

    // Recalculate token count
    const turnsTokens = newTurns.reduce((sum, t) => sum + t.tokenCount, 0);
    const systemTokens = Math.ceil(context.systemPrompt.length / 4);
    const scratchpadTokens = Math.ceil(context.scratchpad.length / 4);

    return {
      ...context,  // ← IMMUTABLE: spread, don't mutate
      turns: newTurns,
      tokenCount: turnsTokens + systemTokens + scratchpadTokens,
    };
  }
}
```

---

## Example 2: Remove Duplicate Content

Agents sometimes retrieve the same document twice through RAG. This strategy deduplicates `[RAG CONTEXT]` blocks in tool turns.

```typescript
class DeduplicateRAGStrategy implements IContextStrategy {
  name = 'deduplicate_rag';
  priority = 3;

  shouldApply(context: ContextWindow): boolean {
    const toolTurns = context.turns.filter(t => t.role === 'tool');
    const ragContents = toolTurns
      .map(t => String(t.content))
      .filter(c => c.includes('[RAG CONTEXT]'));
    
    // Only apply if there are duplicate RAG blocks
    const unique = new Set(ragContents);
    return unique.size < ragContents.length;
  }

  async apply(context: ContextWindow): Promise<ContextWindow> {
    const seenRAGContent = new Set<string>();

    const newTurns = context.turns.map((turn): Turn => {
      if (turn.role !== 'tool') return turn;
      const content = String(turn.content);
      
      if (!content.includes('[RAG CONTEXT]')) return turn;
      
      if (seenRAGContent.has(content)) {
        // Duplicate — replace with reference
        const deduped = '[RAG CONTEXT — duplicate, see earlier result]';
        return {
          ...turn,
          content: deduped,
          tokenCount: Math.ceil(deduped.length / 4),
          compressed: true,
        };
      }
      
      seenRAGContent.add(content);
      return turn;
    });

    const turnsTokens = newTurns.reduce((sum, t) => sum + t.tokenCount, 0);
    const overhead = Math.ceil((context.systemPrompt + context.scratchpad).length / 4);

    return {
      ...context,
      turns: newTurns,
      tokenCount: turnsTokens + overhead,
    };
  }
}
```

---

## Example 3: LLM-Powered Variable-Length Summary

For maximum compression, use the LLM to produce targeted summaries based on the current goal:

```typescript
import type { IProviderAdapter } from 'lemura/types';

class GoalAwareSummaryStrategy implements IContextStrategy {
  name = 'goal_aware_summary';
  priority = 8;

  constructor(
    private readonly adapter: IProviderAdapter,
    private readonly triggerThreshold: number = 0.85
  ) {}

  shouldApply(context: ContextWindow): boolean {
    const utilization = context.tokenCount / context.maxTokens;
    const hasGoal = !!context.metadata['goal'];
    return utilization > this.triggerThreshold && hasGoal;
  }

  async apply(context: ContextWindow): Promise<ContextWindow> {
    const goal = context.metadata['goal'] as { statement: string };
    
    // Identify turns to compress (middle section)
    const keep = 3;
    const toCompress = context.turns.slice(0, -keep);
    if (toCompress.length === 0) return context;

    const conversationText = toCompress
      .map(t => `[${t.role.toUpperCase()}]: ${String(t.content).slice(0, 2000)}`)
      .join('\n\n');

    // Use the LLM to create a goal-focused summary
    const summaryResponse = await this.adapter.complete({
      model: context.metadata['model'] as string ?? 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: `
Current goal: "${goal.statement}"

Summarize the following conversation, focusing ONLY on information relevant to the goal above.
Be concise and factual. Preserve specific values, decisions, and errors exactly.
Discard conversational filler.

${conversationText}`,
      }],
      maxTokens: 600,
    });

    const summary = summaryResponse.content;
    const summaryTurn: Turn = {
      role: 'system',
      content: `[GOAL-FOCUSED SUMMARY]\n${summary}\n[/GOAL-FOCUSED SUMMARY]`,
      tokenCount: this.adapter.estimateTokens(summary),
      compressed: true,
    };

    const newTurns = [summaryTurn, ...context.turns.slice(-keep)];
    const turnsTokens = newTurns.reduce((sum, t) => sum + t.tokenCount, 0);
    const overhead = Math.ceil((context.systemPrompt + context.scratchpad).length / 4);

    return {
      ...context,
      turns: newTurns,
      tokenCount: turnsTokens + overhead,
      compressionSummary: (context.compressionSummary ?? '') + '\n' + summary,
    };
  }
}
```

---

## Registering Custom Strategies

```typescript
const session = new SessionManager({
  adapter,
  model: 'gpt-4o',
  maxTokens: 128_000,
  compressionStrategies: [
    new DeduplicateRAGStrategy(),               // priority 3 — runs first
    new PruneOldToolResultsStrategy(5, 0.70),  // priority 5
    new SandwichCompressionStrategy(adapter, { // priority 10
      priority: 10,
      preserveFirst: 2,
      preserveLast: 4,
    }),
    new MaxTokensCompressionStrategy(adapter, { // priority 20 — emergency
      priority: 20,
      threshold: 0.95,
    }),
  ],
});
```

---

## Testing Your Strategy

Write a unit test for every strategy before using in production:

```typescript
import { describe, it, expect } from 'vitest';
import { buildContextFixture } from 'lemura/test-utils';

describe('PruneOldToolResultsStrategy', () => {
  it('does not apply when utilization is below threshold', () => {
    const strategy = new PruneOldToolResultsStrategy(3, 0.70);
    const context = buildContextFixture({ tokenCount: 50_000, maxTokens: 128_000 });
    expect(strategy.shouldApply(context)).toBe(false);
  });

  it('prunes old tool turns and keeps recent ones', async () => {
    const strategy = new PruneOldToolResultsStrategy(2, 0.70);
    const context = buildContextFixture({
      tokenCount: 100_000,
      maxTokens: 128_000,
      turns: [
        { role: 'user', content: 'start', tokenCount: 10 },
        { role: 'tool', content: 'old result', tokenCount: 5000 },  // should be pruned
        { role: 'user', content: 'continue', tokenCount: 10 },
        { role: 'tool', content: 'recent result', tokenCount: 5000 }, // should be kept
        { role: 'assistant', content: 'done', tokenCount: 50 },
      ],
    });

    const result = await strategy.apply(context);

    // Should NOT mutate input
    expect(result).not.toBe(context);
    expect(context.turns[1]?.content).toBe('old result'); // input unchanged

    // Should prune old tool turn
    const oldToolTurn = result.turns[1];
    expect(oldToolTurn?.compressed).toBe(true);
    expect(oldToolTurn?.content).not.toBe('old result');

    // Should keep recent tool turn
    const recentToolTurn = result.turns[3];
    expect(recentToolTurn?.content).toBe('recent result');
    expect(recentToolTurn?.compressed).toBeFalsy();
  });
});
```

---

## Tips & Tricks

> **Tip:** Always return the input `context` unchanged if there's nothing to compress — don't create a new object unnecessarily. Check `shouldApply()` logic is tight enough to avoid running when not needed.

> **Tip:** Test `shouldApply()` thoroughly, especially edge cases: empty turns array, already-compressed turns, contexts right at the threshold boundary.

> **Tip:** If your strategy makes an LLM call in `apply()`, it's a good candidate for accepting a `summaryModel` config option so users can use a cheaper model for compression (e.g., `gpt-4o-mini`) separate from their main agent model.
