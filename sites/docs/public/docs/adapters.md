# Provider Adapters

Adapters are lemura's gateway to the outside world. Their only job is to **normalize** different AI provider APIs into lemura's internal types — no business logic, only translation.

> 🌿 **Makix Context** 🔌: Makix is deployed on INfodev's OpenAI-compatible API (Qwen 3.5 4B, 16K tokens). Because all provider interaction goes through `IProviderAdapter`, switching from local Ollama during development to INfodev in production requires changing exactly **one object** — nothing else in Makix changes.

![Provider Adapters — Normalization Flow](/images/adapters-diagram.png)

---

## The Core Problem

Every provider returns data differently:

```
OpenAI:    { finish_reason: "stop",     message: { role: "assistant", content: "..." } }
Anthropic: { stop_reason: "end_turn",   content: [{ type: "text", text: "..." }]     }
INfodev:   { finish_reason: "stop",     message: { role: "assistant", content: "..." } }
Cohere:    { finish_reason: "COMPLETE", text: "..."                                   }
```

lemura normalizes all of these into one `CompletionResponse`. Switch your provider with one line — your tools, skills, and compression strategies never change.

---

## In This Section

| Page | What it covers |
|---|---|
| [OpenAI-Compatible Adapter →](/docs/adapters/openai-compatible) | Setting up `OpenAICompatibleAdapter` — INfodev, OpenAI, Groq, Ollama, LM Studio |
| [Finish Reason Normalization →](/docs/adapters/finish-reason) | How providers' stop signals map to lemura's 4-value enum |
| [Retry & Rate Limits →](/docs/adapters/retry-rate-limits) | Exponential backoff, 429/503 handling |
| [Streaming & Multimodal →](/docs/adapters/streaming-multimodal) | `stream()`, ASR, TTS, Vision, Image generation |
| [Writing a Custom Adapter →](/docs/adapters/custom-adapter) | Full implementation guide + contract test suite |

---

## Quick Reference — Makix Provider Config

```typescript
import { OpenAICompatibleAdapter } from 'lemura/adapters';

// Production — INfodev (Qwen 3.5 4B, 16K)
const adapter = new OpenAICompatibleAdapter({
  baseUrl: 'https://api.infodev.mg/v1',
  apiKey: process.env.INFODEV_API_KEY!,
  defaultModel: 'qwen3.5-4b',
  retry: { maxRetries: 3, baseDelayMs: 500 },
});

// Development — local Ollama (no API key)
const devAdapter = new OpenAICompatibleAdapter({
  baseUrl: 'http://localhost:11434/v1',
  apiKey: 'ollama',
  defaultModel: 'qwen2.5:4b',
});
```

See [OpenAI-Compatible Adapter →](/docs/adapters/openai-compatible) for the full provider compatibility table.
