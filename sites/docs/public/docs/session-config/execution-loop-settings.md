# Execution & Loop Control

The ReAct loop is the engine behind every lemura agent. Understanding how to configure its limits, planning modes, and tool execution controls directly determines how reliable, cost-effective, and responsive your agent is in production.

lemura provides two complementary budget mechanisms — **iteration limits** (how many reasoning cycles) and **step limits** (how many tool calls). These govern the same loop from different angles: iterations bound reasoning depth, while steps bound side effects. Together with goal and continuation planning, they give you precise control over complex multi-step workflows without sacrificing the flexibility of autonomous reasoning.

---

## Loop Constraints

### `maxIterations?: number` (default: `10`)

Limits the number of complete Reason → Act → Observe cycles. When this limit is hit, `LemuraMaxIterationsError` is thrown — a **hard stop** with no final response.

```typescript
const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  maxIterations: 10,
});
```

**Choosing a value:**

| Value | Best for |
|---|---|
| `3–5` | Simple tasks: lookup, summarize, single tool call |
| `8–12` | General purpose: multi-tool tasks with some back-and-forth |
| `15–25` | Deep research, coding agents that iterate many times |

**Catching the error:**

```typescript
try {
  const result = await session.run(message);
} catch (err) {
  if (err instanceof LemuraMaxIterationsError) {
    // err.lastResponse contains the last partial output, if any
    return `Task too complex. Partial result: ${err.lastResponse ?? '(none)'}`;
  }
  throw err;
}
```

---

### `maxSteps?: number` (default: `20`)

Limits the total number of **individual tool calls** across all iterations. Unlike `maxIterations`, reaching `maxSteps` triggers a **graceful conclusion** — lemura removes tool definitions from the next call and instructs the model to wrap up with a structured final response.

```typescript
const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  maxIterations: 10,   // hard stop
  maxSteps: 20,        // soft stop — graceful conclusion
});
```

When `maxSteps` is hit, the model receives:

```
You have used 20/20 steps. Provide your final response now.
Do not call any more tools. Use this structure:

## Goal Status: ACHIEVED | PARTIALLY_ACHIEVED | FAILED
### What was accomplished
[...]
### Remaining tasks
[...]
### Result
[...]
```

**Tip:** `maxSteps` is more useful for production cost control than `maxIterations`. One iteration may contain many tool calls — `maxSteps` places a ceiling on the total external API invocations and side effects.

---

## Planning & Goal Control

### `enableGoalPlanning?: boolean`

When `true`, lemura runs a mini-planning LLM call before the first tool call to decompose the user's message into sub-goals and success criteria. This goal is then injected before every provider call, preventing the agent from drifting away from the original objective during long tasks with many tool calls and context compressions.

```typescript
const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  enableGoalPlanning: true,
  goalInjectionFrequency: 'always',
  goalInjectionPosition: 'system_prompt',
});
```

> See [Goal Planning →](/docs/advanced-execution/goal-planning) for the full guide including manual goal setting, sub-goal tracking, and injection positions.

---

### `goalInjectionFrequency?: string`

Controls how often the goal block is re-injected:

| Value | Behavior | Best for |
|---|---|---|
| `'always'` | Every single provider call | Most agents — strong goal adherence |
| `'every_N_turns'` | Every N iterations (set `goalInjectionN`) | Very long sessions where token savings matter |
| `'on_compression'` | Only after a compression event | Minimal injection — use only if goal drift is acceptable |

```typescript
// Save tokens in very long sessions — re-inject every 3 turns
goalInjectionFrequency: 'every_N_turns',
goalInjectionN: 3,
```

---

### `goalInjectionPosition?: string`

Where in the context the goal block appears:

| Value | Where | Best for |
|---|---|---|
| `'system_prompt'` | Appended to the system prompt | Most agents |
| `'pre_turn'` | Injected as a synthetic system message just before the provider call | Maximum visibility — model reads goal last before deciding |

---

### `goalInjectionN?: number` (default: `3`)

When `goalInjectionFrequency: 'every_N_turns'`, re-inject the goal every N iterations. Also controls how often `goalProgressReconciliation` runs.

---

### `goalProgressReconciliation?: boolean` (default: `false`) *(since v1.5.4)*

When `true`, lemura periodically (every `goalInjectionN` tool rounds) makes one small LLM call to reconcile which decomposed sub-goals are already complete and marks them done — so the re-injected goal block reflects real progress instead of always showing every sub-goal as pending. Counters goal drift on long runs. Requires `enableGoalPlanning`.

