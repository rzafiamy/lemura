# Tool Auto-Discovery

lemura's auto-discovery system lets you distribute tools as npm packages. Any package with a `"lemura"` key in its `package.json` can be automatically discovered and registered.

---

## The Auto-Discovery Protocol

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

---

## Enabling Auto-Discovery

```typescript
const session = new SessionManager({
  adapter,
  model: 'gpt-4o',
  maxTokens: 128_000,
  autodiscoverTools: true,  // default: false — opt-in
});

// Listen for what was found
session.on('tools:discovered', ({ tools, skills }) => {
  console.log('Auto-discovered tools:', tools.map(t => t.name));
  console.log('Auto-discovered skills:', skills.map(s => s.name));
});
```

---

## How Discovery Works Internally

```
1. Scan node_modules/*/package.json
2. Look for packages with a "lemura" key
3. For each listed tool file:
   a. Dynamic import() the file
   b. Validate the default export has { name, description, parameters, execute }
   c. Register in ToolRegistry
4. For each listed skill file:
   a. Read the markdown file
   b. Parse YAML frontmatter
   c. Register in SkillInjector
5. Emit 'tools:discovered' event with the full list
```

---

## Building a Distributable Tool Package

Step-by-step for publishing your own tool package:

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
    "lemura": ">=0.1.0"
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

## Dynamic Registration at Runtime

Register tools after session creation:

```typescript
const session = new SessionManager({ adapter, model: 'gpt-4o', maxTokens: 128_000 });

// Add a tool later (e.g., after user authentication)
session.tools.register({
  name: 'send_payment',
  description: 'Process a payment. Only available for authenticated users.',
  parameters: {
    type: 'object',
    properties: {
      amount: { type: 'number', description: 'Amount in USD' },
      recipient: { type: 'string', description: 'Recipient account ID' },
    },
    required: ['amount', 'recipient'],
  },
  execute: async ({ amount, recipient }) => {
    return await paymentService.transfer(amount, recipient);
  },
});

// Remove a tool when no longer needed
session.tools.unregister('send_payment');

// Check what's registered
const registered = session.tools.list();
console.log('Active tools:', registered.map(t => t.name));
```

---

## Conditional Tool Registration

Only register tools based on user permissions or feature flags:

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

## Namespace Conventions

Community tool packages follow this naming pattern to avoid conflicts:

| Package type | Naming | Examples |
|---|---|---|
| Official lemura tools | `@lemura/tools-{name}` | `@lemura/tools-web`, `@lemura/tools-code` |
| Community tools | `lemura-tools-{name}` | `lemura-tools-postgres`, `lemura-tools-jira` |
| Company-internal | `@{company}/lemura-{name}` | `@acme/lemura-crm` |

---

## Tips & Tricks

> **Tip:** Auto-discovery uses `import()` which is async. All discovered tools are available by the time the first `session.run()` is called — but the `'tools:discovered'` event fires asynchronously during `SessionManager` construction. Don't rely on it being synchronous.

> **Tip:** When building a distributable tool package, add a `prepack` script that runs `pnpm build` to ensure `dist/` is always fresh before publishing: `"prepack": "pnpm build"`.

> **Tip:** Version your tool packages with semver aligned to your lemura peer dependency. If lemura's `IToolDefinition` interface changes in a major version, you need a major version bump in your tool package too.
