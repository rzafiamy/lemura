# maxSteps & Loop Control

Controlling how many steps an agent takes — and ensuring it concludes gracefully regardless — is critical for production reliability and cost management.

---

## Two Limits, Two Behaviors

lemura provides two separate limits with different behaviors when exceeded:

| Limit | What it counts | What happens when exceeded |
|---|---|---|
| `maxIterations` | Full ReAct cycles | Throws `LemuraMaxIterationsError` — hard stop |
| `maxSteps` | Individual tool calls | Forces graceful conclusion — no throw |

```typescript
const session = new SessionManager({
  adapter,
  model: 'gpt-4o',
  maxTokens: 128_000,
  maxIterations: 10,  // Hard stop after 10 full reason→act cycles
  maxSteps: 20,       // Soft stop after 20 individual tool calls
});
```

---

## Understanding maxIterations

One **iteration** = one ReAct cycle:

```
Iteration 1:
  Reason: "I should search for the data"
  Act:    search_web("EV market 2025")
  Act:    fetch_pdf("Gartner EV report")  ← both in one iteration
  Observe: [search result] [pdf result]

Iteration 2:
  Reason: "I have the data, let me extract key figures"
  Act:    extract_tables("...")
  Observe: [tables]

Iteration 3:
  Reason: "Now I can write the report"
  → final answer (no tool call)
```

This 3-iteration flow uses 3 tool calls (2 in iter 1, 1 in iter 2) across 2 non-final iterations.

**When `maxIterations` is hit:** `LemuraMaxIterationsError` is thrown. Catch it:

```typescript
try {
  const result = await session.run("Research EV market...");
} catch (err) {
  if (err instanceof LemuraMaxIterationsError) {
    // The last partial response is available
    console.log('Last partial content:', err.lastResponse ?? '(none)');
    return 'The research took too many steps. Please try a more focused question.';
  }
  throw err;
}
```

---

## Understanding maxSteps

`maxSteps` counts total individual tool calls, not iterations. When reached, lemura:

1. Removes tool definitions from the next provider call payload
2. Injects this message:

```
You have used 20/20 steps. Provide your final response now.
Do not call any more tools. Use the required structure:

## Goal Status: ACHIEVED | PARTIALLY_ACHIEVED | FAILED
### What was accomplished
[...]
### Remaining tasks
[...]
### Result
[...]
```

The model can only produce text at this point — no more tool calls. This gives a graceful shutdown even if the task isn't complete.

---

## The Mandatory Final Response Format

All agent conclusions — natural or forced — should follow this structure:

```markdown
## Goal Status: ACHIEVED

### What was accomplished
- Searched for Q4 2025 EV market data across 5 sources
- Extracted key statistics for EU, US, and China markets
- Created comparison analysis showing 23% YoY growth globally

### Remaining tasks
None

### Failed steps
None

### Result

# Q4 2025 EV Market Report

## Global Overview
The global EV market grew 23% year-over-year in Q4 2025...
```

---

## Infinite Loop Detection

lemura tracks consecutive identical tool calls. If the same tool is called with the same arguments twice in a row, it's likely stuck:

```typescript
session.on('loop:detected', ({ tool, args, strike }) => {
  console.warn(`Loop detected! ${tool} called with same args (strike ${strike}/3)`);
});
```

On the **3rd consecutive duplicate call**:
1. lemura halts the loop
2. Injects a prompt explaining the loop
3. Forces a final response

**Common causes of loops:**
- Tool returns the same result regardless of input
- System prompt doesn't give the agent clear stopping criteria
- `maxSteps` is too high and the agent isn't making progress

---

## Natural Conclusion Detection

The agent concludes naturally when all three conditions are met:
1. `finishReason === 'stop'` from the provider
2. Response contains no tool calls
3. Response has substantive content (not just whitespace or empty)

```typescript
// In ReActAgent (simplified):
if (
  response.finishReason === 'stop' &&
  !response.toolCalls?.length &&
  response.content.trim().length > 50
) {
  return response.content;  // Natural conclusion
}
```

---

## Tuning for Different Task Types

### Quick Q&A agent (tight limits)
```typescript
const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  maxIterations: 3,   // 3 back-and-forth cycles max
  maxSteps: 5,        // 5 tool calls max
});
// Best for: customer support, simple lookups, FAQ answers
```

### Research agent (generous limits)
```typescript
const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 200_000,
  maxIterations: 20,  // full research process
  maxSteps: 40,       // many data gathering steps
  enableGoalPlanning: true,           // plan before starting
  enableContinuationPlanning: true,   // structured execution
});
// Best for: deep research, codebase analysis, complex audits
```

### Workflow automation (balanced)
```typescript
const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  maxIterations: 8,
  maxSteps: 15,
  enableContinuationPlanning: true,
  continuationStrategy: 'sequential',
});
// Best for: multi-step automations with defined start/end
```

---

## Monitoring Exhaustion

Track when limits are hit in production:

```typescript
let sessionStats = { toolCalls: 0, iterations: 0 };

session.on('tool:execute', () => sessionStats.toolCalls++);
session.on('turn:complete', ({ role }) => {
  if (role === 'assistant') sessionStats.iterations++;
});

try {
  const result = await session.run(message);
  metrics.gauge('agent.tool_calls', sessionStats.toolCalls);
  metrics.gauge('agent.iterations', sessionStats.iterations);
  return result;
} catch (err) {
  if (err instanceof LemuraMaxIterationsError) {
    metrics.increment('agent.max_iterations_hit');
    // Alert if hitting this frequently — tasks may be too complex
  }
}
```

---

## Tips & Tricks

> **Tip:** Start with the defaults (`maxIterations: 10, maxSteps: 20`) and tune based on observed behavior. Log how many steps your typical tasks actually use — you'll often find 80% finish in under 5 steps.

> **Tip:** `maxSteps` is more predictable for cost control than `maxIterations`. One iteration can contain many tool calls — `maxSteps` puts a ceiling on the total number of API calls and external service invocations.

> **Tip:** If your agent frequently hits `maxSteps` without completing, the task is too complex for a single session. Consider breaking it into smaller sub-tasks, or use `enableContinuationPlanning` to make progress more efficient.
