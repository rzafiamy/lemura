# Tool Discovery

lemura tools are always registered explicitly — you pass `tools: [...]` in `SessionConfig` or call registration helpers. This page covers the three main patterns: static arrays, conditional registration, and npm-package distribution conventions.

---

## Static Tool Array (most common)

Pass all tools at construction time:

```typescript
import { readFileTool, webSearchTool } from './my-tools.js';

const session = new SessionManager({
  adapter,
  model: 'gpt-4o',
  maxTokens: 128_000,
  tools: [readFileTool, webSearchTool],
});
```

---

## Conditional Tool Registration

Only register tools based on user permissions, feature flags, or active skills:

```typescript
async function createAgentSession(user: User) {
  const tools: IToolDefinition[] = [
    searchTool,       // always available
    readFileTool,     // always available
  ];

  // Premium users get more tools
  if (user.plan === 'premium') {
    tools.push(sendEmailTool);
    tools.push(createCalendarEventTool);
  }

  // Admins get admin tools
  if (user.role === 'admin') {
    tools.push(userManagementTool);
    tools.push(systemDiagnosticsTool);
  }

  return new SessionManager({
    adapter,
    model: 'gpt-4o',
    maxTokens: 128_000,
    tools,
    systemPrompt: `You are assisting ${user.name} (${user.plan} plan).`,
  });
}
```

---

## Skill-Driven Tool Discovery

When skills declare `requiredTools`, you can build a minimal, context-aware tool set from the active skill set:

```typescript
const allTools = [readFileTool, listDirTool, webSearchTool, shellTool, dbQueryTool];

const session = new SessionManager({
  adapter, model, maxTokens,
  skills: [...],
  activeDynamicSkills: ['code-review'],
});

// Build tool array from what active skills need
const needed = new Set(session.skills.getRequiredTools());
const tools = allTools.filter(t => needed.has(t.name));

// Create the final session with the filtered tool set
const agentSession = new SessionManager({ adapter, model, maxTokens, tools, skills });
```

This pattern enables runtime skill selection to drive which tools are exposed — the agent only sees tools relevant to its current mode.

---

## MCP Servers (Model Context Protocol)

Tools from external MCP servers are registered via `mcpServers`. Discovery is automatic and non-blocking — tools are available by the time `run()` is first called:

```typescript
const session = new SessionManager({
  adapter,
  model: 'gpt-4o',
  maxTokens: 128_000,
  mcpServers: [
    { name: 'github', transport: 'stdio', command: 'npx', args: ['@modelcontextprotocol/server-github'] },
    { name: 'db_tools', transport: 'http', url: 'http://localhost:3001' }
  ],
});

// session.run() automatically waits for MCP tool discovery before first call
const result = await session.run('List open pull requests');
```

See [MCP overview](../mcp/overview.md) for full configuration options.

---

## Distributable Tool Packages (npm convention)

To distribute tools as an npm package that other lemura users can install and integrate, use the `"lemura"` key in `package.json` to declare what your package exports:

### In your tool package's `package.json`:

```json
{
  "name": "lemura-tools-web",
  "version": "1.0.0",
  "description": "Web search and scraping tools for lemura agents",
  "lemura": {
    "tools": [
      "./dist/tools/search-web.js",
      "./dist/tools/scrape-page.js",
      "./dist/tools/fetch-json.js"
    ],
    "skills": [
      "./skills/web-search-expert.md"
    ]
  }
}
```

### Each tool file's default export must be `IToolDefinition` or `IToolDefinition[]`:

```typescript
// dist/tools/search-web.js (compiled from TypeScript)
export default {
  name: 'search_web',
  description: 'Search the internet for current information.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
    },
    required: ['query'],
  },
  execute: async ({ query }) => {
    // implementation
  },
};
```

### Consuming the package in your application:

Consumers import the tools manually and pass them to `SessionManager`. The `"lemura"` key in `package.json` is a convention for documentation and tooling — not an auto-loader:

```typescript
import searchWebTool from 'lemura-tools-web/dist/tools/search-web.js';
import scrapePageTool from 'lemura-tools-web/dist/tools/scrape-page.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load the bundled skill
const skillContent = readFileSync(
  new URL('../node_modules/lemura-tools-web/skills/web-search-expert.md', import.meta.url),
  'utf8'
);

const session = new SessionManager({
  adapter, model, maxTokens,
  tools: [searchWebTool, scrapePageTool],
  skills: [{
    name: 'web-search-expert',
    version: '1.0.0',
    description: 'Web search and research expert',
    inject: 'system_prompt',
    priority: 10,
    content: extractMarkdownBody(skillContent),
  }],
});
```

---

## Building a Distributable Tool Package

```
lemura-tools-myapp/
├── src/
│   └── tools/
│       ├── search.ts
│       ├── database.ts
│       └── index.ts         # optional re-exports
├── skills/
│   └── search-expert.md
├── dist/                    # compiled output
├── package.json
├── tsconfig.json
└── README.md
```

### `package.json`

```json
{
  "name": "lemura-tools-myapp",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "lemura": {
    "tools": [
      "./dist/tools/search.js",
      "./dist/tools/database.js"
    ],
    "skills": [
      "./skills/search-expert.md"
    ]
  },
  "peerDependencies": {
    "lemura": ">=1.4.0"
  }
}
```

### `tsconfig.json` for tool packages

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "outDir": "./dist"
  }
}
```

---

## Namespace Conventions

Community tool packages follow this naming pattern to avoid conflicts:

| Package type | Naming | Examples |
|---|---|---|
| Official lemura tools | `@lemura/tools-{name}` | `@lemura/tools-web`, `@lemura/tools-code` |
| Community tools | `lemura-tools-{name}` | `lemura-tools-postgres`, `lemura-tools-jira` |
| Company-internal | `@{company}/lemura-{name}` | `@acme/lemura-crm` |

---

## Tips & Tricks

> **Tip:** Use `session.skills.getRequiredTools()` with `requiredTools` on skills to build minimal tool sets automatically — expose only what the active skill configuration needs.

> **Tip:** When building a distributable tool package, add a `prepack` script that runs your build command to ensure `dist/` is always fresh before publishing: `"prepack": "pnpm build"`.

> **Tip:** Version your tool packages with semver aligned to your lemura peer dependency. If lemura's `IToolDefinition` interface changes in a major version, bump your tool package too.
