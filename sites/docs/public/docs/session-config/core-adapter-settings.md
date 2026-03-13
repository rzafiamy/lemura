# Core & Adapter Settings

The core settings establish the three things a `SessionManager` cannot function without: a provider adapter, a model ID, and a context window size. Everything else in `SessionConfig` is optional and layered on top of these three fundamentals.

Understanding these fields first gives you a solid mental model before exploring advanced configuration. The adapter abstracts all provider-specific HTTP details. The model ID tells the adapter which model to invoke. `maxTokens` is the hard ceiling that drives every compression decision the runtime makes.

---

## Essential Fields (Required)

### `adapter: IProviderAdapter`

The adapter is the bridge between lemura's internal ReAct loop and your AI provider. It handles all HTTP communication, normalizes the response format, and provides token estimation. **Lemura never calls provider APIs directly** — every request flows through this object.

```typescript
import { OpenAICompatibleAdapter } from 'lemura/adapters';

const adapter = new OpenAICompatibleAdapter({
  baseUrl: 'https://api.openai.com/v1',
  apiKey: process.env.OPENAI_API_KEY!,
  defaultModel: 'gpt-4o',
});

const session = new SessionManager({ adapter, model: 'gpt-4o', maxTokens: 128_000 });
```

The `IProviderAdapter` interface is provider-agnostic. Swap any adapter at construction time to change providers — nothing else in your code changes.

See [Provider Adapters →](/docs/adapters) for setup guides for OpenAI, Groq, Ollama, Azure, and more.

---

### `model: string`

The model ID passed to the provider for every completion request in this session. This must be a valid model name for your configured `adapter.baseUrl`.

```typescript
// OpenAI
model: 'gpt-4o'
model: 'gpt-4o-mini'
model: 'o3-mini'

// Groq
model: 'llama-3.3-70b-versatile'
model: 'llama-3.1-8b-instant'

// Local Ollama
model: 'llama3.2'
model: 'qwen2.5:4b'

// Environment-driven (recommended for production)
model: process.env.LLM_MODEL ?? 'gpt-4o'
```

> **Tip:** Use an environment variable so you can change the model without a code deploy.

---

### `maxTokens: number`

The hard limit of the context window. This is the most important configuration number because **all compression decisions are driven by this value**. When `context.tokenCount / maxTokens` reaches a strategy's `triggerThreshold`, compression fires.

```typescript
// Set to ~90-95% of your model's actual limit to leave a safety buffer
maxTokens: 120_000   // for gpt-4o (128k actual limit)
maxTokens: 190_000   // for claude-3.5-sonnet (200k actual limit)
maxTokens: 15_000    // for a small local model (16k actual limit)
```

**Token budget breakdown:** `maxTokens` is shared by everything — system prompt, skills, tool definitions, RAG results, tool responses, and conversation turns. Plan allocations explicitly:

```
model context:      128,000 tokens
─────────────────────────────────
system prompt:      -  2,000
skills budget:      -  8,000   (skillTokenBudget)
tool definitions:   -  3,000   (4–6 well-defined tools)
RAG budget:         - 10,000   (ragTokenBudget)
tool response buf:  - 15,000   (toolResponseTokenBudget)
safety margin 5%:   -  6,400
─────────────────────────────────
available for turns: ~83,600 tokens
```

---

## Identity & Persona

### `systemPrompt?: string`

The base identity instruction for the agent. This is injected first into the context window before every provider call and **is never compressed or removed**. Use it for invariant rules that must hold throughout the entire session.

```typescript
// Minimal identity
systemPrompt: 'You are a helpful assistant.'

// Specialized agent
systemPrompt: `
You are Aria, a customer success agent for Acme Corp.
Always use the customer's name when known.
Escalate unresolved issues after 2 attempts using the create_ticket tool.
Never discuss competitor products.
`.trim()
```

