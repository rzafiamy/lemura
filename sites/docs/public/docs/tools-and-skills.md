# Tools & Skills

Tools give your agent the ability to **act** in the world. Skills give it the ability to **think** in a specific way. Together they transform a raw LLM into a specialized, capable agent.

> 🌿 **Makix Context** 🔧: Makix uses 4 tools (`search_web`, `get_weather`, `manage_calendar`, `send_message`) and one personality skill (`friendly-assistant`) that makes every response warm, transparent, and trustworthy. This section covers everything you need to build and configure them.

![Tools & Skills — Act vs Think](/images/tools-skills-diagram.png)

---

## Tools vs. Skills — At a Glance

| | Tools | Skills |
|---|---|---|
| **What** | Async functions the agent can call | Markdown injected into the system prompt |
| **Purpose** | Take actions (search, fetch, send) | Shape behavior (persona, rules, format) |
| **Runtime** | Executes during the ReAct loop | Active for the entire session |
| **Makix example** | `search_web`, `get_weather` | `friendly-assistant` — "always cite sources" |

---

## In This Section

| Page | What it covers |
|---|---|
| [Defining Tools →](/docs/tools-and-skills/defining-tools) | `IToolDefinition` interface, parameters schema, `ToolContext` |
| [Tool Validation →](/docs/tools-and-skills/tool-validation) | JSON Schema validation, `LemuraToolValidationError`, best practices |
| [Tool Discovery →](/docs/tools-and-skills/tool-discovery) | Auto-discovery from `node_modules`, dynamic registration |
| [Real-World Tool Examples →](/docs/tools-and-skills/tool-examples) | `search_web`, file system, database, HTTP API, shell tools |
| [Skills System →](/docs/tools-and-skills/skills-system) | Skill file format, injection positions, tier/budget management |
| [Tool Firewall →](/docs/tools-and-skills/tool-firewall) | Ask/accept/deny policy for tool calls |

---

## Quick Reference — Makix Tool Suite

```typescript
import { SessionManager, OpenAICompatibleAdapter } from 'lemura';

const session = new SessionManager({
  adapter,
  model: 'qwen3.5-4b',
  maxTokens: 16_000,
  tools: [searchWebTool, getWeatherTool, manageCalendarTool, sendMessageTool],
  skills: [{ content: readFileSync('./skills/friendly-assistant.md', 'utf8') }],
  skillTokenBudget: 1_600,   // 10% of 16K
});
```

See [Defining Tools →](/docs/tools-and-skills/defining-tools) for the complete `IToolDefinition` interface and [Skills System →](/docs/tools-and-skills/skills-system) for the tier/budget system.

---

## Built-In Media Tools (Optional)
If you want ASR, TTS, Vision, and Image Generation to be callable by the agent, enable media tools in `SessionConfig`:

```ts
const session = new SessionManager({
  adapter,
  model: 'qwen3.5-4b',
  maxTokens: 16_000,
  media: { enableTools: true, toolPrefix: 'media_' }
});
```

Each media tool accepts an optional `model` parameter so the agent can target a specific modality model.

---

## Tool Firewall (Ask/Accept/Deny)
The tool firewall lets you gate tool calls with allow/deny rules and optional user approval.

```ts
const session = new SessionManager({
  adapter,
  model: 'qwen3.5-4b',
  maxTokens: 16_000,
  toolFirewall: {
    defaultDecision: 'ask',
    rules: [
      { name: '^read_.*', decision: 'accept', reason: 'Read-only tools are safe' },
      { name: '^write_.*', decision: 'ask', reason: 'Writes require approval' },
      { name: '^execute_shell$', arguments: 'rm\\s+-rf', decision: 'deny', reason: 'Dangerous command' }
    ],
    onAsk: async (toolName, argsJson) => {
      // Ask the user in your UI and return 'accept' or 'deny'
      return 'deny';
    }
  }
});
```

Firewall behavior:
- `accept`: tool executes.
- `deny`: tool is blocked and the agent receives a tool error.
- `ask`: your app can decide via `onAsk`. If no handler is provided, the call is blocked.
