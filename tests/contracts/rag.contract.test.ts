import { describe, it, expect } from 'vitest';
import { InMemoryRAGAdapter } from '../../src/rag/InMemoryRAGAdapter.js';

describe('RAG Adapter Contract Test Suite', () => {
    const adapter = new InMemoryRAGAdapter();

    const mockDocs = [
        { id: '1', content: 'The agile methodology focuses on iterative development.' },
        { id: '2', content: 'Capital of France is Paris.' },
    ];

    it('ingest() processes documents and returns counts', async () => {
        const response = await adapter.ingest({ documents: mockDocs });
        expect(response.ingestedCount).toBe(2);
        expect(response.failedCount).toBe(0);
    });

    it('query() returns matching results with positive score', async () => {
        const response = await adapter.query({ query: 'France' });
        expect(response.results.length).toBeGreaterThan(0);
        expect(response.results[0].document.id).toBe('2');
        expect(response.results[0].score).toBeGreaterThan(0);
        expect(response.results[0].score).toBeLessThanOrEqual(1);
    });
});
