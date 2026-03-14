# Tools & Skills

A raw LLM can only generate text. Tools and skills are the two mechanisms that transform it into a capable, specialized agent — and they operate at completely different layers of the system.

**Tools** give the agent the ability to *act*. A tool is an async TypeScript function with a JSON Schema description. When the model decides it needs to call a tool, it emits a structured tool call request (never calling the function directly). Lemura intercepts this request, validates the arguments against the schema, executes the function, and feeds the result back as an observation turn in the ReAct loop. Tools are ephemeral — they run during execution and their results become part of the conversation history. Examples: `search_web`, `query_database`, `send_email`, `read_file`.

**Skills** give the agent the ability to *think* in a specific way. A skill is a Markdown file injected into the system prompt before every provider call. Skills don't execute — they shape the model's reasoning, tone, rules, and domain knowledge for the entire session. A skill can say "You are a code review expert — always check for security vulnerabilities first" or "You are a customer support agent — never reveal internal pricing." Unlike the base `systemPrompt`, skills survive context compression: they are re-injected after every compression event so the agent never forgets its behavioral rules. Multiple skills can be stacked and are automatically downgraded (or skipped) in priority order when the token budget is tight.

The key design insight is that tools and skills are *complementary*, not alternatives. You define what the agent can do with tools, and what kind of agent it is with skills. A customer support agent uses tools like `lookup_order` and `create_ticket`, and skills like `support-persona.md` and `escalation-policy.md`. Both systems are independently configurable and combine naturally.

> **Makix example:** Makix uses 4 tools (`search_web`, `get_weather`, `manage_calendar`, `send_message`) and one personality skill (`friendly-assistant.md`) that makes every response warm and transparent. The tools give Makix its capabilities; the skill gives it its character.

---

## Tools vs. Skills — Full Comparison

| Dimension | Tools | Skills |
|---|---|---|
| **What it is** | Async TypeScript function | Markdown document |
| **Purpose** | Take actions in the world | Shape how the agent thinks |
| **When it runs** | During the ReAct loop (on-demand) | Every provider call (always active) |
| **Token cost** | Paid when called (result injected into turns) | Paid on every call (part of system prompt) |
| **Survives compression?** | No — tool results live in turn history | Yes — re-injected after every compression |
| **Configurable via JSON Schema** | Yes — arguments validated before execution | No — free-form Markdown |
| **Budget control** | `toolResponseTokenBudget`, `toolResponseProcessor` | `skillTokenBudget`, priority tiers |
| **Example** | `search_web`, `get_weather`, `query_db` | "Always cite sources", "You are a security reviewer" |

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

## Minimal Tool Example

A tool is an object satisfying `IToolDefinition`. The `parameters` field is a standard JSON Schema `object` — lemura validates every argument against it before calling `execute()`:

```typescript
import type { IToolDefinition } from 'lemura/types';

const searchWebTool: IToolDefinition = {
  name: 'search_web',
  description: 'Search the internet for current information on any topic.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query. Be specific for better results.',
      },
      maxResults: {
        type: 'number',
        description: 'Number of results to return (1–10). Default: 5.',
        default: 5,
      },
    },
    required: ['query'],
  },
  execute: async (args, context) => {
    // args.query is guaranteed to be a string here — lemura validated it
    const results = await mySearchAPI(args.query, args.maxResults ?? 5);
    return results.map(r => `${r.title}: ${r.url}\n${r.snippet}`).join('\n\n');
  },
};
```

Register one or more tools in `SessionConfig.tools`:

```typescript
const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  tools: [searchWebTool, getWeatherTool, sendEmailTool],
});
```

---

## Minimal Skill Example

A skill is a Markdown string (typically loaded from a `.md` file). The simplest form:

```typescript
import { readFileSync } from 'fs';

const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  skills: [
    {
      // Loaded from a file — recommended for non-trivial skills
      content: readFileSync('./skills/code-reviewer.md', 'utf8'),
      priority: 1,        // lower number = higher priority (never dropped)
      tier: 'extended',   // 'extended' | 'standard' | 'micro' | 'nano'
    },
    {
      // Inline skill — fine for short behavioral rules
      content: '## Output Format\nAlways respond in JSON unless the user asks for prose.',
      priority: 5,
      tier: 'micro',
    },
  ],
  skillTokenBudget: 8_000,   // skills collectively may not exceed 8,000 tokens
});
```

Example skill file (`skills/code-reviewer.md`):
```markdown
## Role
You are an expert code reviewer specializing in TypeScript and security.

## Review Process
1. Check for security vulnerabilities first (OWASP Top 10)
2. Evaluate type safety and null handling
3. Assess error handling and edge cases
4. Comment on readability and maintainability

## Output Format
Structure feedback as: CRITICAL > MAJOR > MINOR > SUGGESTION
Always provide a corrected code snippet for CRITICAL and MAJOR issues.
```

