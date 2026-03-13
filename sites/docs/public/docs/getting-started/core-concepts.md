# Core Concepts

Understanding these five concepts gives you a complete mental model of lemura before you write a single line of code. Each concept maps to a concrete part of the architecture, and knowing how they connect makes configuration decisions obvious rather than arbitrary.

---

## 1. The ReAct Loop — The Engine

The ReAct (Reason + Act) pattern is the standard architecture for tool-using AI agents. Lemura's entire runtime is built around this loop. Every call to `session.run()` enters this cycle and stays in it until the model produces a natural conclusion or a configured limit is reached.

The loop works as follows: the model receives the current context (system prompt, conversation history, tool definitions, goal block if enabled) and **reasons** about what to do next. If it decides to use a tool, it emits a structured tool call request — it never calls the tool directly. Lemura intercepts this request, validates the arguments against the tool's JSON Schema, and **acts**: executes the function, captures the result, and appends it as an observation turn. The model then reasons again with this new information. This cycle repeats until the model decides its reasoning is complete and emits a final text response.

This design has a critical implication: **the model is stateless between iterations**. It doesn't "remember" previous reasoning steps — it only sees the accumulated turn history. Lemura's context management system exists precisely to maintain this history efficiently as it grows.

```
User Message
     │
     ▼
┌────────────────────────────────────────────────────┐
│              SessionManager.run()                  │
│                                                    │
│  ┌─────────────────────────────────────────────┐  │
│  │         Prepare Context (each iteration)    │  │
│  │  1. Inject skills into system prompt        │  │
│  │  2. Re-inject goal block (if enabled)       │  │
│  │  3. Apply compression strategies if needed  │  │
│  │  4. Apply SummaryInjectionStrategy          │  │
│  └────────────────────┬────────────────────────┘  │
│                        │                           │
│  ┌─────────────────────▼────────────────────────┐ │
│  │         Provider Call                        │ │
│  │  adapter.complete(messages + tools)          │ │
│  └────────────────────┬────────────────────────┘  │
│                        │                           │
│                 finishReason?                      │
│                  /         \                       │
│            tool_call        stop                  │
│               │               │                   │
│  ┌────────────▼─────────┐     │                   │
│  │  Execute Tool(s)     │     │                   │
│  │  validate args       │     │                   │
│  │  call execute()      │     │                   │
│  │  compress result     │     │                   │
│  │  append observation  │     │                   │
│  └────────────┬─────────┘     │                   │
│               │ (loop back)   │                   │
└───────────────┘               │                   │
                                ▼                   │
                         Final Answer               │
└────────────────────────────────────────────────────┘
```

**Key insight:** The model never calls tools directly. It *requests* a tool call by emitting a structured JSON object. Lemura intercepts that request, validates the arguments, executes the function, and feeds the result back as an observation. The model then decides what to do next based on what it observed.

---

## 2. The Provider Adapter — Normalizing the LLM Layer

Every AI provider has a different API shape, authentication pattern, streaming protocol, and set of stop signals. The `IProviderAdapter` interface normalizes all of them into a single consistent contract:

```
Your application code
        │
        ▼
IProviderAdapter (single interface)
  ├── complete(request)  → CompletionResponse
  ├── stream(request)    → AsyncIterable<CompletionChunk>
  └── estimateTokens(text) → number
        │
        ├── OpenAICompatibleAdapter  ──→ OpenAI / Groq / Ollama / Azure
        ├── [Your custom adapter]    ──→ Any provider
        └── [Future adapters]
```

The `finishReason` normalization is the most critical part. Every provider uses different strings to signal that generation stopped:

| Provider | Stop string | Tool call string |
|---|---|---|
| OpenAI | `"stop"` | `"tool_calls"` |
| Anthropic | `"end_turn"` | `"tool_use"` |
| Groq | `"stop"` | `"tool_calls"` |
| Cohere | `"COMPLETE"` | `"TOOL"` |

Lemura maps all of these to exactly four values: `'stop' | 'tool_call' | 'max_tokens' | 'error'`. The ReAct loop only ever reads these four values — it has no knowledge of any provider-specific strings.

---

## 3. The Context Window — Session Memory

The `ContextWindow` is lemura's single source of truth for everything the agent knows about the current session:

```typescript
interface ContextWindow {
  systemPrompt: string;        // Never compressed — always visible
  scratchpad:   string;        // Internal reasoning — never sent to provider
  turns:        Turn[];        // Conversation history — the part that grows
  tokenCount:   number;        // Current estimated total size
  maxTokens:    number;        // Hard limit from SessionConfig
  compressionSummary?: string; // Accumulated past-compression summary
  metadata: Record<string, unknown>; // Goals, plans, custom data — survives compression
}
```

