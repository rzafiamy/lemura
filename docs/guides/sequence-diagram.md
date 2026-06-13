# Sequence Diagram

## What this is

The temporal view of a single request: the exact order of messages exchanged between
`SessionManager` and its collaborators from `run(message)` to the returned answer. It
mirrors the stages in [request-flow.md](request-flow.md), but as interaction sequences.

Two diagrams are provided:
1. **Full `run()`** — the complete ReAct loop including a tool round and goal
   verification.
2. **`stream()` differences** — how streaming buffers the final answer before yielding.

---

## 1. Full `run()` — tool round + goal verification

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant SM as SessionManager
    participant MCP as MCPClientRegistry
    participant RT as Router / LLMRouter
    participant GI as GoalInjector
    participant CM as ContextManager
    participant SK as SkillInjector
    participant SC as StepCounter
    participant AD as IProviderAdapter
    participant FW as ToolFirewall
    participant TR as ToolRegistry
    participant TP as ToolResponseProcessor

    User->>SM: run(message)

    Note over SM,MCP: Stage 1 — Pre-flight
    SM->>MCP: await mcpReady
    SM->>SM: ensureScratchpadLoaded()
    SM->>RT: route(message, categories)
    RT->>AD: complete(routing prompt)
    AD-->>RT: RouterDecision {mode, categories}
    RT-->>SM: decision → routedCategories

    alt enableGoalPlanning and mode != 'chat'
        SM->>GI: new GoalInjector(statement)
        SM->>AD: complete(mini-planning prompt)
        AD-->>SM: { subGoals, successCriteria }
        SM->>GI: updateDecomposition(...)
    end
    SM->>SM: push user turn

    loop ReAct loop (iterations < maxIterations)

        Note over SM,SK: Stage 2 — prepare + build
        SM->>CM: prepare(context)
        CM->>CM: apply compression strategies (by priority)
        CM-->>SM: new ContextWindow
        SM->>GI: shouldInjectThisTurn() → goal block
        SM->>SK: buildInjectionBlock('system_prompt', budget)
        SK-->>SM: skills block
        SM->>SC: isMaxReached()?
        alt maxSteps reached
            SM->>SM: append forced-conclusion prompt, drop tools
        end

        Note over SM,AD: Stage 2e — provider call
        SM->>AD: complete({ messages, tools: getActiveTools() })
        AD-->>SM: CompletionResponse {finishReason, ...}

        alt finishReason == 'tool_call'
            SM->>SC: increment(toolCalls.length)
            loop each tool call
                SM->>FW: evaluate(toolFirewall, name, args)
                alt decision == deny / ask→deny
                    FW-->>SM: blocked → observation
                else allowed
                    SM->>SM: checkExecutionBudget(name)
                    SM->>TR: execute(name, args, ctx)
                    Note right of TR: validate schema · timeout guard · run
                    TR-->>SM: raw result
                    SM->>SM: stash blobs in STM, serialize, token-cap
                    SM->>TP: evaluate(content, tool)
                    TP-->>SM: evaluation
                    opt shouldCompress and !errorDetected
                        SM->>TP: compress(content, evaluation)
                        TP-->>SM: compressed content
                    end
                end
            end
            SM->>SM: push assistant(toolCalls) + tool(observation) turns
            SM->>GI: incrementTurn()
            Note over SM: continue → next iteration
        else finishReason == 'stop'
            Note over SM,AD: Stage 3 — conclusion
            SM->>SM: push final assistant turn
            opt enableGoalPlanning
                SM->>AD: complete(goal-verification prompt)
                AD-->>SM: { achieved, missing, reason }
                alt not achieved and budget and missing
                    SM->>SM: push corrective user turn
                    Note over SM: continue → re-enter loop with tools
                else unmet, budget exhausted
                    SM->>SM: append ⚠️ Goal Verification Warning
                end
            end
            SM-->>User: final answer (string)
        end
    end

    Note over SM,User: if loop exhausts → throw LemuraMaxIterationsError
```

---

## 2. How `stream()` differs

`stream()` follows the same pipeline, but the **final** assistant message is produced
via `adapter.stream()` and **buffered** — goal verification runs on the buffered text so
a rejected/corrected attempt is never surfaced. Only the single approved answer is
yielded.

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant SM as SessionManager
    participant AD as IProviderAdapter

    User->>SM: stream(message)
    Note over SM: ...same pre-flight + loop as run()...
    Note over SM: tool iterations use complete() (no live yielding)

    Note over SM,AD: final iteration → stream the answer
    SM->>AD: stream({ messages, stream: true })
    loop chunks
        AD-->>SM: CompletionChunk {delta, finished}
        SM->>SM: accumulate delta (buffer, do NOT yield yet)
    end

    opt finishReason == 'stop' and enableGoalPlanning
        SM->>AD: complete(goal-verification prompt)
        AD-->>SM: verdict
        alt not achieved and budget and missing
            SM->>SM: push corrective user turn
            Note over SM: continue loop — buffered attempt discarded
        else unmet, exhausted
            SM->>SM: append ⚠️ warning to buffer
        end
    end

    SM-->>User: yield accumulated (single approved answer)
```

---

## Reading notes

- **Two extra LLM calls are common per task turn** beyond the main loop: one for
  **routing** and one for **mini-planning** (only when `enableGoalPlanning`), plus one
  for **goal verification** at the end. A `chat`-mode route skips planning and
  verification entirely.
- **Compression runs every iteration** via `ContextManager.prepare()` — it is a no-op
  unless a strategy's `shouldApply()` returns true.
- **Tool errors are never swallowed** — they are pushed back as `tool`-role
  observations so the model can react on the next iteration.
- **`maxSteps` vs `maxIterations`**: the `StepCounter` counts individual tool calls and
  forces a graceful conclusion (tools dropped) when exceeded; `maxIterations` bounds the
  whole loop and throws `LemuraMaxIterationsError` if hit without a final answer.

---

## See also

- [Request flow](request-flow.md) — the same pipeline as a stage-by-stage narrative.
- [Class diagram](class-diagram.md) — the objects participating above.
- [Use case diagram](use-case-diagram.md) — the actors and goals behind a request.
