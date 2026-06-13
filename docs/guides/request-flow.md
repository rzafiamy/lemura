# Request Flow — From User Message to Final Output

## What this is

This guide traces a single user request through every stage of the lemura runtime, from
the moment `session.run(message)` (or `session.stream(message)`) is called until the
final assistant string is returned.

The entry point is [`SessionManager`](../../src/agent/SessionManager.ts) — it owns the
full ReAct loop. There is no separate `ReActAgent` class; the loop lives inside
`SessionManager._executeLoop()` (for `run()`) and `SessionManager.stream()` (for
streaming). Both share the same staged pipeline described below.

> **Components involved:** `SessionManager`, `ContextManager`, `ToolRegistry`,
> `SkillInjector`, `MCPClientRegistry`, `IRouterAdapter` (LLMRouter), `GoalInjector`,
> `ContinuationPlanner`, `StepCounter`, `ToolResponseProcessor`, `ToolFirewall`,
> `IProviderAdapter`.

---

## High-level pipeline

```
session.run(message)
        │
        ▼
┌──────────────────────────────────────────────────────────────────────┐
│ STAGE 0 — Construction (once, in the constructor)                      │
│   build ContextManager, ToolRegistry, SkillInjector, StepCounter,     │
│   ToolResponseProcessor, Router?, GoalInjector?, register builtin/STM/ │
│   media tools, kick off async MCP connect (this.mcpReady)             │
└──────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────────────────────┐
│ STAGE 1 — Pre-flight (per run)                                         │
│   await mcpReady → ensureScratchpadLoaded → routing step →            │
│   goal init + mini-planning → push user turn                          │
└──────────────────────────────────────────────────────────────────────┘
        │
        ▼
╔══════════════════════════════════════════════════════════════════════╗
║ STAGE 2 — ReAct LOOP   (while iterations < maxIterations)              ║
║                                                                        ║
║   2a. recount tokens → ContextManager.prepare() (compression)         ║
║   2b. buildSystemPrompt (goal + plan + skills)                        ║
║   2c. buildMessages (history → NormalizedMessage[])                   ║
║   2d. maxSteps guard → maybe inject forced-conclusion prompt          ║
║   2e. adapter.complete({ messages, tools: getActiveTools() })         ║
║   2f. branch on finishReason:                                         ║
║         ├─ 'tool_call' → firewall → execute → observe → loop (2a)     ║
║         └─ 'stop'/'max_tokens'/'error' → STAGE 3                      ║
╚══════════════════════════════════════════════════════════════════════╝
        │
        ▼
┌──────────────────────────────────────────────────────────────────────┐
│ STAGE 3 — Conclusion                                                   │
│   push final assistant turn → goal verification →                     │
│     ├─ incomplete + budget → corrective user turn → back to STAGE 2   │
│     └─ done/exhausted → return string (run) / yield string (stream)   │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Stage 0 — Construction (`constructor`)

Runs once when you `new SessionManager(config)`. No LLM calls happen here.

| Step | What happens | Code |
|---|---|---|
| Wire core services | Instantiates `ContextManager`, `ToolRegistry` (with `defaultTimeoutMs`), `SkillInjector`, `MediaBridge`. | `SessionManager.ts:109-125` |
| Apply dynamic skills | `activeDynamicSkills` / `activeDynamicTags` are enabled on the injector. | `:116-123` |
| Step limits | Builds `StepCounter(maxSteps ?? 20)`; warns if `maxSteps` vs `maxIterations` are mismatched. | `:128-152` |
| Tool response processor | Uses a custom `toolResponseProcessor` or a default one. | `:155-159` |
| Register compression strategies | Each strategy in `config.compressionStrategies` is registered (sorted by `priority`). | `:161-163` |
| Router | If `enableRouting`, builds the custom `router` or a default `LLMRouter`. | `:166-172` |
| Built-in tools | If `stmRegistry` → registers STM + scratchpad tools; if `media.enableTools` → registers media tools. | `:175-191` |
| Initial context | Creates the empty `ContextWindow` (systemPrompt, empty turns, `maxTokens`). | `:193-200` |
| MCP | If `mcpServers` present, starts `_initMCP()` **asynchronously** and stores the promise as `this.mcpReady`. Tools register as servers connect. | `:203-206`, `:490-526` |
| Traces | Emits `session_init` + per-skill `skill_load` trace events via `onTrace`. | `:209-238` |

---

## Stage 1 — Pre-flight (per `run()` / `stream()`)

These steps run once at the start of every call, **before** the loop.

### 1.1 Await MCP readiness & load scratchpad
`run()` first `await this.mcpReady` so MCP tools are registered, then
`ensureScratchpadLoaded()` reads persisted scratchpad state from
`config.scratchpadAdapter` (honoring a pending clear from `reset()`).
→ `:1207-1211`, `:266-279`

### 1.2 Routing step (MetaRouter)
`_runRoutingStep(userMessage)` runs **first** so a `chat` verdict can suppress goal
planning/verification. It groups registered tools by `category`
(`buildToolCategories`) and asks the router which categories are relevant. The result
is stored in `this.routedCategories` (plus `alwaysAvailableCategories`). Uncategorized
tools are always available. Fail-safe: a null/failed decision disables routing (all
tools exposed). → `:550-590`, `:1460-1462`

### 1.3 Goal init + mini-planning
If `enableGoalPlanning` is on, no goal was set manually, and it is **not** a `chat`
turn, a `GoalInjector` is created with the user message as the goal statement. Then
`_runMiniPlanningStep()` makes **one LLM call** asking for `subGoals[]` and
`successCriteria[]` (JSON), stored on the goal. → `:1465-1481`, `:602-643`

### 1.4 Push the user turn
The user message (string or `ContentBlock[]`) becomes a `user` Turn appended to
`context.turns`, with an estimated token count. → `:1484-1492`

### 1.5 Loop setup
Resets `iterations = 0`, rebuilds the `StepCounter`, and sets
`correctionsRemaining = maxGoalCorrections ?? 1`. → `:1494-1500`

---

## Stage 2 — The ReAct loop

`while (this.iterations < maxIterations)` (default `maxIterations = 10`). Each pass is
one Reason→Act→Observe cycle.

### 2a. Token recount + context preparation
The token count is recomputed from all turns + system prompt, then
`ContextManager.prepare(context)` runs. `prepare()`:
1. Re-derives `tokenCount` from turns,
2. Iterates registered strategies in priority order, applying each where
   `shouldApply()` is true (immutably — each returns a **new** `ContextWindow`),
3. Throws `LemuraContextOverflowError` if still over `maxTokens` after all strategies.

→ `:1507-1510`, `ContextManager.ts:29-60`

> Goal and continuation-plan state live in `context.metadata` so compression never
> drops them.

### 2b. Build the system prompt
`buildSystemPrompt()` assembles, in order:
1. The base `systemPrompt`,
2. Goal block (if `goalInjectionPosition === 'system_prompt'` and due this turn),
3. Continuation-plan status block (if `enableContinuationPlanning`),
4. Injected skills via `SkillInjector.buildInjectionBlock('system_prompt', skillTokenBudget)`.

When `staticSystemPrompt` is on, dynamic goal/plan content is **not** put here — it is
appended to the latest user/tool message instead (to keep the KV-cache prefix stable).
→ `:706-746`

### 2c. Build the messages array
`buildMessages()` maps `context.turns` → `NormalizedMessage[]`, prepends the system
message, handles `pre_turn` goal injection, and (when `staticSystemPrompt`) appends
frozen `<lemura:agent-state>` blocks to the latest turn. → `:749-832`

### 2d. maxSteps guard
If `stepCounter.isMaxReached()`, a forced-conclusion system message
(`getForcedConclusionPrompt()` + the mandatory final-response structure) is appended,
and **tools are removed** from the provider call. → `:1516-1526`, `:1541`

### 2e. Provider call
`adapter.complete({ model, messages, tools: getActiveTools(), maxTokens })`.
`getActiveTools()` returns the router-filtered tool set (or all tools when routing is
off). Usage is added to `totalTokens`; failures are logged and rethrown. → `:1536-1557`

### 2f. Branch on `finishReason`

#### → `tool_call`: Act + Observe
1. `stepCounter.increment(toolCalls.length)`.
2. For each (or in concurrent batches when `parallelToolCalls`):
   - **Firewall** — `passesFirewall()` evaluates `config.toolFirewall`. Decision
     `deny` blocks; `ask` calls `onAsk` (fail-safe: only explicit accept proceeds).
     Blocked calls produce a "Blocked by tool firewall" observation. → `:964-1013`
   - **Execute** — `executeSingleToolCall()`:
     - Budget check (`maxCallsPerSession` / `maxCallsPerTool`). → `:835-869`
     - Continuation planner resolves `inputMapping` and marks the step running. → `:1028-1037`
     - `ToolRegistry.execute()` validates args against the JSON Schema, enforces the
       timeout (`LemuraToolTimeoutError`), and runs the tool.
     - Scratchpad updates are captured; **base64/binary blobs are stashed in STM** and
       replaced with refs. → `:1079-1106`
     - Result is JSON-serialized, token-capped (`maxTokensPerTool`), then evaluated &
       compressed by `ToolResponseProcessor` unless an error was detected. → `:1108-1126`
     - Continuation planner runs any step `verify`, then marks the step
       done/failed/retry and stores `outputKey` output. → `:1129-1190`
   - Tool errors become `Error: <msg>` observations (never silently swallowed).
3. The assistant turn (with `toolCalls`) and each `tool`-role observation turn are
   appended to `context.turns`; `onTurn` fires for each. → `:1632-1654`
4. `goalInjector.incrementTurn()`; optional sub-goal reconciliation every N rounds. → `:1656-1661`
5. `continue` → back to **2a**.

#### → `stop` / `max_tokens` / `error`: go to Stage 3
The response becomes the final assistant turn. → `:1665-1679`

### Loop exit guard
If the `while` condition is exhausted without a final answer, throw
`LemuraMaxIterationsError`. → `:1727-1735`

---

## Stage 3 — Conclusion & goal verification

After a `stop` finish:

1. The final assistant turn is appended and `onTurn` fires. → `:1671-1679`
2. **Goal verification** (`_verifyGoal`, only when `enableGoalPlanning` and not
   disabled):
   - Priority A: user-supplied `config.goalVerifier(goal, turns)`.
   - Fallback C: a built-in **LLM verifier** call against meaningful `successCriteria`
     (skipped for the generic auto-criterion), returning
     `{ achieved, reason, missing }`. → `:1749-1832`
3. **Correction branch** — if the goal is **not achieved**, there is an actionable
   `missing`, `correctionsRemaining > 0`, and iteration budget remains: decrement the
   budget, push a **corrective user turn** ("…use tools as needed… address what is
   still missing"), and `continue` back into **Stage 2** with full tool access. → `:1688-1706`
4. **Exhausted branch** — if unmet but no budget/actionable missing: append a visible
   `⚠️ Goal Verification Warning` block to the answer and return it. → `:1709-1719`
5. Otherwise: return `response.content` (the clean final answer). → `:1722-1723`

For `stream()`, the same logic runs, but the final answer is **buffered** (not yielded
live) so that a rejected/corrected attempt is never surfaced — only the single approved
answer is yielded at the end. → `:1354-1434`

---

## Two worked examples

### A. Simple question (no tools)

```
run("What is the capital of France?")
 → mcpReady, scratchpad loaded
 → routing: 'chat' verdict (or routing off) → goal planning suppressed
 → push user turn
 → iteration 1:
     prepare() (no compression needed)
     buildSystemPrompt + buildMessages
     adapter.complete() → finishReason 'stop', content "Paris."
 → no goal verification (chat turn)
 → return "Paris."
