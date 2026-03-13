# Provider Adapters

An adapter is lemura's boundary layer between the agentic runtime and an AI provider's HTTP API. It has a single responsibility: translate lemura's internal request/response types into the format a specific provider expects, and translate the provider's response back into lemura's normalized types. No business logic lives in adapters — only translation.

This abstraction is what makes lemura provider-agnostic. Your tools, skills, compression strategies, and application code all work against the `IProviderAdapter` interface — they have no knowledge of whether the underlying model is GPT-4o, Llama 3, or a locally-hosted Qwen variant. When you switch providers, you change one object in your `SessionConfig` and nothing else changes.

The most significant normalization an adapter performs is `finishReason`. Every provider uses different strings to signal that the model stopped generating: OpenAI uses `"stop"` and `"tool_calls"`, Anthropic uses `"end_turn"` and `"tool_use"`, Groq mirrors OpenAI, Cohere uses `"COMPLETE"` and `"TOOL"`. Lemura maps all of these to exactly four values: `'stop' | 'tool_call' | 'max_tokens' | 'error'`. The ReAct loop reads only this normalized value to decide its next action — it never sees provider-specific strings.

> 🌿 **Makix Context** 🔌: Makix is deployed on INfodev's OpenAI-compatible API (Qwen 3.5 4B, 16K tokens). Because all provider interaction goes through `IProviderAdapter`, switching from local Ollama during development to INfodev in production requires changing exactly **one object** — nothing else in Makix changes.

---

## The Normalization Problem

Without adapters, your application code must handle every provider's idiosyncrasies:

```
Provider          finish_reason field         stop value        tool call value
────────────────────────────────────────────────────────────────────────────────
OpenAI            finish_reason               "stop"            "tool_calls"
Anthropic         stop_reason                 "end_turn"        "tool_use"
Groq              finish_reason               "stop"            "tool_calls"
Cohere            finish_reason               "COMPLETE"        "TOOL"
Local models      finish_reason / undefined   "stop" / null     varies
```

Lemura normalizes all of this so your code always reads `response.finishReason === 'stop'` — never provider-specific strings.

---

## The IProviderAdapter Interface

```typescript
interface IProviderAdapter {
  // Identity
  readonly name: string;
  readonly version: string;

  // Text generation (required)
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  stream(request: CompletionRequest):  AsyncIterable<CompletionChunk>;

  // Multimodal (optional — throw CAPABILITY_NOT_SUPPORTED if not implemented)
  transcribe(request: TranscriptionRequest):    Promise<TranscriptionResponse>;
  synthesize(request: SynthesisRequest):        AsyncIterable<AudioChunk>;
  describeImage(request: VisionRequest):        Promise<VisionResponse>;
  generateImage(request: ImageGenRequest):      Promise<ImageGenResponse>;

  // Utilities (required)
  estimateTokens(text: string): number;
  getModelInfo():               ModelInfo;
  healthCheck():                Promise<boolean>;
}
```

**Key normalized types:**

```typescript
interface CompletionResponse {
  content:      string;          // The model's text response
  toolCalls?:   ToolCall[];      // Tool call requests from the model
  finishReason: 'stop' | 'tool_call' | 'max_tokens' | 'error';
  usage?: {
    promptTokens:     number;
    completionTokens: number;
    totalTokens:      number;
  };
  rawResponse?: unknown;         // Original provider response — for debugging
}
```

---

## In This Section

| Page | What it covers |
|---|---|
| [OpenAI-Compatible Adapter →](/docs/adapters/openai-compatible) | Setup for OpenAI, Groq, Azure, Ollama, LM Studio, Together AI |
| [Finish Reason Normalization →](/docs/adapters/finish-reason) | How providers' stop signals map to lemura's 4-value enum |
| [Retry & Rate Limits →](/docs/adapters/retry-rate-limits) | Exponential backoff, 429/503 handling, circuit breaker pattern |
| [Streaming & Multimodal →](/docs/adapters/streaming-multimodal) | `stream()`, ASR, TTS, Vision, Image generation |
| [Writing a Custom Adapter →](/docs/adapters/custom-adapter) | Full implementation guide + contract test suite |

---

## Quick Reference — Common Providers

