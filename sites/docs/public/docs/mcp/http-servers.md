# HTTP / SSE MCP Servers

The `http` (and `sse`) transport connects to a **remote MCP server** over HTTP using native `fetch`. JSON-RPC requests are sent as `POST` to the server's base URL. No child processes are spawned.

> **Node.js ≥ 18** is required (for native `fetch` support), which is already a lemura requirement.

---

## Configuration

```typescript
{
  name: 'remote_tools',
  transport: 'http',      // or 'sse'
  url: 'http://localhost:3001',
  timeoutMs: 15_000
}
```

### Required fields
| Field | Description |
|---|---|
| `name` | Unique identifier for this server |
| `transport` | `'http'` or `'sse'` |
| `url` | Base URL of the MCP server |

### Optional fields
| Field | Default | Description |
|---|---|---|
| `timeoutMs` | `30_000` | Per-call timeout; uses `AbortController` |

> **Note**: `env`, `command`, and `args` are ignored for HTTP/SSE transport.

---

## Full Example

```typescript
import { SessionManager, OpenAICompatibleAdapter } from 'lemura';

const adapter = new OpenAICompatibleAdapter({ /* ... */ });

const session = new SessionManager({
  adapter,
  model: 'qwen3.5-4b',
  maxTokens: 16_000,
  mcpServers: [
    {
      name: 'product_tools',
      transport: 'http',
      url: 'https://tools.internal.example.com',
      timeoutMs: 20_000
    }
  ]
});

try {
  const result = await session.run('Search the product catalog for wireless headphones');
  console.log(result);
} finally {
  await session.close();
}
```

---

## Mixing Transports

You can freely mix stdio and HTTP servers in the same session:

```typescript
mcpServers: [
  { name: 'github',   transport: 'stdio', command: 'npx', args: ['@mcp/server-github'] },
  { name: 'db_tools', transport: 'http',  url: 'http://localhost:4000' }
]
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `LemuraMCPConnectionError: HTTP 404` | Wrong URL or route | Verify the server is running and the base URL is correct |
| `LemuraMCPConnectionError: HTTP 401` | Auth required | Add auth headers (custom `fetch` wrapper not yet built-in; open an issue) |
| `LemuraMCPTimeoutError` | Server response is slow | Increase `timeoutMs` |
| Tools list is empty | Server returned `[]` for `tools/list` | Check the server implementation |
