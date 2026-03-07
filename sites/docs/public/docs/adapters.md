# Provider Adapters

Adapters are lemura's gateway to the outside world. Their only job is to **normalize** different AI provider APIs into lemura's internal types. No business logic lives in adapters — only translation.

---

## The Core Problem Adapters Solve

Every AI provider has a slightly different API:

```
OpenAI:    { finish_reason: "stop",     message: { role: "assistant", content: "..." } }
Anthropic: { stop_reason: "end_turn",   content: [{ type: "text", text: "..." }]     }
Groq:      { finish_reason: "stop",     message: { role: "assistant", content: "..." } }
Cohere:    { finish_reason: "COMPLETE", text: "..."                                   }
```

Without adapters, your agent code becomes a nest of provider-specific `if` statements. lemura's adapter layer eliminates this permanently.

---

## The IProviderAdapter Interface

```typescript
interface IProviderAdapter {
  // Identity
  readonly name: string;       // e.g., 'openai', 'anthropic'
  readonly version: string;    // adapter version

  // Text completion
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  stream(request: CompletionRequest): AsyncIterable<CompletionChunk>;

  // Multimodal (implement only what your provider supports)
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResponse>;   // ASR
  synthesize(request: SynthesisRequest): AsyncIterable<AudioChunk>;            // TTS
  describeImage(request: VisionRequest): Promise<VisionResponse>;              // Vision
  generateImage(request: ImageGenRequest): Promise<ImageGenResponse>;          // Image gen

  // Utilities
  estimateTokens(text: string): number;
  getModelInfo(): ModelInfo;
  healthCheck(): Promise<boolean>;
}
```

**Adapters only implement what they support.** Unimplemented optional methods throw `LemuraAdapterError` with code `CAPABILITY_NOT_SUPPORTED`.

---

## CompletionRequest & Response

These are the normalized types your adapter works with:

```typescript
interface CompletionRequest {
  model: string;
  messages: NormalizedMessage[];
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
  stream?: boolean;
  systemPrompt?: string;
}

interface CompletionResponse {
  content: string;
  toolCalls?: ToolCall[];
  finishReason: 'stop' | 'tool_call' | 'max_tokens' | 'error';  // always normalized
  usage: TokenUsage;
  rawResponse?: unknown;   // original provider response for debugging
}
```

The `finishReason` field is the most important normalization. Every provider uses different stop reason strings — lemura normalizes all of them to exactly four values.

---

## The Built-In: OpenAICompatibleAdapter

lemura ships with one bundled adapter that supports **any OpenAI-compatible API**:

```typescript
import { OpenAICompatibleAdapter } from 'lemura/adapters';

const adapter = new OpenAICompatibleAdapter({
  baseUrl: 'https://api.openai.com/v1',
  apiKey: process.env.OPENAI_API_KEY!,
  defaultModel: 'gpt-4o',
  timeout: 30_000,           // optional, ms
  retry: {
    maxRetries: 3,
    baseDelayMs: 500,        // exponential backoff: 500ms, 1s, 2s
  },
});
```

### Compatible Providers

This single adapter connects to all of these:

| Provider | Base URL | Notes |
|---|---|---|
| **OpenAI** | `https://api.openai.com/v1` | GPT-4o, o3, etc. |
| **Azure OpenAI** | `https://{resource}.openai.azure.com/openai/deployments/{deployment}` | Add `api-version` header |
| **Groq** | `https://api.groq.com/openai/v1` | Ultra-fast Llama/Mistral |
| **Together AI** | `https://api.together.xyz/v1` | Open-source model hosting |
| **Ollama** | `http://localhost:11434/v1` | Local inference |
| **LM Studio** | `http://localhost:1234/v1` | Local GUI-based inference |
| **Any custom OpenAI-compatible endpoint** | Your URL | Pass `defaultHeaders` for auth |

```typescript
// Groq — same adapter, different URL
const groqAdapter = new OpenAICompatibleAdapter({
  baseUrl: 'https://api.groq.com/openai/v1',
  apiKey: process.env.GROQ_API_KEY!,
  defaultModel: 'llama-3.3-70b-versatile',
});

// Local Ollama — no API key needed
const ollamaAdapter = new OpenAICompatibleAdapter({
  baseUrl: 'http://localhost:11434/v1',
  apiKey: 'ollama',            // required by the client but unused
  defaultModel: 'llama3.2',
});
```

---

## Switching Providers

This is lemura's killer feature. To switch from OpenAI to Groq in production:

```typescript
// Before
const session = new SessionManager({
  adapter: new OpenAICompatibleAdapter({ baseUrl: 'https://api.openai.com/v1', ...openaiConfig }),
  model: 'gpt-4o',
  // ...rest of config unchanged
});

// After — one line change, everything else stays identical
const session = new SessionManager({
  adapter: new OpenAICompatibleAdapter({ baseUrl: 'https://api.groq.com/openai/v1', ...groqConfig }),
  model: 'llama-3.3-70b-versatile',
  // ...identical config
});
```

