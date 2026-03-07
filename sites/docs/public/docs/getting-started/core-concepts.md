# Core Concepts

Understanding these five concepts gives you a complete mental model of lemura before you write a single line of code.

---

## 1. The ReAct Loop — The Engine

lemura's execution engine is the **ReAct (Reason + Act)** loop. Every `session.run()` call goes through this cycle until the agent produces a final answer:

```
User Message
     │
     ▼
┌────────────────────────────────────────┐
│         SessionManager.run()           │
│                                        │
│  ┌────────────────────────────────┐   │
│  │  Inject skills into prompt      │   │
│  │  Compress context if needed     │   │
│  │  Call provider → get response   │   │
│  └────────────┬───────────────────┘   │
│               │                        │
│        ┌──────┴──────┐                 │
│        │             │                 │
│   tool_call?     stop/final?           │
│        │             │                 │
│   Execute tool   Return answer         │
│   Inject result                        │
│        │                               │
│        └──── repeat cycle ────────────┘
└────────────────────────────────────────┘
```

**Key insight:** The model never calls tools directly. It *requests* a tool call. lemura intercepts that request, validates the arguments, executes the function, and feeds the result back as an observation. The model then decides what to do next.

---

## 2. The Provider Adapter — Normalizing the LLM Layer

Every AI provider has a different API shape. The `IProviderAdapter` interface normalizes all of them:

```
OpenAI API ──────┐
Anthropic API ───┼──→ IProviderAdapter ──→ lemura
Groq API ────────┘
Your Custom API ─┘
```

As a lemura user, you *only* interact with `IProviderAdapter`. When Anthropic changes their API, their adapter updates — your code doesn't change.

**The most important normalization:** `finishReason`. Every provider uses different strings:
- OpenAI: `"stop"`, `"tool_calls"`, `"length"`  
- Anthropic: `"end_turn"`, `"tool_use"`, `"max_tokens"`
- Groq: `"stop"`, `"tool_calls"`

lemura maps all of these to exactly four values: `'stop' | 'tool_call' | 'max_tokens' | 'error'`.

---

## 3. The Context Window — Memory

The `ContextWindow` is lemura's single source of truth for everything the agent knows:

```typescript
interface ContextWindow {
  systemPrompt: string;        // never compressed — always visible
  scratchpad: string;          // internal reasoning trace (not sent to provider)
  turns: Turn[];               // conversation history
  tokenCount: number;          // current estimated size
  maxTokens: number;           // hard limit
  compressionSummary?: string; // accumulated past-compression summary
  metadata: Record<string, unknown>; // goals, plan, custom data
}
```

**Critical invariant:** The `ContextWindow` is **immutable**. Strategies that compress it must return a *new* object, never mutate the original. This makes compression safe to retry and compose.

---

## 4. Compression Strategies — Automatic Memory Management

As conversations grow, lemura automatically reduces context size using a composable **strategy stack**. Strategies run in priority order before every provider call:

```typescript
compressionStrategies: [
  new SummaryInjectionStrategy({ priority: 1 }),     // always runs first
  new SandwichCompressionStrategy(adapter, {          // runs at 80% usage
    priority: 2,
    preserveFirst: 2,    // keep initial context
    preserveLast: 4,     // keep recent context
    triggerThreshold: 0.8,
  }),
  new MaxTokensCompressionStrategy(adapter, {         // emergency fallback
    priority: 3,
    threshold: 0.95,
  }),
]
```

Each strategy decides independently whether to apply via `shouldApply()`, then transforms the `ContextWindow` immutably.

---

## 5. Tools & Skills — Behavior and Capability

| Concept | What it is | Example |
|---|---|---|
| **Tool** | An async function the agent can call | `search_web`, `write_file`, `query_database` |
| **Skill** | Markdown injected into the system prompt | "Always respond in Spanish", "You are a code review expert" |

Tools extend *what* the agent can do. Skills shape *how* it thinks and behaves.

---

## How They All Fit Together

```
┌─────────────────────────────────────────────────────────┐
│                     SessionManager                       │
│                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ ReActAgent  │  │ContextManager│  │  ToolRegistry  │  │
│  │  (loop)     │  │ (memory)     │  │  (actions)    │  │
│  └──────┬──────┘  └──────┬───────┘  └───────┬───────┘  │
│         │                │                   │           │
│  ┌──────▼─────────────────────────────────────────┐    │
│  │              IProviderAdapter                   │    │
│  │   (normalize any LLM into one interface)        │    │
│  └─────────────────────────────────────────────────┘    │
│                                                          │
│  ┌───────────────┐  ┌─────────────────────────────┐     │
│  │ SkillInjector │  │       IRAGAdapter            │     │
│  │  (behavior)   │  │  (knowledge retrieval)      │     │
│  └───────────────┘  └─────────────────────────────┘     │
└─────────────────────────────────────────────────────────┘
```

**Data flow for a single turn:**
1. `SessionManager.run(message)` starts
2. `SkillInjector` builds the system prompt from active skills
3. `ContextManager.prepare()` applies any needed compression
4. `ReActAgent` calls the provider, gets a response
5. If tool call: `ToolRegistry` validates + executes → observation appended → back to step 3
6. If final answer: `SessionManager` returns the string

---

## Tips & Tricks

> **Tip:** You don't need to enable all features. lemura is opt-in everywhere. Start with just `adapter`, `model`, and `maxTokens`. Add tools, skills, and compression only when you need them.

> **Tip:** The `metadata` field on `ContextWindow` persists across compression events. Use it to store any data that must survive the entire session: `context.metadata['userId'] = '123'`. Compression strategies must never delete metadata.

> **Tip:** Think of `systemPrompt` in `SessionConfig` as your "floor" — it always stays. Think of skills as "ceiling modifiers" — they augment the floor for specific behaviors. Keep the floor minimal and let skills do the specialization.
