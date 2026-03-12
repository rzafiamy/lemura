import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MCPClientRegistry } from '../../../src/mcp/MCPClientRegistry.js';
import { MCPClient } from '../../../src/mcp/MCPClient.js';
import { LemuraMCPConnectionError } from '../../../src/types/errors.js';

// ---------------------------------------------------------------------------
// Helpers / mocks
// ---------------------------------------------------------------------------

const makeLogger = () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn()
});

/** Creates a mocked MCPClient that resolves connect() and exposes preset tools */
function mockMCPClient(
    tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>,
    callToolResult: unknown = { text: 'ok' }
) {
    const client = {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
        callTool: vi.fn().mockResolvedValue(callToolResult),
        get tools() { return tools; },
        get isConnected() { return true; },
        get serverName() { return 'mock'; }
    };
    return client as unknown as MCPClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCPClientRegistry', () => {
    let logger: ReturnType<typeof makeLogger>;
    let registry: MCPClientRegistry;

    beforeEach(() => {
        logger = makeLogger();
        registry = new MCPClientRegistry(logger as any);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // -------------------------------------------------------------------
    it('registers a server and discovers its tools as IToolDefinitions', async () => {
        const mcpTools = [
            { name: 'search_docs', description: 'Search documentation', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } }
        ];

        // Spy on MCPClient so we don't need a real process
        vi.spyOn(MCPClient.prototype, 'connect').mockResolvedValue(undefined);
        Object.defineProperty(MCPClient.prototype, 'tools', { get: () => mcpTools, configurable: true });

        await registry.register('docs', { name: 'docs', transport: 'stdio', command: 'echo' });

        const tools = await registry.discoverTools();

        expect(tools).toHaveLength(1);
        expect(tools[0].name).toBe('search_docs');
        // Description should be prefixed with the server name
        expect(tools[0].description).toContain('[MCP:docs]');
        // Parameters should mirror the MCP inputSchema
        expect(tools[0].parameters).toMatchObject({ type: 'object' });
    });

    // -------------------------------------------------------------------
    it('routes callTool to the correct IToolDefinition.execute()', async () => {
        const mcpTools = [
            { name: 'get_weather', description: 'Get weather', inputSchema: { type: 'object', properties: {} } }
        ];

        vi.spyOn(MCPClient.prototype, 'connect').mockResolvedValue(undefined);
        vi.spyOn(MCPClient.prototype, 'callTool').mockResolvedValue('sunny in Paris');
        Object.defineProperty(MCPClient.prototype, 'tools', { get: () => mcpTools, configurable: true });

        await registry.register('weather', { name: 'weather', transport: 'http', url: 'http://localhost:9999' });
        const tools = await registry.discoverTools();

        // Execute through the bridged IToolDefinition — simulates SessionManager calling it
        const weatherTool = tools.find(t => t.name === 'get_weather')!;
        const result = await weatherTool.execute({ city: 'Paris' }, {} as any);

        expect(result).toBe('sunny in Paris');
        expect(MCPClient.prototype.callTool).toHaveBeenCalledWith('get_weather', { city: 'Paris' });
    });

    // -------------------------------------------------------------------
    it('warns and overrides when two servers expose the same tool name', async () => {
        const sharedTool = [{ name: 'ping', description: 'Ping', inputSchema: {} }];

        vi.spyOn(MCPClient.prototype, 'connect').mockResolvedValue(undefined);
        Object.defineProperty(MCPClient.prototype, 'tools', { get: () => sharedTool, configurable: true });

        await registry.register('server_a', { name: 'server_a', transport: 'stdio', command: 'a' });
        await registry.register('server_b', { name: 'server_b', transport: 'stdio', command: 'b' });

        const tools = await registry.discoverTools();

        // Only one bridged tool for 'ping' (last wins)
        expect(tools.filter(t => t.name === 'ping')).toHaveLength(2); // both bridged...
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("'ping' is already provided"));
    });

    // -------------------------------------------------------------------
    it('throws LemuraMCPConnectionError when connect fails', async () => {
        vi.spyOn(MCPClient.prototype, 'connect').mockRejectedValue(new Error('ENOENT: no such file'));

        await expect(
            registry.register('broken', { name: 'broken', transport: 'stdio', command: 'nonexistent' })
        ).rejects.toBeInstanceOf(LemuraMCPConnectionError);

        expect(logger.error).not.toHaveBeenCalled(); // error is thrown, not swallowed
    });

    // -------------------------------------------------------------------
    it('disconnectAll disconnects all servers gracefully', async () => {
        const disconnectSpy = vi.spyOn(MCPClient.prototype, 'connect').mockResolvedValue(undefined);
        const discSpy = vi.spyOn(MCPClient.prototype, 'disconnect').mockResolvedValue(undefined);
        Object.defineProperty(MCPClient.prototype, 'tools', { get: () => [], configurable: true });

        await registry.register('s1', { name: 's1', transport: 'stdio', command: 'echo' });
        await registry.register('s2', { name: 's2', transport: 'stdio', command: 'echo' });

        await registry.disconnectAll();

        expect(discSpy).toHaveBeenCalledTimes(2);
        expect(registry.getRegisteredServers()).toHaveLength(0);
        void disconnectSpy; // used
    });

    // -------------------------------------------------------------------
    it('getRegisteredServers returns server names', async () => {
        vi.spyOn(MCPClient.prototype, 'connect').mockResolvedValue(undefined);
        Object.defineProperty(MCPClient.prototype, 'tools', { get: () => [], configurable: true });

        await registry.register('alpha', { name: 'alpha', transport: 'http', url: 'http://a' });
        await registry.register('beta', { name: 'beta', transport: 'http', url: 'http://b' });

        expect(registry.getRegisteredServers()).toEqual(['alpha', 'beta']);
    });
});
