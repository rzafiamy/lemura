# OpenAI & Compatible Providers

The `OpenAICompatibleAdapter` is lemura's built-in adapter. It works with OpenAI and any provider that mirrors the OpenAI REST API format.

---

## Why "Compatible"?

OpenAI's Chat Completions API has become a de-facto standard. Dozens of providers implement the same endpoint contract — same request/response shape, same authentication pattern, same streaming protocol. A single adapter covers all of them.

---

## Configuration

```typescript
import { OpenAICompatibleAdapter } from 'lemura/adapters';

const adapter = new OpenAICompatibleAdapter({
  baseUrl: string;         // Required — the API's base URL
  apiKey: string;          // Required — passed as Authorization: Bearer <key>
  defaultModel: string;    // Required — fallback model if not specified per-request
  defaultHeaders?: Record<string, string>;  // Extra headers (e.g., API versioning)
  timeout?: number;        // Request timeout in ms. Default: 30_000
  retry?: {
    maxRetries: number;    // How many times to retry on 429/503. Default: 3
    baseDelayMs: number;   // First retry delay. Doubles exponentially. Default: 500
  };
});
```

---

## OpenAI

```typescript
const adapter = new OpenAICompatibleAdapter({
  baseUrl: 'https://api.openai.com/v1',
  apiKey: process.env.OPENAI_API_KEY!,
  defaultModel: 'gpt-4o',
  retry: { maxRetries: 3, baseDelayMs: 1000 },
});
```

**Available models:**
| Model | Context | Best for |
|---|---|---|
| `gpt-4o` | 128k | General purpose, tool use, vision |
| `gpt-4o-mini` | 128k | Fast, cheap, good for simpler tasks |
| `o3-mini` | 200k | Advanced reasoning (slow) |
| `gpt-3.5-turbo` | 16k | Legacy, high throughput |

---

## Azure OpenAI

Azure requires a specific URL format and the `api-version` header:

```typescript
const adapter = new OpenAICompatibleAdapter({
  baseUrl: `https://${process.env.AZURE_RESOURCE}.openai.azure.com/openai/deployments/${process.env.AZURE_DEPLOYMENT}`,
  apiKey: process.env.AZURE_OPENAI_API_KEY!,
  defaultModel: process.env.AZURE_DEPLOYMENT!,   // deployment name acts as the model
  defaultHeaders: {
    'api-version': '2024-05-01-preview',
  },
});
```

> **Tip:** Azure deployments map one deployment name → one model. Create separate adapter instances for different models (GPT-4o vs GPT-4o-mini) with different deployment names.

---

## Groq — Ultra-Fast Inference

Groq offers OpenAI-compatible endpoints with dramatically faster token generation:

```typescript
const adapter = new OpenAICompatibleAdapter({
  baseUrl: 'https://api.groq.com/openai/v1',
  apiKey: process.env.GROQ_API_KEY!,
  defaultModel: 'llama-3.3-70b-versatile',
});
```

**Groq models:**
| Model | Context | Speed |
|---|---|---|
| `llama-3.3-70b-versatile` | 128k | ~750 tokens/sec |
| `llama-3.1-8b-instant` | 128k | ~1200 tokens/sec |
| `mixtral-8x7b-32768` | 32k | ~600 tokens/sec |
| `gemma2-9b-it` | 8k | ~900 tokens/sec |

---

## Together AI

Together AI hosts 100+ open-source models:

```typescript
const adapter = new OpenAICompatibleAdapter({
  baseUrl: 'https://api.together.xyz/v1',
  apiKey: process.env.TOGETHER_API_KEY!,
  defaultModel: 'meta-llama/Llama-3-70b-chat-hf',
});
```

---

## Ollama (Local Inference)

Run models entirely on your own hardware — no API key, no data leaving your machine:

```typescript
// First, install and start Ollama: https://ollama.ai
// ollama pull llama3.2

const adapter = new OpenAICompatibleAdapter({
  baseUrl: 'http://localhost:11434/v1',
  apiKey: 'ollama',          // Required by the client library but ignored by Ollama
  defaultModel: 'llama3.2',
});
```

> **Tip:** Ollama has a 30-token/sec rate due to CPU/GPU constraints. Increase your `timeout` for longer responses:
> ```typescript
> timeout: 120_000,  // 2 minutes for long Ollama responses
> ```

---

## LM Studio (Local GUI)

LM Studio provides a GUI for running local models with an OpenAI-compatible server:

```typescript
const adapter = new OpenAICompatibleAdapter({
  baseUrl: 'http://localhost:1234/v1',
  apiKey: 'lm-studio',      // ignored
  defaultModel: 'local-model',  // matches whatever model is loaded in LM Studio
});
```

---

## Multiple Adapters in One App

Most production apps use multiple adapters for different purposes:

```typescript
// Fast, cheap model for simple classification
const fastAdapter = new OpenAICompatibleAdapter({
  baseUrl: 'https://api.groq.com/openai/v1',
  apiKey: process.env.GROQ_API_KEY!,
  defaultModel: 'llama-3.1-8b-instant',
});

// Powerful model for complex reasoning
const powerAdapter = new OpenAICompatibleAdapter({
  baseUrl: 'https://api.openai.com/v1',
  apiKey: process.env.OPENAI_API_KEY!,
  defaultModel: 'gpt-4o',
});

// Route requests to the right adapter
const session = userIsOnPremiumPlan
  ? new SessionManager({ adapter: powerAdapter, model: 'gpt-4o', maxTokens: 128_000 })
  : new SessionManager({ adapter: fastAdapter, model: 'llama-3.1-8b-instant', maxTokens: 128_000 });
```

---

## Health Checking

Use `healthCheck()` for readiness probes:

```typescript
const healthy = await adapter.healthCheck();
if (!healthy) {
  alerting.send('AI provider is unreachable');
}

// In an Express.js health endpoint:
app.get('/health', async (req, res) => {
  const aiOk = await adapter.healthCheck();
  res.json({
    status: aiOk ? 'ok' : 'degraded',
    ai: aiOk,
  });
});
```

---

## Tips & Tricks

> **Tip:** Don't hardcode `model` in `defaultModel` if you want to support model upgrades without code changes. Use an environment variable: `defaultModel: process.env.LLM_MODEL ?? 'gpt-4o'`.

> **Tip:** The `defaultHeaders` field is ideal for sending organization IDs, request tracing headers, or custom authentication schemes that differ from standard Bearer tokens.

> **Tip:** When using Azure OpenAI in CI/CD, be careful with the `api-version` header — Microsoft deprecates old versions regularly. Pin the version and set a calendar reminder to update it.
