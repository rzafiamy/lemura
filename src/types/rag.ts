export interface RAGDocument {
    id: string;
    content: string;
    metadata?: Record<string, unknown>;
}

export interface RAGIngestOptions {
    [key: string]: unknown;
}

export interface RAGIngestRequest {
    documents: RAGDocument[];
    collectionId?: string;
    options?: RAGIngestOptions;
}

export interface RAGIngestResponse {
    ingestedCount: number;
    failedCount: number;
    failures?: Array<{ id: string; reason: string }>;
}

export interface RAGQueryRequest {
    query: string;
    topK?: number;
    collectionId?: string;
    filter?: Record<string, unknown>;
    minScore?: number;
}

export interface RAGResult {
    document: RAGDocument;
    score: number;
    chunkIndex?: number;
}

export interface RAGQueryResponse {
    results: RAGResult[];
    queryEmbedding?: number[];
}

export interface IRAGAdapter {
    ingest(request: RAGIngestRequest): Promise<RAGIngestResponse>;
    query(request: RAGQueryRequest): Promise<RAGQueryResponse>;
    delete?(ids: string[]): Promise<void>;
    healthCheck?(): Promise<boolean>;
}
