# MCPServerConfig Reference

Full reference for the `MCPServerConfig` interface used in `SessionConfig.mcpServers`.

---

## Interface

```typescript
interface MCPServerConfig {
  name: string;
  transport: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}
```

---

## Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | ✅ Always | Unique name for this server. Used in tool description prefixes (`[MCP:name]`) and logs |
| `transport` | `'stdio' \| 'http' \| 'sse'` | ✅ Always | Transport mechanism |
| `command` | `string` | stdio only | Executable to spawn (e.g. `'npx'`, `'python'`, `'./server'`) |
| `args` | `string[]` | stdio only | Arguments passed after the command (e.g. `['@mcp/server-github']`) |
| `url` | `string` | http/sse only | Base URL where the MCP server is listening (e.g. `'http://localhost:3001'`) |
| `env` | `Record<string,string>` | stdio only | Extra env vars merged with `process.env` before spawning |
| `timeoutMs` | `number` | No | Per-call timeout in ms. Default: `30_000` (30 seconds) |

---

## Transport Compatibility Matrix

| Field | `stdio` | `http` | `sse` |
|---|---|---|---|
| `command` | ✅ required | ignored | ignored |
| `args` | optional | ignored | ignored |
| `env` | optional | ignored | ignored |
| `url` | ignored | ✅ required | ✅ required |
| `timeoutMs` | optional | optional | optional |

---

## SessionConfig Integration

```typescript
import { SessionManager } from 'lemura';

const session = new SessionManager({
  adapter,
  model: 'my-model',
  maxTokens: 16_000,

  // MCP servers are opt-in — omit this field to disable MCP entirely
  mcpServers: [
    {
      name: 'github',
      transport: 'stdio',
      command: 'npx',
      args: ['@modelcontextprotocol/server-github'],
      env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN! },
      timeoutMs: 20_000
    },
    {
      name: 'my_api',
      transport: 'http',
      url: 'http://localhost:3001',
      timeoutMs: 10_000
    }
  ]
});

// Always close when done to release resources
await session.close();
```

---

## Error Classes

| Class | Code | Thrown when |
|---|---|---|
| `LemuraMCPError` | `MCP_ERROR` | Generic MCP failure (base class) |
| `LemuraMCPConnectionError` | `MCP_CONNECTION_FAILED` | Spawn failure, HTTP error, JSON-RPC init error |
| `LemuraMCPTimeoutError` | `MCP_TOOL_TIMEOUT` | Tool call exceeded `timeoutMs` |

All extend `LemuraError` and follow the same `{ message, code, problem, hints }` structure.
