# Scratchpad & Working Memory

The scratchpad is lemura's implementation of **working memory** — an internal space for the ReAct agent to reason without polluting the conversation history or consuming excessive context tokens.

---

## What Is the Scratchpad?

The scratchpad is a special `string` field in `ContextWindow` that:
- **Is never sent to the provider directly** — it's for internal reasoning only
- **Is not part of turn history** — clear it explicitly when you want a fresh slate
- **Is never compressed** — compression strategies skip it entirely
- **Is written after every provider reasoning step** — capturing intermediate thoughts

```typescript
interface ContextWindow {
  systemPrompt: string;     // static, injected once
  scratchpad: string;       // ← working memory — never sent to provider
  turns: Turn[];            // conversation history — sent to provider
  // ...
}
```

---

## How the Agent Uses the Scratchpad

During a ReAct cycle, the agent writes to the scratchpad after each reasoning step:

```
User: "Research and compare the top 3 EV batteries in 2025"
     ↓
[Scratchpad writes]:
  "I need to:
   1. Search for EV battery market data
   2. Find top 3 by capacity and market share
   3. Compare specs (capacity, charge speed, cycle life)
   Let me start with search_web..."
     ↓
[Tool call]: search_web("top EV battery 2025 comparison")
     ↓
[Scratchpad updates]:
  "Found: CATL, BYD Blade, Tesla 4680 cells. 
   Need specific specs for each. Searching per-battery..."
     ↓
[More tool calls, scratchpad updates]
     ↓
[Final answer generated]
     ↓
[Scratchpad stays available until you clear it]
```

---

## Reading the Scratchpad

Access the current scratchpad content at any time:

```typescript
// After a session.run() completes:
const context = session.getContext();
console.log('Last reasoning trace:');
console.log(context.scratchpad);
// → "Searched for EV batteries. Found CATL, BYD, Tesla as top 3.
//    Compared specs: CATL 300Wh/kg, BYD 150Wh/kg, Tesla 4680 272Wh/kg.
//    Compiled comparison table. Task complete."
```

Subscribing to scratchpad updates in real-time:

```typescript
session.on('scratchpad:updated', ({ content, turn }) => {
  // Stream reasoning to a debug panel
  debugPanel.update(content);
});
```

---

## Why the Scratchpad Saves Tokens

Without a scratchpad, reasoning traces would be injected back into the conversation as `assistant` role turns, consuming context permanently. With the scratchpad:

```
Typical ReAct WITHOUT scratchpad:
  system:    2,000 tokens
  turn 1:    1,000 tokens
  reasoning: 500 tokens  ← injected into context
  tool call: 200 tokens
  tool result: 2,000 tokens
  reasoning: 500 tokens  ← injected again
  ---
  Total: ~6,200 tokens for one tool cycle

Typical ReAct WITH scratchpad:
  system:    2,000 tokens
  turn 1:    1,000 tokens
  tool call: 200 tokens
  tool result: 2,000 tokens
  (scratchpad: 500 tokens — NOT in context)
  ---
  Total: ~5,200 tokens for one tool cycle
```

Over a session with 10 tool calls, the scratchpad saves ~5,000 tokens — enough to fit 5–10 additional conversation turns.

---

## The ScratchpadStrategy

The `ScratchpadStrategy` is automatically included in the default lemura setup. You rarely configure it directly, but here's what it controls:

```typescript
import { ScratchpadStrategy } from 'lemura/context';

const scratchpad = new ScratchpadStrategy({
  clearOnNewUserTurn: true,       // default: true — clear between user turns
  maxScratchpadTokens: 2_000,     // default: no limit — scratchpad never grows unbounded in practice
});
```

### When to set `clearOnNewUserTurn: false`

If your agent handles sequential tasks where reasoning from a previous user turn is directly relevant to the next one:

```typescript
// Example: a session where user provides data incrementally
// Turn 1: "Here are 10 data points: [...]"
// Turn 2: "Now add these 5 more: [...]"  ← agent needs to remember analysis from turn 1
new ScratchpadStrategy({ clearOnNewUserTurn: false })
```

---

## Writing to the Scratchpad in Custom Tools

Custom tools can write context hints to the scratchpad for the agent's next reasoning step:

```typescript
const analyzeDataTool = {
  name: 'analyze_data',
  description: 'Analyze a dataset and identify patterns.',
  parameters: {
    type: 'object',
    properties: {
      datasetId: { type: 'string' }
    },
    required: ['datasetId'],
  },
  execute: async (params, ctx: ToolContext) => {
    const data = await fetchDataset(params.datasetId);
    const analysis = runStatisticalAnalysis(data);

    // Add a hint to the scratchpad for the agent's next step
    ctx.appendToScratchpad?.(
      `Dataset ${params.datasetId}: mean=${analysis.mean}, outliers=${analysis.outlierCount}`
    );

    return `Analysis complete. Found ${analysis.outlierCount} outliers.`;
  },
};
```

---

## Inspecting Multi-Turn Reasoning

For debugging complex agents, log the scratchpad at each step:

```typescript
let stepCount = 0;

session.on('tool:execute', ({ toolName }) => {
  stepCount++;
  const ctx = session.getContext();
  console.log(`\n─── Step ${stepCount}: ${toolName} ───────────────────`);
  console.log('Scratchpad before call:');
  console.log(ctx.scratchpad || '(empty)');
});
```

---

## Tips & Tricks

> **Tip:** The scratchpad is not stored in `session.getHistory()` — it's ephemeral working memory. If you need to audit an agent's full reasoning trace, subscribe to `'scratchpad:updated'` events and store them externally.

> **Tip:** Keep tool results short and action-oriented. The agent uses tool results to update its scratchpad reasoning — huge walls of text make it harder for the model to reason clearly. Prefer structured summaries over raw dumps.

> **Tip:** When a session seems to "forget" something between turns, check whether the scratchpad was cleared (manually or via `reset()`). If the agent needs to remember a computation from a previous turn, encode it explicitly in the tool's return value so it becomes part of the conversation `turns` — not just the scratchpad.
