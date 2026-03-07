---
trigger: always_on
---

# lemura — Advanced Agent Execution Techniques

## Overview

Five runtime techniques governing how the ReAct agent executes, recovers, and concludes. Distinct from context compression (memory) — these are about **execution discipline**.

---

## 1. Tool Response Compression & Evaluation

### Size classification

| Class | Token estimate | Action |
|---|---|---|
| `small` | < 200 | Inject verbatim |
| `medium` | 200–800 | Inject verbatim, flag for future compression |
| `large` | 800–2000 | Summarize to facts relevant to current goal |
| `oversized` | > 2000 | Extract only the directly relevant fragment |

### ToolResponseProcessor interface

```
ToolResponseProcessor {
  evaluate(response, tool, context): ToolResponseEvaluation
  compress(response, evaluation): string
}

ToolResponseEvaluation {
  relevanceScore: number        // 0–1
  sizeClass: 'small'|'medium'|'large'|'oversized'
  shouldCompress: boolean
  suggestedMaxTokens: number
  answered: boolean             // did the tool answer what was asked?
  answeredPartially: boolean
  errorDetected: boolean        // error signal even if HTTP 200
  suggestedAction: 'continue'|'retry'|'retry_with_params'|'skip'|'escalate'
}
```

### Compression strategies
- **Extractive**: keep sentences/fields mentioning current goal entities
- **Truncative**: first N + last M tokens (for structured data)
- **Structured**: keep only fields referenced in the tool's output schema
- **Summarized**: provider call — "Summarize in max {N} tokens, focusing on {goal_keywords}"

### Rules
- Always evaluate before compressing — empty result ≠ error result
- `errorDetected: true` responses are always injected as observations, never dropped
- `SessionConfig.toolResponseTokenBudget` default: 15% of `maxTokens`
- If cumulative tool responses in one iteration exceed the budget, compress oldest results first

---

## 2. maxSteps Enforcement & Final Response Formulation

### maxSteps vs maxIterations

| Field | Counts | On exceeded |
|---|---|---|
| `maxIterations` | Full ReAct cycles | Throws `LemuraMaxIterationsError` |
| `maxSteps` | Individual tool calls | Forces graceful final response |

`maxSteps` default: `20`. `maxIterations` default: `10`.

### Forced-conclusion injection (when `toolCallCount >= maxSteps`)

```
"You have used {toolCallCount}/{maxSteps} steps. Provide your final response now.
Do not call any more tools. Use the required structure below."
```

Tool definitions are removed from the provider call payload in final-response mode.

### Mandatory final response format

All conclusions — natural or forced — MUST use this structure:

```
## Goal Status: [ACHIEVED | PARTIALLY_ACHIEVED | FAILED]

### What was accomplished
[Summary of completed work]

### Remaining tasks
[Bulleted list, or "None"]

### Failed steps
[Tool/step name + error context, or "None"]

### Result
[The actual answer or deliverable]
```

### Natural conclusion detection
`finishReason === 'stop'` AND no tool call AND response has substantive content.

---

## 3. Tool Continuation Strategy

### ContinuationPlan type

```
ContinuationPlan {
  steps: ContinuationStep[]
  currentStepIndex: number
  strategy: 'sequential'|'parallel'|'conditional'
}

ContinuationStep {
  stepId: string
  toolName: string
  description: string
  dependsOn: string[]           // stepIds required before this step runs
  status: 'pending'|'running'|'done'|'failed'|'skipped'
  outputKey?: string            // store result under this key
  inputMapping?: Record<string, string>  // { param: 'priorStep.outputKey' }
}
```

Plan is stored in `context.metadata['continuationPlan']` — **never removed by compression strategies**.

### Strategies
- **Sequential**: steps run in declared order; each step's output feeds downstream via `inputMapping`
- **Parallel**: steps with no mutual `dependsOn` are batched into one provider call
- **Conditional**: step only runs if a prior step's output meets a declared condition

### Dependency rules
- A step cannot run until all `dependsOn` steps are `done`
- If a step is `failed`, all steps that depend on it become `skipped`
- Resolved `inputMapping` values are validated against the tool's JSON Schema before injection
- Prior step outputs stored in `context.metadata['toolOutputs'][outputKey]`

