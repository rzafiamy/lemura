# Tools, Media & Extensions

Tools, skills, and external integrations are what transform a raw conversational LLM into a specialized agent capable of taking real actions. This page covers every `SessionConfig` field that controls what your agent can do, what external systems it can connect to, and how tool execution is governed.

There are three categories of extension: **Tools** (async functions the agent can call during reasoning), **Skills** (behavioral instructions injected into the system prompt), and **Integrations** (RAG adapters, MCP servers, and the Media Bridge). All of these are optional — a minimal session with just `adapter`, `model`, and `maxTokens` works fine. Add extensions one layer at a time as your use case demands them.

---

## Tools

### `tools?: IToolDefinition[]`

The array of tool definitions available to the agent in this session. Each tool must have a `name`, `description`, `parameters` JSON Schema, and an `execute` async function. Schema validation is **enforced before `execute()` is called** — invalid arguments throw `LemuraToolValidationError` and the agent receives a structured error observation.

```typescript
import type { IToolDefinition } from 'lemura/types';

const searchTool: IToolDefinition = {
  name: 'search_web',
  description: `Search the internet for current information.
Use when you need up-to-date facts, news, prices, or recent events.`,
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query. Be specific. Max 200 chars.',
      },
      numResults: {
        type: 'number',
        description: 'Results to return. Default: 5. Max: 10.',
        minimum: 1, maximum: 10,
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
  execute: async ({ query, numResults = 5 }: { query: string; numResults?: number }) => {
    const results = await webSearch(query, numResults);
    return results.map(r => `${r.title}\n${r.url}\n${r.snippet}`).join('\n\n');
  },
};

const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  tools: [searchTool, readFileTool, sendEmailTool],
});
```

> **Tip:** See [Defining Tools →](/docs/tools-and-skills/defining-tools) for the complete `IToolDefinition` interface, description writing guidelines, and common patterns.

---

### Dynamic Tool Registration

Register, unregister, or list tools at runtime after the session is created:

```typescript
const session = new SessionManager({ adapter, model: 'gpt-4o', maxTokens: 128_000 });

// Add a tool after construction (e.g., after user authenticates)
session.tools.register({
  name: 'send_payment',
  description: 'Process a payment. Only for authenticated users.',
  parameters: { ... },
  execute: async ({ amount, recipient }) => paymentService.transfer(amount, recipient),
});

// Remove when no longer needed
session.tools.unregister('send_payment');

// Inspect what's registered
const registered = session.tools.list();
console.log('Active tools:', registered.map(t => t.name));
```

---

### `parallelToolCalls?: boolean` (default: `false`)

When `true`, independent tool calls within a single assistant turn are executed in parallel using `Promise.all`. This can significantly reduce latency for agents that request multiple tools in one iteration.

```typescript
const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  parallelToolCalls: true,
  toolExecutionBudget: { maxConcurrentCalls: 4 },   // max 4 at once
});
```

> **Important:** The Tool Firewall still evaluates each call sequentially (since `onAsk` may involve async user interaction). Only calls that pass the firewall are forwarded to the parallel executor.

---

### `toolRegistryTimeoutMs?: number` (default: `30_000`)

Default timeout in milliseconds for every tool call. Individual tools can override this with their own `timeout` field. When exceeded, `LemuraToolTimeoutError` is thrown and the agent receives a structured timeout observation.

```typescript
const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  toolRegistryTimeoutMs: 60_000,   // 60s default for all tools
  tools: [
    {
      name: 'fast_lookup',
      description: 'Quick in-memory lookup.',
      parameters: { ... },
      timeout: 1_000,   // override: 1s for this specific tool
      execute: async () => cache.lookup(),
    },
    {
      name: 'slow_analytics',
      description: 'Complex analytics query — may take 2 minutes.',
      parameters: { ... },
      timeout: 120_000,  // override: 2 minutes
      execute: async (params) => runAnalytics(params),
    },
  ],
});
```

---

### `toolExecutionBudget?: ToolExecutionBudget`

Enforces call quotas at the session level — useful for cost control and preventing runaway tool usage:

```typescript
toolExecutionBudget: {
  maxCallsPerSession: 100,         // total tool calls for the entire session
  maxCallsPerTool: {
    search_web:  10,               // search_web can be called max 10 times
    run_command:  5,               // shell tool limited to 5 calls
  },
  maxConcurrentCalls: 4,           // max parallel executions
}
```

When a quota is exceeded, a `LemuraMaxIterationsError` is thrown and the session halts gracefully.

---

### `autodiscoverTools?: boolean` (default: `false`)

When `true`, lemura scans `node_modules` for packages that declare lemura tools in their `package.json`. Any package with a `"lemura"` key is loaded and its tools and skills are registered automatically.

```typescript
// In a tool package's package.json:
{
  "name": "lemura-tools-web",
  "lemura": {
    "tools": ["./dist/tools/search-web.js"],
    "skills": ["./skills/web-search-expert.md"]
  }
}

// In SessionConfig:
const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  autodiscoverTools: true,
});
```

> See [Tool Auto-Discovery →](/docs/tools-and-skills/tool-discovery) for how to build distributable tool packages.

---

## Skills

### `skills?: ISkill[]`

