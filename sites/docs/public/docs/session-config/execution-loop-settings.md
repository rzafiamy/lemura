# Execution & Loop Control

lemura provides granular control over the ReAct loop to prevent runaway costs and ensure high-quality reasoning.

## Loop Constraints

### `maxIterations: number` (default: 10)
Limits the number of full "Reasoning → Action → Observation" cycles. If the agent enters an infinite loop or fails to reach a goal, this protects your API budget.

- **Low (3-5)**: Best for simple, one-shot tasks (e.g., "summarize this").
- **High (15-25)**: Necessary for deep research agents or coding agents that need many tool steps.

### `maxSteps: number` (default: 20) ✅ Wired in v1.2.0
Limits the total number of **tool calls** permitted across all iterations. Unlike `maxIterations`, reaching `maxSteps` triggers a **graceful final response** instead of an error — the model is prompted to conclude with the mandatory output structure.

```typescript
const session = new SessionManager({
  maxIterations: 10,  // max full ReAct cycles
  maxSteps: 15,       // max individual tool calls — triggers graceful exit
  // ...
});
```

---

## Planning & Logic

### `enableGoalPlanning: boolean` ✅ Wired in v1.2.0
When true, lemura initialises a `GoalInjector` on the first `run()` call. The user's message becomes the goal and is injected into the system prompt (or as a `pre_turn` message) on every iteration, keeping the model focused even after context compression.

### `goalInjectionFrequency: string`
- `always`: (Default) Inject goal context every single turn.
- `every_N_turns`: Inject every 2nd or 3rd turn to save tokens.
- `on_compression`: Only re-inject goals after a compression event.

### `goalInjectionPosition: string`
- `system_prompt`: *(Default)* Goal is prepended to the system prompt on each iteration.
- `pre_turn`: Goal is injected as a synthetic `system` message just before the provider call.

### `enableContinuationPlanning: boolean`
Enables the agent to plan multiple tool calls at once (parallel or sequential). See [Continuation Planning](/docs/advanced-execution/continuation-planning) for details.

```typescript
continuationStrategy: 'parallel' | 'sequential' | 'conditional'
```

---

## Tool Execution Controls (New in v1.2.0)

### `parallelToolCalls: boolean` (default: false)
When `true`, independent tool calls within a single assistant turn are executed in parallel via `Promise.all`. This can significantly reduce latency for agents that request multiple tools at once.

```typescript
parallelToolCalls: true,
toolExecutionBudget: { maxConcurrentCalls: 4 }  // max 4 at once
```

### `toolRegistryTimeoutMs: number` (default: 30 000)
Sets the default timeout in milliseconds for every tool call. Individual tools can override this by setting a `timeoutMs` property. When exceeded, a `LemuraToolTimeoutError` is thrown and the agent receives a structured error observation.

### `toolExecutionBudget: ToolExecutionBudget`
Enforces call quotas at the session level:

```typescript
toolExecutionBudget: {
  maxCallsPerSession: 100,          // total tool calls for the session
  maxCallsPerTool: {
    search_web: 10,                 // search_web can be called at most 10 times
    run_code: 5,                    // run_code at most 5 times
  },
  maxConcurrentCalls: 4,            // max parallel executions when parallelToolCalls: true
}
```

When a quota is exceeded, a `LemuraMaxIterationsError` is thrown and the session halts.

---

## Tool Response Processing ✅ Wired in v1.2.0

### `toolResponseProcessor: IToolResponseProcessor`
Controls how large tool responses are compressed before being added to context. The default processor automatically truncates responses classified as `large` or `oversized`.

```typescript
import { ToolResponseProcessor } from 'lemura';

const session = new SessionManager({
  toolResponseProcessor: new ToolResponseProcessor(),
  maxTokensPerTool: 2_000,  // hard token cap per tool response
});
```

See [Tool Response Compression](/docs/advanced-execution/tool-response-compression) for full configuration.
