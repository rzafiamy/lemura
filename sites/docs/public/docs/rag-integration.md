# RAG Integration

RAG (Retrieval-Augmented Generation) lets your agent access a **knowledge base** at runtime — documents, code, FAQs, policies, product specs — anything you've embedded into a vector database.

lemura doesn't bundle a vector DB. Instead it defines `IRAGAdapter`, an interface your app implements to connect its own embedding store. This keeps lemura provider-agnostic right down to the data layer.

---

## Why RAG Instead of Just Stuffing the Context?

| Approach | Pros | Cons |
|---|---|---|
| **Stuff everything into context** | Simple | Hits token limits fast, slow, expensive |
| **Fine-tuning** | Fast inference | Expensive, knowledge becomes stale |
| **RAG** | Fresh knowledge, scalable, cheap | Requires embedding + retrieval setup |

RAG lets the agent query only the relevant slice of your knowledge base per question — instead of loading all 10,000 documents, it loads the 5 most relevant chunks.

---

## How lemura Integrates RAG

When `ragAdapter` is in `SessionConfig`, two built-in tools auto-register:

```
Session starts
      ↓
ragAdapter detected → register rag_query + rag_ingest tools
      ↓
User asks a question
      ↓
agent.run("What's our refund policy?")
      ↓
Model decides: "I need to look this up"
  → calls rag_query({ query: "refund policy", topK: 3 })
      ↓
lemura calls ragAdapter.query(...)
      ↓
Results injected into context as [RAG CONTEXT] block
      ↓
Model reads context, generates answer
```

---

## The IRAGAdapter Interface

```typescript
interface IRAGAdapter {
  // Index documents into your vector store
  ingest(request: RAGIngestRequest): Promise<RAGIngestResponse>;

  // Semantic search over indexed documents
  query(request: RAGQueryRequest): Promise<RAGQueryResponse>;

  // Optional
  delete?(ids: string[]): Promise<void>;
  healthCheck?(): Promise<boolean>;
}
```

### Request & Response Types

```typescript
interface RAGIngestRequest {
  documents: RAGDocument[];
  collectionId?: string;     // namespace/collection for multi-tenant setups
}

interface RAGDocument {
  id: string;                // stable ID — preserved round-trip
  content: string;           // raw text to embed
  metadata?: Record<string, unknown>;  // arbitrary metadata for filtering
}

interface RAGQueryRequest {
  query: string;             // natural language query
  topK?: number;             // default: 5
  collectionId?: string;
  filter?: Record<string, unknown>;   // metadata filter (adapter-specific)
  minScore?: number;         // similarity threshold 0–1
}

interface RAGQueryResponse {
  results: RAGResult[];
}

interface RAGResult {
  document: RAGDocument;
  score: number;             // 0–1 similarity score
  chunkIndex?: number;       // if adapter chunks documents
}
```

---

## The InMemoryRAGAdapter (Testing Only)

lemura ships a TF-IDF in-memory adapter for development and testing:

```typescript
import { SessionManager } from 'lemura';
import { InMemoryRAGAdapter } from 'lemura/rag';

const rag = new InMemoryRAGAdapter();

// Ingest your knowledge base
await rag.ingest({
  documents: [
    {
      id: 'policy-refunds',
      content: 'Customers may request a full refund within 30 days of purchase. After 30 days, store credit is offered.',
      metadata: { category: 'support', topic: 'refunds' },
    },
    {
      id: 'policy-shipping',
      content: 'Standard shipping takes 5–7 business days. Express shipping takes 1–2 business days.',
      metadata: { category: 'support', topic: 'shipping' },
    },
  ],
});

const session = new SessionManager({
  adapter,
  model: 'gpt-4o',
  maxTokens: 128_000,
  ragAdapter: rag,   // rag_query and rag_ingest tools auto-register
});

const answer = await session.run("What's your return policy?");
// Agent calls rag_query, finds 'policy-refunds', answers correctly
```

> ⚠️ `InMemoryRAGAdapter` has no persistence and uses TF-IDF (not real embeddings). For production, use a real vector store adapter.

---

## Building a Production RAG Adapter

Example: Pinecone adapter:

