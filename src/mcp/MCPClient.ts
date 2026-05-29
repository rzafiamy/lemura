import { ChildProcess, spawn } from 'child_process';
import { ILogger } from '../types/index.js';
import {
    MCPServerConfig,
    MCPToolDefinition,
    MCPJsonRpcRequest,
    MCPJsonRpcResponse
} from '../types/mcp.js';
import { LemuraMCPConnectionError, LemuraMCPTimeoutError } from '../types/errors.js';

/**
 * Low-level MCP server client.
 *
 * Supports two transports:
 * - **stdio** — spawns a child process and communicates over stdin/stdout via newline-delimited JSON-RPC 2.0
 * - **http** — sends JSON-RPC 2.0 `POST` requests using native `fetch` (Node >= 18 required)
 *
 * Lifecycle:
 * 1. `connect()` — initialize the server and fetch its tool list
 * 2. `callTool()` — invoke a tool by name
 * 3. `disconnect()` — terminate the connection / child process
 *
 * @example
 * const client = new MCPClient('github', {
 *   name: 'github',
 *   transport: 'stdio',
 *   command: 'npx',
 *   args: ['@modelcontextprotocol/server-github'],
 *   env: { GITHUB_TOKEN: '...' }
 * }, logger);
 *
 * await client.connect();
 * const result = await client.callTool('create_issue', { title: 'bug' });
 * await client.disconnect();
 */
export class MCPClient {
    private readonly config: MCPServerConfig;
    private readonly logger: ILogger;
    private readonly _serverName: string;
    private readonly timeoutMs: number;

    private _tools: MCPToolDefinition[] = [];
    private _connected: boolean = false;

    // stdio-specific state
    private process: ChildProcess | null = null;
    private pendingCallbacks: Map<number | string, {
        resolve: (value: unknown) => void;
        reject: (reason: Error) => void;
    }> = new Map();
    private requestId: number = 1;
    private stdioBuffer: string = '';

    constructor(name: string, config: MCPServerConfig, logger: ILogger) {
        this._serverName = name;
        this.config = config;
        this.logger = logger;
        this.timeoutMs = config.timeoutMs ?? 30_000;
    }

    get serverName(): string {
        return this._serverName;
    }

    get tools(): MCPToolDefinition[] {
        return this._tools;
    }

    get isConnected(): boolean {
        return this._connected;
    }

    // ---------------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------------

    /**
     * Connects to the MCP server: sends `initialize` + `notifications/initialized`,
     * then fetches the tool list via `tools/list`.
     */
    async connect(): Promise<void> {
        this.logger.debug(`[MCP:${this._serverName}] Connecting via ${this.config.transport}...`);

        if (this.config.transport === 'stdio') {
            await this._connectStdio();
        } else {
            // http / sse — validate url exists
            if (!this.config.url) {
                throw new LemuraMCPConnectionError(
                    `[MCP:${this._serverName}] 'url' is required for ${this.config.transport} transport`,
                    `No URL provided for MCP server '${this._serverName}'`,
                    [`Set 'url' in the MCPServerConfig for server '${this._serverName}'`]
                );
            }
        }

        await this._initialize();
        await this._discoverTools();
        this._connected = true;
        this.logger.info(`[MCP:${this._serverName}] Connected. ${this._tools.length} tool(s) available.`);
    }

    /**
     * Calls a tool on this MCP server.
     *
     * @param toolName - The tool name as declared by the server
     * @param args - Tool arguments (must match the tool's inputSchema)
     * @returns The serialised result from the server
     */
    async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
        this.logger.debug(`[MCP:${this._serverName}] Calling tool '${toolName}'`, { args });

        const request: MCPJsonRpcRequest = {
            jsonrpc: '2.0',
            id: this._nextId(),
            method: 'tools/call',
            params: { name: toolName, arguments: args }
        };

        const startMs = Date.now();
        let response: MCPJsonRpcResponse;
        try {
            response = await this._rpc(request);
        } catch (err: unknown) {
            const elapsedMs = Date.now() - startMs;
            if (err instanceof LemuraMCPTimeoutError) {
                this.logger.error(
                    `[MCP:${this._serverName}] Tool '${toolName}' timed out after ${elapsedMs}ms (limit: ${this.timeoutMs}ms)`,
                    {
                        problem: `MCP server '${this._serverName}' did not respond to tool '${toolName}' in time.`,
                        hints: [
                            `Increase 'timeoutMs' in the MCPServerConfig for '${this._serverName}' (currently ${this.timeoutMs}ms).`,
                            `Check whether the MCP server process is healthy and not blocked.`
                        ]
                    }
                );
            } else {
                this.logger.error(
                    `[MCP:${this._serverName}] Tool '${toolName}' RPC failed after ${elapsedMs}ms: ${(err as Error).message}`
                );
            }
            throw err;
        }
        this.logger.debug(`[MCP:${this._serverName}] Tool '${toolName}' completed in ${Date.now() - startMs}ms`);
        this._assertNoError(response, `tool '${toolName}'`);

