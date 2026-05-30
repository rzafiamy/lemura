import { describe, it, expect, vi } from 'vitest';
import { SessionManager } from '../../../src/agent/SessionManager.js';
import { IProviderAdapter, IToolDefinition } from '../../../src/types/index.js';

/**
 * Builds an adapter scripted to request one tool call on the first completion,
 * then return a plain stop response on every subsequent completion. This lets
 * us assert whether the `dangerous_tool` actually executed.
 */
function makeScriptedAdapter(): IProviderAdapter {
    let call = 0;
    return {
        name: 'mock',
        version: '1.0.0',
        complete: vi.fn(async () => {
            call++;
            if (call === 1) {
                return {
                    content: '',
                    toolCalls: [{ id: 'call_1', name: 'dangerous_tool', arguments: '{}' }],
                    finishReason: 'tool_call' as const,
                    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
                };
            }
            return {
                content: 'Done',
                finishReason: 'stop' as const,
                usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
            };
        }),
        stream: vi.fn(),
        estimateTokens: vi.fn().mockReturnValue(10),
        getModelInfo: vi.fn(),
        healthCheck: vi.fn().mockResolvedValue(true),
        transcribe: vi.fn(),
        synthesize: vi.fn(),
        describeImage: vi.fn(),
        generateImage: vi.fn()
    } as unknown as IProviderAdapter;
}

function makeDangerousTool(): { tool: IToolDefinition; ran: () => boolean } {
    let executed = false;
    const tool: IToolDefinition = {
        name: 'dangerous_tool',
        description: 'A tool guarded by the firewall',
        parameters: { type: 'object', properties: {} },
        execute: async () => {
            executed = true;
            return 'executed';
        }
    };
    return { tool, ran: () => executed };
}

describe('Tool firewall ask decision', () => {
    it('blocks the tool when onAsk returns the boolean false', async () => {
        const { tool, ran } = makeDangerousTool();
        const session = new SessionManager({
            adapter: makeScriptedAdapter(),
            model: 'mock-v1',
            maxTokens: 5000,
            tools: [tool],
            toolFirewall: {
                defaultDecision: 'allow',
                rules: [{ name: 'dangerous_tool', decision: 'ask' }],
                onAsk: async () => false
            }
        });

        await session.run('do the dangerous thing');

        expect(ran()).toBe(false);
    });

    it('blocks the tool when onAsk returns the string deny', async () => {
        const { tool, ran } = makeDangerousTool();
        const session = new SessionManager({
            adapter: makeScriptedAdapter(),
            model: 'mock-v1',
            maxTokens: 5000,
            tools: [tool],
            toolFirewall: {
                defaultDecision: 'allow',
                rules: [{ name: 'dangerous_tool', decision: 'ask' }],
                onAsk: async () => 'deny'
            }
        });

        await session.run('do the dangerous thing');

        expect(ran()).toBe(false);
    });

    it('blocks the tool when onAsk throws', async () => {
        const { tool, ran } = makeDangerousTool();
        const session = new SessionManager({
            adapter: makeScriptedAdapter(),
            model: 'mock-v1',
            maxTokens: 5000,
            tools: [tool],
            toolFirewall: {
                defaultDecision: 'allow',
                rules: [{ name: 'dangerous_tool', decision: 'ask' }],
                onAsk: async () => {
                    throw new Error('user closed the prompt');
                }
            }
        });

        await session.run('do the dangerous thing');

        expect(ran()).toBe(false);
    });

    it('runs the tool when onAsk returns the boolean true', async () => {
        const { tool, ran } = makeDangerousTool();
        const session = new SessionManager({
            adapter: makeScriptedAdapter(),
            model: 'mock-v1',
            maxTokens: 5000,
            tools: [tool],
            toolFirewall: {
                defaultDecision: 'allow',
                rules: [{ name: 'dangerous_tool', decision: 'ask' }],
                onAsk: async () => true
            }
        });

        await session.run('do the dangerous thing');

        expect(ran()).toBe(true);
    });

    it('runs the tool when onAsk returns the string accept', async () => {
        const { tool, ran } = makeDangerousTool();
        const session = new SessionManager({
            adapter: makeScriptedAdapter(),
            model: 'mock-v1',
            maxTokens: 5000,
            tools: [tool],
            toolFirewall: {
                defaultDecision: 'allow',
                rules: [{ name: 'dangerous_tool', decision: 'ask' }],
                onAsk: async () => 'accept'
            }
        });

        await session.run('do the dangerous thing');

        expect(ran()).toBe(true);
    });
});