Understanding what each field means:
- **`systemPrompt`** is permanent and never touched by compression. Think of it as the agent's constitutional foundation.
- **`scratchpad`** holds intermediate reasoning. It's never sent to the provider — it's internal working memory.
- **`turns`** grows with every exchange. This is the part that eventually fills up and triggers compression.
- **`metadata`** stores structured data (goals, continuation plans, custom state) that must survive compression events. Compression strategies are required to never delete metadata.
- **`compressionSummary`** accumulates summaries of prior compressions, injected back into context by `SummaryInjectionStrategy`.

**Critical invariant:** The `ContextWindow` is **immutable**. Compression strategies that transform it must return a *new* object, never mutate the original. This makes compression safe to retry, compose, and test in isolation.

---

## 4. Compression Strategies — Automatic Memory Management

As conversations grow, token utilization rises. When it approaches the configured threshold, lemura runs the compression strategy stack before the next provider call:

```
Turn 1–10:   utilization = 35% → no compression needed
Turn 11–20:  utilization = 65% → no compression needed
Turn 21:     utilization = 82% → SandwichCompressionStrategy fires
             → summarize turns 3–17, keep turns 1–2 and 18–21
             → utilization drops to 41% → provider call proceeds
Turn 22–35:  utilization grows again...
Turn 36:     utilization = 83% → fires again, appends to compressionSummary
```

Strategies are composed in a stack with explicit priorities. Lower priority number = runs first. Each strategy is independent and only applies if its `shouldApply()` condition is true:

```typescript
compressionStrategies: [
  new SummaryInjectionStrategy({ priority: 1 }),     // always runs — re-injects history
  new SandwichCompressionStrategy(adapter, {          // runs at 80% — summarizes middle
    priority: 2,
    triggerThreshold: 0.80,
    preserveFirst: 2,
    preserveLast: 6,
  }),
  new HistoryCompressionStrategy(adapter, {           // runs at 92% — emergency fallback
    priority: 3,
    windowSize: 6,
    triggerAtPercent: 0.92,
  }),
]
```

The stack runs iteratively until the context fits. If all strategies have been applied and the context still overflows, `LemuraContextOverflowError` is thrown.

---

## 5. Tools & Skills — Behavior and Capability

Tools and skills extend the agent in two complementary dimensions:

**Tools** extend *what the agent can do*. They are async TypeScript functions the model can invoke during its ReAct cycle. Before `execute()` is called, lemura validates the arguments against the tool's JSON Schema — the function is only called with valid, type-safe arguments.

**Skills** extend *how the agent thinks and behaves*. They are Markdown files injected into the system prompt. Unlike the base `systemPrompt`, skills are:
- Re-injected automatically after every compression event (so the agent never "forgets" its behavioral rules)
- Prioritized and automatically downgraded to shorter versions when the token budget is tight
- Composable — multiple skills stack in priority order

| Concept | What it is | Where it operates | Example |
|---|---|---|---|
| **Tool** | Async function | During ReAct loop execution | `search_web`, `query_database`, `send_email` |
| **Skill** | Markdown in system prompt | Every provider call | "You are a code review expert", "Always cite sources" |

---

## How They All Fit Together

A single `session.run(message)` call involves every component:

```
session.run("Research EV market trends for Q4 2025")
     │
     ├─ 1. SkillInjector builds the system prompt
     │      (systemPrompt + active skills in priority order)
     │
     ├─ 2. GoalInjector sets the goal (if enableGoalPlanning: true)
     │      → runs mini-planning LLM call to decompose into sub-goals
     │
     ├─ 3. ContextManager.prepare() — compression check
     │      → if tokenCount > maxTokens × 0.80, apply strategies
     │
     ├─ 4. adapter.complete() — call the provider
     │      → receive CompletionResponse with normalized finishReason
     │
     ├─ 5a. finishReason === 'tool_call':
     │       → ToolFirewall evaluates the call (accept / deny / ask)
     │       → ToolRegistry.validate() checks args against JSON Schema
     │       → tool.execute() runs
     │       → ToolResponseProcessor compresses result if too large
     │       → observation appended to turns
     │       → back to step 3 (next iteration)
     │
     └─ 5b. finishReason === 'stop':
              → return response.content as final answer ✅
```

---

## Tips & Tricks

> **Tip:** You don't need to enable all features. lemura is opt-in everywhere. A minimal session is just `adapter + model + maxTokens`. Add tools, skills, compression, and goal planning only when your use case needs them.

> **Tip:** The `metadata` field on `ContextWindow` persists across all compression events. Use it to store any data that must survive the entire session: `context.metadata['userId'] = '123'`. Compression strategies are contractually required never to delete metadata.

> **Tip:** Think of `systemPrompt` as your "floor" — it's always there, defines the agent's identity. Think of skills as "ceiling modifiers" — they augment the floor for specific capabilities. Keep the floor minimal and let skills handle specialization.

> **Tip:** The `scratchpad` is the agent's private working memory. It's never sent to the provider. Subscribing to `'scratchpad:updated'` events lets you stream the agent's reasoning process to a debug panel, without exposing it to users.