        // MCP spec: result.content is an array of content blocks
        const result = response.result as Record<string, unknown> | undefined;
        if (result && Array.isArray(result['content'])) {
            // Flatten text content blocks into a single string for convenience
            const texts = (result['content'] as Array<{ type: string; text?: string }>)
                .filter(b => b.type === 'text' && b.text)
                .map(b => b.text as string);
            return texts.length === 1 ? texts[0] : texts.length > 1 ? texts.join('\n') : result;
        }
        return result;
    }

    /**
     * Disconnects from the MCP server.
     * For stdio: sends the `exit` notification then terminates the process.
     */
    async disconnect(): Promise<void> {
        if (!this._connected) return;

        this.logger.debug(`[MCP:${this._serverName}] Disconnecting...`);
        this._connected = false;

        if (this.process) {
            try {
                // Best-effort: send exit notification
                const exitNotif = JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'notifications/exit'
                }) + '\n';
                this.process.stdin?.write(exitNotif);
            } catch { /* ignore write errors on shutdown */ }

            this.process.kill();
            this.process = null;
        }

        // Reject any still-pending callbacks
        for (const [, cb] of this.pendingCallbacks) {
            cb.reject(new LemuraMCPConnectionError(
                `[MCP:${this._serverName}] Connection closed before response received`
            ));
        }
        this.pendingCallbacks.clear();
    }

    // ---------------------------------------------------------------------------
    // Private: stdio transport
    // ---------------------------------------------------------------------------

    private async _connectStdio(): Promise<void> {
        const { command, args = [], env = {} = {} } = this.config as Required<Pick<MCPServerConfig, 'command'>> & MCPServerConfig;

        if (!command) {
            throw new LemuraMCPConnectionError(
                `[MCP:${this._serverName}] 'command' is required for stdio transport`,
                `No command provided for stdio MCP server '${this._serverName}'`,
                [`Set the 'command' field in MCPServerConfig for server '${this._serverName}'`]
            );
        }

        return new Promise<void>((resolve, reject) => {
            let proc: ChildProcess;
            try {
                proc = spawn(command, args, {
                    stdio: ['pipe', 'pipe', 'pipe'],
                    env: { ...process.env, ...env }
                });
            } catch (err: unknown) {
                return reject(new LemuraMCPConnectionError(
                    `[MCP:${this._serverName}] Failed to spawn '${command}': ${(err as Error).message}`,
                    `Could not start MCP server process for '${this._serverName}'`,
                    [
                        `Ensure '${command}' is installed and available in PATH`,
                        `Check the 'args' and 'env' configuration for server '${this._serverName}'`
                    ]
                ));
            }

            this.process = proc;

            proc.on('error', (err) => {
                this.logger.error(`[MCP:${this._serverName}] Process error: ${err.message}`);
                // Reject any pending callbacks
                for (const [, cb] of this.pendingCallbacks) {
                    cb.reject(new LemuraMCPConnectionError(
                        `[MCP:${this._serverName}] Process error: ${err.message}`
                    ));
                }
                this.pendingCallbacks.clear();
                this._connected = false;
            });

            proc.on('exit', (code, signal) => {
                if (this._connected) {
                    this.logger.warn(`[MCP:${this._serverName}] Process exited unexpectedly (code=${code}, signal=${signal})`);
                    this._connected = false;
                }
            });

            proc.stdout?.on('data', (chunk: Buffer) => {
                this.stdioBuffer += chunk.toString('utf8');
                this._flushStdioBuffer();
            });

            proc.stderr?.on('data', (chunk: Buffer) => {
                // MCP servers may log to stderr; surface as debug
                this.logger.debug(`[MCP:${this._serverName}] stderr: ${chunk.toString('utf8').trim()}`);
            });

            resolve();
        });
    }

    /** Parses newline-delimited JSON messages from the stdio buffer */
    private _flushStdioBuffer(): void {
        const lines = this.stdioBuffer.split('\n');
        // Keep the last (potentially incomplete) line in the buffer
        this.stdioBuffer = lines.pop() ?? '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            let msg: MCPJsonRpcResponse;
            try {
                msg = JSON.parse(trimmed) as MCPJsonRpcResponse;
            } catch {
                this.logger.debug(`[MCP:${this._serverName}] Ignoring non-JSON line: ${trimmed.slice(0, 120)}`);
                continue;
            }

            // Responses have an id; notifications do not — ignore notifications
            if (msg.id === undefined || msg.id === null) continue;

            const cb = this.pendingCallbacks.get(msg.id);
            if (cb) {
                this.pendingCallbacks.delete(msg.id);
                cb.resolve(msg);
            }
        }
    }

    // ---------------------------------------------------------------------------
    // Private: JSON-RPC helpers
    // ---------------------------------------------------------------------------

    private _nextId(): number {
        return this.requestId++;
    }

    /** Sends a JSON-RPC request and returns the response, honouring the configured timeout. */
    private async _rpc(request: MCPJsonRpcRequest): Promise<MCPJsonRpcResponse> {
        if (this.config.transport === 'stdio') {
            return this._rpcStdio(request);
        }
        return this._rpcHttp(request);
    }

    private _rpcStdio(request: MCPJsonRpcRequest): Promise<MCPJsonRpcResponse> {
        return new Promise<MCPJsonRpcResponse>((resolve, reject) => {
            if (!this.process?.stdin) {
                return reject(new LemuraMCPConnectionError(
                    `[MCP:${this._serverName}] stdin is not available`
                ));
            }

            const id = request.id;
            let timedOut = false;

            const timer = setTimeout(() => {
                timedOut = true;
                this.pendingCallbacks.delete(id);
                reject(new LemuraMCPTimeoutError(
                    `[MCP:${this._serverName}] RPC call '${request.method}' timed out after ${this.timeoutMs}ms`
                ));
            }, this.timeoutMs);

            this.pendingCallbacks.set(id, {
                resolve: (value) => {
                    if (timedOut) return;
                    clearTimeout(timer);
                    resolve(value as MCPJsonRpcResponse);
                },
                reject: (err) => {
                    if (timedOut) return;
                    clearTimeout(timer);
                    reject(err);
                }
            });

            this.process.stdin.write(JSON.stringify(request) + '\n', 'utf8');
        });
    }

    private async _rpcHttp(request: MCPJsonRpcRequest): Promise<MCPJsonRpcResponse> {
        const url = this.config.url!;

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    ...this.config.headers
                },
                body: JSON.stringify(request),
                signal: controller.signal
            });

            if (!res.ok) {
                throw new LemuraMCPConnectionError(
                    `[MCP:${this._serverName}] HTTP ${res.status} from server: ${res.statusText}`,
                    `MCP server '${this._serverName}' returned a non-2xx response`,
                    [`Verify the server is running at '${url}' and accepting JSON-RPC requests`]
                );
            }

            return await res.json() as MCPJsonRpcResponse;
        } catch (err: unknown) {
            if ((err as Error).name === 'AbortError') {
                throw new LemuraMCPTimeoutError(
                    `[MCP:${this._serverName}] HTTP RPC '${request.method}' timed out after ${this.timeoutMs}ms`
                );
            }
            throw err;
        } finally {
            clearTimeout(timer);
        }
    }

    /** Sends `initialize` then `notifications/initialized` per MCP spec */
    private async _initialize(): Promise<void> {
        const initRequest: MCPJsonRpcRequest = {
            jsonrpc: '2.0',
            id: this._nextId(),
            method: 'initialize',
            params: {
                protocolVersion: '2024-11-05',
                capabilities: { tools: {} },
                clientInfo: { name: 'lemura', version: '1.2.0' }
            }
        };

        let response: MCPJsonRpcResponse;
        try {
            response = await this._rpc(initRequest);
        } catch (err: unknown) {
            const msg = (err as Error).message ?? String(err);
            throw new LemuraMCPConnectionError(
                `[MCP:${this._serverName}] Initialize failed: ${msg}`,
                `Failed to initialize MCP server '${this._serverName}'`,
                [
                    `Ensure the server supports the MCP protocol`,
                    `Verify the server is running and accepting connections`
                ]
            );
        }

        this._assertNoError(response, 'initialize');

        // Send the initialized notification (no id = notification, no response expected)
        const initializedNotif = JSON.stringify({
            jsonrpc: '2.0',
            method: 'notifications/initialized'
        }) + '\n';

        if (this.config.transport === 'stdio' && this.process?.stdin) {
            this.process.stdin.write(initializedNotif, 'utf8');
        } else if (this.config.transport !== 'stdio') {
            // HTTP: fire-and-forget notify (some servers don't require it)
            fetch(this.config.url!, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...this.config.headers
                },
                body: initializedNotif
            }).catch(() => { /* optional notification — ignore errors */ });
        }
    }

    /** Fetches and caches the tool list from the server */
    private async _discoverTools(): Promise<void> {
        const request: MCPJsonRpcRequest = {
            jsonrpc: '2.0',
            id: this._nextId(),
            method: 'tools/list',
            params: {}
        };

        const response = await this._rpc(request);
        this._assertNoError(response, 'tools/list');

        const result = response.result as Record<string, unknown> | undefined;
        const tools = (result?.['tools'] ?? []) as MCPToolDefinition[];
        this._tools = tools;
    }

    private _assertNoError(response: MCPJsonRpcResponse, context: string): void {
        if (response.error) {
            throw new LemuraMCPConnectionError(
                `[MCP:${this._serverName}] JSON-RPC error in ${context}: [${response.error.code}] ${response.error.message}`,
                `MCP server '${this._serverName}' returned a JSON-RPC error during ${context}`,
                ['Check the MCP server logs for more details']
            );
        }
    }
}
