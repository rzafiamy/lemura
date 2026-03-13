# Goal Planning & Injection

Goal planning is lemura's solution to **goal drift** — the tendency of agents to forget their original objective after many tool calls and context compressions.

---

## The Problem: Goal Drift

Here's a real failure pattern without goal injection:

```
Turn 1 (user):    "Research Q4 2025 EV market trends and create a summary report"
Turn 2 (agent):   "I'll search for EU market data first..."
Turn 3-6:         [Tool calls, data gathering]
Turn 7:           [Context compressed — initial user message summarized]
Turn 8 (agent):   "I found some data about Tesla's US sales..."
Turn 10 (agent):  "Here's information about battery technology..."
Turn 12 (agent):  "Done!" ← But never created the report, forgot about EU/China
```

Goal injection prevents this by keeping the original objective visible throughout.

---

## Enabling Goal Planning

```typescript
const session = new SessionManager({
  adapter,
  model: 'gpt-4o',
  maxTokens: 128_000,
  enableGoalPlanning: true,
  goalInjectionFrequency: 'always',       // re-inject before every provider call
  goalInjectionPosition: 'system_prompt', // append to system prompt
});
```

When `enableGoalPlanning: true`, lemura automatically runs a **mini-planning step** before the first tool call to decompose the user's message into sub-goals and success criteria.

---

## The Mini-Planning Step

When `enableGoalPlanning` is true and no manual goal has been set, lemura sends one extra LLM call before the first ReAct iteration:

```
Given this goal: "Research Q4 2025 EV market trends and create a summary report"

1. List the sub-goals needed to achieve this (max 5, be specific)
2. List success criteria — what does "done" look like? (max 3, binary, measurable)

Respond ONLY with valid JSON: { "subGoals": string[], "successCriteria": string[] }
```

For the EV market research example:
```json
{
  "subGoals": [
    "Search for Q4 2025 EU EV market sales data",
    "Search for Q4 2025 US EV market sales data",
    "Search for Q4 2025 China EV market sales data",
    "Compile comparison statistics across all three markets",
    "Write a structured summary report"
  ],
  "successCriteria": [
    "Summary covers EU, US, and China markets with specific figures",
    "Report includes sources for all statistics",
    "Output is a formatted markdown document, 500-1000 words"
  ]
}
```

> **Performance note:** The mini-planning step adds one LLM call per session. For simple, single-turn queries this is unnecessary overhead — only enable it for multi-step research or workflow tasks.

---

## The Goal Injection Block

The goal is stored in `context.metadata['goal']` and injected before every provider call:

```
[CURRENT GOAL]
Research Q4 2025 EV market trends and create a summary report

Success criteria:
- Summary covers EU, US, and China markets with specific figures
- Report includes sources for all statistics
- Output is a formatted markdown document, 500-1000 words

Sub-goals remaining:
- Search for Q4 2025 EU EV market sales data ← pending
- Compile comparison statistics across all markets ← pending
- Write a structured summary report ← pending

Sub-goals completed:
- ✅ Search for Q4 2025 US EV market sales data
- ✅ Search for Q4 2025 China EV market sales data
[/CURRENT GOAL]
```

This block:
- **Survives context compression** — it's in `context.metadata`, which is never compressed
- **Is re-injected on every turn** (or per `goalInjectionFrequency` setting)
- **Updates dynamically** — call `session.goalInjector?.markSubGoalDone(subGoal)` to move sub-goals to the completed section

---

## Goal Injection Frequency Options

```typescript
// Always inject (recommended for most agents)
goalInjectionFrequency: 'always'

// Every N turns (good for very long sessions to save tokens)
goalInjectionFrequency: 'every_N_turns'
goalInjectionN: 3   // re-inject every 3 iterations (default: 3)

// Only after compression events (minimum injection — least reliable)
goalInjectionFrequency: 'on_compression'
```

> **Warning:** `'on_compression'` is the weakest guarantee. If compression hasn't triggered yet, the goal won't be re-injected. Only use for agents where goal drift is acceptable.

---

## Injection Position

```typescript
// Append to system prompt (default, most common)
goalInjectionPosition: 'system_prompt'
// → Goal appears at the end of the system prompt

// Inject as pre-turn synthetic message (highest visibility)
goalInjectionPosition: 'pre_turn'
// → Goal appears as a system message just before each provider call
// → More visible to the model but costs slightly more tokens
```

---

## Manual Goal Setting — `session.setGoal()`

Skip the mini-planning step and set the goal structure directly:

```typescript
// For when you know the structure upfront
session.setGoal({
  statement: 'Audit the authentication module and produce a security report',
  decomposition: [
    'Read all files in src/auth/',
    'Identify SQL injection risks',
    'Identify XSS risks',
    'Check session management implementation',
    'Write security report',
  ],
  successCriteria: [
    'Report covers all 5 audit areas',
    'Each finding includes a severity rating and recommended fix',
    'Report is formatted in markdown with a summary table',
  ],
});

const report = await session.run(
  'Begin the security audit of the authentication module.'
);
```

`setGoal()` stores the goal in `context.metadata['goal']` immediately and skips the auto-planning LLM call on `run()`.

---

## Accessing Goal Data

Inspect the current goal state at any time:

```typescript
const context = session.getContext();
const goal = context.metadata['goal'] as {
  statement: string;
  decomposition: string[];
  successCriteria: string[];
  completedSubGoals: string[];
} | undefined;

if (goal) {
  const remaining = goal.decomposition.filter(
    sg => !goal.completedSubGoals.includes(sg)
  );
  console.log(`Goal progress: ${goal.completedSubGoals.length}/${goal.decomposition.length} sub-goals done`);
  console.log('Remaining:', remaining);
}
```

---

## Marking Sub-Goals Complete

Mark sub-goals as done so they appear in the "completed" section of the injection block:

```typescript
// After verifying a sub-goal is complete:
session.goalInjector?.markSubGoalDone('Search for Q4 2025 US EV market sales data');

// Or retrieve the goal from context and update via setGoal()
const ctx = session.getContext();
const goal = ctx.metadata['goal'] as { completedSubGoals: string[] } | undefined;
console.log('Completed:', goal?.completedSubGoals);
```

---

## Tips & Tricks

> **Tip:** For very complex tasks, break them into sub-sessions. Complete "Phase 1: Data Gathering" in one session, then start a fresh session for "Phase 2: Report Writing" — manually injecting the Phase 1 summary as context. This avoids very long single sessions.

> **Tip:** The mini-planning step costs tokens (one extra LLM call). For simple queries, skip `enableGoalPlanning` and only enable it for multi-step research or workflow tasks.

> **Tip:** Set `goalInjectionPosition: 'pre_turn'` for agents that need maximum goal adherence — the goal is literally the last thing the model reads before deciding its next action.

> **Tip:** Combine with `continuationPlanning` for maximum orchestration power: the plan provides the step-by-step structure, and the goal keeps the overarching objective in focus.
