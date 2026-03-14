import { describe, it, expect, vi } from 'vitest';
import { ContextManager, SandwichCompressionStrategy } from '../../../src/context/index.js';
import { LemuraContextOverflowError, ContextWindow, IProviderAdapter } from '../../../src/types/index.js';

describe('ContextManager Unit Tests', () => {
    it('should return context unmodified if no strategies apply', async () => {
        const manager = new ContextManager();
        const ctx: ContextWindow = {
            systemPrompt: '',
            scratchpad: '',
            turns: [{ role: 'user', content: 'hi', tokenCount: 100, turnIndex: 0, compressed: false }],
            tokenCount: 100,
            maxTokens: 1000,
            metadata: {}
        };

        const result = await manager.prepare(ctx);
        expect(result.tokenCount).toBe(100);
    });

    it('should throw LemuraContextOverflowError if compression fails to reduce tokens enough', async () => {
        const manager = new ContextManager();
        const ctx: ContextWindow = {
            systemPrompt: '',
            scratchpad: '',
            turns: [
                { role: 'user', content: 'hello', tokenCount: 1500, turnIndex: 0, compressed: false }
            ],
            tokenCount: 1500,
            maxTokens: 1000,
            metadata: {}
        };

        await expect(manager.prepare(ctx, 0.95)).rejects.toThrow(LemuraContextOverflowError);
    });

    it('should sort strategies by priority', () => {
        const manager = new ContextManager();
        const s1 = { name: 's1', priority: 50, shouldApply: () => true, apply: async (c: any) => c };
        const s2 = { name: 's2', priority: 10, shouldApply: () => true, apply: async (c: any) => c };

        manager.registerStrategy(s1);
        manager.registerStrategy(s2);
        // @ts-ignore internal verification
        expect(manager.strategies[0].priority).toBe(10);
        // @ts-ignore internal verification
        expect(manager.strategies[1].priority).toBe(50);
    });
});
