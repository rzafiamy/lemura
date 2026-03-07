---
trigger: always_on
---

# lemura — Provider Adapter Rules

## Purpose

The adapter layer is lemura's interface to the outside world. Its sole job is to **normalize** different AI provider APIs into lemura's internal types. No business logic lives here — only translation.

---

## IProviderAdapter Interface (complete)

```
IProviderAdapter {
  // Identity
  readonly name: string           // e.g. 'openai', 'anthropic', 'custom'
  readonly version: string        // adapter version, not provider version

  // Text completion
  complete(request: CompletionRequest): Promise<CompletionResponse>
  stream(request: CompletionRequest): AsyncIterable<CompletionChunk>

  // Multimodal
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResponse>   // ASR
  synthesize(request: SynthesisRequest): AsyncIterable<AudioChunk>            // TTS
  describeImage(request: VisionRequest): Promise<VisionResponse>              // Vision
  generateImage(request: ImageGenRequest): Promise<ImageGenResponse>          // Image gen

  // Utilities
  estimateTokens(text: string): number
  getModelInfo(): ModelInfo

  // Lifecycle
  healthCheck(): Promise<boolean>
}
```

Adapters implement only the methods they support. Unimplemented optional methods should throw `LemuraAdapterError` with code `CAPABILITY_NOT_SUPPORTED`.

---

## CompletionRequest / Response Types

```
CompletionRequest {
  model: string
  messages: NormalizedMessage[]
  tools?: ToolDefinition[]
  maxTokens?: number
  temperature?: number
  stopSequences?: string[]
  stream?: boolean
  systemPrompt?: string
}

CompletionResponse {
  content: string
  toolCalls?: ToolCall[]
  finishReason: 'stop' | 'tool_call' | 'max_tokens' | 'error'
  usage: TokenUsage
  rawResponse?: unknown           // original provider response, for debugging
}

CompletionChunk {
  delta: string
  toolCallDelta?: Partial<ToolCall>
  finished: boolean
  finishReason?: CompletionResponse['finishReason']
}
```

---

## Adapter Implementation Rules

1. **Never leak provider-specific types** into the return values. Everything returned must conform to lemura's internal types.
2. **Always normalize `finishReason`** — providers use different strings (`stop`, `end_turn`, `length`, `COMPLETE`, etc.). Map all to the lemura enum.
3. **Wrap all HTTP errors** in `LemuraAdapterError`. Include the HTTP status code in the error metadata.
4. **Implement retry logic** for transient errors (429 rate limits, 503 service unavailable) with exponential backoff. Config: `{ maxRetries: number, baseDelayMs: number }`.
5. **Never buffer streaming responses** internally — pass chunks through immediately as received.
6. **Tool call normalization**: providers return tool calls in different formats (parallel vs sequential, different ID formats). Normalize to lemura's `ToolCall[]` before returning.

---

## Reference OpenAI-Compatible Adapter

The bundled reference adapter (`src/adapters/OpenAICompatibleAdapter.ts`) supports any provider with an OpenAI-compatible API:

- OpenAI
- Azure OpenAI
- Together AI
- Groq
- Ollama (local)
- Any other OpenAI-API-compatible endpoint

Config shape:
```
OpenAICompatibleAdapterConfig {
  baseUrl: string          // e.g. 'https://api.openai.com/v1'
  apiKey: string
  defaultModel: string
  defaultHeaders?: Record<string, string>
  timeout?: number         // ms, default 30000
  retry?: RetryConfig
}
```

---

## Writing a Custom Adapter

To implement a custom adapter:

1. Create a class implementing `IProviderAdapter`
2. Implement only the capabilities your provider supports
3. For unsupported methods: throw `new LemuraAdapterError('...', 'CAPABILITY_NOT_SUPPORTED')`
4. Run the adapter contract test suite against your implementation:
   ```bash
   pnpm test tests/contracts/adapter.contract.test.ts --adapter=./my-adapter
   ```
5. The contract test validates all required methods and error normalization

---

## Adapter Contract Test Suite

All adapters (built-in and community) must pass these contract tests:

- `complete()` returns a valid `CompletionResponse`
- `stream()` yields at least one `CompletionChunk` and a final chunk with `finished: true`
- `finishReason` is always one of the four normalized values
- Errors from the provider become `LemuraAdapterError` instances
- `estimateTokens()` returns a positive integer for any non-empty string
- `healthCheck()` returns `true` on success and `false` (not throw) on connectivity failure

---

## ASR / TTS / Vision / ImageGen Notes

**ASR (transcribe)**:
- Input: audio blob + MIME type + optional language hint
- Output: transcript string + confidence + detected language

**TTS (synthesize)**:
- Input: text + voice ID + format (mp3, wav, pcm)
- Output: `AsyncIterable<AudioChunk>` — always streaming, even if provider returns all-at-once (wrap in single-chunk iterable)

**Vision (describeImage)**:
- Input: image as base64 or URL + optional prompt
- Output: description string + detected objects array

**Image Generation**:
- Input: prompt + dimensions + style hints
- Output: URL or base64 of generated image + revised prompt (some providers rewrite the prompt)