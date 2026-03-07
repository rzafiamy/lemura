# Vector Store Adapters

lemura doesn't bundle a vector database — it defines `IRAGAdapter`, which your app implements to connect any embedding store. This page covers building and testing production RAG adapters.

---

## Why No Bundled Vector Store?

Vector stores differ dramatically in:
- **Deployment model**: local (Chroma), managed cloud (Pinecone), self-hosted (Weaviate)
- **Embedding strategy**: external OpenAI, built-in, custom models
- **Performance characteristics**: latency, throughput, exact vs approximate search
- **Cost structure**: per-query, per-storage, compute-based

By defining an interface, lemura lets you pick the vector store that fits your requirements — and swap it out later without changing agent code.

---

## The Adapter Interface

```typescript
interface IRAGAdapter {
  ingest(request: RAGIngestRequest): Promise<RAGIngestResponse>;
  query(request: RAGQueryRequest): Promise<RAGQueryResponse>;
  delete?(ids: string[]): Promise<void>;
  healthCheck?(): Promise<boolean>;
}
```

---

## Chroma Adapter (Self-Hosted, Local Dev)

Chroma is the easiest to get running locally — no API key, Docker optional:

```typescript
import type { IRAGAdapter, RAGIngestRequest, RAGIngestResponse, RAGQueryRequest, RAGQueryResponse } from 'lemura/types';
import { ChromaClient, OpenAIEmbeddingFunction } from 'chromadb';

export class ChromaRAGAdapter implements IRAGAdapter {
  private client: ChromaClient;
  private embedder: OpenAIEmbeddingFunction;
  private collectionCache = new Map<string, Awaited<ReturnType<ChromaClient['getOrCreateCollection']>>>();

  constructor(private config: {
    chromaUrl: string;       // e.g. 'http://localhost:8000'
    openaiApiKey: string;    // for embeddings
    defaultCollection: string;
  }) {
    this.client = new ChromaClient({ path: config.chromaUrl });
    this.embedder = new OpenAIEmbeddingFunction({
      openai_api_key: config.openaiApiKey,
    });
  }

  private async getCollection(id?: string) {
    const name = id ?? this.config.defaultCollection;
    if (!this.collectionCache.has(name)) {
      const col = await this.client.getOrCreateCollection({
        name,
        embeddingFunction: this.embedder,
      });
      this.collectionCache.set(name, col);
    }
    return this.collectionCache.get(name)!;
  }

  async ingest(request: RAGIngestRequest): Promise<RAGIngestResponse> {
    const collection = await this.getCollection(request.collectionId);
    let ingestedCount = 0;
    const failures: Array<{ id: string; reason: string }> = [];

    // Batch in chunks of 100 to avoid memory issues
    const batchSize = 100;
    for (let i = 0; i < request.documents.length; i += batchSize) {
      const batch = request.documents.slice(i, i + batchSize);
      try {
        await collection.upsert({
          ids:        batch.map(d => d.id),
          documents:  batch.map(d => d.content),
          metadatas:  batch.map(d => d.metadata as Record<string, string> ?? {}),
        });
        ingestedCount += batch.length;
      } catch (err) {
        batch.forEach(d => failures.push({ id: d.id, reason: String(err) }));
      }
    }

    return { ingestedCount, failedCount: failures.length, failures };
  }

  async query(request: RAGQueryRequest): Promise<RAGQueryResponse> {
    const collection = await this.getCollection(request.collectionId);

    const results = await collection.query({
      queryTexts: [request.query],
      nResults: request.topK ?? 5,
      where: request.filter as Record<string, unknown>,
    });

    const ids        = results.ids[0] ?? [];
    const documents  = results.documents[0] ?? [];
    const metadatas  = results.metadatas[0] ?? [];
    const distances  = results.distances?.[0] ?? [];

    return {
      results: ids
        .map((id, i) => ({
          document: {
            id,
            content: documents[i] ?? '',
            metadata: (metadatas[i] ?? {}) as Record<string, unknown>,
          },
          // Chroma returns L2 distance — convert to similarity (0-1)
          score: Math.max(0, 1 - (distances[i] ?? 1) / 2),
        }))
        .filter(r => r.score >= (request.minScore ?? 0)),
    };
  }

  async delete(ids: string[]) {
    const collection = await this.getCollection();
    await collection.delete({ ids });
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.heartbeat();
      return true;
    } catch {
      return false;
    }
  }
}
```

---

## Weaviate Adapter (Self-Hosted or Cloud)

