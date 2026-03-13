# Advanced Runtime Execution

These techniques govern **how** the ReAct agent executes, recovers, and concludes. They are about execution discipline and reliability — distinct from context compression.

> 🌿 **Makix Context** 🛠️: When a user asks _"Research the best flights to Tokyo, check my calendar, cross-reference my notes, and email me a summary"_ — that single message requires 4 tools running in sequence, goal maintenance across many turns, and compressed tool outputs. This section shows how lemura handles all of it reliably.

![Advanced Runtime Execution — The 5 Techniques](/images/advanced-execution-diagram.png)

---

## The Five Techniques

| Technique | Problem it solves | Config key |
|---|---|---|
| **Tool Response Compression** | Flight search results flood Makix's 16K context | `toolResponseProcessor` |
| **maxSteps Enforcement** | Makix loops forever if a calendar API fails | `maxSteps` |
| **Continuation Planning** | search → calendar → notes → email must run in strict order | `enableContinuationPlanning` |
| **Goal Injection** | Makix forgets the original task after context compression | `enableGoalPlanning` |
| **Skill Size Management** | Too many skills exceed the 1,600-token skill budget | `skillTokenBudget` |

---

## In This Section

| Page | What it covers |
|---|---|
| [Tool Response Compression →](/docs/advanced-execution/tool-response-compression) | Size classification, compression strategies, `ToolResponseProcessor` config |
| [maxSteps Enforcement →](/docs/advanced-execution/max-steps) | `maxIterations` vs `maxSteps`, mandatory final response format |
| [Continuation Planning →](/docs/advanced-execution/continuation-planning) | `ContinuationPlan`, sequential/parallel/conditional strategies, dependency rules |
| [Goal Planning →](/docs/advanced-execution/goal-planning) | Goal injection, sub-goal tracking, self-evaluation before final response |

---

## Quick Reference — Makix Full Production Config

```typescript
const session = new SessionManager({
  adapter, model: 'qwen3.5-4b', maxTokens: 16_000,

  // Step limits
  maxIterations: 10,
  maxSteps: 15,

  // Goal planning — Makix never loses track of the task
  enableGoalPlanning: true,
  goalInjectionFrequency: 'always',

  // Continuation planning — search → calendar → notes → email
  enableContinuationPlanning: true,
  continuationStrategy: 'sequential',

  // Tool response cap — 15% of 16K = 2,400 tokens
  toolResponseProcessor: new ToolResponseProcessor({ budgetPercent: 0.15 }),

  // Context compression
  compressionStrategies: [
    new SummaryInjectionStrategy({ priority: 1 }),
    new SandwichCompressionStrategy(adapter, { priority: 2, triggerThreshold: 0.80, preserveFirst: 3, preserveLast: 4 }),
    new HistoryCompressionStrategy(adapter, { priority: 3, windowSize: 6, triggerAtPercent: 0.92 }),
  ],

  // Skill budget — 10% of 16K
  skillTokenBudget: 1_600,
});
```

See each sub-page for detailed configuration options and failure mode guides.
