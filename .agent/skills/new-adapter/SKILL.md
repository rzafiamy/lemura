---
name: lemura-new-adapter
description: Implements a new IProviderAdapter for lemura. Use when adding support for a new AI provider (OpenAI, Anthropic, Groq, Ollama, Azure, etc.) or writing a custom adapter to wrap an existing API client. Covers request/response normalization, finishReason mapping, streaming, and the contract test suite.
---

# Lemura: Implementing a New Provider Adapter

## When to use this skill

- Adding a new provider (Anthropic, Groq, Together AI, Ollama, Azure OpenAI, etc.)
- Wrapping an existing in-app API client behind `IProviderAdapter`
- Fixing a normalization bug in an existing adapter
- Adding multimodal support (ASR, TTS, vision, image gen) to an existing adapter

## The golden rule

**Never let provider-specific types escape the adapter.** Everything that goes in is `lemura`-typed. Everything that comes out is `lemura`-typed. The adapter is a one-way translation booth.

## File to create

```
src/adapters/MyProviderAdapter.ts          # for built-in adapters
# or
packages/lemura-adapter-myprovider/src/index.ts   # for standalone packages
```

## Required method checklist

### `complete(request: CompletionRequest): Promise<CompletionResponse>`
- [ ] Maps `request.messages` to provider format (role names vary: `tool` vs `function`, `assistant` vs `model`)
- [ ] Handles `request.systemPrompt` — some providers use a `system` field, others need a prepended system message
- [ ] Maps `request.tools` to provider's function/tool schema format
- [ ] Normalizes response: `content`, `toolCalls[]`, `finishReason`, `usage`
- [ ] `finishReason` is ALWAYS one of: `'stop' | 'tool_call' | 'max_tokens' | 'error'`
- [ ] Wraps ALL HTTP errors in `LemuraAdapterError` with original as `cause`

### `stream(request: CompletionRequest): AsyncIterable<CompletionChunk>`
- [ ] Returns `AsyncIterable<CompletionChunk>` — never a Promise of an array
- [ ] Each chunk: `{ delta: string, finished: boolean, finishReason? }`
- [ ] Final chunk always has `finished: true` and a `finishReason`
- [ ] Accumulates tool call deltas correctly if streamed in fragments
- [ ] Handles premature stream close → emit final chunk with `finishReason: 'error'`

### `estimateTokens(text: string): number`
- [ ] Returns a positive integer for any non-empty string
- [ ] Uses provider tokenizer endpoint if available
- [ ] Fallback: `Math.ceil(text.length / 4)` with a comment explaining it's approximate

### `healthCheck(): Promise<boolean>`
- [ ] Makes a minimal API call (list models, 1-token completion)
- [ ] Returns `true` on success, `false` on failure
- [ ] **NEVER throws** — catches everything and returns `false`

## finishReason normalization map

| What provider sends | What lemura expects |
|---|---|
| `'stop'` | `'stop'` |
| `'end_turn'` | `'stop'` |
| `'COMPLETE'` | `'stop'` |
| `'tool_calls'` | `'tool_call'` |
| `'tool_use'` | `'tool_call'` |
| `'length'` | `'max_tokens'` |
| `'MAX_TOKENS'` | `'max_tokens'` |
| anything else | `'error'` |

## Tool call normalization

```ts
// Output must always be this shape — regardless of what the provider sends
type ToolCall = {
  id: string       // use provider's ID, or crypto.randomUUID() if absent
  name: string     // function/tool name
  arguments: string  // JSON string — NOT a parsed object
}
```

## Config shape convention

```ts
interface MyProviderAdapterConfig {
  baseUrl: string           // allows local/proxy overrides
  apiKey: string            // never hardcode
  defaultModel: string      // used when request.model is absent
  timeout?: number          // default: 30000
  retry?: RetryConfig       // default: { maxRetries: 3, baseDelayMs: 1000 }
  defaultHeaders?: Record<string, string>
}
```

All fields except `apiKey` and `defaultModel` must have defaults.

## Unimplemented capabilities

If the provider does not support a method (e.g. no TTS endpoint):

```ts
synthesize(): AsyncIterable<AudioChunk> {
  throw new LemuraAdapterError(
    'MyProvider does not support speech synthesis',
    'CAPABILITY_NOT_SUPPORTED'
  );
}
```

Never omit the method — always implement with a clear error.

## Contract test

Before merging, run:
```bash
pnpm test tests/contracts/adapter.contract.test.ts
```

The contract test validates: completion, streaming, finish reason normalization, error wrapping, estimateTokens, healthCheck. All must pass — no exceptions.