```typescript
import type { IRAGAdapter, RAGIngestRequest, RAGIngestResponse, RAGQueryRequest, RAGQueryResponse } from 'lemura/types';
import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';  // for embeddings

export class PineconeRAGAdapter implements IRAGAdapter {
  private pc: Pinecone;
  private openai: OpenAI;
  private indexName: string;

  constructor(config: { pineconeApiKey: string; openaiApiKey: string; indexName: string }) {
    this.pc = new Pinecone({ apiKey: config.pineconeApiKey });
    this.openai = new OpenAI({ apiKey: config.openaiApiKey });
    this.indexName = config.indexName;
  }

  async ingest(request: RAGIngestRequest): Promise<RAGIngestResponse> {
    const index = this.pc.index(this.indexName);
    let ingestedCount = 0;
    const failures: Array<{ id: string; reason: string }> = [];

    for (const doc of request.documents) {
      try {
        // Generate embedding via OpenAI
        const embeddingResponse = await this.openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: doc.content,
        });
        const embedding = embeddingResponse.data[0]!.embedding;

        // Upsert into Pinecone
        await index.upsert([{
          id: doc.id,
          values: embedding,
          metadata: {
            content: doc.content,
            ...doc.metadata,
            collectionId: request.collectionId ?? 'default',
          },
        }]);

        ingestedCount++;
      } catch (err) {
        failures.push({ id: doc.id, reason: String(err) });
      }
    }

    return { ingestedCount, failedCount: failures.length, failures };
  }

  async query(request: RAGQueryRequest): Promise<RAGQueryResponse> {
    const index = this.pc.index(this.indexName);

    // Embed the query
    const embeddingResponse = await this.openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: request.query,
    });
    const queryEmbedding = embeddingResponse.data[0]!.embedding;

    // Search Pinecone
    const results = await index.query({
      vector: queryEmbedding,
      topK: request.topK ?? 5,
      includeMetadata: true,
      filter: request.collectionId
        ? { collectionId: { $eq: request.collectionId } }
        : undefined,
    });

    // Normalize to lemura's types
    return {
      results: (results.matches ?? [])
        .filter(match => (match.score ?? 0) >= (request.minScore ?? 0))
        .map(match => ({
          document: {
            id: match.id,
            content: String(match.metadata?.['content'] ?? ''),
            metadata: match.metadata as Record<string, unknown>,
          },
          score: match.score ?? 0,
        })),
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.pc.listIndexes();
      return true;
    } catch {
      return false;
    }
  }
}
```

### Popular Adapter Targets

| Vector Store | Package convention | Notes |
|---|---|---|
| Pinecone | `lemura-rag-pinecone` | Managed cloud, great for production |
| Weaviate | `lemura-rag-weaviate` | Open-source, self-hostable |
| Chroma | `lemura-rag-chroma` | Excellent for local development |
| pgvector | `lemura-rag-pgvector` | If you already have Postgres |
| Qdrant | `lemura-rag-qdrant` | High performance, self-hostable |

---

## RAG Context Injection Format

When the `rag_query` tool returns results, lemura formats them as:

```
[RAG CONTEXT]
Source: policy-refunds
Score: 0.94
---
Customers may request a full refund within 30 days of purchase. After 30 days, store credit is offered.
[/RAG CONTEXT]

[RAG CONTEXT]
Source: policy-shipping
Score: 0.71
---
Standard shipping takes 5–7 business days. Express shipping takes 1–2 business days.
[/RAG CONTEXT]
```

This block is injected as a `tool` role turn in the context, contributing to the token budget.

---

## RAG Token Budget

RAG results compete with conversation history for the token budget:

```typescript
const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  ragAdapter: pineconeAdapter,
  ragTokenBudget: 25_600,   // RAG results can use up to 20% of context (default)
});
```

If RAG results would overflow the budget, context compression runs **before** RAG injection. Tune `topK` and `ragTokenBudget` together:

```typescript
// If results are large (full PDF pages), lower topK
query({ query, topK: 2 })   // 2 chunks x ~1000 tokens = ~2k tokens

// If results are small (snippets), you can go higher
query({ query, topK: 10 })  // 10 chunks x ~200 tokens = ~2k tokens
```

---

## Multi-Tenant RAG (Collection-Based)

Use `collectionId` to namespace documents per user/tenant:

```typescript
// Ingest per-user documents
await ragAdapter.ingest({
  documents: userDocs,
  collectionId: `user-${userId}`,
});

// Query is automatically scoped to that user's collections
// via the tool's filter logic in your adapter
```

---

## Advanced: Manually Calling RAG in Tools

You can access the RAG adapter directly in your custom tools:

```typescript
const analyzeRepoTool = {
  name: 'analyze_repository',
  description: 'Analyze a code repository by searching its indexed documentation.',
  parameters: {
    type: 'object',
    properties: {
      component: { type: 'string', description: 'Component or module to analyze' },
    },
    required: ['component'],
  },
  execute: async ({ component }: { component: string }, ctx: ToolContext) => {
    if (!ctx.ragAdapter) return 'No knowledge base configured.';

    const results = await ctx.ragAdapter.query({
      query: `${component} architecture implementation details`,
      topK: 5,
      minScore: 0.7,
    });

    return results.results
      .map(r => `[${r.document.id}] ${r.document.content}`)
      .join('\n\n');
  },
};
```

---

## When Things Go Wrong

**No results returned despite relevant documents**
Lower `minScore` (try 0.5 instead of 0.7). Also verify the documents were successfully ingested by calling `ingest()` and checking `ingestedCount`.

**Wrong documents retrieved**
Your chunking strategy may be too coarse. Try splitting documents into smaller semantic chunks (200–500 tokens each) before ingesting. The query vector matches best with similarly-sized content.

**RAG tool is never called by the agent**
Add to your system prompt: _"When answering questions about [domain], always use the rag_query tool first."_ Or use `enableGoalPlanning: true` to let the agent plan upfront which tools to use.

**Scores are all identical (e.g., all 1.0 or all 0.0)**
Your adapter isn't normalizing scores to 0–1 range. Pinecone scores are already 0–1. Cosine similarity values from other stores may need `(score + 1) / 2` normalization.

**Embedding model mismatch**
If you change the embedding model (e.g., from `text-embedding-3-small` to `text-embedding-3-large`), re-ingest all documents. The vector dimensions change and old vectors become meaningless.
