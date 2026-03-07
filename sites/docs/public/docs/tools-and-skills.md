# Tools & Skills

Tools give your agent the ability to **act** in the world. Skills give it the ability to **think** in a specific way. Together they transform a raw LLM into a specialized, capable agent.

---

## Tools vs. Skills — When to Use Each

| | Tools | Skills |
|---|---|---|
| **What it is** | JavaScript functions the agent can call | Markdown files injected into the system prompt |
| **Purpose** | Take actions (search, compute, fetch data, write files) | Shape behavior (persona, rules, reasoning approach) |
| **Runtime** | Executes during the ReAct loop | Active for the entire session |
| **Defined in** | TypeScript/JavaScript | Markdown with YAML frontmatter |
| **Example** | `search_web`, `read_file`, `send_email` | "You always cite sources", "You respond in JSON" |

---

## Part 1: Tools

### How the ReAct Loop Uses Tools

When the model decides to call a tool, lemura:

```
Model output:  { "tool_call": { "name": "search_web", "args": { "query": "..." } } }
                          ↓
1. ToolRegistry validates args against JSON Schema
2. ToolRegistry.execute("search_web", validatedArgs, context) → string
3. Result appended as role: "tool" turn in context
4. Model receives observation, continues reasoning
```

### Defining a Tool

Every tool implements `IToolDefinition`:

```typescript
interface IToolDefinition {
  name: string;         // snake_case, unique
  description: string;  // imperative sentence — what the model reads to decide when to call it
  parameters: JSONSchema;  // validates inputs before execute() is called
  execute(params: unknown, context: ToolContext): Promise<unknown>;
}
```

### Your First Tool

```typescript
const searchWebTool: IToolDefinition = {
  name: 'search_web',
  description: 'Search the internet for current information. Use when you need up-to-date facts, news, or data not in your training.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query. Be specific and use keywords.',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum results to return. Default: 5.',
      },
    },
    required: ['query'],
  },
  execute: async ({ query, maxResults = 5 }: { query: string; maxResults?: number }) => {
    const results = await mySearchAPI.search(query, { limit: maxResults });
    return results.map(r => `${r.title}\n${r.url}\n${r.snippet}`).join('\n\n');
  },
};

const session = new SessionManager({
  adapter,
  model: 'gpt-4o',
  maxTokens: 128_000,
  tools: [searchWebTool],
});
```

### The ToolContext

Your `execute()` function receives a `ToolContext` as the second argument:

```typescript
interface ToolContext {
  sessionId: string;     // current session identifier
  turnIndex: number;     // which turn triggered this tool call
  logger: ILogger;       // safe logging — use this instead of console.log
  ragAdapter?: IRAGAdapter;  // access the RAG adapter if configured
}

// Example: logging in a tool
execute: async (params, ctx) => {
  ctx.logger.debug('search_web called', { query: params.query, turn: ctx.turnIndex });
  // ...
}
```

### Tool Naming Best Practices

```typescript
// ✅ Good tool descriptions — specific about WHEN to use
"Search the web for current information about a topic. Use when you need recent events, prices, or facts not in your training data."
"Read the contents of a file from the local filesystem. Use when the user asks you to analyze, summarize, or modify a specific file."
"Send an email to one or more recipients. Use only when explicitly asked to send or compose an email."

// ❌ Bad tool descriptions — vague, model won't know when to call these
"Searches"
"Does web search things"
"Tool for searching information"
```

The description is the model's only guide for deciding whether to call the tool. Be precise about the use case.

### Tool Composition: Dependent Chains

For workflows where tools depend on each other:

```typescript
const getSourcesTool = { name: 'get_sources', ... };
const extractFactsTool = { name: 'extract_facts', ... };
const synthesizeTool = { name: 'synthesize_report', ... };

// The agent will naturally chain: get_sources → extract_facts → synthesize_report
// Or use ContinuationPlanning for explicit sequencing (see Advanced Execution guide)
const session = new SessionManager({
  adapter,
  model: 'gpt-4o',
  maxTokens: 128_000,
  tools: [getSourcesTool, extractFactsTool, synthesizeTool],
  enableContinuationPlanning: true,
});
```

### Built-In Tools

lemura ships these built-in tools (all opt-in, configured by `SessionConfig`):

| Tool name | Purpose | Requires |
|---|---|---|
| `rag_query` | Query your vector database | `ragAdapter` in config |
| `rag_ingest` | Add documents to the knowledge base | `ragAdapter` in config |
| `context_summarize` | Manually trigger context compression | — |
| `skill_list` | List active skills (useful for debugging) | — |

```typescript
// Enable built-in RAG tools by just providing a ragAdapter
const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  ragAdapter: new MyPineconeAdapter(),  // rag_query and rag_ingest auto-register
});
```

### Tool Auto-Discovery

For package-level tool distribution, lemura discovers tools in `node_modules` by scanning `package.json`:

```json
{
  "name": "my-lemura-tools",
  "lemura": {
    "tools": ["./dist/tools/search.js", "./dist/tools/calculator.js"],
    "skills": ["./skills/math-expert.md"]
  }
}
```

Enable in your config:

```typescript
const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  autodiscoverTools: true,  // scans node_modules for "lemura" key in package.json
});

session.on('tools:discovered', ({ tools }) => {
  console.log('Auto-discovered tools:', tools.map(t => t.name));
});
```

### Dynamic Tool Registration

Register tools at runtime:

```typescript
const session = new SessionManager({ adapter, model: 'gpt-4o', maxTokens: 128_000 });

// Later, after session is created
session.tools.register(dynamicTool);

// Or unregister
session.tools.unregister('old_tool_name');
```

