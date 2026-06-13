# Use Case Diagram

## What this is

The use case view of lemura — **who** interacts with the runtime and **what** they can
accomplish. lemura is a library, so its "actors" are the developer integrating it, the
end user whose messages flow through a session, and the external systems the runtime
talks to (the LLM provider, RAG store, and MCP servers).

The use cases below map to real public API surface on
[`SessionManager`](../../src/agent/SessionManager.ts) and the adapter interfaces.

---

## Actors

| Actor | Role |
|---|---|
| **Consumer Developer** | Configures and drives a `SessionManager` from application code. |
| **End User** | Sends messages that the consumer app forwards to `session.run()` / `stream()`. |
| **Provider (LLM)** | `IProviderAdapter` — completion, streaming, ASR/TTS/vision/image-gen. |
| **RAG Store** | `IRAGAdapter` — ingest & query (optional). |
| **MCP Server** | External tool servers bridged via `MCPClientRegistry` (optional). |
| **Tool / Skill Author** | Defines `IToolDefinition`s and skill markdown consumed by a session. |

---

## Diagram

```mermaid
flowchart LR
    dev["Consumer Developer"]
    user["End User"]
    author["Tool / Skill Author"]
    provider["Provider LLM"]
    rag["RAG Store"]
    mcp["MCP Server"]

    subgraph LEMURA["lemura runtime - SessionManager"]
        direction TB
        UC1(["Configure session"])
        UC2(["Run a request - run / stream"])
        UC3(["Manage tools at runtime"])
        UC4(["Manage skills at runtime"])
        UC5(["Set goal and plan"])
        UC6(["Load / inspect history"])
        UC7(["Reset / close session"])
        UC8(["Direct media ops - ASR / TTS / vision"])

        UC9(["Route the turn - MetaRouter"])
        UC10(["Manage context window - compression"])
        UC11(["Execute a tool - validate, firewall, timeout"])
        UC12(["Inject skills"])
        UC13(["Plan and verify goal"])
        UC14(["Observe via traces - onTrace / onTurn"])
    end

    dev --> UC1
    dev --> UC3
    dev --> UC4
    dev --> UC5
    dev --> UC6
    dev --> UC7
    dev --> UC8
    dev --> UC14
    user --> UC2
    author -. defines .-> UC11
    author -. authors .-> UC12

    %% includes - core run pipeline
    UC2 -. include .-> UC9
    UC2 -. include .-> UC10
    UC2 -. include .-> UC12
    UC2 -. include .-> UC13
    UC2 -. include .-> UC11

    %% external system collaborations
    UC2 --> provider
    UC8 --> provider
    UC9 --> provider
    UC13 --> provider
    UC11 --> rag
    UC11 --> mcp
    UC10 -. summarize .-> provider
```

---

## Use case briefs

### Driven by the Consumer Developer

- **Configure session** — build a `SessionConfig` (adapter, model, `maxTokens`, tools,
  skills, compression strategies, router, goal/continuation flags, MCP servers) and
  `new SessionManager(config)`.
- **Manage tools at runtime** — `session.tools.register()` / `unregister()` /
  `getAll()`.
- **Manage skills at runtime** — `session.skills.enableSkill()` / `disableSkill()` /
  `enableByTags()`.
- **Set goal & plan** — `session.setGoal(...)` and `session.setPlan(steps, strategy)`
  bypass the automatic mini-planning step.
- **Load / inspect history** — `loadHistory()`, `getHistory()`, `getContext()`,
  `getPlan()`.
- **Reset / close** — `reset()` clears conversation state; `close()` disconnects MCP
  servers.
- **Direct media ops** — `getMedia()` exposes ASR / TTS / vision / image-gen on the
  `MediaBridge`.
- **Observe** — supply `onTrace` / `onTurn` callbacks to watch the pipeline.

### Driven by the End User

- **Run a request** — the end user's message enters via `run()` or `stream()`. This is
  the umbrella use case that **includes** the internal pipeline below.

### Internal use cases (`<<include>>` of "Run a request")

- **Route the turn** — `MetaRouter`/`LLMRouter` narrows the tool surface and may mark a
  `chat` turn.
- **Manage context window** — `ContextManager` applies compression strategies before
  each provider call.
- **Inject skills** — `SkillInjector` adds skill content to the system prompt within a
  token budget.
- **Plan & verify goal** — `GoalInjector` mini-planning + post-answer verification.
- **Execute a tool** — schema-validate, firewall-check, timeout-guard, and run; talks
  to RAG / MCP when those tools are invoked.

---

## See also

- [Request flow](request-flow.md) — the staged pipeline these use cases run through.
- [Sequence diagram](sequence-diagram.md) — the temporal view of "Run a request".
- [Class diagram](class-diagram.md) — the structural view of the components.
