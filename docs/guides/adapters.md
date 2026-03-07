# Adapters 

## What this is
The adapter layer is lemura's interface to the outside world. Its purpose is to normalize different AI provider APIs into lemura's specific `IProviderAdapter` and Completion Types.

## How it works

Adapters implement the `IProviderAdapter` interface defined in `src/types/adapters.ts`.
This covers `complete({ model, messages, tools ... })`, `stream({ ... })`, and optional multimodal capabilities. If an optional request capability doesn't exist for the underlying LLM, it throws a `LemuraAdapterError` matching `CAPABILITY_NOT_SUPPORTED`.

```ts
interface IProviderAdapter {
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  stream(request: CompletionRequest): AsyncIterable<CompletionChunk>;
  // ...
}
```

## Configuration

| Field | Type | Default | Description |
|---|---|---|---|
| `baseUrl` | `string` | Required | Open-AI compatible server |
| `apiKey` | `string` | Required | The provider token |
| `defaultModel` | `string` | `'gpt-4o'` | Model backup |

## Examples

```ts
import { OpenAICompatibleAdapter } from 'lemura/adapters';

const gptAdapter = new OpenAICompatibleAdapter({
  baseUrl: 'https://api.openai.com/v1',
  apiKey: process.env.API_KEY,
  defaultModel: 'gpt-4o'
});
```

## When things go wrong
- **Unmapped `finishReason`:** Make sure your adapter normalizes arbitrary API reasons (like "end_turn") into either `stop`, `tool_call`, `max_tokens`, or `error`.
- **Unhandled Rate Limits:** The `OpenAICompatibleAdapter` automatically handles Backoff Retries. Ensure standard HTTP Status mappings are set.
