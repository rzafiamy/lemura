<p align="center">
  <img src="https://raw.githubusercontent.com/rzafiamy/lemura/main/sites/docs/public/lemura-logo.png" alt="lemura logo" width="200" />
</p>

# lemura

**A provider-agnostic, premium agentic AI runtime for the modern web.**

[![npm version](https://img.shields.io/npm/v/lemura.svg?style=flat-square)](https://www.npmjs.com/package/lemura)
[![license](https://img.shields.io/npm/l/lemura.svg?style=flat-square)](./LICENSE)
[![docs](https://img.shields.io/badge/docs-lemura.makix.fr-blue?style=flat-square)](https://lemura.makix.fr)
[![build](https://img.shields.io/github/actions/workflow/status/rzafiamy/lemura/ci.yml?branch=main&style=flat-square)](https://github.com/rzafiamy/lemura/actions)
[![coverage](https://img.shields.io/codecov/c/github/rzafiamy/lemura?style=flat-square)](https://codecov.io/gh/rzafiamy/lemura)

---

`lemura` is a robust, provider-agnostic npm package designed to encapsulate a full agentic AI runtime. It simplifies the complex orchestration of LLMs, tools, and context management into a single, cohesive interface.

### ❓ Why lemura?

- **Zero Lock-in**: Switch between OpenAI, Anthropic, Groq, or local Ollama instances by changing one line of code.
- **Production Ready**: Built-in context compression, tool retry logic, and execution budget enforcement.
- **Developer First**: Premium logging, native TypeScript types, and Model Context Protocol (MCP) support.

### ✨ Key Features

- **🧠 Dynamic Skill Market**: Switch skills on/off at runtime via tags, names, or tool dependencies.
- **🔌 Native MCP Support**: Connect to any Model Context Protocol server with custom header support (Auth).
- **🛡️ Tool Firewall**: Fully integrated ask/accept/deny policy layer for secure tool execution — fail-safe by design.
- **🎯 Goal Maintenance & Verification**: LLM-powered sub-goal decomposition, progress reconciliation, and post-run goal verification that re-enters the loop with full tool access to finish incomplete answers.
- **🧹 Context Compression**: Sandwich, history, and summary-injection strategies keep long conversations within budget while ensuring the model never "forgets" the context.
- **🌊 Native Streaming**: `run()` and `stream()` share one ReAct core — `stream()` completes all tool use and verification, then emits the final answer token-by-token.
- **📚 RAG Connector**: Pluggable `IRAGAdapter` interface plus a bundled in-memory adapter for ingest → query → context injection.
- **📊 Observability**: Detailed tracing, token tracking, and structured logging with actionable hints.

## 🚀 Install

```bash
pnpm add lemura
# or
npm install lemura
```

## ⚙️ Environment Variables

The built-in `OpenAICompatibleAdapter` can be configured using environment variables. To load them from a `.env` file in Node.js, you'll typically need a library like `dotenv`:

```bash
npm install dotenv
```

Then at the very top of your entry point:

```ts
import 'dotenv/config';
```

Create a `.env` file in your project root:

```ini
# Provider Configuration (OpenAI, Groq, Together, Ollama, etc.)
LEMURA_API_KEY=your_api_key_here
LEMURA_BASE_URL=https://api.openai.com/v1
LEMURA_MODEL=gpt-4o-mini

# Fallbacks (Lemura also checks standard OpenAI variables)
OPENAI_API_KEY=your_api_key_here
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
```

## ⚡ Quick Start

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

  // Or stream the final response token-by-token
  for await (const token of session.stream('What is lemura?')) {
    process.stdout.write(token);
  }
}

main();
```

### 🛠️ Quick Start: Creating a Tool

Adding tools to your agent is straightforward using the standard `IToolDefinition` interface.

```ts
import { IToolDefinition } from 'lemura';

const getWeather: IToolDefinition = {
  name: 'get_weather',
  description: 'Get the current weather for a specific city',
  parameters: {
    type: 'object',
    properties: {
      city: { type: 'string', description: 'The name of the city' }
    },
    required: ['city']
  },
  execute: async ({ city }) => {
    // Call your weather API here
    return `The weather in ${city} is sunny, 22°C.`;
  }
};

// Register it when creating the session
const session = new SessionManager({
  adapter,
  model: 'gpt-4o-mini',
  tools: [getWeather]
});
```

## 🧠 Core Concepts

Explore the architecture and advanced capabilities of `lemura` at [lemura.makix.fr](https://lemura.makix.fr) or browse the local guides:

- 🏁 [**Getting Started**](./docs/guides/getting-started.md) — Fundamental setup and concepts.
- 🧹 [**Context Management**](./docs/guides/context-management.md) — Advanced compression strategies.
- 🔌 [**Adapters**](./docs/guides/adapters.md) — Connecting to OpenAI, Groq, Anthropic, and more.
- 🛠️ [**Tools and Skills**](./docs/guides/tools-and-skills.md) — Extending agent capabilities.
- 🎛️ [**Media Bridge**](./docs/guides/media-bridge.md) — ASR, TTS, vision, and image generation.
- ⚡ [**Advanced Execution**](./docs/guides/advanced-execution.md) — Goal planning and continuation.

## 📦 API Overview

| Export | Description |
|---|---|
| `SessionManager` | The main entry point orchestrating the ReAct loop, tools, goals, and streaming. |
| `ContextManager` | Manages the conversation history using pluggable compression strategies. |
| `OpenAICompatibleAdapter` | Reference adapter for OpenAI, Groq, Together, Ollama, and any OpenAI-compatible endpoint. |
| `ToolRegistry` | Registers, validates, and executes tools with timeout and budget enforcement. |
| `SkillInjector` | Loads and formats YAML/Markdown skills into system prompts. |
| `MCPClient` / `MCPClientRegistry` | Connect to Model Context Protocol servers and register their tools. |
| `InMemoryRAGAdapter` | Self-contained RAG adapter for testing the ingest → query round-trip. |
| `DefaultLogger` | Colorized logger with Problem/Hints metadata support. |

### Subpath Exports

Each layer is independently importable so consumers only bundle what they use:

```ts
import { SandwichCompressionStrategy } from 'lemura/context';
import { OpenAICompatibleAdapter }      from 'lemura/adapters';
import { ToolRegistry }                 from 'lemura/tools';
import { SkillInjector }                from 'lemura/skills';
import { InMemoryRAGAdapter }           from 'lemura/rag';
import { MCPClient }                    from 'lemura/mcp';
import { DefaultLogger }                from 'lemura/logger';
```

## 🪵 Logging and Tracing

`lemura` features a premium, structured logging system designed for developer experience. It provides colorized output and actionable hints for errors.

```ts
import { SessionManager, DefaultLogger, LogLevel } from 'lemura';

const logger = new DefaultLogger();
logger.setLevel(LogLevel.DEBUG); // Set to show trace-level information

const session = new SessionManager({
  adapter,
  model: 'gpt-4o-mini',
  maxTokens: 100000,
  logger: logger // Inject the logger
});
```

When an error occurs (like an invalid API key), `lemura` provides beautiful, structured feedback:

```text
2026-03-07T13:05:49.686Z [FATAL] Provider call failed: HTTP 401: Unauthorized
  PROBLEM: Authentication failed. The API key is invalid or missing.
  HINTS:
    - Ensure your API key is correctly configured in the adapter or environment variables.
    - Check if the API key has expired or been revoked.
```

## 🔌 Provider Adapters

`lemura` interacts with LLMs exclusively through the `IProviderAdapter` interface, ensuring zero lock-in.

| Adapter | Status | Description |
|---|---|---|
| `OpenAICompatibleAdapter` | ✅ Built-in | Wrapper for OpenAI and API-compatible endpoints. |

> [!TIP]
> To write a custom adapter for another provider, see the [Custom Adapter Recipe](./docs/recipes/custom-adapter.md).

## 🤝 Contributing

We welcome contributions! Please read our [Internal Rules](./.agent/rules/Project.md) and [Documentation Guidelines](./.agent/rules/Documentation.md) before submitting a PR.

## 📄 License

Distributed under the **MIT License**. See `LICENSE` for more information.