---

## Dynamic Tool Registration

Tools can be registered and unregistered at runtime without recreating the session:

```typescript
const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  tools: [searchWebTool],  // initial tools
});

// Add a tool dynamically (e.g., after user authentication)
session.tools.register(userSpecificDatabaseTool);

// Remove a tool (e.g., after a resource becomes unavailable)
session.tools.unregister('search_web');

// List all currently registered tools
const allTools = session.tools.getAll();
console.log(allTools.map(t => t.name));
// → ['get_weather', 'user_specific_database']
```

---

## Skill Token Budget Management

When all skills combined exceed `skillTokenBudget`, lemura automatically downgrades them in priority order. Each skill can define multiple tiers — from `extended` (full content) down to `nano` (a few-line summary):

```typescript
const session = new SessionManager({
  adapter, model: 'qwen3.5-4b', maxTokens: 16_000,
  skillTokenBudget: 1_600,  // 10% of 16K

  skills: [
    {
      content: fullCodeReviewerSkill,   // 1,200 tokens at extended tier
      priority: 1,                       // priority 1 = NEVER downgraded or skipped
      tier: 'extended',
      // With priority < 5, this skill always appears at full length
    },
    {
      content: formattingRulesSkill,    // 400 tokens at standard tier
      priority: 5,
      tier: 'standard',
      // If budget is tight, lemura tries 'micro' version, then 'nano', then skips
    },
  ],
});
```

**Downgrade order:** `extended → standard → micro → nano → skipped`. Skills with `priority < 5` are exempt from downgrading and skipping.

---

## Built-In Media Tools

If your adapter supports multimodal capabilities, enable media tools so the agent can call ASR, TTS, vision, and image generation directly:

```typescript
const session = new SessionManager({
  adapter,
  model: 'gpt-4o',
  maxTokens: 128_000,
  media: {
    enableTools: true,
    toolPrefix: 'media_',   // tools are: media_transcribe, media_synthesize, etc.
  },
});

// Available media tools in the ReAct loop:
// media_transcribe    — audio → text (ASR)
// media_synthesize    — text → audio (TTS)
// media_describe_image — image → text description (vision)
// media_generate_image — text prompt → image
```

---

## Tool Firewall

The Tool Firewall evaluates every tool call request before execution. Rules are pattern-matched in order; the first matching rule wins. If no rule matches, `defaultDecision` applies:

```typescript
const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  toolFirewall: {
    defaultDecision: 'accept',
    rules: [
      // Read-only operations — always safe
      { name: '^read_.*',       decision: 'accept', reason: 'Read-only' },
      { name: '^search_.*',     decision: 'accept', reason: 'Read-only' },
      // Writes — require explicit user approval
      { name: '^write_.*',      decision: 'ask',    reason: 'Modifies data' },
      { name: '^send_.*',       decision: 'ask',    reason: 'External communication' },
      // Dangerous operations — always blocked
      {
        name: 'execute_shell',
        arguments: 'rm\\s+-rf',   // argument pattern match
        decision: 'deny',
        reason: 'Dangerous command blocked',
      },
    ],
    onAsk: async (toolName, argsJson) => {
      // Your UI presents the approval dialog; this resolves when the user decides
      const approved = await showApprovalDialog({ toolName, argsJson });
      return approved ? 'accept' : 'deny';
    },
  },
});
```

**Decision semantics:**
- `accept` — tool executes immediately
- `deny` — tool is blocked; the agent receives a `tool_error` observation and must decide how to proceed
- `ask` — `onAsk` is called; if no `onAsk` handler is provided, defaults to `deny`

---

## Tips & Tricks

> **Tip:** Tool descriptions are load-bearing. The model decides *which* tool to call based on the `description` field — not the function name. Write descriptions that explain *when* to use the tool, not just *what* it does. "Search the internet for current information on any topic" is better than "Performs a web search."

> **Tip:** Keep `execute()` return values concise. A tool that returns a 50-page document will consume enormous context tokens. Consider returning a summary plus a reference ID the agent can use to request specific sections via a second tool call.

> **Tip:** Use `priority: 1` sparingly. A skill at priority 1 is *never* dropped, even when context is critically tight. Reserve it for behavioral rules that are truly non-negotiable (safety policies, output format contracts). Let content-heavy skills sit at `priority: 5` or higher so they can be downgraded gracefully.

> **Tip:** The `context` second argument to `execute(args, context)` provides `context.sessionId`, `context.turnIndex`, and `context.metadata` — useful for logging, multi-tenant routing, and passing session-level state (like a user ID) into tool implementations without global variables.
