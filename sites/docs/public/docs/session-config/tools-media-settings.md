# Tools, Media & Extensions

Extend your agent with custom toolsets, media capabilities, RAG knowledge, and execution controls.

## Extension Points

### `tools: IToolDefinition[]`
Pass an array of tool objects that the agent can execute. Each tool must define a JSON Schema for its parameters. Schema validation is **automatically enforced** at runtime (no external dependencies) — invalid args throw `LemuraToolValidationError` before `execute()` is called.

```typescript
const myTool: IToolDefinition = {
  name: 'search_web',
  description: 'Search the web for current information.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 1, maxLength: 500 },
      topK:  { type: 'integer', minimum: 1, maximum: 20 },
    },
    required: ['query'],
    additionalProperties: false,
  },
  execute: async (params, ctx) => {
    // params is validated before reaching here
    const { query, topK = 5 } = params as { query: string; topK?: number };
    return await webSearch(query, topK);
  },
};
```

### `skills: ISkill[]`
Modular behavior blocks. Unlike a system prompt, skills can be priority-managed and compression-aware.

### `ragAdapter: IRAGAdapter`
Connect your vector database. When present, lemura automatically registers the `rag_query` and `rag_ingest` tools.

---

## Security Controls (New in v1.2.0)

### `toolFirewall: ToolFirewallConfig`
The Tool Firewall evaluates every tool call before execution with a rule-based allow/deny/ask policy.

```typescript
toolFirewall: {
  defaultDecision: 'ask',
  rules: [
    { name: '^read_.*',  decision: 'accept', reason: 'Read-only tools are safe' },
    { name: '^write_.*', decision: 'ask',    reason: 'Writes require approval' },
  ],
  onAsk: async (toolName, argsJson) => {
    return await myUI.confirm(`Allow tool: ${toolName}?`) ? 'accept' : 'deny';
  }
}
```

See [Tool Firewall →](/docs/tools-and-skills/tool-firewall) for the full guide.

### `toolRegistryTimeoutMs: number` (default: 30 000)
Default timeout for all tool executions. Throws `LemuraToolTimeoutError` on expiry.

### `toolExecutionBudget: ToolExecutionBudget`
Per-session call quotas and concurrency limits.

### `parallelToolCalls: boolean` (default: false)
Execute multiple tool calls in parallel when the agent requests them in a single turn.

---

## Media Integration

### `media: MediaConfig`
Enables the "Media Bridge" — a set of built-in tools for multimodal interactions.

```typescript
media: {
  enableTools: true,   // Registers media_transcribe, media_synthesize, etc.
  toolPrefix: 'ux_'    // Optional prefix for tool names (e.g., ux_transcribe)
}
```

---

## Registry & Discovery

### `autodiscoverTools: boolean` (default: false)
When true, lemura scans your project's `node_modules` for any package declaring lemura tools in its `package.json`. Perfect for building an ecosystem of sharable agent tools.
