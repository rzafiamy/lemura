# Advanced Runtime Execution

The ReAct loop's core mechanic — reason, call tool, observe, reason again — is straightforward. But a real production agent faces challenges that go beyond the basic cycle: tool results that are too large to fit in context, tasks with strict ordering dependencies between tool calls, goal drift when compression wipes out the original intent, and infinite loops when a tool fails repeatedly. Advanced execution is the collection of subsystems that make the ReAct loop **reliable** rather than just functional.

These techniques are not a single monolithic system — each one is independently configurable and addresses a distinct class of failure. **Tool Response Compression** prevents any single large API result from consuming the entire token budget. **maxSteps enforcement** guarantees the loop terminates even if the model never emits `finishReason: 'stop'`. **Continuation Planning** lets you express a multi-tool workflow as an explicit graph — with data flowing from one tool's output directly into the next tool's arguments. **Goal Injection** re-anchors the model to the original task before every provider call, preventing context compression from causing silent goal abandonment. **Goal Verification** then checks — after the loop reaches `stop` — whether the goal was *actually* achieved, and re-enters the loop with full tool access to fix what is missing. **Routing (MetaRouter)** classifies each turn as `chat` or `task` and narrows the exposed tool set to only the relevant categories. **Skill Budget Management** ensures behavioral instructions survive even on small-context models by automatically downgrading lower-priority skills when the token budget is tight.

You don't need all of them. A simple Q&A agent needs none. A research agent that runs five web searches needs response compression and maxSteps. A workflow automation agent that moves data across APIs needs continuation planning, goal injection, and verification. An assistant that mixes chit-chat with real tasks benefits from routing. The section structure below maps each technique to the problem it solves and the configuration key that enables it.

> **Makix example:** When a user asks _"Research the best flights to Tokyo, check my calendar, cross-reference my notes, and email me a summary"_ — that single message requires 4 tools running in sequence, goal maintenance across many turns, and compressed tool outputs that might otherwise overflow a 16K context. All five techniques activate to make this work reliably.

---

## The Techniques

| Technique | Problem it solves | Config key |
|---|---|---|
| **Tool Response Compression** | A flight search result floods the 16K context | `toolResponseProcessor` |
| **maxSteps Enforcement** | The agent loops forever if a calendar API fails | `maxSteps` |
| **Continuation Planning** | search → calendar → notes → email must run in strict order with data flow | `enableContinuationPlanning` |
| **Goal Injection** | The agent forgets the original task after context compression | `enableGoalPlanning` |
| **Goal Verification** | The agent claims "done" but silently skipped a required step | `enableGoalVerification` / `goalVerifier` |
| **Routing (MetaRouter)** | Chit-chat triggers phantom goals; too many tools confuse the model | `enableRouting` |
| **Skill Budget Management** | Too many skills exceed the 1,600-token skill budget | `skillTokenBudget` |

---

## In This Section

| Page | What it covers |
|---|---|
| [Tool Response Compression →](/docs/advanced-execution/tool-response-compression) | Size classification, compression strategies, `ToolResponseProcessor` config |
| [maxSteps Enforcement →](/docs/advanced-execution/max-steps) | `maxIterations` vs `maxSteps`, mandatory final response format |
| [Continuation Planning →](/docs/advanced-execution/continuation-planning) | `ContinuationPlan`, sequential/parallel/conditional strategies, dependency rules |
| [Goal Planning →](/docs/advanced-execution/goal-planning) | Goal injection, sub-goal tracking, verification, corrections, progress reconciliation |
| [Routing (MetaRouter) →](/docs/advanced-execution/routing) | `enableRouting`, chat/task classification, category-based tool narrowing, custom routers |

---

## How These Techniques Compose

The five techniques are applied at different points in the ReAct iteration:

```
session.run("Research flights, check calendar, update notes, email summary")
       │
       ├─ Router (enableRouting: true) classifies the turn
       │    → mode: 'task' (not chit-chat → full pipeline runs)
       │    → categories: [SEARCH, CALENDAR, NOTES, EMAIL]
       │    → only tools in those categories are exposed this turn
       │
       ├─ GoalInjector builds the goal block
       │    → "Complete task: Research flights... [sub-goals: 1. search, 2. calendar, ...]"
       │    → re-injected every iteration (enableGoalPlanning: true)
       │
       ├─ ContinuationPlanner builds the execution plan
       │    → step 1: search_flights → outputKey: 'flights'
       │    → step 2: get_calendar(date=flights.departure) → outputKey: 'events'
       │    → step 3: query_notes(context=flights+events) → outputKey: 'notes'
       │    → step 4: send_email(body=flights+events+notes)
       │
       ├─ [ReAct iteration N]
       │    ├─ ContextManager checks compression threshold
       │    ├─ adapter.complete() → finishReason: 'tool_call'
       │    ├─ ToolResponseProcessor classifies result
       │    │    → small (≤300 tokens): verbatim
       │    │    → medium (≤1000): verbatim + flagged
       │    │    → large (≤3000): LLM-summarized
       │    │    → oversized (>3000): truncated with notice
       │    └─ observation appended → loop back
       │
       ├─ maxSteps = 15 → graceful conclusion if loop exceeds 15 tool calls
       │
       └─ [finishReason: 'stop'] → GoalVerifier checks success criteria
            → achieved: false + budget left → re-enter loop (with tools) to fix
            → budget exhausted             → append ⚠️ Goal Verification Warning
            → achieved: true               → deliver the final answer
```

> Verification runs on the **buffered** final answer, before anything reaches the caller — a rejected attempt is silently corrected, so the user only ever sees the single approved response.

