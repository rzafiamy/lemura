---
name: lemura-advanced-execution
description: Implements and debugs lemura's advanced agent execution techniques — tool response compression and evaluation, maxSteps enforcement with structured final response, tool continuation planning for sequential and dependent tool chains, goal injection and maintenance across compression boundaries, and skill size budget management. Use when working on any of these five runtime systems or debugging execution discipline issues.
---

# Lemura: Advanced Agent Execution Techniques

## When to use this skill

- Implementing `ToolResponseProcessor` or modifying tool response evaluation logic
- Working on `maxSteps` enforcement or final response formulation
- Building or debugging `ContinuationPlan` for sequential/dependent tool chains
- Implementing or tuning goal injection and mini-planning
- Managing skill token budget and tier-based size reduction
- Debugging: agent drifts from goal, tool chain breaks mid-sequence, final response is malformed

---

## Decision tree: which technique applies?

```
Tool returned too much data or irrelevant content?
  → Tool Response Compression & Evaluation

Agent won't stop / no structured conclusion / caller gets raw mid-thought?
  → maxSteps + Final Response Formulation

Tools need to run in order / tool B needs tool A's output?
  → Tool Continuation Strategy

Agent forgot the original goal mid-conversation or after compression?
  → Goal Injection & Maintenance

Skills are eating too much of the token budget?
  → Skill Size Management
```

---

## 1. Tool Response Compression & Evaluation

### Implementation checklist

- [ ] `ToolResponseProcessor` is injected into `SessionConfig.toolResponseProcessor`
- [ ] `evaluate()` classifies response into `small | medium | large | oversized`
- [ ] `evaluate()` sets `answered`, `answeredPartially`, `errorDetected`, `suggestedAction`
- [ ] `compress()` applies the correct strategy for the size class (see rules file)
- [ ] Compressed response respects `toolResponseTokenBudget` (default: 15% of `maxTokens`)
- [ ] `errorDetected: true` responses are still injected as observations — never silently dropped

### Key rule
**Always evaluate before compressing.** An empty result is different from an error result — the model needs to know which it got to recover correctly.

### Debugging tool response issues
- Log the raw response size vs compressed size using `[lemura:tools] response compressed`
- If `answered: false` appears repeatedly for the same tool → the tool's output schema may not match what the model expects
- If compression is removing relevant data → increase `toolResponseTokenBudget` or tune the extractive compression selector

---

## 2. maxSteps & Final Response Formulation

### Implementation checklist

- [ ] `toolCallCount` is incremented on every tool call (not just every iteration)
- [ ] When `toolCallCount >= maxSteps`, a forced-conclusion system turn is injected
- [ ] The forced-conclusion prompt instructs: no more tool calls, use the required format
- [ ] The final response always uses the structured format (Goal Status / Accomplished / Remaining / Failed / Result)
- [ ] Natural conclusion (before maxSteps) also uses the structured format
- [ ] `Goal Status` is one of: `ACHIEVED`, `PARTIALLY_ACHIEVED`, `FAILED`

### Final response injection prompt (exact wording)
```
You have used {toolCallCount} of {maxSteps} allowed steps.
You must now provide your final response. Do not call any more tools.

Your response MUST follow this structure:
## Goal Status: [ACHIEVED | PARTIALLY_ACHIEVED | FAILED]
### What was accomplished
### Remaining tasks
### Failed steps
### Result
```

### Debugging formulation issues
- If the model ignores the format → increase the injection prompt's position (move to `pre_turn` instead of appended system)
- If `Goal Status` is always `ACHIEVED` incorrectly → add goal self-evaluation step before final formulation
- If the model still calls tools after maxSteps injection → verify tool definitions are removed from the provider call payload in final-response mode

---

## 3. Tool Continuation Strategy

### Implementation checklist

