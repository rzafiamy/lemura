# lemura

lemura is a provider-agnostic npm package that encapsulates a full agentic AI runtime.

## Install

```bash
npm install lemura
```

## Quick Start

```ts
import { SessionManager, OpenAICompatibleAdapter } from 'lemura';

async function main() {
  const adapter = new OpenAICompatibleAdapter({
    baseUrl: 'https://api.openai.com/v1',
    apiKey: process.env.OPENAI_API_KEY || '',
    defaultModel: 'gpt-4o-mini'
  });

  const session = new SessionManager({
    adapter,
    model: 'gpt-4o-mini',
    maxTokens: 100000,
  });

  const response = await session.run('What is lemura?');
  console.log(response);
}

main();
```

## Core Concepts

- [Getting Started](./docs/guides/getting-started.md)
- [Context Management](./docs/guides/context-management.md)
- [Adapters](./docs/guides/adapters.md)
- [Tools and Skills](./docs/guides/tools-and-skills.md)
- [Advanced Execution](./docs/guides/advanced-execution.md)

## API Overview

| Export | Description |
|---|---|
| `SessionManager` | The main entry point orchestrating the ReAct loop and tools. |
| `ContextManager` | Manages the conversation history using compression strategies. |
| `OpenAICompatibleAdapter` | Reference adapter for OpenAI, Groq, Together, etc. |
| `ToolRegistry` | Registers and executes tools for the agent. |
| `SkillInjector` | Loads and formats YAML/Markdown skills into system prompts. |

## Provider Adapters

lemura interacts with LLMs exclusively through the `IProviderAdapter` interface.

| Adapter | Status | Description |
|---|---|---|
| `OpenAICompatibleAdapter` | Built-in | Wrapper for OpenAI and API-compatible endpoints. |

To write a custom adapter for another provider, see the [Custom Adapter Recipe](./docs/recipes/custom-adapter.md).

## Contributing

Please read the internal rules and documentation guidelines before contributing.

## License

MIT
