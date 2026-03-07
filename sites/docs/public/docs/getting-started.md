# Getting Started with lemura

> **lemura** is a provider-agnostic npm package that bundles a full agentic AI runtime. It gives you a ReAct loop, multi-provider adapters, pluggable context compression, tool orchestration, skill injection, and RAG integration — all in one composable package with zero vendor lock-in.

---

## Why lemura?

Building production-grade AI agents is harder than it looks. Here are the problems lemura solves out of the box:

| Problem | What breaks without lemura | How lemura fixes it |
|---|---|---|
| **Context overflow** | Conversations crash past the token limit | Pluggable compression strategies shrink history automatically |
| **Vendor lock-in** | Switching providers requires rewriting inference code | One `IProviderAdapter` interface — swap providers in one line |
| **Tool chaos** | Each provider has a different tool call format | Normalized `ToolCall[]` across all providers |
| **Prompt drift** | System rules get lost after context compression | Goal injection keeps the objective visible at all times |
| **Streaming complexity** | Managing async chunk buffers is error-prone | `stream()` returns a clean `AsyncIterable<CompletionChunk>` |

---

## Installation

```bash
npm install lemura
# or
pnpm add lemura
```

> **Node.js ≥ 18 required.** lemura uses native `fetch`, `AsyncIterable`, and `structuredClone`.

---

## Quick Start (3 minutes)

This minimal example creates a conversational agent that can call tools:

```typescript
import { SessionManager, OpenAICompatibleAdapter } from 'lemura';

// 1. Create a provider adapter
const adapter = new OpenAICompatibleAdapter({
  baseUrl: 'https://api.openai.com/v1',
  apiKey: process.env.OPENAI_API_KEY!,
  defaultModel: 'gpt-4o',
});

// 2. Define tools the agent can use
const weatherTool = {
  name: 'get_weather',
  description: 'Get the current weather for a city. Use whenever the user asks about weather.',
  parameters: {
    type: 'object',
    properties: {
      city: { type: 'string', description: 'City name, e.g. "Paris"' },
    },
    required: ['city'],
  },
  execute: async ({ city }: { city: string }) => {
    // Your real implementation here
    return `Weather in ${city}: 22°C, partly cloudy.`;
  },
};

// 3. Create a session
const session = new SessionManager({
  adapter,
  model: 'gpt-4o',
  maxTokens: 128_000,
  tools: [weatherTool],
});

// 4. Run it
const answer = await session.run("What's the weather like in Tokyo?");
console.log(answer);
// → "The weather in Tokyo is currently 22°C and partly cloudy."
```

That's it. The agent automatically:
- Decides to call `get_weather` with `{ city: "Tokyo" }`
- Observes the tool result
- Generates a natural language response

---

## How the ReAct Loop Works

lemura runs a **ReAct (Reason + Act)** loop — the industry-standard architecture for tool-using agents:

```
User Message
     │
     ▼
┌──────────────────────────────────────┐
│          SessionManager.run()        │
│                                      │
│  1. Inject skills into system prompt │
│  2. Compress context if needed       │
│  3. Call provider → get response     │
│  4a. If tool_call → execute tool     │
│      → append observation → goto 2  │
│  4b. If stop → return final answer   │
└──────────────────────────────────────┘
```

Each iteration is one **ReAct cycle**: the model reasons about what to do, acts (calls a tool), and observes the result before reasoning again.

---

## Core Concepts Map

Here's how all the pieces fit together:

```
┌─────────────────────────────────────────────────────────┐
│                     SessionManager                      │
│                                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ ReActAgent  │  │ContextManager│  │  ToolRegistry  │  │
│  │  (loop)     │  │ (memory)     │  │  (actions)    │  │
│  └──────┬──────┘  └──────┬───────┘  └───────┬───────┘  │
│         │                │                   │          │
│  ┌──────▼──────────────────────────────────────────┐   │
│  │              IProviderAdapter                   │   │
│  │   (normalize any LLM into one interface)        │   │
│  └────────────────────────────────────────────────-┘   │
│                                                         │
│  ┌───────────────┐  ┌─────────────────────────────┐    │
│  │ SkillInjector │  │      IRAGAdapter             │    │
│  │  (behavior)   │  │  (knowledge retrieval)      │    │
│  └───────────────┘  └─────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

---

## SessionConfig Reference

All configuration flows through `SessionConfig` — no globals, no environment variable reads inside the package:

```typescript
interface SessionConfig {
  // Required
  adapter: IProviderAdapter;     // Which LLM to use
  model: string;                 // Model identifier (e.g., 'gpt-4o')
  maxTokens: number;             // Context window size

  // Agent behavior
  maxIterations?: number;        // Default: 10 — max ReAct loop cycles
  maxSteps?: number;             // Default: 20 — max individual tool calls
  systemPrompt?: string;         // Base system instruction

  // Extensions
  tools?: IToolDefinition[];             // Actions the agent can take
  skills?: ISkill[];                     // Behavioral prompt modifiers
  ragAdapter?: IRAGAdapter;              // Knowledge retrieval
  compressionStrategies?: IContextStrategy[];  // Memory management

  // Advanced
  enableGoalPlanning?: boolean;          // Mini planning step before execution
  enableContinuationPlanning?: boolean;  // Multi-step tool sequencing
  toolResponseTokenBudget?: number;      // Cap on tool output tokens
  logger?: ILogger;                      // Observability hook
}
```

---

## Streaming Responses

Use `session.stream()` to get real-time output:

```typescript
for await (const chunk of session.stream("Write a technical spec for a user auth system")) {
  process.stdout.write(chunk.delta);
  if (chunk.finished) break;
}
```

Each `CompletionChunk` has:
- `delta: string` — the new text fragment
- `finished: boolean` — `true` on the final chunk
- `finishReason?` — why generation stopped

---

## Multi-Turn Conversations

`SessionManager` maintains conversation history across multiple `run()` calls:

```typescript
const session = new SessionManager({ adapter, model: 'gpt-4o', maxTokens: 128_000 });

await session.run("My name is Alice.");
await session.run("What's my name?");
// → "Your name is Alice."

// Reset when you want a fresh conversation
session.reset();
```

---

## Error Handling

lemura throws typed errors you can `switch` on:

```typescript
import { LemuraError, LemuraMaxIterationsError, LemuraContextOverflowError } from 'lemura';

try {
  const result = await session.run(userMessage);
} catch (err) {
  if (err instanceof LemuraMaxIterationsError) {
    // Agent couldn't finish in time — increase maxIterations or simplify the task
  } else if (err instanceof LemuraContextOverflowError) {
    // Context overflowed — add a compression strategy
  } else if (err instanceof LemuraError) {
    // Any other lemura error — check err.code
    console.error(err.code, err.message);
  }
}
```

---

## Next Steps

| What you want to do | Where to go |
|---|---|
| Use a different LLM (Anthropic, Groq, Ollama…) | [Provider Adapters →](/docs/adapters) |
| Handle long conversations without overflow | [Context Management →](/docs/context-management) |
| Give your agent powerful tools | [Tools & Skills →](/docs/tools-and-skills) |
| Connect a knowledge base | [RAG Integration →](/docs/rag-integration) |
| Build complex autonomous workflows | [Advanced Runtime →](/docs/advanced-execution) |
