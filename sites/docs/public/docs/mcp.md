# MCP Integration

The **Model Context Protocol (MCP)** is an open standard for exposing tools, resources, and prompts from external servers to AI agents. Instead of writing every tool yourself, you connect to an MCP server — a separate process that implements the protocol — and the server advertises what it can do. Lemura discovers those capabilities at startup, wraps them as native `IToolDefinition` objects, and registers them in the `ToolRegistry`. The agent's ReAct loop treats MCP tools exactly like any hand-written tool — the indirection is invisible to the model.

The architectural significance of MCP is that it decouples *tool authorship* from *agent authorship*. The team that builds the GitHub MCP server owns its implementation, authentication, and versioning. The team that builds the lemura agent just declares `{ name: 'github', transport: 'stdio', ... }` in the session config and immediately gains access to all tools that server exposes — today and in the future as the server adds new capabilities. This is especially valuable in enterprise environments where internal systems (ERP, CRM, knowledge bases) already have MCP servers and you want to consume them in an agent without re-implementing their API clients.

Lemura supports two MCP transports. **stdio** spawns a child process and communicates over stdin/stdout — ideal for local tools, developer utilities, and CLI-wrapped APIs. **HTTP** sends JSON-RPC requests to a remote endpoint over fetch — ideal for shared enterprise MCP servers, multi-tenant deployments, and services that need to run on their own infrastructure. Both transports expose the same capabilities to the agent and share the same configuration schema.

> **Makix example:** Makix connects to a company-internal MCP server (`product_tools`) that exposes `search_catalog`, `check_inventory`, and `create_order`. By declaring it in `mcpServers`, these tools are instantly available alongside Makix's existing native tools — no extra wiring needed.

---

## Architecture & Lifecycle

```
Application startup
       │
       ├─ SessionManager reads SessionConfig.mcpServers
       │
       ├─ MCPClientRegistry initializes one MCPClient per server
       │    ├─ stdio: spawn child process (command + args + env)
       │    └─ http:  establish connection to baseUrl
       │
       ├─ Each MCPClient calls initialize() + listTools()
       │    → receives tool schemas from the server
       │
       ├─ MCPClientRegistry wraps each tool as IToolDefinition
       │    → name: "{serverName}_{toolName}" (namespaced)
       │    → execute: forwards call to MCPClient → server
       │
       ├─ All MCP tools registered in ToolRegistry
       │    → merged with native tools
       │    → identical to agent
       │
       └─ session.run() — ReAct loop proceeds normally
              ├─ model calls "github_list_issues"
              ├─ ToolRegistry routes to MCP wrapper
              ├─ MCPClient sends request to stdio/http server
              └─ result injected as observation turn

Application shutdown
       └─ session.close() → MCPClientRegistry.closeAll()
            ├─ stdio: SIGTERM child processes
            └─ http:  close connections
```

**Important:** Always call `session.close()` when you're done. Stdio MCP servers are child processes — not calling `close()` leaks them.

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

## Quick Start — stdio Server

Stdio MCP servers run as child processes. This is the most common pattern for development tools, local utilities, and open-source MCP packages:

```typescript
import { SessionManager, OpenAICompatibleAdapter } from 'lemura';

const adapter = new OpenAICompatibleAdapter({
  baseUrl: 'https://api.openai.com/v1',
  apiKey: process.env.OPENAI_API_KEY!,
  defaultModel: 'gpt-4o',
});

const session = new SessionManager({
  adapter,
  model: 'gpt-4o',
  maxTokens: 128_000,
  mcpServers: [
    {
      name: 'github',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN! },
    }
  ],
});

try {
  // The agent now has access to all tools from the GitHub MCP server:
  // github_list_issues, github_create_pr, github_search_code, etc.
  const answer = await session.run('List all open issues labelled "bug" in my main repository');
  console.log(answer);
} finally {
  await session.close(); // always clean up — terminates the child process
}
```

---

## Quick Start — HTTP Server

HTTP MCP servers run as persistent services. Use this for shared enterprise tools or remote APIs:

