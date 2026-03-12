# MCP Examples

End-to-end code examples for common MCP server setups.

---

## Example 1 — GitHub Tools (stdio)

Connect to the official GitHub MCP server to manage repos, issues, and PRs.

```typescript
import { SessionManager, OpenAICompatibleAdapter } from 'lemura';

const adapter = new OpenAICompatibleAdapter({
  baseUrl: 'http://localhost:11434/v1',
  apiKey: 'ollama'
});

const session = new SessionManager({
  adapter,
  model: 'qwen3.5-4b',
  maxTokens: 16_000,
  mcpServers: [
    {
      name: 'github',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN! }
    }
  ]
});

try {
  const result = await session.run(
    'List all open issues in the lemura repository labelled "bug"'
  );
  console.log(result);
} finally {
  await session.close();
}
```

---

## Example 2 — File System Tools (stdio)

Give the agent read/write access to a directory.

```typescript
const session = new SessionManager({
  adapter,
  model: 'qwen3.5-4b',
  maxTokens: 16_000,
  mcpServers: [
    {
      name: 'fs',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/home/user/projects']
    }
  ]
});

const result = await session.run('List all TypeScript files in /home/user/projects/lemura/src');
```

---

## Example 3 — Custom Python MCP Server (stdio)

Connect to a hand-rolled python server.

```typescript
const session = new SessionManager({
  adapter,
  model: 'qwen3.5-4b',
  maxTokens: 16_000,
  mcpServers: [
    {
      name: 'db_tools',
      transport: 'stdio',
      command: 'python',
      args: ['./servers/db_mcp_server.py'],
      env: {
        DATABASE_URL: process.env.DATABASE_URL!,
        READ_ONLY: 'true'
      },
      timeoutMs: 60_000 // DB queries can be slow
    }
  ]
});
```

---

## Example 4 — Remote HTTP Server

```typescript
const session = new SessionManager({
  adapter,
  model: 'qwen3.5-4b',
  maxTokens: 16_000,
  mcpServers: [
    {
      name: 'internal_tools',
      transport: 'http',
      url: 'https://tools.internal.mycompany.com',
      timeoutMs: 15_000
    }
  ]
});
```

---

## Example 5 — Multiple Servers + Native Tools + Firewall

Mix MCP servers with native tools and a firewall that gates write operations.

```typescript
import { SessionManager, OpenAICompatibleAdapter } from 'lemura';
import { searchWebTool } from './tools/search.js';

const session = new SessionManager({
  adapter,
  model: 'qwen3.5-4b',
  maxTokens: 32_000,

  // Native tools
  tools: [searchWebTool],

  // MCP servers (tools auto-discovered and merged)
  mcpServers: [
    {
      name: 'github',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN! }
    }
  ],

  // Firewall: approve all writes
  toolFirewall: {
    defaultDecision: 'accept',
    rules: [
      { name: '^create_.*', decision: 'ask', reason: 'Creating resources requires approval' },
      { name: '^delete_.*', decision: 'deny', reason: 'Deletes are always blocked' }
    ],
    onAsk: async (toolName, argsJson) => {
      // In a real app, prompt the user in the UI
      console.log(`Approve tool call: ${toolName}`, JSON.parse(argsJson));
      return 'accept';
    }
  }
});

try {
  const result = await session.run('Search for lemura on npm and open a GitHub issue linking to it');
  console.log(result);
} finally {
  await session.close();
}
```

---

## Example 6 — Using MCPClientRegistry Standalone

For advanced scenarios, use `MCPClientRegistry` directly without `SessionManager`.

```typescript
import { MCPClientRegistry } from 'lemura';
import { DefaultLogger } from 'lemura';

const logger = new DefaultLogger();
const registry = new MCPClientRegistry(logger);

await registry.register('github', {
  name: 'github',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-github'],
  env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN! }
});

// Get IToolDefinition[] (can be passed to ToolRegistry)
const tools = await registry.discoverTools();
console.log('Available tools:', tools.map(t => t.name));

// Call a tool directly
const result = await registry.callTool('list_repos', { owner: 'anthropics' });
console.log(result);

await registry.disconnectAll();
```