---

### `enableGoalVerification?: boolean` (default: `true` when goal planning is on) *(since v1.5.0)*

After the ReAct loop reaches a `stop` finish, verify whether the goal's success criteria were actually met. When unmet and correction budget remains, lemura re-enters the loop with full tool access to fix the gap (see `maxGoalCorrections`). Set to `false` to skip verification without removing `enableGoalPlanning`.

```typescript
const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  enableGoalPlanning: true,
  enableGoalVerification: true,
});
```

---

### `goalVerifier?: (goal, turns) => GoalVerifierResult` *(since v1.5.0)*

Optional user-supplied callback (sync or async) called after a `stop` finish when goal planning is on. Return `{ achieved: false, missing: '...' }` to drive a correction re-entry, or `{ achieved: true }` to finish. When omitted and `successCriteria` is non-empty, lemura falls back to a built-in LLM check.

```typescript
goalVerifier: async (goal, turns) => {
  const last = String(turns.at(-1)?.content ?? '');
  return last.includes('## Result')
    ? { achieved: true }
    : { achieved: false, missing: 'No "## Result" section in output' };
},
```

> See [Goal Planning & Verification →](/docs/advanced-execution/goal-planning) for the full verification + correction flow.

---

### `maxGoalCorrections?: number` (default: `1`) *(since v1.5.4)*

Maximum goal-verification corrective re-entries per run. Each correction re-enters the ReAct loop with full tool access so the model can *act* on what is missing. When the budget is exhausted and the goal is still unmet, a visible Goal Verification Warning is appended instead. Set to `0` to disable corrective re-entry.

---

### `enableContinuationPlanning?: boolean`

Enables the structured multi-step continuation planner. When active, the agent follows a declared sequence of tool steps with explicit dependencies, rather than improvising the sequence itself.

```typescript
const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  enableContinuationPlanning: true,
  continuationStrategy: 'sequential',
});

session.setPlan([
  { stepId: 'fetch',   toolName: 'fetch_data',   description: 'Fetch data',   dependsOn: [] },
  { stepId: 'analyze', toolName: 'analyze_data', description: 'Analyze data', dependsOn: ['fetch'] },
  { stepId: 'report',  toolName: 'write_report', description: 'Write report', dependsOn: ['analyze'] },
]);
```

> See [Continuation Planning →](/docs/advanced-execution/continuation-planning) for the full guide including `outputKey`, `inputMapping`, conditional steps, and dependency failure propagation.

---

### `continuationStrategy?: string`

The execution strategy for continuation planning:

| Value | Behavior |
|---|---|
| `'sequential'` | Steps run one after another in dependency order |
| `'parallel'` | Steps whose dependencies are met run simultaneously |
| `'conditional'` | Steps with unmet `condition` fields are skipped |

---

## Routing (MetaRouter) *(since v1.6.0)*

### `enableRouting?: boolean` (default: `false`)

Runs a router once per turn, before the ReAct loop, to classify the message (`chat`/`task`) and select relevant tool categories. Tools whose `category` is not selected are hidden from the model for that turn; a `chat` verdict also suppresses goal planning/verification for the turn. Uses the built-in `LLMRouter` unless a custom `router` is supplied.

```typescript
const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  enableRouting: true,
  routerModel: 'gpt-4o-mini',
  alwaysAvailableCategories: ['scratchpad'],
  tools: [/* … tools with `category` fields … */],
});
```

| Field | Type | Default | Purpose |
|---|---|---|---|
| `router` | `IRouterAdapter` | — | Custom router; takes precedence over the built-in one |
| `routerModel` | `string` | `model` | Model used by the built-in `LLMRouter` |
| `alwaysAvailableCategories` | `string[]` | `[]` | Categories always exposed regardless of the decision |

> See [Routing (MetaRouter) →](/docs/advanced-execution/routing) for the full guide including custom routers and observability.

---

## Tool Execution Controls

### `parallelToolCalls?: boolean` (default: `false`)

When `true`, independent tool calls within a single assistant response are executed in parallel using `Promise.all`. This can significantly reduce latency when the model requests multiple tools in one iteration.

```typescript
const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  parallelToolCalls: true,
  toolExecutionBudget: { maxConcurrentCalls: 4 },
});
```

---

### `toolRegistryTimeoutMs?: number` (default: `30_000`)

