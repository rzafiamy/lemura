import { describe, it, expect, vi } from 'vitest';
import { SessionManager } from '../../../src/agent/SessionManager.js';
import { IProviderAdapter, LemuraAdapterError } from '../../../src/types/index.js';

const mockAdapter: IProviderAdapter = {
    name: 'mock',
    version: '1.0.0',
    complete: vi.fn().mockResolvedValue({
        content: 'Mocked response content',
        finishReason: 'stop',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    }),
    stream: vi.fn(),
    estimateTokens: vi.fn().mockReturnValue(10),
    getModelInfo: vi.fn(),
    healthCheck: vi.fn().mockResolvedValue(true),
    transcribe: vi.fn(),
    synthesize: vi.fn(),
    describeImage: vi.fn(),
    generateImage: vi.fn()
};

describe('SessionManager Unit Tests', () => {
    it('should execute a simple run completely', async () => {
        const session = new SessionManager({
            adapter: mockAdapter,
            model: 'mock-v1',
            maxTokens: 500
        });

        const res = await session.run('Hello agent');
        expect(res).toBe('Mocked response content');

        const history = session.getHistory();
        expect(history.length).toBe(2);
        expect(history[0].role).toBe('user');
        expect(history[1].role).toBe('assistant');
    });

    it('getContext returns correct values', () => {
        const session = new SessionManager({
            adapter: mockAdapter,
            model: 'mock-v1',
            maxTokens: 500,
            systemPrompt: 'System Core'
        });

        const ctx = session.getContext();
        expect(ctx.systemPrompt).toBe('System Core');
        expect(ctx.maxTokens).toBe(500);
    });
});
