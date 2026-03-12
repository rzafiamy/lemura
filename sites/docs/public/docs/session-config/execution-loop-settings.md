# Execution & Loop Control

lemura provides granular control over the ReAct loop to prevent runaway costs and ensure high-quality reasoning.

## Loop Constraints

### `maxIterations: number` (default: 10)
Limits the number of full "Reasoning → Action → Observation" cycles. If the agent enters an infinite loop or fails to reach a goal, this protects your API budget.

- **Low (3-5)**: Best for simple, one-shot tasks (e.g., "summarize this").
- **High (15-25)**: Necessary for deep research agents or coding agents that need many tool steps.

### `maxSteps: number` (default: 20)
Limits the total number of tool calls permitted across all iterations. Unlike `maxIterations`, reaching `maxSteps` triggers a **graceful final response** instead of an error.

---

## Planning & Logic

### `enableGoalPlanning: boolean`
When true, lemura performs a mini-planning step before the first turn. It breaks your goal into sub-goals and success criteria, injecting them into every turn to maintain focus.

### `goalInjectionFrequency: string`
- `always`: (Default) Inject goal context every single turn.
- `every_N_turns`: Inject every 2nd or 3rd turn to save tokens.
- `on_compression`: Only re-inject goals after a compression event has triggered.

### `enableContinuationPlanning: boolean`
Enables the agent to plan multiple tool calls at once (Parallel or Sequential).

```typescript
continuationStrategy: 'parallel' | 'sequential' | 'conditional'
```

- **Sequential**: Tools run one by one; later tools can use outputs from earlier ones.
- **Parallel**: Independent tools (e.g., searching 3 sites) run in a single batch call.
- **Conditional**: A second tool only runs if the first one returns specific data.