Skills are Markdown files injected into the system prompt to define *how* the agent thinks and behaves — independently of what tools it has. Unlike the `systemPrompt`, skills:
- Have **priorities** controlling injection order
- Are **automatically re-injected** after every context compression event
- Can be **downgraded** to shorter versions (`micro`, `nano`) if the skill budget is tight

```typescript
import { readFileSync } from 'fs';

const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  skills: [
    // Load from file (recommended for multi-line skills)
    { content: readFileSync('./skills/safety-rules.md', 'utf8') },
    { content: readFileSync('./skills/code-review-expert.md', 'utf8') },

    // Inline (good for simple, dynamic skills)
    { content: `---
name: language-preference
priority: 20
inject: system_prompt
nano: Always respond in English, regardless of the user's language.
---
Always respond in English, regardless of the input language.
Translate the user's question to English internally before answering.` },
  ],
});
```

> See [Skills System →](/docs/tools-and-skills/skills-system) for the full skill file format, injection positions, and tier/budget management.

---

### `skillTokenBudget?: number`

Maximum tokens the combined skill injection block may consume. When skills exceed this budget, they are automatically downgraded:

```
Extended (≤ 2000 tokens) → Standard (≤ 800) → Micro (≤ 300) → Nano (≤ 100) → Skipped
```

Skills with `priority < 5` are **never downgraded or skipped**, regardless of budget.

```typescript
// For a 16k context model, 10% for skills
skillTokenBudget: 1_600

// For a large 128k model, more room for rich skills
skillTokenBudget: 10_000
```

---

## RAG Integration

### `ragAdapter?: IRAGAdapter`

Connect a vector database for retrieval-augmented generation. When set, lemura automatically registers two tools: `rag_query` (searches the knowledge base) and `rag_ingest` (adds new documents).

```typescript
import { InMemoryRAGAdapter } from 'lemura/rag';

const rag = new InMemoryRAGAdapter();
await rag.ingest({
  documents: [
    { id: 'doc-1', content: 'Paris trip: decided on train, budget €800.', metadata: { category: 'travel' } },
    { id: 'doc-2', content: 'Food preferences: no shellfish, love Japanese cuisine.', metadata: { category: 'food' } },
  ],
});

const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  ragAdapter: rag,
  ragTokenBudget: 10_000,   // max tokens for RAG results
});
// rag_query and rag_ingest are now auto-registered
```

> See [RAG Integration →](/docs/rag-integration) for implementing a production vector store adapter (Pinecone, Weaviate, etc.).

---

### `ragTokenBudget?: number`

Maximum tokens that RAG results may consume per turn. Results are ranked by relevance and the least relevant are dropped first when over budget.

```typescript
ragTokenBudget: 10_000    // for 128k model, ~8%
ragTokenBudget: 3_200     // for 16k model, 20%
```

---

## MCP Servers

### `mcpServers?: MCPServerConfig[]`

Connect any MCP (Model Context Protocol) compatible server. Tools exposed by MCP servers are automatically discovered at session startup and registered alongside native tools — fully transparent to the ReAct loop.

```typescript
const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  mcpServers: [
    // stdio transport: spawn a local process
    {
      name: 'github',
      transport: 'stdio',
      command: 'npx',
      args: ['@modelcontextprotocol/server-github'],
      env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN! },
    },
    // HTTP transport: connect to a remote MCP server
    {
      name: 'company_tools',
      transport: 'http',
      url: 'https://tools.internal.mycompany.com/mcp',
      headers: { 'Authorization': `Bearer ${process.env.TOOLS_API_KEY}` },
    },
  ],
});

// Always close MCP connections when done
try {
  const result = await session.run('List my open pull requests');
} finally {
  await session.close();
}
```

> See [MCP Integration →](/docs/mcp) for the full stdio/HTTP setup guide.

---

## Media Bridge

### `media?: MediaConfig`

Enables the Media Bridge — a set of built-in tools for multimodal interactions. When `enableTools: true`, lemura registers tools that allow the agent to call ASR, TTS, vision, and image generation capabilities from within the ReAct loop.

```typescript
const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  media: {
    enableTools: true,    // register media_transcribe, media_synthesize, etc.
    toolPrefix: 'media_', // optional prefix (default: 'media_')
  },
});
```

Available media tools when enabled:

| Tool name | What it does |
|---|---|
| `media_transcribe` | Convert audio (base64) to text |
| `media_synthesize` | Convert text to speech (returns audio base64) |
| `media_describe_image` | Describe or analyze an image |
| `media_generate_image` | Generate an image from a text prompt |

> See [Media Bridge →](/docs/media-bridge) for the full multimodal integration guide.

---

## Tips & Tricks

> **Tip:** Register tools conditionally based on user permissions — don't expose admin tools to regular users. Build a `createSession(user)` factory function that assembles the right tool set per user role.

> **Tip:** Don't enable `autodiscoverTools: true` in production without auditing what packages declare lemura tools. Any `node_modules` package with a `"lemura"` key in its `package.json` will have its tools registered.

> **Tip:** When using both `ragAdapter` and `tools`, be aware that `rag_query` and `rag_ingest` are auto-registered. If you also define tools with those names, the auto-registered ones are skipped and yours win — but this can cause confusion. Use unique names.

> **Tip:** Always call `session.close()` in a `finally` block when using `mcpServers`. MCP servers spawn child processes or hold HTTP connections — forgetting to close them leaks resources.
