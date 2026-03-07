# Tools & Skills

Tools give your agent the ability to **act** in the world. Skills give it the ability to **think** in a specific way. Together they transform a raw LLM into a specialized, capable agent.

> **Makix context:** Makix uses 4 tools (`search_web`, `get_weather`, `manage_calendar`, `send_message`) and one personality skill (`friendly-assistant`) that makes every response warm, transparent, and trustworthy. This section covers everything you need to build and configure them.

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
