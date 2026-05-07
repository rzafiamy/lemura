import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MCPClient } from '../../../src/mcp/MCPClient.js';
import { ILogger } from '../../../src/types/index.js';

describe('MCPClient (HTTP Headers)', () => {
    let logger: ILogger;

    beforeEach(() => {
        logger = {
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        } as unknown as ILogger;

        // Mock global fetch
        global.fetch = vi.fn();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should include custom headers in HTTP RPC calls', async () => {
        const config = {
            name: 'test-server',
            transport: 'http' as const,
            url: 'https://api.example.com/mcp',
            headers: {
                'Authorization': 'Bearer test-token',
                'X-Custom-Header': 'custom-value'
            }
        };

        const client = new MCPClient('test-server', config, logger);

        // Mock initialize response
        (global.fetch as any).mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                jsonrpc: '2.0',
                id: 1,
                result: {
                    protocolVersion: '2024-11-05',
                    capabilities: { tools: {} },
                    serverInfo: { name: 'test', version: '1.0.0' }
                }
            })
        });

        // Mock initialize notification (fire-and-forget)
        (global.fetch as any).mockResolvedValueOnce({ ok: true });

        // Mock tools/list response
        (global.fetch as any).mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                jsonrpc: '2.0',
                id: 2,
                result: { tools: [] }
            })
        });

        await client.connect();

        // Check first fetch (initialize)
        expect(global.fetch).toHaveBeenCalledWith(
            'https://api.example.com/mcp',
            expect.objectContaining({
                headers: expect.objectContaining({
                    'Authorization': 'Bearer test-token',
                    'X-Custom-Header': 'custom-value',
                    'Content-Type': 'application/json'
                })
            })
        );
    });
});
