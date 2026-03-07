---
trigger: always_on
---

# lemura — RAG Connector Rules

## Overview

lemura does not bundle a vector database or embeddings engine. Instead it defines `IRAGAdapter` — an interface that consuming apps implement to connect their own RAG system. lemura ships a minimal reference implementation for testing purposes only.

---

## IRAGAdapter Interface

```
IRAGAdapter {
  // Ingest a document or set of documents
  ingest(request: RAGIngestRequest): Promise<RAGIngestResponse>

  // Query for relevant documents
  query(request: RAGQueryRequest): Promise<RAGQueryResponse>

  // Optional: delete documents
  delete?(ids: string[]): Promise<void>

  // Optional: health check
  healthCheck?(): Promise<boolean>
}
```

---

## Request / Response Types

```
RAGIngestRequest {
  documents: RAGDocument[]
  collectionId?: string          // optional namespace/collection
  options?: RAGIngestOptions
}

RAGDocument {
  id: string                     // caller-assigned stable ID
  content: string                // raw text to embed
  metadata?: Record<string, unknown>
}

RAGIngestResponse {
  ingestedCount: number
  failedCount: number
  failures?: Array<{ id: string; reason: string }>
}

RAGQueryRequest {
  query: string                  // natural language query
  topK?: number                  // default: 5
  collectionId?: string
  filter?: Record<string, unknown>   // metadata filter, adapter-specific
  minScore?: number              // similarity threshold, 0–1
}

RAGQueryResponse {
  results: RAGResult[]
  queryEmbedding?: number[]      // optional, for caching
}

RAGResult {
  document: RAGDocument
  score: number                  // 0–1 similarity
  chunkIndex?: number            // if the adapter chunks documents
}
```

---

## RAG Integration in the Agent Loop

When `ragAdapter` is present in `SessionConfig`:

1. The `rag_query` built-in tool is automatically registered
2. The `rag_ingest` built-in tool is automatically registered  
3. RAG results injected by the tool are formatted as:

```
[RAG CONTEXT]
Source: {document.id}
Score: {score}
---
{document.content}
[/RAG CONTEXT]
```

4. Multiple results are concatenated with a separator
5. The formatted block is returned as the tool result and appended to context as a `tool` role turn

---

## RAG Context Injection Budget

RAG results compete with conversation history for the token budget. Rules:

- RAG results are injected as tool results — they count against `maxTokens`
- `RAGQueryRequest.topK` should be tuned based on `maxTokens` and expected result size
- If RAG results would push the context over budget, `ContextManager` applies compression **before** RAG injection
- A `ragTokenBudget` can be set in `SessionConfig` to cap how many tokens RAG results can consume (default: 20% of `maxTokens`)

---

## Writing a Custom RAG Adapter

Implementing `IRAGAdapter` for a specific vector store:

1. Create a class implementing `IRAGAdapter`
2. Map your vector store's API to lemura's request/response types
3. Normalize similarity scores to 0–1 range
4. Ensure `document.id` is preserved round-trip (ingest → query)
5. Run the RAG adapter contract test:
   ```bash
   pnpm test tests/contracts/rag.contract.test.ts --adapter=./my-rag-adapter
   ```

### Example adapter targets (not bundled, implement externally)

| Vector Store | npm package name convention |
|---|---|
| Pinecone | `lemura-rag-pinecone` |
| Weaviate | `lemura-rag-weaviate` |
| Chroma | `lemura-rag-chroma` |
| pgvector | `lemura-rag-pgvector` |
| In-memory (testing) | `lemura/rag/InMemoryRAGAdapter` (bundled, test only) |

---

## InMemoryRAGAdapter (bundled for testing)

A minimal in-memory adapter that uses cosine similarity on TF-IDF vectors:

- **Not for production** — no persistence, no real embeddings
- Use only in tests and local development
- Import from `lemura/rag` sub-path
- Does not require a real provider adapter — fully self-contained

---

## RAG Adapter Contract Tests

The contract test suite verifies:

- `ingest()` accepts an array of documents and returns `ingestedCount === documents.length` on success
- `query()` returns results sorted by score descending
- `query()` with `topK: 1` returns at most 1 result
- All scores are between 0 and 1 inclusive
- A document ingested with a given `id` is retrievable via a semantic query for its content
- `delete()` (if implemented) removes documents from query results