- [ ] `ContinuationPlan` is generated when `enableContinuationPlanning: true`
- [ ] Plan is stored in `context.metadata['continuationPlan']`
- [ ] Plan status summary is injected before each iteration
- [ ] `dependsOn` resolution blocks a step from running until all dependencies are `done`
- [ ] `inputMapping` injects prior step outputs into current step params
- [ ] Failed steps mark all downstream dependents as `skipped`
- [ ] Parallel steps (no mutual dependencies) are batched into a single provider call

### Plan status injection format
```
[CONTINUATION PLAN — Step {current}/{total}]
✅ Step 1 ({toolName}): Done
▶  Step 2 ({toolName}): Running
⏳ Step 3 ({toolName}): Waiting on Step 2
❌ Step 4 ({toolName}): Skipped (dependency failed)
```

### Debugging sequence breaks
- If a step runs before its dependency completes → check `dependsOn` array, verify step IDs match exactly
- If `inputMapping` resolves to `undefined` → the prior step's `outputKey` was not stored correctly in `context.metadata['toolOutputs']`
- If the plan disappears after compression → `context.metadata` must be excluded from all compression strategies

---

## 4. Goal Injection & Maintenance

### Implementation checklist

- [ ] `Goal` object is created from user message at session start
- [ ] If `enableGoalPlanning: true`: planning step runs before first tool call to decompose goal
- [ ] Goal is stored in `context.metadata['goal']`
- [ ] Goal is re-injected according to `goalInjectionFrequency`
- [ ] Goal injection is **never removed by compression strategies** — it is always re-added after compression
- [ ] Self-evaluation prompt runs before final response formulation

### Goal injection format
```
[CURRENT GOAL]
{goal.statement}

Success criteria:
- {criterion 1}
- {criterion 2}

Sub-goals remaining:
- {uncompleted sub-goal 1}
[/CURRENT GOAL]
```

### Mini-planning prompt (when `enableGoalPlanning: true`)
Send this before the first tool call:
```
Given this goal: "{userMessage}"
1. List the sub-goals needed to achieve it (max 5, be specific)
2. List the success criteria — what does "done" look like? (max 3 criteria)
3. Respond ONLY with JSON: { "subGoals": string[], "successCriteria": string[] }
```

Parse the JSON, store as `Goal`, inject into system prompt, then begin execution.

### Debugging goal drift
- If the model drifts → switch `goalInjectionFrequency` from `on_compression` to `always`
- If goal injection is eating too many tokens → write a `nano` version of the goal (one sentence) and use it after the first 5 turns
- If self-evaluation is always wrong → make success criteria more concrete and binary (not "good quality" but "contains at least 3 examples")

---

## 5. Skill Size Management

### Implementation checklist

- [ ] Each skill has a `tier` field in frontmatter: `nano | micro | standard | extended`
- [ ] Each skill has inline `nano:` and `micro:` fallback content in frontmatter
- [ ] `SkillInjector` sorts skills by priority before fitting them into the budget
- [ ] Budget overflow triggers downgrade: `standard → micro → nano → skip`
- [ ] Skills with `priority < 5` are never skipped
- [ ] `extended` tier examples live in `examples/` and are never auto-injected
- [ ] Skill size reduction is logged: `[lemura:skills] skill downgraded to micro: {name}`

### Authoring a well-sized skill

**Write the `nano` fallback first.** If you can't express the skill's single most important instruction in one sentence, the skill is not focused enough.

```yaml
---
name: my-skill
description: ...
tier: standard
nano: |
  You are a {role} who always {core behavior}.
micro: |
  You are a {role} who always {core behavior}.
  Rules: {rule 1}. {rule 2}. {rule 3}.
---

# Full skill content here (standard tier)
...
```

### Debugging skill budget issues
- Log `[lemura:skills] budget` to see token allocation per skill
- If a critical skill is being skipped → lower its priority number (closer to 1)
- If total skill budget is always exceeded → audit skills for repetition (shared rules belong in one base skill)
- If `extended` tier content is needed at runtime → instruct the agent to `view` the examples file explicitly, not inject it upfront