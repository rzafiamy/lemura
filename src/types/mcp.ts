/**
 * MCP (Model Context Protocol) transport and configuration types for lemura.
 */

/** Supported MCP server transport modes */
export type MCPTransportType = 'stdio' | 'http' | 'sse';

/**
 * Configuration for a single MCP server connection.
 *
 * @example
 * // stdio server
 * const config: MCPServerConfig = {
 *   name: 'my_server',
 *   transport: 'stdio',
 *   command: 'npx',
 *   args: ['@modelcontextprotocol/server-github'],
 *   env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN! }
 * };
 *
 * @example
 * // HTTP server
 * const config: MCPServerConfig = {
 *   name: 'remote_tools',
 *   transport: 'http',
 *   url: 'http://localhost:3001'
 * };
 */
export interface MCPServerConfig {
    /** Unique name for this server (used to namespace tools) */
    name: string;
    /** Transport mechanism to communicate with the server */
    transport: MCPTransportType;
    /**
     * For `stdio`: the executable to spawn (e.g. `'npx'`, `'python'`).
     * For `http`/`sse`: leave undefined — use `url` instead.
     */
    command?: string;
    /**
     * For `stdio`: additional arguments passed to the spawned command.
     * @example ['@modelcontextprotocol/server-github']
     */
    args?: string[];
    /**
     * For `http`/`sse`: base URL of the MCP server.
     * @example 'http://localhost:3001'
     */
    url?: string;
    /**
     * Environment variables injected into the spawned process (stdio only).
     * Runtime env variables can be referenced before passing, e.g.:
     * `{ GITHUB_TOKEN: process.env.GITHUB_TOKEN! }`
     */
    env?: Record<string, string>;
    /**
     * Per-call timeout in milliseconds. Defaults to `30_000`.
     */
    timeoutMs?: number;
}

/**
 * A tool definition as returned by an MCP server's `tools/list` response.
 * @internal Used by `MCPClient`; developers interact with `IToolDefinition` instead.
 */
export interface MCPToolDefinition {
    /** Tool name as declared by the MCP server */
    name: string;
    /** Human-readable description of what the tool does */
    description: string;
    /** JSON Schema for the tool's input parameters */
    inputSchema: Record<string, unknown>;
}

/**
 * Raw JSON-RPC 2.0 request envelope sent to an MCP server.
 * @internal
 */
export interface MCPJsonRpcRequest {
    jsonrpc: '2.0';
    id: number | string;
    method: string;
    params?: Record<string, unknown>;
}

/**
 * Raw JSON-RPC 2.0 response envelope received from an MCP server.
 * @internal
 */
export interface MCPJsonRpcResponse {
    jsonrpc: '2.0';
    id: number | string;
    result?: unknown;
    error?: { code: number; message: string; data?: unknown };
}
