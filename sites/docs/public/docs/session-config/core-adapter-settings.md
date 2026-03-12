# Core & Adapter Settings

These are the fundamental requirements for any lemura session. Without these three fields, the agent cannot initialize.

## Essential Fields

### `adapter: IProviderAdapter`
The bridge between lemura and your AI provider. It handles all HTTP communication, streaming normalization, and error retries.

```typescript
import { OpenAICompatibleAdapter } from 'lemura/adapters';

const config = {
  adapter: new OpenAICompatibleAdapter({
    baseUrl: 'https://api.openai.com/v1',
    apiKey: process.env.OPENAI_API_KEY!,
    defaultModel: 'gpt-4o'
  })
};
```

### `model: string`
The specific model ID to use for this session. This value is passed to your adapter for every request.

| Provider | Typical Model IDs |
|---|---|
| OpenAI | `gpt-4o`, `gpt-4o-mini`, `o1-preview` |
| Anthropic | `claude-3-5-sonnet-latest`, `claude-3-haiku` |
| Groq | `llama-3.3-70b-versatile`, `mixtral-8x7b-32768` |

### `maxTokens: number`
The hard limit of the context window. This is the single most important number for memory management. `ContextManager` uses this value to trigger compression strategies.

> **Rule of Thumb:** Set this to roughly 90-95% of your model's actual limit to leave a safety buffer for system prompts and tool definitions.

---

## Identity & Persona

### `systemPrompt: string`
Provides the core identity and permanent instructions for the agent. This content is **never compressed** and is always present at the top of the context window.

```typescript
systemPrompt: "You are Makix, a specialized cloud infrastructure agent. Always output JSON when requested."
```

Use `systemPrompt` for rules that must never be forgotten, and use **Skills** for more modular, behavioral instructions.
