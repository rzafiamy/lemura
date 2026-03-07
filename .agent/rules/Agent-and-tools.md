---
trigger: always_on
---

# lemura — ReAct Agent & Tools Rules

## The ReAct Loop

The ReAct (Reason + Act) loop is lemura's execution engine. It lives in `src/agent/ReActAgent.ts`.

### Loop Lifecycle

```
1. Receive user message
2. Inject skills into system prompt (SkillInjector)
3. Prepare context window (ContextManager.prepare())
4. Call provider → get response
5. Parse response:
   a. If tool_call → execute tool → append observation → goto 3
   b. If stop/final → return response to caller
6. Emit turn event
```

### Loop Safety Rules

- **Max iterations guard**: every session config must specify `maxIterations` (default: 10). If the loop exceeds this, throw `LemuraMaxIterationsError` and return the last assistant message.
- **Infinite loop detection**: if the same tool is called with identical arguments twice in a row, emit a `'loop:detected'` warning event and increment a strike counter. At 3 strikes, halt with error.
- **Tool error recovery**: if a tool throws, inject the error as a `tool` role message and allow the agent to react. Do not silently swallow tool errors.
- **Scratchpad write on every reasoning step**: after each provider response containing reasoning content, update `context.scratchpad` before the next iteration.

---

## SessionManager

`SessionManager` is the primary entry point for consumers. It owns:
- One `ContextManager` instance
- One `ReActAgent` instance
- One `ToolRegistry` instance
- One `SkillInjector` instance
- Conversation state (persisted across `run()` calls)

```
SessionManager {
  run(userMessage: string): Promise<string>
  stream(userMessage: string): AsyncIterable<string>
  reset(): void
  getContext(): ContextWindow
  getHistory(): Turn[]
}
```

`SessionManager` constructor takes a `SessionConfig`:
```
SessionConfig {
  adapter: IProviderAdapter
  model: string
  maxTokens: number
  maxIterations?: number
  tools?: IToolDefinition[]
  skills?: ISkill[]
  ragAdapter?: IRAGAdapter
  compressionStrategies?: IContextStrategy[]
  systemPrompt?: string
  logger?: ILogger
}
```

---

## ToolRegistry

### Registration

Tools are registered in three ways:
1. **Explicit registration** — passed in `SessionConfig.tools`
2. **Autodiscovery** — scanning `node_modules` for packages with `"lemura": { "tools": [...] }` in their `package.json`
3. **Dynamic registration** — `session.tools.register(tool)` at runtime

### Tool Definition Interface

```
IToolDefinition {
  name: string                    // unique, snake_case
  description: string             // shown to the model — be specific
  parameters: JSONSchema          // JSON Schema object for input validation
  execute(params: unknown, context: ToolContext): Promise<unknown>
}

ToolContext {
  sessionId: string
  turnIndex: number
  logger: ILogger
  ragAdapter?: IRAGAdapter
}
```

### Execution Rules

- **Always validate** inputs against the JSON Schema before calling `execute()`. Invalid inputs throw `LemuraToolValidationError` without calling the function.
- **Always serialize** outputs to string for the model. Complex objects are JSON stringified.
- **Timeout**: every tool execution has a configurable timeout (default 30s). Exceeded timeout throws `LemuraToolTimeoutError`.
- **Tool results** are appended as `role: 'tool'` turns in the context.

### Autodiscovery Protocol

A package declares itself as a lemura tool source by adding to its `package.json`:

```json
{
  "lemura": {
    "tools": ["./dist/tools/my-tool.js"],
    "skills": ["./skills/my-skill.md"]
  }
}
```

Each listed file's default export must be an `IToolDefinition` or `IToolDefinition[]`.

The autodiscovery scanner:
1. Reads `node_modules/*/package.json` looking for the `"lemura"` key
2. Dynamically imports listed tool files
3. Registers discovered tools in the `ToolRegistry`
4. Emits `'tools:discovered'` event with the list

Autodiscovery is **opt-in**: `SessionConfig.autodiscoverTools: boolean` (default: `false`).

---

## Tool Naming Conventions

- Tool names: `snake_case`, e.g. `search_web`, `query_rag`, `get_weather`
- Tool description: imperative sentence, e.g. "Search the web for current information about a topic"
- Parameter names: `camelCase` in schema, `camelCase` in `execute()` destructuring
- Required parameters listed in `required[]` in the JSON Schema
- Optional parameters documented with their defaults in `description`

---

## Built-In Tools

lemura ships with these built-in tools (all opt-in):

| Tool name | Purpose | Requires |
|---|---|---|
| `rag_query` | Query the RAG adapter | `ragAdapter` in config |
| `rag_ingest` | Ingest documents into RAG | `ragAdapter` in config |
| `context_summarize` | Manually trigger compression | — |
| `skill_list` | List available skills | — |

---

## Skills Injection

`SkillInjector` manages loading and injecting skills into the system prompt.

### Skill File Format

Skills are Markdown files with a YAML frontmatter header:

```markdown
---
name: web-search-expert
version: 1.0.0
description: Expert at formulating effective web search queries
inject: system_prompt          # or: 'pre_turn' | 'post_history'
priority: 10
---

You are an expert at breaking down complex questions into precise search queries...
[rest of skill content]
```

### Injection Positions

- `system_prompt` — appended to the system prompt before the first turn (most common)
- `pre_turn` — injected as a synthetic system message before each user turn
- `post_history` — injected after the last turn, just before the provider call

### Loading Order

1. Skills from `SessionConfig.skills` (highest priority, loaded first)
2. Skills discovered via autodiscovery from `node_modules`
3. Skills from `skills/` directory in the project root (lowest priority)

When multiple skills target the same injection position, they are concatenated in priority order (lowest number first).