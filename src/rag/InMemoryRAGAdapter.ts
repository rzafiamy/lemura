import { IRAGAdapter, RAGDocument, RAGIngestRequest, RAGIngestResponse, RAGQueryRequest, RAGQueryResponse } from '../types/index.js';

export class InMemoryRAGAdapter implements IRAGAdapter {
    private documents: Map<string, RAGDocument> = new Map();

    async ingest(request: RAGIngestRequest): Promise<RAGIngestResponse> {
        for (const doc of request.documents) {
            this.documents.set(doc.id, doc);
        }
        return {
            ingestedCount: request.documents.length,
            failedCount: 0
        };
    }

    async query(request: RAGQueryRequest): Promise<RAGQueryResponse> {
        const queryStr = request.query.toLowerCase();
        const results = [];

        // Very basic keyword matching for testing
        for (const doc of this.documents.values()) {
            const content = doc.content.toLowerCase();
            let score = 0;
            if (content.includes(queryStr)) score += 0.8;

            const words = queryStr.split(' ');
            for (const word of words) {
                if (content.includes(word)) score += 0.1;
            }

            if (score > 0 && score >= (request.minScore || 0)) {
                results.push({ document: doc, score: Math.min(score, 1) });
            }
        }

        results.sort((a, b) => b.score - a.score);
        const topK = request.topK || 5;

        return {
            results: results.slice(0, topK)
        };
    }

    async healthCheck(): Promise<boolean> {
        return true;
    }
}