```typescript
import weaviate from 'weaviate-ts-client';
import type { IRAGAdapter } from 'lemura/types';

export class WeaviateRAGAdapter implements IRAGAdapter {
  private client: ReturnType<typeof weaviate.client>;

  constructor(config: {
    scheme: 'http' | 'https';
    host: string;           // e.g. 'localhost:8080' or 'your-cluster.weaviate.io'
    apiKey?: string;        // for Weaviate Cloud
    openaiApiKey: string;   // for text2vec-openai vectorizer
    className: string;      // Weaviate class name, e.g. 'Document'
  }) {
    this.client = weaviate.client({
      scheme: config.scheme,
      host: config.host,
      apiKey: config.apiKey ? new weaviate.ApiKey(config.apiKey) : undefined,
      headers: { 'X-OpenAI-Api-Key': config.openaiApiKey },
    });
    this.className = config.className;
  }

  private className: string;

  async query(request: RAGQueryRequest): Promise<RAGQueryResponse> {
    const result = await this.client.graphql
      .get()
      .withClassName(this.className)
      .withFields('content id _additional { certainty }')
      .withNearText({ concepts: [request.query] })
      .withLimit(request.topK ?? 5)
      .do();

    const items = result.data?.Get?.[this.className] ?? [];

    return {
      results: items
        .map((item: Record<string, unknown>) => ({
          document: {
            id: String(item['id'] ?? ''),
            content: String(item['content'] ?? ''),
          },
          score: Number((item['_additional'] as Record<string, unknown>)?.['certainty'] ?? 0),
        }))
        .filter((r: { score: number }) => r.score >= (request.minScore ?? 0)),
    };
  }

  async ingest(request: RAGIngestRequest): Promise<RAGIngestResponse> {
    let ingestedCount = 0;
    const failures: Array<{ id: string; reason: string }> = [];

    for (const doc of request.documents) {
      try {
        await this.client.data.creator()
          .withClassName(this.className)
          .withId(doc.id)
          .withProperties({ content: doc.content, ...doc.metadata })
          .do();
        ingestedCount++;
      } catch (err) {
        failures.push({ id: doc.id, reason: String(err) });
      }
    }

    return { ingestedCount, failedCount: failures.length, failures };
  }
}
```

---

## pgvector Adapter (PostgreSQL)

If you already run PostgreSQL, `pgvector` is the simplest production-ready option:

```typescript
import { Pool } from 'pg';
import type { IRAGAdapter } from 'lemura/types';

export class PgVectorRAGAdapter implements IRAGAdapter {
  constructor(
    private pool: Pool,
    private openaiApiKey: string,
    private tableName = 'lemura_documents'
  ) {}

  private async embed(text: string): Promise<number[]> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.openaiApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: text }),
    });
    const data = await response.json() as { data: [{ embedding: number[] }] };
    return data.data[0]!.embedding;
  }

  async query(request: RAGQueryRequest): Promise<RAGQueryResponse> {
    const embedding = await this.embed(request.query);
    const vectorStr = `[${embedding.join(',')}]`;

    const result = await this.pool.query(
      `SELECT id, content, metadata,
              1 - (embedding <=> $1::vector) AS similarity
       FROM ${this.tableName}
       WHERE 1 - (embedding <=> $1::vector) >= $2
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
      [vectorStr, request.minScore ?? 0.5, request.topK ?? 5]
    );

    return {
      results: result.rows.map(row => ({
        document: { id: row.id, content: row.content, metadata: row.metadata },
        score: Number(row.similarity),
      })),
    };
  }

  async ingest(request: RAGIngestRequest): Promise<RAGIngestResponse> {
    let ingestedCount = 0;
    const failures: Array<{ id: string; reason: string }> = [];

    for (const doc of request.documents) {
      try {
        const embedding = await this.embed(doc.content);
        const vectorStr = `[${embedding.join(',')}]`;

        await this.pool.query(
          `INSERT INTO ${this.tableName} (id, content, metadata, embedding)
           VALUES ($1, $2, $3, $4::vector)
           ON CONFLICT (id) DO UPDATE SET content = $2, metadata = $3, embedding = $4::vector`,
          [doc.id, doc.content, doc.metadata ?? {}, vectorStr]
        );
        ingestedCount++;
      } catch (err) {
        failures.push({ id: doc.id, reason: String(err) });
      }
    }

    return { ingestedCount, failedCount: failures.length, failures };
  }

  // Initialize the table if it doesn't exist
  async initialize() {
    await this.pool.query(`
      CREATE EXTENSION IF NOT EXISTS vector;
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        id        TEXT PRIMARY KEY,
        content   TEXT NOT NULL,
        metadata  JSONB DEFAULT '{}',
        embedding vector(1536)  -- text-embedding-3-small dimension
      );
      CREATE INDEX IF NOT EXISTS ${this.tableName}_embedding_idx
        ON ${this.tableName} USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100);
    `);
  }
}
```

---

## RAG Adapter Contract Tests

All adapters must pass the contract test suite:

```bash
pnpm test tests/contracts/rag.contract.test.ts --adapter=./dist/MyRAGAdapter.js
```

Tests verify:
- `ingest()` returns `ingestedCount === documents.length` on success
- `query()` returns results sorted by score descending
- `query({ topK: 1 })` returns at most 1 result
- All scores are between 0 and 1 inclusive
- A document ingested with a given `id` is retrievable via semantic query for its content

---

## Tips & Tricks

> **Tip:** Normalize scores to [0, 1] before returning. Cosine similarities from most stores are in [-1, 1] — apply `(score + 1) / 2` to normalize. L2 distances need different normalization: `1 - min(distance, 2) / 2`.

> **Tip:** For pgvector, create an IVFFlat index after inserting at least 1000 rows (or use HNSW, which works at any size). Querying without an index is O(n) and very slow at scale.

> **Tip:** When ingesting, batch your embedding calls. OpenAI's embedding API supports up to 2048 texts per request — use it to reduce latency and cost dramatically compared to one-at-a-time embedding.