Your tools, skills, compression strategies, RAG adapter — none of it changes.

---

## Writing a Custom Adapter

Need to support a provider that isn't OpenAI-compatible? Implement `IProviderAdapter`:

```typescript
import type { IProviderAdapter, CompletionRequest, CompletionResponse } from 'lemura/types';
import { LemuraAdapterError } from 'lemura';

export class AnthropicAdapter implements IProviderAdapter {
  readonly name = 'anthropic';
  readonly version = '1.0.0';

  constructor(private config: { apiKey: string; defaultModel: string }) {}

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    let rawResponse: unknown;

    try {
      // Call the Anthropic API directly (no SDK — raw fetch)
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: request.model || this.config.defaultModel,
          max_tokens: request.maxTokens ?? 4096,
          messages: this.normalizeMessages(request.messages),
          system: request.systemPrompt,
        }),
      });

      if (!response.ok) {
        throw new LemuraAdapterError(
          `Anthropic API error: ${response.status} ${response.statusText}`,
          'PROVIDER_ERROR',
          { status: response.status }
        );
      }

      rawResponse = await response.json();
    } catch (err) {
      if (err instanceof LemuraAdapterError) throw err;
      throw new LemuraAdapterError(`Network error: ${String(err)}`, 'NETWORK_ERROR');
    }

    return this.normalizeResponse(rawResponse);
  }

  private normalizeFinishReason(anthropicReason: string): CompletionResponse['finishReason'] {
    switch (anthropicReason) {
      case 'end_turn':    return 'stop';
      case 'tool_use':    return 'tool_call';
      case 'max_tokens':  return 'max_tokens';
      default:            return 'error';
    }
  }

  // ... implement stream(), estimateTokens(), healthCheck(), etc.
}
```

### Custom Adapter Checklist

- [ ] Normalize `finishReason` to `'stop' | 'tool_call' | 'max_tokens' | 'error'`
- [ ] Wrap all HTTP errors in `LemuraAdapterError` (include HTTP status in metadata)
- [ ] Never leak provider-specific types in return values
- [ ] Implement retry logic for 429 and 503 status codes
- [ ] Implement `healthCheck()` — return `false` on failure, never throw
- [ ] Run the adapter contract tests: `pnpm test tests/contracts/adapter.contract.test.ts`

---

## Retry & Rate Limit Handling

`OpenAICompatibleAdapter` automatically handles rate limits:

```typescript
const adapter = new OpenAICompatibleAdapter({
  baseUrl: '...',
  apiKey: '...',
  defaultModel: 'gpt-4o',
  retry: {
    maxRetries: 5,
    baseDelayMs: 1000,   // First retry after 1s, then 2s, 4s, 8s, 16s
  },
});
```

For custom adapters, implement the same pattern:

```typescript
async function withRetry<T>(fn: () => Promise<T>, config: RetryConfig): Promise<T> {
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRetryable = err instanceof LemuraAdapterError &&
        [429, 503].includes(err.metadata?.status);

      if (!isRetryable || attempt === config.maxRetries) throw err;
      await new Promise(r => setTimeout(r, config.baseDelayMs * 2 ** attempt));
    }
  }
  throw new Error('Unreachable');
}
```

---

## Multimodal Capabilities

lemura's adapter interface covers the full AI modality spectrum:

```typescript
// ASR — transcribe audio to text
const transcript = await adapter.transcribe({
  audio: audioBlob,
  mimeType: 'audio/webm',
  languageHint: 'en',
});
// → { transcript: "Hello world", confidence: 0.98, detectedLanguage: "en" }

// TTS — synthesize text to speech (always streaming)
for await (const chunk of adapter.synthesize({
  text: "Welcome to lemura",
  voiceId: 'alloy',
  format: 'mp3',
})) {
  audioBuffer.push(chunk.data);
}

// Vision — describe an image
const vision = await adapter.describeImage({
  imageUrl: 'https://example.com/chart.png',
  prompt: 'What trend does this chart show?',
});
// → { description: "The chart shows upward growth from 2022 to 2025", objects: [...] }
```

Calling an unimplemented capability throws:
```typescript
LemuraAdapterError: "transcribe is not supported by this adapter"
// err.code === 'CAPABILITY_NOT_SUPPORTED'
```

---

## When Things Go Wrong

**`CAPABILITY_NOT_SUPPORTED`**
You called `transcribe()`, `synthesize()`, `describeImage()`, or `generateImage()` on an adapter that doesn't implement it. Check the adapter's documentation for supported capabilities.

**`PROVIDER_ERROR` with status 401**
Invalid API key. Check your environment variables.

**`PROVIDER_ERROR` with status 429**
Rate limit hit. Increase `retry.maxRetries` or throttle your request rate.

**`finishReason: 'error'` in the response**
The provider returned an unexpected stop reason. Check `rawResponse` for the original payload.

**Streaming stops early**
Always consume the full `AsyncIterable` in a `for await...of` loop — don't break early unless you explicitly call `.return()` to trigger cleanup.