---

## Quick Reference — Full Production Config

This is the recommended setup for an agent that runs multi-step workflows on a 16K model:

```typescript
import {
  SessionManager,
  ToolResponseProcessor,
  SummaryInjectionStrategy,
  SandwichCompressionStrategy,
  HistoryCompressionStrategy,
} from 'lemura';

const session = new SessionManager({
  adapter,
  model: 'qwen3.5-4b',
  maxTokens: 16_000,

  // ── Iteration limits ───────────────────────────────────────────────
  maxIterations: 10,       // max ReAct iterations per session.run() call
  maxSteps: 15,            // max total tool calls across all iterations

  // ── Goal planning — never lose track of the task ───────────────────
  enableGoalPlanning: true,
  goalInjectionFrequency: 'always',   // re-inject goal every iteration
  goalInjectionPosition: 'pre_turn',  // inject before user turn
  goalProgressReconciliation: true,   // mark sub-goals done as they complete

  // ── Goal verification — confirm the goal was actually achieved ─────
  enableGoalVerification: true,       // default true when goal planning is on
  maxGoalCorrections: 1,              // re-enter the loop up to N times to fix gaps

  // ── Routing — classify the turn + narrow the tool set ──────────────
  enableRouting: true,                // uses the built-in LLMRouter
  routerModel: 'qwen3.5-4b',          // small/cheap model for classification
  alwaysAvailableCategories: ['scratchpad'],

  // ── KV-cache stability — recommended for long agentic runs ─────────
  staticSystemPrompt: true,           // freeze system prompt across iterations

  // ── Continuation planning — explicit multi-step execution ──────────
  enableContinuationPlanning: true,
  continuationStrategy: 'sequential', // 'sequential' | 'parallel' | 'conditional'

  // ── Tool response compression — cap individual results ────────────
  toolResponseProcessor: new ToolResponseProcessor({
    budgetPercent: 0.15,     // all tool results combined ≤ 15% of maxTokens (2,400 tokens)
    smallMaxTokens: 200,     // verbatim if under 200 tokens
    mediumMaxTokens: 600,    // verbatim + flagged if under 600 tokens
    largeMaxTokens: 2_000,   // LLM-summarized if under 2,000 tokens
  }),

  // ── Context compression — for long-running sessions ───────────────
  compressionStrategies: [
    new SummaryInjectionStrategy({ priority: 1 }),
    new SandwichCompressionStrategy(adapter, {
      priority: 2,
      triggerThreshold: 0.75,   // fire earlier on small 16K window
      preserveFirst: 3,
      preserveLast: 4,
      summaryMaxTokens: 300,
    }),
    new HistoryCompressionStrategy(adapter, {
      priority: 3,
      windowSize: 6,
      triggerAtPercent: 0.90,
    }),
  ],

  // ── Skill budget — 10% of 16K ─────────────────────────────────────
  skillTokenBudget: 1_600,
});
```

---

## Configuration Profiles

Different agent types need different subsets of these features:

**Simple Q&A agent** — no advanced execution needed:
```typescript
const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  maxIterations: 5,
  // no compression, no goal planning, no continuation planning
});
```

**Research agent** — response compression + iteration limit:
```typescript
const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  maxIterations: 20,
  maxSteps: 30,
  toolResponseProcessor: new ToolResponseProcessor({ budgetPercent: 0.12 }),
  compressionStrategies: [
    new SummaryInjectionStrategy({ priority: 1 }),
    new SandwichCompressionStrategy(adapter, { priority: 2, triggerThreshold: 0.80 }),
  ],
});
```

**Workflow automation agent** — all five techniques active:
```typescript
const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  maxIterations: 15,
  maxSteps: 25,
  enableGoalPlanning: true,
  goalInjectionFrequency: 'always',
  enableContinuationPlanning: true,
  continuationStrategy: 'sequential',
  toolResponseProcessor: new ToolResponseProcessor({ budgetPercent: 0.15 }),
  compressionStrategies: [
    new SummaryInjectionStrategy({ priority: 1 }),
    new SandwichCompressionStrategy(adapter, { priority: 2, triggerThreshold: 0.80 }),
    new HistoryCompressionStrategy(adapter, { priority: 3, triggerAtPercent: 0.92 }),
  ],
  skillTokenBudget: 12_800,
});
```

---

## Tips & Tricks

> **Tip:** Start with just `maxIterations` and `maxSteps`. Add `toolResponseProcessor` once you observe token spikes from tool results. Enable goal planning and continuation planning last — only when you confirm the agent is losing track of goals or executing steps out of order.

> **Tip:** `maxIterations` limits ReAct loop cycles per `session.run()` call. `maxSteps` limits cumulative tool calls across all iterations. For a single complex task, set `maxSteps` to roughly `maxIterations × average_tools_per_turn`.

> **Tip:** When `enableContinuationPlanning` is true, you can still call `session.setPlan()` before `session.run()` to pre-load an explicit plan rather than letting the model generate one. This is useful for deterministic workflows where you know exactly what tools to call.

> **Tip:** Pair `enableRouting` with `enableGoalPlanning`. A `chat` verdict from the router suppresses goal planning and verification for that turn — so casual messages don't trigger a phantom goal or a spurious verification warning, while real tasks still get the full pipeline.

> **Tip:** Goal verification is most valuable when success is *checkable*. Supply a `goalVerifier` callback for deterministic checks (a file exists, output contains a marker); otherwise lemura falls back to a built-in LLM check against `successCriteria`. Set `maxGoalCorrections: 0` to surface a warning instead of re-entering the loop.
