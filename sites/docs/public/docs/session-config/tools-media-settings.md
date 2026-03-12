# Tools, Media & Extensions

Extend your agent with custom toolsets, media capabilities, and RAG knowledge.

## Extension Points

### `tools: IToolDefinition[]`
Pass an array of tool objects that the agent can execute. Each tool must define a JSON Schema for its parameters.

### `skills: ISkill[]`
Modular behavior blocks. Unlike a system prompt, skills can be priority-managed and compression-aware.

### `ragAdapter: IRAGAdapter`
Connect your vector database. When present, lemura automatically registers the `rag_query` and `rag_ingest` tools.

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
