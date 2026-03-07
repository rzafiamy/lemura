# Getting Started with Lemura

## What this is
Lemura is a powerful, minimal-overhead toolkit that provides a robust ReAct (Reason + Act) agent loop. It’s built to be provider-agnostic, enabling you to build agentic workflows that can drop in a different LLM or multi-modal provider by swapping a single adapter.

## How it works
Lemura centers around a `SessionManager` which wraps:
- An `IProviderAdapter` for executing completions.
- A `ContextManager` which intelligently handles the conversation history limits.
- A `ToolRegistry` that handles complex multi-step functions using the ReAct loop.

When `SessionManager.run()` is called, the loop queries the provider, evaluates tool calls, and appends observations until finishing the underlying objective or reaching a forced error/step limit.

## Configuration

| Field | Type | Default | Description |
|---|---|---|---|
| `adapter` | `IProviderAdapter` | Required | The provider interface. |
| `model` | `string` | Required | The model identifier. |
| `maxTokens` | `number` | Required | The maximum tokens for the session context window before overflowing. |
| `maxIterations` | `number` | 10 | Max number of ReAct loop iterations before an error is thrown. |
| `tools` | `IToolDefinition[]` | `[]` | Tools injected at initialization. |

## Examples

```ts
import { SessionManager, OpenAICompatibleAdapter } from 'lemura';

const adapter = new OpenAICompatibleAdapter({
  baseUrl: 'https://api.openai.com/v1',
  apiKey: process.env.OPENAI_API_KEY || '',
  defaultModel: 'gpt-4o'
});

const session = new SessionManager({
  adapter,
  model: 'gpt-4o',
  maxTokens: 100000,
});

await session.run('Evaluate my repository.');
```

## When things go wrong

- **`LemuraMaxIterationsError`:** Make sure you're providing tools that don't infinitely loop or get stuck. Increase `maxIterations` in `SessionConfig` if the problem requires deep searching.
- **`LemuraContextOverflowError`:** Provide adequate Context Management strategies using the `compressionStrategies` property.
- **`LemuraAdapterError`:** Check your API keys and endpoint connectivity.