---

## Part 2: Skills

Skills are Markdown files that get injected into the system prompt. They define **how** the agent thinks, not what it can do.

### Skill File Format

```markdown
---
name: code-review-expert
version: 1.0.0
description: Expert code reviewer who focuses on security, performance, and maintainability
inject: system_prompt
priority: 10
tier: standard
nano: |
  You are a strict code reviewer who always checks for security vulnerabilities first.
micro: |
  You are a code review expert. Always: (1) check for security issues, (2) flag performance problems, (3) suggest tests for uncovered paths.
---

You are an expert software engineer specializing in code review. Your reviews are:

**Security-first**: Always scan for: SQL injection, XSS, CSRF, insecure deserialization, hardcoded secrets, and improper error handling that leaks information.

**Performance-aware**: Flag O(n²) algorithms, N+1 queries, missing indexes, unnecessary re-renders, and blocking I/O in async contexts.

**Maintainability-focused**: Comment on naming conventions, function length, coupling, and test coverage gaps.

Always structure your review as:
1. Security issues (P0 — must fix before merge)
2. Performance issues (P1 — fix in this PR or file a ticket)
3. Style/maintainability (P2 — optional but recommended)
```

### Injection Positions

| Position | When | Use for |
|---|---|---|
| `system_prompt` | Once, before any turns | Persona, core rules, response format |
| `pre_turn` | Before each user message | Dynamic context, rotating instructions |
| `post_history` | Just before provider call | Final-moment reminders |

### Skill Tiers & Budget Management

Skills are automatically downsized when the token budget is tight:

```
skillTokenBudget = 0.10 * maxTokens (default: 10%)

├── tier: standard  (≤ 800 tokens)  — full content
├── tier: micro     (≤ 300 tokens)  — from frontmatter nano/micro fields
├── tier: nano      (≤ 100 tokens)  — single-sentence from nano field
└── (skip if no budget remains — warning logged)
```

Priority `< 5` skills are **never skipped** — perfect for critical safety rules.

```typescript
import { SessionManager } from 'lemura';
import { readFileSync } from 'fs';

const codeReviewSkill = {
  content: readFileSync('./skills/code-review-expert.md', 'utf8'),
  // frontmatter is parsed automatically
};

const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  skills: [codeReviewSkill],
  skillTokenBudget: 15_000,  // 15k tokens for skills
});
```

### Loading Order

Skills load in this priority:
1. `SessionConfig.skills` (highest priority — your explicit skills)
2. Auto-discovered skills from `node_modules` packages
3. Skills in `./skills/` project root directory

---

## Real-World Examples

### Customer Support Agent

```typescript
const lookupOrderTool = {
  name: 'lookup_order',
  description: 'Look up order status and details by order ID. Use when customer asks about their order.',
  parameters: {
    type: 'object',
    properties: {
      orderId: { type: 'string', description: 'Order ID in format ORD-XXXXXX' },
    },
    required: ['orderId'],
  },
  execute: async ({ orderId }) => {
    return await orderDB.findById(orderId);
  },
};

const refundTool = {
  name: 'process_refund',
  description: 'Process a refund for an order. Only call this AFTER the customer has confirmed they want a refund.',
  parameters: {
    type: 'object',
    properties: {
      orderId: { type: 'string' },
      reason: { type: 'string', description: 'Refund reason for records' },
    },
    required: ['orderId', 'reason'],
  },
  execute: async ({ orderId, reason }) => {
    return await refundService.process(orderId, reason);
  },
};

const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  tools: [lookupOrderTool, refundTool],
  systemPrompt: `You are a helpful customer support agent for Acme Store.
Always look up the order before discussing it. Never process refunds without explicit customer confirmation.`,
});
```

### Research Assistant with Multiple Tools

```typescript
const tools = [
  searchWebTool,          // search the internet
  readPDFTool,            // parse PDF documents
  createChartTool,        // generate data visualizations
  writeSummaryTool,       // save summaries to disk
];

const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 200_000,
  tools,
  enableGoalPlanning: true,   // plan before executing
  maxSteps: 30,               // complex research may need many steps
  compressionStrategies: [
    new SandwichCompressionStrategy(adapter, { preserveFirst: 1, preserveLast: 3 }),
  ],
});

await session.run(`
  Research the competitive landscape for electric vehicle charging networks in Europe.
  Include market share data, key players, and trends from 2023–2025.
  Create a summary report with a chart.
`);
```

---

## When Things Go Wrong

**`LemuraToolNotFoundError`**
The agent called a tool that wasn't registered. Check `SessionConfig.tools` array and make sure the tool name matches exactly (case-sensitive, snake_case).

**`LemuraToolValidationError`**
The agent called a tool with invalid arguments. Your JSON Schema rejected the parameters. This usually means your schema is too strict or has incorrect types. Check the `parameters` definition.

**Model ignores the tool completely**
Your tool description isn't compelling enough. Make sure it explicitly states **when** and **why** to call the tool. Include example trigger phrases in the description: _"Use when the user asks about..."_

**Tool is called repeatedly with the same arguments**
Infinite loop detection will halt with 3 strikes. Your tool result isn't advancing the conversation — make the tool return more actionable information, or improve the system prompt to guide the agent forward.

**Skills not appearing in system prompt**
Check the `skillTokenBudget`. If set too low, large skills get dropped. Check logs for `[SkillInjector] downgraded {name} to nano tier` or `[SkillInjector] skipped {name}: insufficient budget`.