**`systemPrompt` vs Skills:**
- Use `systemPrompt` for rules that are **absolute and unconditional** — they must always be present.
- Use [Skills](/docs/tools-and-skills/skills-system) for behavioral rules that might vary, compose, or need to survive compression events explicitly.

---

### `sessionId?: string`

An optional identifier for this session. Used by:
- The scratchpad persistence adapter (if configured)
- Observability events (included in trace payloads)
- Logging context

```typescript
// Tie the session to a user's authenticated session
sessionId: `user_${userId}_session_${Date.now()}`

// Stable ID for a long-running background agent
sessionId: 'nightly-report-agent'
```

---

## Completion Limits

### `maxCompletionTokens?: number`

The maximum number of tokens the model may generate in a single response. This is separate from `maxTokens` (the context window size) — it caps only the *output* length per call.

```typescript
// Default: 2,000 — reasonable for most conversational responses
maxCompletionTokens: 2_000

// Longer for agents that write reports or large outputs
maxCompletionTokens: 8_000

// Short for quick Q&A with tight latency requirements
maxCompletionTokens: 500
```

> **Important:** If `maxCompletionTokens` is too small, responses may be cut off mid-sentence. If the model returns `finishReason: 'max_tokens'`, increase this value.

---

### `maxIterations?: number`

Maximum number of full ReAct cycles (Reason → Act → Observe) before lemura throws `LemuraMaxIterationsError`. This is a **hard stop** — it throws rather than concluding gracefully.

```typescript
maxIterations: 5    // tight: simple Q&A, single-tool tasks
maxIterations: 10   // default: moderate complexity
maxIterations: 25   // generous: deep research, multi-step coding tasks
```

See [maxSteps & Loop Control →](/docs/advanced-execution/max-steps) for the softer alternative (`maxSteps`) that concludes gracefully instead of throwing.

---

## Full Minimal Examples

### Development Prototype

```typescript
import { SessionManager, OpenAICompatibleAdapter } from 'lemura';

const session = new SessionManager({
  adapter: new OpenAICompatibleAdapter({
    baseUrl: 'https://api.openai.com/v1',
    apiKey: process.env.OPENAI_API_KEY!,
    defaultModel: 'gpt-4o',
  }),
  model: 'gpt-4o',
  maxTokens: 128_000,
});
```

### Customer Support Bot

```typescript
const session = new SessionManager({
  adapter: new OpenAICompatibleAdapter({
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKey: process.env.GROQ_API_KEY!,
    defaultModel: 'llama-3.3-70b-versatile',
    retry: { maxRetries: 3, baseDelayMs: 500 },
  }),
  model: 'llama-3.3-70b-versatile',
  maxTokens: 128_000,
  maxCompletionTokens: 1_500,
  maxIterations: 5,
  sessionId: `support_${ticketId}`,
  systemPrompt: `You are a support agent for Acme Corp.
    Always look up the order before discussing it.
    Escalate unresolved issues after 2 attempts.`,
});
```

### Local Model (Ollama)

```typescript
const session = new SessionManager({
  adapter: new OpenAICompatibleAdapter({
    baseUrl: 'http://localhost:11434/v1',
    apiKey: 'ollama',
    defaultModel: 'qwen2.5:4b',
    timeout: 120_000,   // local models can be slow
  }),
  model: 'qwen2.5:4b',
  maxTokens: 15_000,   // small model, small window
  maxCompletionTokens: 1_000,
  maxIterations: 8,
});
```

---

## Tips & Tricks

> **Tip:** Never hard-code API keys. Use `process.env.YOUR_KEY!` and load from `.env` with `import 'dotenv/config'` at your entry point.

> **Tip:** Use the `sessionId` field in every production session and include it in all observability events. Without it, correlated logs across microservices become very hard to trace.

> **Tip:** Set `maxTokens` to 90–95% of your model's documented context limit. The remaining 5–10% acts as a safety buffer for token counting approximation errors and unexpected response length spikes.
