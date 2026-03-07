# Writing a Custom Adapter

If your provider doesn't offer an OpenAI-compatible API, implement `IProviderAdapter` from scratch. This guide walks through every method with working examples.

---

## When to Write a Custom Adapter

- Your provider has a unique API shape (e.g., raw Anthropic, Cohere, AI21)
- You need to add middleware between lemura and the provider (logging, request transformation, caching)
- You're wrapping an existing SDK to add retry logic or custom auth

---

## The Full Interface

```typescript
interface IProviderAdapter {
  // Identity (required)
  readonly name: string;
  readonly version: string;

  // Text (required)
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  stream(request: CompletionRequest): AsyncIterable<CompletionChunk>;

  // Multimodal (implement only what you support)
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResponse>;
  synthesize(request: SynthesisRequest): AsyncIterable<AudioChunk>;
  describeImage(request: VisionRequest): Promise<VisionResponse>;
  generateImage(request: ImageGenRequest): Promise<ImageGenResponse>;

  // Utilities (required)
  estimateTokens(text: string): number;
  getModelInfo(): ModelInfo;
  healthCheck(): Promise<boolean>;
}
```

**For unimplemented methods**, throw `LemuraAdapterError` with code `CAPABILITY_NOT_SUPPORTED`:

```typescript
async transcribe(request: TranscriptionRequest): Promise<TranscriptionResponse> {
  throw new LemuraAdapterError(
    'transcribe is not supported by the Anthropic adapter',
    'CAPABILITY_NOT_SUPPORTED'
  );
}
```

---

## Complete Anthropic Adapter Example

```typescript
import type {
  IProviderAdapter,
  CompletionRequest,
  CompletionResponse,
  CompletionChunk,
} from 'lemura/types';
import { LemuraAdapterError } from 'lemura';

interface AnthropicConfig {
  apiKey: string;
  defaultModel: string;
  maxRetries?: number;
}

export class AnthropicAdapter implements IProviderAdapter {
  readonly name = 'anthropic';
  readonly version = '1.0.0';

  constructor(private config: AnthropicConfig) {}

  // ─── Text Completion ──────────────────────────────────────────
  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const rawResponse = await this.fetchWithRetry({
      method: 'POST',
      url: 'https://api.anthropic.com/v1/messages',
      body: {
        model: request.model || this.config.defaultModel,
        max_tokens: request.maxTokens ?? 4096,
        temperature: request.temperature,
        stop_sequences: request.stopSequences,
        system: request.systemPrompt,
        messages: this.normalizeMessages(request.messages),
        // Map lemura tool definitions to Anthropic format
        tools: request.tools?.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        })),
      },
    });

    return this.normalizeResponse(rawResponse);
  }

  // ─── Streaming ────────────────────────────────────────────────
  async *stream(request: CompletionRequest): AsyncIterable<CompletionChunk> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        ...this.buildRequestBody(request),
        stream: true,
      }),
    });

    if (!response.ok || !response.body) {
      throw new LemuraAdapterError(
        `Anthropic API error: ${response.status}`,
        'PROVIDER_ERROR',
        { status: response.status }
      );
    }

    // Parse Anthropic SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') return;

        try {
          const event = JSON.parse(data);
          const chunk = this.normalizeStreamChunk(event);
          if (chunk) yield chunk;
        } catch {
          // Skip malformed lines
        }
      }
    }
  }

  // ─── Utilities ────────────────────────────────────────────────
  estimateTokens(text: string): number {
    // Anthropic uses a ~3.5 chars/token ratio
    return Math.ceil(text.length / 3.5);
  }

  getModelInfo() {
    return {
      name: this.config.defaultModel,
      provider: 'anthropic',
      capabilities: ['text', 'vision', 'tool_use'],
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch('https://api.anthropic.com/v1/models', {
        headers: this.getHeaders(),
      });
      return response.ok;
    } catch {
      return false;  // Never throw — always return boolean
    }
  }

  // ─── Private helpers ─────────────────────────────────────────
  private normalizeResponse(raw: unknown): CompletionResponse {
    const r = raw as {
      content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
      stop_reason: string;
      usage: { input_tokens: number; output_tokens: number };
    };

    const textContent = r.content.find(c => c.type === 'text');
    const toolUseContent = r.content.filter(c => c.type === 'tool_use');

    return {
      content: textContent?.text ?? '',
      toolCalls: toolUseContent.map(t => ({
        id: t.id!,
        name: t.name!,
        arguments: t.input as Record<string, unknown>,
      })),
      finishReason: this.normalizeFinishReason(r.stop_reason),
      usage: {
        promptTokens: r.usage.input_tokens,
        completionTokens: r.usage.output_tokens,
        totalTokens: r.usage.input_tokens + r.usage.output_tokens,
      },
      rawResponse: raw,
    };
  }

  private normalizeFinishReason(reason: string): CompletionResponse['finishReason'] {
    // THIS IS THE MOST CRITICAL NORMALIZATION
    switch (reason) {
      case 'end_turn':   return 'stop';
      case 'tool_use':   return 'tool_call';
      case 'max_tokens': return 'max_tokens';
      default:           return 'error';
    }
  }

  private normalizeMessages(messages: NormalizedMessage[]) {
    return messages
      .filter(m => m.role !== 'system')  // Anthropic uses separate 'system' field
      .map(m => ({
        role: m.role === 'tool' ? 'user' : m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      }));
  }

  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.config.apiKey,
      'anthropic-version': '2023-06-01',
    };
  }

  private async fetchWithRetry(options: {
    method: string;
    url: string;
    body: unknown;
  }): Promise<unknown> {
    const maxRetries = this.config.maxRetries ?? 3;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const response = await fetch(options.url, {
        method: options.method,
        headers: this.getHeaders(),
        body: JSON.stringify(options.body),
      });

      if (response.ok) return await response.json();

      const isRetryable = [429, 503].includes(response.status);
      if (!isRetryable || attempt === maxRetries) {
        throw new LemuraAdapterError(
          `Anthropic API error: ${response.status} ${response.statusText}`,
          'PROVIDER_ERROR',
          { status: response.status }
        );
      }

      // Exponential backoff: 500ms, 1s, 2s, 4s...
      await new Promise(r => setTimeout(r, 500 * 2 ** attempt));
    }

    throw new LemuraAdapterError('Unreachable', 'UNKNOWN');
  }
}
```

