<align="center">
  <img src="./docs/assets/logo.png" alt="lemura logo" width="200" />
</align>

# lemura

**A provider-agnostic, premium agentic AI runtime for the modern web.**

[![npm version](https://img.shields.io/npm/v/lemura.svg?style=flat-square)](https://www.npmjs.com/package/lemura)
[![license](https://img.shields.io/npm/l/lemura.svg?style=flat-square)](https://github.com/lemura-ai/lemura/blob/main/LICENSE)
[![build](https://img.shields.io/github/actions/workflow/status/lemura-ai/lemura/ci.yml?branch=main&style=flat-square)](https://github.com/lemura-ai/lemura/actions)
[![coverage](https://img.shields.io/codecov/c/github/lemura-ai/lemura?style=flat-square)](https://codecov.io/gh/lemura-ai/lemura)

---

`lemura` is a robust, provider-agnostic npm package designed to encapsulate a full agentic AI runtime. It simplifies the complex orchestration of LLMs, tools, and context management into a single, cohesive interface.

## 🚀 Install

```bash
pnpm add lemura
# or
npm install lemura
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
}

main();
```

## 🧠 Core Concepts

Explore the architecture and advanced capabilities of `lemura`:

- 🏁 [**Getting Started**](./docs/guides/getting-started.md) — Fundamental setup and concepts.
- 🧹 [**Context Management**](./docs/guides/context-management.md) — Advanced compression strategies.
- 🔌 [**Adapters**](./docs/guides/adapters.md) — Connecting to OpenAI, Groq, Anthropic, and more.
- 🛠️ [**Tools and Skills**](./docs/guides/tools-and-skills.md) — Extending agent capabilities.
- ⚡ [**Advanced Execution**](./docs/guides/advanced-execution.md) — Goal planning and continuation.

## 📦 API Overview

| Export | Description |
|---|---|
| `SessionManager` | The main entry point orchestrating the ReAct loop and tools. |
| `ContextManager` | Manages the conversation history using compression strategies. |
| `OpenAICompatibleAdapter` | Reference adapter for OpenAI, Groq, Together, etc. |
| `ToolRegistry` | Registers and executes tools for the agent. |
| `SkillInjector` | Loads and formats YAML/Markdown skills into system prompts. |

## 🔌 Provider Adapters

`lemura` interacts with LLMs exclusively through the `IProviderAdapter` interface, ensuring zero lock-in.

| Adapter | Status | Description |
|---|---|---|
| `OpenAICompatibleAdapter` | ✅ Built-in | Wrapper for OpenAI and API-compatible endpoints. |

> [!TIP]
> To write a custom adapter for another provider, see the [Custom Adapter Recipe](./docs/recipes/custom-adapter.md).

## 🤝 Contributing

We welcome contributions! Please read our [Internal Rules](./.cursor/rules/Project.md) and [Documentation Guidelines](./.cursor/rules/Documentation.md) before submitting a PR.

## 📄 License

Distributed under the **MIT License**. See `LICENSE` for more information.