### Plan status injection (before every iteration)

```
[CONTINUATION PLAN — Step 2/4]
✅ Step 1 (search_documents): Done
▶  Step 2 (extract_entities): Running
⏳ Step 3 (cross_reference): Waiting on Step 2
⏳ Step 4 (generate_report): Waiting on Step 3
```

---

## 4. Goal Injection & Maintenance

### Goal type

```
Goal {
  id: string
  statement: string             // original user request verbatim
  decomposition: string[]       // sub-goals from planning step
  successCriteria: string[]     // binary conditions for "done"
  injectionFrequency: 'always'|'every_N_turns'|'on_compression'
  injectionPosition: 'system_prompt'|'pre_turn'
}
```

Stored in `context.metadata['goal']`. **Never compressed away.** Re-injected after every compression event at minimum.

### Injection format

```
[CURRENT GOAL]
{goal.statement}

Success criteria:
- {criterion}

Sub-goals remaining:
- {uncompleted sub-goals}
[/CURRENT GOAL]
```

### Mini-planning (when `enableGoalPlanning: true`)

Runs before the first tool call. Prompt:

```
Given this goal: "{userMessage}"
1. List sub-goals needed (max 5, specific)
2. List success criteria — what does "done" look like? (max 3, binary)
Respond ONLY with JSON: { "subGoals": string[], "successCriteria": string[] }
```

Parse → store as `Goal` → inject into system prompt → begin execution.

### Goal self-evaluation (before final response)
A dedicated provider call: "Have I met all success criteria?"
- All met → `ACHIEVED`
- Some met → `PARTIALLY_ACHIEVED`, unmet criteria go in `Remaining tasks`
- None met → `FAILED`

This is a model call, not a heuristic.

---

## 5. Skill Size Management

### Tiers

| Tier | Max tokens | Content |
|---|---|---|
| `nano` | ≤ 100 | Role definition only |
| `micro` | ≤ 300 | Role + top 3–5 rules |
| `standard` | ≤ 800 | Full skill content |
| `extended` | ≤ 2000 | Full + examples (lazy only) |

`SessionConfig.skillTokenBudget` default: 10% of `maxTokens`.

### Skill frontmatter fields

```yaml
---
name: my-skill
description: ...
inject: system_prompt
priority: 10
tier: standard
nano: |
  You are a {role} who always {core behavior}.
micro: |
  You are a {role}. Rules: {rule 1}. {rule 2}. {rule 3}.
---
```

### Size reduction algorithm

1. Sort skills by priority ascending (lowest number = highest priority)
2. Fit each skill at `standard` tier
3. Budget remaining < standard size → downgrade to `micro`
4. Budget remaining < micro size → downgrade to `nano`
5. Budget remaining < nano size → skip (log warning)
6. Skills with `priority < 5` are **never skipped**

### Lazy loading rule
Extended-tier examples live in `examples/` subdirectory. They are **never auto-injected** — the agent reads them with `view` during execution only when actively needed.

### Authoring rule
Write the `nano` fallback first. If you can't express the skill's most important instruction in one sentence, the skill is not focused enough. Shared rules across skills belong in one base skill — never duplicated.

---

## SessionConfig fields (all five techniques)

```ts
interface SessionConfig {
  // Tool response
  toolResponseTokenBudget?: number          // default: 0.15 * maxTokens
  toolResponseProcessor?: IToolResponseProcessor

  // Step limits
  maxSteps?: number                         // default: 20
  maxIterations?: number                    // default: 10

  // Continuation
  enableContinuationPlanning?: boolean      // default: false
  continuationStrategy?: 'sequential'|'parallel'|'conditional'

  // Goal
  enableGoalPlanning?: boolean              // default: false
  goalInjectionFrequency?: Goal['injectionFrequency']   // default: 'always'
  goalInjectionPosition?: Goal['injectionPosition']     // default: 'system_prompt'

  // Skills
  skillTokenBudget?: number                 // default: 0.10 * maxTokens
}
```