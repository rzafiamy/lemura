# stdio MCP Servers

The `stdio` transport spawns a child process and communicates over **stdin/stdout** using newline-delimited JSON-RPC 2.0. This is the most common transport for local MCP servers (e.g. NPX packages).

---

## Configuration

```typescript
{
  name: 'github',
  transport: 'stdio',
  command: 'npx',                                     // executable
  args: ['@modelcontextprotocol/server-github'],       // arguments
  env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN! },   // env vars injected into the child process
  timeoutMs: 30_000                                    // per-call timeout (default 30s)
}
```

### Required fields
| Field | Description |
|---|---|
| `name` | Unique identifier for this server |
| `transport` | Must be `'stdio'` |
| `command` | Executable to spawn (must be in `PATH`) |

### Optional fields
| Field | Default | Description |
|---|---|---|
| `args` | `[]` | Arguments passed to the executable |
| `env` | `{}` | Extra environment variables merged with `process.env` |
| `timeoutMs` | `30_000` | Timeout per JSON-RPC call in ms |

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
      name: 'github',
      transport: 'stdio',
      command: 'npx',
      args: ['@modelcontextprotocol/server-github'],
      env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN! }
    },
    {
      name: 'filesystem',
      transport: 'stdio',
      command: 'npx',
      args: ['@modelcontextprotocol/server-filesystem', '/home/user/projects'],
      timeoutMs: 10_000
    }
  ]
});

try {
  const result = await session.run('List my open PRs and summarise the latest commit');
  console.log(result);
} finally {
  await session.close();
}
```

---

## Custom Python Server

```typescript
{
  name: 'my_db_tools',
  transport: 'stdio',
  command: 'python',
  args: ['./my_mcp_server.py'],
  env: {
    DATABASE_URL: process.env.DATABASE_URL!,
    LOG_LEVEL: 'INFO'
  }
}
```

---

## Stderr Logging

Output written by the child process to **stderr** is captured and surfaced as `debug` log entries (`[MCP:serverName] stderr: ...`). Enable your logger's debug level to see it.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `LemuraMCPConnectionError: Failed to spawn` | Command not in PATH | Install the package or provide an absolute path in `command` |
| Tools list is empty | Server did not respond to `tools/list` | Check the server supports MCP ≥ 2024-11-05 |
| `LemuraMCPTimeoutError` | Server is too slow | Increase `timeoutMs` or optimise the server |