```typescript
const session = new SessionManager({
  adapter,
  model: 'gpt-4o',
  maxTokens: 128_000,
  mcpServers: [
    {
      name: 'product_tools',
      transport: 'http',
      baseUrl: 'https://internal-mcp.mycompany.com',
      headers: {
        'Authorization': `Bearer ${process.env.INTERNAL_API_TOKEN}`,
        'X-Tenant-ID': process.env.TENANT_ID!,
      },
      timeout: 30_000,   // 30 second timeout per tool call
    }
  ],
});
```

---

## Multiple MCP Servers

You can connect multiple MCP servers simultaneously. Tools from each server are namespaced by server name to prevent collisions:

```typescript
const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  mcpServers: [
    // Developer tools — local process
    {
      name: 'github',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN! },
    },
    // File system access — local process
    {
      name: 'filesystem',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/workspace'],
    },
    // Internal CRM — remote HTTP server
    {
      name: 'crm',
      transport: 'http',
      baseUrl: 'https://crm-mcp.internal.example.com',
      headers: { Authorization: `Bearer ${process.env.CRM_TOKEN}` },
    },
  ],
  // Native tools alongside MCP tools — they coexist transparently
  tools: [sendEmailTool, generateReportTool],
});

// Available tools in the ReAct loop:
// github_list_issues, github_create_pr, github_search_code
// filesystem_read_file, filesystem_write_file, filesystem_list_directory
// crm_get_contact, crm_create_deal, crm_update_status
// send_email, generate_report (native tools)
```

---

## MCPServerConfig Reference

```typescript
interface MCPServerConfig {
  // Required for all transports
  name:      string;             // Unique server name — used as tool name prefix
  transport: 'stdio' | 'http';  // Communication protocol

  // stdio-only fields
  command?:  string;             // Executable to spawn (e.g., 'npx', 'python')
  args?:     string[];           // Command arguments
  env?:      Record<string, string>; // Additional environment variables

  // http-only fields
  baseUrl?:  string;             // MCP server URL
  headers?:  Record<string, string>; // HTTP headers (auth, tenant ID, etc.)
  timeout?:  number;             // Per-request timeout in ms (default: 30_000)

  // Both transports
  retries?:  number;             // Retry count for failed calls (default: 3)
}
```

**Tool naming:** All tools from a server are prefixed with `{serverName}_`. If a GitHub server exposes `list_issues`, the registered tool name is `github_list_issues`. This prevents collisions when multiple servers expose tools with the same name.

---

## Tool Firewall with MCP Tools

MCP tools participate in the Tool Firewall exactly like native tools. Use name patterns to create policies:

```typescript
const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  mcpServers: [
    { name: 'github', transport: 'stdio', command: 'npx', args: ['...'] },
  ],
  toolFirewall: {
    defaultDecision: 'accept',
    rules: [
      // Read-only GitHub operations — auto-accept
      { name: '^github_list_.*',    decision: 'accept', reason: 'Read-only' },
      { name: '^github_search_.*',  decision: 'accept', reason: 'Read-only' },
      // Write operations — require user approval
      { name: '^github_create_.*',  decision: 'ask',    reason: 'Creates a new resource' },
      { name: '^github_delete_.*',  decision: 'deny',   reason: 'Deletion not permitted' },
    ],
    onAsk: async (toolName, argsJson) => {
      const approved = await promptUser(`Allow ${toolName}?`);
      return approved ? 'accept' : 'deny';
    },
  },
});
```

---

## Tips & Tricks

> **Tip:** Always wrap `session.run()` in a `try/finally` and call `session.close()` in the `finally` block. stdio MCP servers are child processes — an unhandled exception that skips `close()` will leave them running indefinitely.

> **Tip:** If an MCP server's tools aren't appearing as expected, check the server's `listTools()` response by subscribing to trace events. The `mcp:tools_discovered` event logs every tool name and schema received at startup.

> **Tip:** For HTTP MCP servers behind authentication, put credentials in `headers` rather than the `baseUrl`. This keeps secrets out of URLs and works correctly with logging systems that might record request paths.

> **Tip:** Use `toolFirewall` to apply read-only policies to MCP servers in development. You can auto-accept all `list_*` and `get_*` tools while requiring approval for `create_*`, `update_*`, and `delete_*` — without needing to enumerate every tool by name.