```typescript
import { OpenAICompatibleAdapter } from 'lemura/adapters';

// OpenAI
const adapter = new OpenAICompatibleAdapter({
  baseUrl: 'https://api.openai.com/v1',
  apiKey: process.env.OPENAI_API_KEY!,
  defaultModel: 'gpt-4o',
});

// Groq — ultra-fast inference
const adapter = new OpenAICompatibleAdapter({
  baseUrl: 'https://api.groq.com/openai/v1',
  apiKey: process.env.GROQ_API_KEY!,
  defaultModel: 'llama-3.3-70b-versatile',
});

// Ollama — local inference, no API key required
const adapter = new OpenAICompatibleAdapter({
  baseUrl: 'http://localhost:11434/v1',
  apiKey: 'ollama',              // required by client, ignored by Ollama
  defaultModel: 'qwen2.5:4b',
  timeout: 120_000,              // local models can be slow
});

// INfodev (Qwen 3.5 4B, OpenAI-compatible)
const adapter = new OpenAICompatibleAdapter({
  baseUrl: 'https://api.infodev.mg/v1',
  apiKey: process.env.INFODEV_API_KEY!,
  defaultModel: 'qwen3.5-4b',
  retry: { maxRetries: 3, baseDelayMs: 500 },
});
```

---

## Switching Providers

Since all providers share the same interface, switching is a one-line change:

```typescript
// Development: local Ollama (free, private)
const adapter = new OpenAICompatibleAdapter({
  baseUrl: 'http://localhost:11434/v1',
  apiKey: 'ollama',
  defaultModel: 'llama3.2',
});

// Staging: Groq (fast, cheap)
const adapter = new OpenAICompatibleAdapter({
  baseUrl: 'https://api.groq.com/openai/v1',
  apiKey: process.env.GROQ_API_KEY!,
  defaultModel: 'llama-3.3-70b-versatile',
});

// Production: OpenAI (most capable)
const adapter = new OpenAICompatibleAdapter({
  baseUrl: 'https://api.openai.com/v1',
  apiKey: process.env.OPENAI_API_KEY!,
  defaultModel: 'gpt-4o',
  retry: { maxRetries: 3, baseDelayMs: 1_000 },
});

// SessionManager is identical in all environments:
const session = new SessionManager({
  adapter,   // ← the only thing that changes
  model: process.env.LLM_MODEL ?? 'gpt-4o',
  maxTokens: 128_000,
  tools: [/* same tools everywhere */],
});
```

---

## Capability Checks

Check what a specific model/adapter supports before using advanced features:

```typescript
const info = adapter.getModelInfo();

if (!info.capabilities.includes('vision')) {
  // Fall back to text-only description
  throw new Error(`Vision not supported by ${adapter.name}/${info.name}`);
}

if (!info.capabilities.includes('tool_use')) {
  throw new Error('Tool use not supported — choose a model that supports function calling');
}
```

---

## Multiple Adapters in One App

Use different adapters for different purposes to optimize cost and capability:

```typescript
// Fast + cheap: for classification and simple lookups
const fastAdapter = new OpenAICompatibleAdapter({
  baseUrl: 'https://api.groq.com/openai/v1',
  apiKey: process.env.GROQ_API_KEY!,
  defaultModel: 'llama-3.1-8b-instant',
});

// Powerful: for complex reasoning and code generation
const powerAdapter = new OpenAICompatibleAdapter({
  baseUrl: 'https://api.openai.com/v1',
  apiKey: process.env.OPENAI_API_KEY!,
  defaultModel: 'gpt-4o',
});

// Shared: compression strategies can use a cheaper model
const compressionSession = new SessionManager({
  adapter: powerAdapter,
  model: 'gpt-4o',
  maxTokens: 128_000,
  compressionStrategies: [
    new SandwichCompressionStrategy(fastAdapter, {  // ← fast model for compression
      priority: 2, triggerThreshold: 0.80,
    }),
  ],
});
```

---

## Tips & Tricks

> **Tip:** Use `adapter.healthCheck()` in your application's startup and readiness probes. If the provider is unreachable, fail fast rather than discovering it when a user makes their first request.

> **Tip:** Always set `retry.maxRetries` in production. The default is 3 retries, which handles transient 429s and 503s. Without retries, a single rate limit error surfaces as a failure to the user.

> **Tip:** For compression strategies, pass a cheaper/faster model as the adapter rather than your main agent model. Summarizing 20 turns of conversation doesn't require GPT-4o — a fast model like `llama-3.1-8b-instant` does it at a fraction of the cost.
