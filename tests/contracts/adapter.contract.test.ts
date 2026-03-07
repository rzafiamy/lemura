import { describe, it, expect } from 'vitest';
import { IProviderAdapter, LemuraAdapterError } from '../../src/types/index.js';
import { OpenAICompatibleAdapter } from '../../src/adapters/OpenAICompatibleAdapter.js';

describe('Adapter Contract Test Suite', () => {
    // Mock configuration for contract test 
    const adapterBase: IProviderAdapter = new OpenAICompatibleAdapter({
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'test-key',
        defaultModel: 'gpt-4o-mini',
    });

    it('estimateTokens() returns a positive integer for non-empty string', () => {
        const tokens = adapterBase.estimateTokens('Hello world');
        expect(tokens).toBeGreaterThan(0);
        expect(Number.isInteger(tokens)).toBe(true);
    });

    it('healthCheck() resolves to a boolean without throwing', async () => {
        const isHealthy = await adapterBase.healthCheck();
        expect(typeof isHealthy).toBe('boolean');
    });

    it('unsupported capabilities throw CAPABILITY_NOT_SUPPORTED', async () => {
        await expect(adapterBase.transcribe({ audioBase64: 'base64', mimeType: 'audio/mp3' }))
            .rejects.toThrow(LemuraAdapterError);
    });

    // NOTE: Full complete() and stream() testing would require mocking fetch or a live endpoint
    // In a real project we would mock the global fetch for these contract tests
});