Default timeout in milliseconds for every tool execution. Individual tools can override this with their own `timeoutMs` field (since v1.5.1). When exceeded, `LemuraToolTimeoutError` is thrown and the agent receives a structured error observation.

---

### `toolExecutionBudget?: ToolExecutionBudget`

Enforces call quotas at the session level:

```typescript
toolExecutionBudget: {
  maxCallsPerSession: 100,      // total tool calls for the entire session
  maxCallsPerTool: {
    search_web:  10,             // search_web can be called max 10 times per session
    run_command:  3,             // shell tool limited to 3 calls
  },
  maxConcurrentCalls: 4,        // max parallel executions when parallelToolCalls: true
}
```

---

## Tool Response Processing

### `toolResponseProcessor?: IToolResponseProcessor`

Controls how large tool responses are evaluated and compressed before being injected into the context. The built-in `ToolResponseProcessor` classifies results into four size tiers and compresses accordingly.

```typescript
import { ToolResponseProcessor } from 'lemura';

const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  toolResponseProcessor: new ToolResponseProcessor({
    smallMaxTokens:  200,    // verbatim if ≤ 200 tokens
    mediumMaxTokens: 800,    // verbatim if ≤ 800 tokens
    largeMaxTokens:  2_000,  // LLM-summarized if ≤ 2000 tokens
    // oversized (> 2000 tokens): extract relevant fragment
    budgetPercent: 0.15,     // combined tool responses ≤ 15% of maxTokens
  }),
});
```

> See [Tool Response Compression →](/docs/advanced-execution/tool-response-compression) for the full guide including custom processors.

---

### `maxTokensPerTool?: number`

Hard token cap per individual tool response, before the `toolResponseProcessor` runs. If a single tool result exceeds this, it is truncated first.

```typescript
maxTokensPerTool: 2_000    // no single tool response can exceed 2k tokens
```

---

## Completion & Prompt Settings

### `maxCompletionTokens?: number` (default: `4_000`)

Maximum tokens the provider may generate per `complete()` call. Separate from `maxTokens` (total context window). Raised from `2_000` to `4_000` in v1.5.4 — the previous default truncated long reasoning chains mid-thought.

```typescript
maxCompletionTokens: 4_000
```

---

### `staticSystemPrompt?: boolean` (default: `false`) *(since v1.5.1)*

When `true`, the system prompt is built once and kept identical across all ReAct iterations. Dynamic content (continuation plan status, per-turn goal injection) is moved to the last user/tool message instead, so the KV-cache prefix is never invalidated between turns. Recommended for reasoning models and long agentic runs.

```typescript
staticSystemPrompt: true
```

---

## Configuration Profiles

### Quick Q&A Agent (tight limits, fast responses)

```typescript
const session = new SessionManager({
  adapter, model: 'gpt-4o-mini', maxTokens: 32_000,
  maxIterations: 3,
  maxSteps: 5,
  maxCompletionTokens: 500,
  toolRegistryTimeoutMs: 10_000,
});
```

### Research Agent (generous limits, deep reasoning)

```typescript
const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 200_000,
  maxIterations: 25,
  maxSteps: 50,
  enableGoalPlanning: true,
  goalInjectionFrequency: 'always',
  enableContinuationPlanning: true,
  continuationStrategy: 'sequential',
  parallelToolCalls: false,
  toolResponseProcessor: new ToolResponseProcessor({ budgetPercent: 0.15 }),
});
```

### Workflow Automation (balanced + structured)

```typescript
const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  maxIterations: 8,
  maxSteps: 15,
  enableContinuationPlanning: true,
  continuationStrategy: 'sequential',
  parallelToolCalls: true,
  toolExecutionBudget: { maxConcurrentCalls: 4, maxCallsPerSession: 50 },
});
```

---

## Tips & Tricks

> **Tip:** Start with the defaults (`maxIterations: 10, maxSteps: 20`) and tune based on observed behavior. Log how many steps your typical tasks actually use — 80% of real workloads finish in under 5 steps.

> **Tip:** Prefer `maxSteps` over `maxIterations` for cost control in production. `maxSteps` counts actual external service calls and always produces a graceful final response rather than throwing an error.

> **Tip:** Enable `enableGoalPlanning` only for tasks where the agent must stay focused across many turns or compressions. For simple single-tool queries, the mini-planning LLM call adds unnecessary latency.

> **Tip:** Use `toolExecutionBudget.maxCallsPerTool` to prevent tool abuse. An agent that can call `search_web` 50 times per session can run up significant API costs — cap expensive tools with per-tool limits.