---

## Running Contract Tests

After building your adapter, run the adapter contract test suite:

```bash
pnpm test tests/contracts/adapter.contract.test.ts --adapter=./dist/AnthropicAdapter.js
```

The contract tests verify:
- `complete()` returns a valid `CompletionResponse`
- `stream()` yields at least one chunk and a final chunk with `finished: true`
- `finishReason` is always one of the four normalized values
- Errors from the provider become `LemuraAdapterError` instances
- `estimateTokens()` returns a positive integer for any non-empty string
- `healthCheck()` returns `boolean`, never throws

**Your adapter is not ready for production until all contract tests pass.**

---

## Custom Adapter Checklist

```
✅ Adaptor Checklist
───────────────────────────────────────────────────────
[ ] normalizeFinishReason() maps all provider values → lemura 4 values
[ ] All HTTP errors wrapped in LemuraAdapterError with HTTP status metadata
[ ] No provider-specific types in return values (no raw API response types)
[ ] Retry logic for 429 and 503 with exponential backoff
[ ] healthCheck() returns false on failure, never throws
[ ] stream() is a proper async generator — cleans up on early break
[ ] estimateTokens() returns a positive integer for any non-empty string
[ ] getModelInfo() returns at minimum { name, provider }
[ ] All unsupported methods throw LemuraAdapterError('...', 'CAPABILITY_NOT_SUPPORTED')
[ ] Contract test suite passes: pnpm test tests/contracts/adapter.contract.test.ts
```

---

## Tips & Tricks

> **Tip:** The hardest part is usually message format normalization. Different providers handle `system` messages, tool results, and multi-turn differently. Draw out the expected provider API format on paper first before coding.

> **Tip:** For the `stream()` method, always use a `try/finally` to release the reader:
> ```typescript
> const reader = response.body.getReader();
> try {
>   // ... yield chunks
> } finally {
>   reader.releaseLock();
> }
> ```

> **Tip:** Keep `rawResponse` in `CompletionResponse`. It's invaluable for debugging prod issues where the normalized response doesn't look right — you can inspect the original payload.
