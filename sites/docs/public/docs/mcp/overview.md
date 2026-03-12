# MCP Integration — Overview

MCP (Model Context Protocol) is an open standard for exposing callable tools to AI agents. Lemura's MCP integration bridges any MCP server into the existing tool system with zero changes to the agent loop.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  SessionManager                                     │
│                                                     │
│  ToolRegistry (native tools + MCP-bridged tools)    │
│       ↑                                             │
│  MCPClientRegistry                                  │
│    ├── MCPClient "github"   (stdio)                 │
│    ├── MCPClient "weather"  (http)                  │
│    └── MCPClient "db_tools" (stdio)                 │
└─────────────────────────────────────────────────────┘
```

---

## Lifecycle

1. **Construction** — `SessionManager` reads `config.mcpServers` and starts `MCPClientRegistry._initMCP()` asynchronously.
2. **Connect** — each `MCPClient` connects (spawns process or sends HTTP request), sends `initialize`, then `notifications/initialized`.
3. **Discovery** — each client calls `tools/list` and returns an array of `MCPToolDefinition` objects.
4. **Bridging** — `MCPClientRegistry.discoverTools()` converts each `MCPToolDefinition` into an `IToolDefinition` adapter and registers it in `ToolRegistry`.
5. **Execution** — when the LLM requests an MCP tool, `ToolRegistry.execute()` calls the bridged `IToolDefinition.execute()`, which delegates to `MCPClient.callTool()`.
6. **Teardown** — `session.close()` calls `MCPClientRegistry.disconnectAll()`, which sends an `exit` notification and terminates child processes.

---

## Tool Bridging

Each MCP tool becomes an `IToolDefinition`:

| MCP field | Mapped to |
|---|---|
| `name` | `IToolDefinition.name` |
| `description` | `IToolDefinition.description` (prefixed with `[MCP:serverName]`) |
| `inputSchema` | `IToolDefinition.parameters` (JSON Schema) |
| `tools/call` response | `IToolDefinition.execute()` return value |

---

## Name Conflicts

If an MCP tool has the same name as a native tool, the **native tool wins** — the MCP tool is skipped and a warning is logged. If two MCP servers expose the same tool name, the **last-registered server wins** with a warning.

---

## Error Handling

| Error class | When it's thrown |
|---|---|
| `LemuraMCPConnectionError` | Connect failure, spawn failure, HTTP error, init failure |
| `LemuraMCPTimeoutError` | Tool call or HTTP request exceeds `timeoutMs` |

Both are subclasses of `LemuraMCPError` which extends `LemuraError`.

A failed server connection is **non-fatal by default**: `_initMCP` logs the error and continues connecting remaining servers, so one broken server doesn't block the entire session.