```

### B. Tool-using task with a goal

```
run("Summarize the latest sales report from the data store")
 → routing: selects 'data' category → only data tools exposed
 → enableGoalPlanning: GoalInjector created, mini-planning → subGoals + criteria
 → push user turn
 → iteration 1:
     complete() → tool_call: rag_query({...})
       firewall: allow → execute → ToolResponseProcessor compresses the large result
     append assistant(toolCalls) + tool(observation) turns
 → iteration 2:
     prepare() (maybe HistoryCompression fires if near maxTokens)
     complete() → 'stop' with the summary
     _verifyGoal(): criteria met? → achieved
 → return the summary
```

---

## When things go wrong

| Symptom | Likely stage | Where to look |
|---|---|---|
| `LemuraMaxIterationsError` | Loop never reached a `stop` (tool ping-pong, or goal corrections eating iterations). | Raise `maxIterations`; inspect tool outputs; check `maxGoalCorrections`. |
| `LemuraContextOverflowError` | `ContextManager.prepare()` couldn't get under `maxTokens`. | Add/strengthen a `MaxTokensCompressionStrategy`; lower `maxTokensPerTool`. |
| Tool never offered to the model | Router filtered out its category, or it has no `category` but routing expectations differ. | Check `enableRouting`, the tool's `category`, and `alwaysAvailableCategories`. |
| Tool silently blocked | `toolFirewall` returned `deny`/`ask`-without-handler. | Inspect `config.toolFirewall` and the `firewall_blocked` trace. |
| Goal never verified | `enableGoalPlanning` off, `chat` route verdict, or only the generic criterion present. | Enable goal planning; ensure real `successCriteria`; check the route mode. |

---

## See also

- [Advanced execution techniques](../../.agent/rules/Advanced-execution.md) — maxSteps,
  tool-response compression, continuation planning, goal injection.
- [Context management rules](../../.agent/rules/Context-management.md) — the strategy
  stack applied in Stage 2a.
- API reference: [`docs/api/`](../api/).
