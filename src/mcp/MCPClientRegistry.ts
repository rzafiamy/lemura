import { ILogger, IToolDefinition, ToolContext } from '../types/index.js';
import { MCPServerConfig, MCPToolDefinition } from '../types/mcp.js';
import { LemuraMCPConnectionError } from '../types/errors.js';
import { MCPClient } from './MCPClient.js';

/**
 * Manages the full lifecycle of multiple MCP server connections and routes
 * tool calls to the correct server.
 *
 * Typical usage is handled automatically by `SessionManager` when `mcpServers`
 * is set in `SessionConfig`. You can also use it standalone for advanced scenarios.
 *
 * @example
 * const registry = new MCPClientRegistry(logger);
 * await registry.register('github', { transport: 'stdio', command: 'npx', args: ['...'] });
 * const tools = await registry.discoverTools(); // IToolDefinition[] ready for ToolRegistry
 */
export class MCPClientRegistry {
    private readonly clients: Map<string, MCPClient> = new Map();
    /** toolName → serverName  */
    private readonly toolRouter: Map<string, string> = new Map();
    private readonly logger: ILogger;

    constructor(logger: ILogger) {
        this.logger = logger;
    }

    // ---------------------------------------------------------------------------
    // Registration
    // ---------------------------------------------------------------------------

    /**
     * Creates an `MCPClient` for the given config, connects to the server, and
     * registers the server by name.
     *
     * @throws {LemuraMCPConnectionError} if connection / initialization fails
     */
    async register(name: string, config: MCPServerConfig): Promise<void> {
        if (this.clients.has(name)) {
            this.logger.warn(`[MCPClientRegistry] Server '${name}' is already registered — skipping`);
            return;
        }

        const client = new MCPClient(name, config, this.logger);
        try {
            await client.connect();
        } catch (err: unknown) {
            const msg = (err as Error).message ?? String(err);
            throw new LemuraMCPConnectionError(
                `[MCPClientRegistry] Failed to connect to server '${name}': ${msg}`,
                `Could not establish connection to MCP server '${name}'`,
                [
                    `Verify the server is reachable and the transport config is correct`,
                    `Check the 'command', 'args', or 'url' for server '${name}'`
                ]
            );
        }

        this.clients.set(name, client);
        this.logger.info(`[MCPClientRegistry] Server '${name}' registered (${client.tools.length} tools)`);
    }

    // ---------------------------------------------------------------------------
    // Tool discovery
    // ---------------------------------------------------------------------------

    /**
     * Collects tools from all connected MCP servers and returns them as
     * `IToolDefinition` adapters ready to be registered in `ToolRegistry`.
     *
     * Tool names are **not** namespaced — if two servers expose a tool with the
     * same name, the last-registered server wins and a warning is emitted.
     */
    async discoverTools(): Promise<IToolDefinition[]> {
        const bridged: IToolDefinition[] = [];

        for (const [serverName, client] of this.clients) {
            for (const mcpTool of client.tools) {
                if (this.toolRouter.has(mcpTool.name)) {
                    this.logger.warn(
                        `[MCPClientRegistry] Tool '${mcpTool.name}' is already provided by '${this.toolRouter.get(mcpTool.name)}'; ` +
                        `overriding with server '${serverName}'`
                    );
                }
                this.toolRouter.set(mcpTool.name, serverName);
                bridged.push(this._bridge(mcpTool, serverName));
            }
        }

        this.logger.debug(`[MCPClientRegistry] Discovered ${bridged.length} total MCP tool(s)`);
        return bridged;
    }

    // ---------------------------------------------------------------------------
    // Routing
    // ---------------------------------------------------------------------------

    /**
     * Calls a tool on the correct MCP server.
     *
     * @param toolName - The tool name as registered via `discoverTools()`
     * @param args - Parsed arguments object
     * @throws {LemuraMCPConnectionError} if no server is registered for `toolName`
     */
    async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
        const serverName = this.toolRouter.get(toolName);
        if (!serverName) {
            throw new LemuraMCPConnectionError(
                `[MCPClientRegistry] No MCP server found for tool '${toolName}'`,
                `Tool '${toolName}' was not discovered from any connected MCP server`,
                ['Verify the MCP server that provides this tool is configured and connected']
            );
        }

        const client = this.clients.get(serverName)!;
        return client.callTool(toolName, args);
    }

    // ---------------------------------------------------------------------------
    // Lifecycle
    // ---------------------------------------------------------------------------

    /**
     * Disconnects all registered MCP servers gracefully.
     * Called automatically by `SessionManager.close()`.
     */
    async disconnectAll(): Promise<void> {
        const names = Array.from(this.clients.keys());
        this.logger.debug(`[MCPClientRegistry] Disconnecting ${names.length} MCP server(s)...`);

        await Promise.allSettled(
            names.map(async (name) => {
                try {
                    await this.clients.get(name)!.disconnect();
                    this.logger.debug(`[MCPClientRegistry] '${name}' disconnected`);
                } catch (err: unknown) {
                    this.logger.warn(
                        `[MCPClientRegistry] Error disconnecting '${name}': ${(err as Error).message}`
                    );
                }
            })
        );

        this.clients.clear();
        this.toolRouter.clear();
    }

    /** Returns the names of all currently registered servers */
    getRegisteredServers(): string[] {
        return Array.from(this.clients.keys());
    }

    // ---------------------------------------------------------------------------
    // Private helpers
    // ---------------------------------------------------------------------------

    /**
     * Bridges an `MCPToolDefinition` from the protocol into an `IToolDefinition`
     * that the existing `ToolRegistry` can execute.
     */
    private _bridge(mcpTool: MCPToolDefinition, serverName: string): IToolDefinition {
        const self = this;
        return {
            name: mcpTool.name,
            description: `[MCP:${serverName}] ${mcpTool.description}`,
            parameters: mcpTool.inputSchema ?? { type: 'object', properties: {} },
            async execute(params: unknown, _context: ToolContext): Promise<unknown> {
                return self.callTool(mcpTool.name, (params ?? {}) as Record<string, unknown>);
            }
        };
    }
}
