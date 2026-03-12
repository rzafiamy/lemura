# MCP Integration

The **Model Context Protocol (MCP)** lets you connect any MCP-compatible server to a lemura agent. Tools exposed by MCP servers are automatically discovered and become first-class citizens inside the agent's ReAct loop — no changes to your existing setup required.

> 🌿 **Makix Context** 🔌: Makix connects to a company-internal MCP server (`product_tools`) that exposes `search_catalog`, `check_inventory`, and `create_order`. By declaring it in `mcpServers`, these tools are instantly available alongside Makix's existing native tools.

---

## How It Works

```
SessionConfig.mcpServers
        ↓
MCPClientRegistry
  ├── MCPClient (stdio)   ─── spawn child process
  └── MCPClient (http)    ─── native fetch POST
        ↓
IToolDefinition adapters
        ↓
ToolRegistry (merged with native tools)
        ↓
ReAct loop (unchanged)
```

MCP tools are bridged to `IToolDefinition` at startup and registered in the existing `ToolRegistry`. The agent cannot tell the difference between a native tool and an MCP tool.

---

## In This Section

| Page | What it covers |
|---|---|
| [Overview →](/docs/mcp/overview) | Architecture, lifecycle, tool bridging |
| [stdio Servers →](/docs/mcp/stdio-servers) | Spawning local MCP servers via child process |
| [HTTP Servers →](/docs/mcp/http-servers) | Connecting to remote MCP servers over HTTP |
| [Config Reference →](/docs/mcp/config-reference) | Full `MCPServerConfig` field reference |
| [Examples →](/docs/mcp/examples) | End-to-end code examples |

---

## Quick Start

```typescript
import { SessionManager, OpenAICompatibleAdapter } from 'lemura';

const session = new SessionManager({
  adapter,
  model: 'qwen3.5-4b',
  maxTokens: 16_000,
  mcpServers: [
    {
      name: 'github',
      transport: 'stdio',
      command: 'npx',
      args: ['@modelcontextprotocol/server-github'],
      env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN! }
    }
  ]
});

try {
  const answer = await session.run('List my open pull requests');
  console.log(answer);
} finally {
  await session.close(); // disconnect MCP servers
}
```

See [Config Reference →](/docs/mcp/config-reference) for all `MCPServerConfig` options.
