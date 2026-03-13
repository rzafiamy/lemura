# RAG Integration

RAG (Retrieval-Augmented Generation) addresses a fundamental limitation of LLMs: their knowledge is frozen at training time. A well-trained model knows nothing about your company's internal documentation, the user's personal notes, or anything that happened after its training cutoff. RAG solves this by letting the agent query a vector database at inference time, retrieving the most semantically relevant documents and injecting them as context before the model answers.

Lemura integrates RAG through the `IRAGAdapter` interface — a simple, provider-agnostic contract your application implements to connect its own embedding store. When a `ragAdapter` is configured, lemura automatically registers two tools: `rag_query` (the agent uses this to retrieve relevant documents) and `rag_ingest` (to store new documents). The agent treats RAG like any other tool — it calls `rag_query` during its ReAct loop, receives the matching documents as tool observations, and uses them to ground its response.

The key design principle is that **lemura stays out of the embedding business**. It doesn't embed documents, manage vector databases, or prescribe how similarity search works. You bring your own embedding model and vector store, implement two interface methods (`ingest` and `query`), and lemura handles the rest: tool registration, result injection, token budget enforcement, and context lifecycle.

> 🌿 **Makix Context** 📚: Makix keeps a **personal knowledge base** — the user's travel notes, preferences, meeting summaries, and saved decisions. When the user asks _"What did I decide about the Paris trip?"_, Makix queries this store instead of guessing. With a 16K context window, you can't stuff all your notes into context — RAG retrieves only the 3–5 most relevant ones.

---

## How It Works

```
ragAdapter set in SessionConfig
     ↓
rag_query + rag_ingest tools auto-registered
     ↓
User: "What hotels did I shortlist for the Tokyo trip?"
     ↓
ReAct loop:
  Agent calls: rag_query({ query: "Tokyo trip hotels shortlist", topK: 3 })
     ↓
  IRAGAdapter.query() → [doc-1, doc-2, doc-3]
     ↓
  Results injected as [RAG CONTEXT] blocks in tool observation
     ↓
  Agent answers: "Based on your notes, you shortlisted..."
```

---

## The IRAGAdapter Interface

```typescript
interface IRAGAdapter {
  // Store documents in the vector database
  ingest(request: RAGIngestRequest): Promise<RAGIngestResponse>;

  // Search for semantically similar documents
  query(request: RAGQueryRequest): Promise<RAGQueryResponse>;
}

interface RAGIngestRequest {
  documents: RAGDocument[];
}

interface RAGDocument {
  id: string;                           // Unique document ID
  content: string;                      // The text to embed and store
  metadata?: Record<string, unknown>;  // Optional tags, categories, timestamps
}

interface RAGQueryRequest {
  query: string;          // Natural language search query
  topK?: number;          // Number of results to return (default: 5)
  minScore?: number;      // Minimum similarity score filter (0–1)
  filter?: Record<string, unknown>;  // Metadata filter (e.g., { category: 'travel' })
  collectionId?: string;  // Multi-tenant: query a specific sub-collection
}

interface RAGQueryResponse {
  documents: Array<{
    id:       string;
    content:  string;
    score:    number;                     // Cosine similarity (0–1)
    metadata?: Record<string, unknown>;
  }>;
}
```

---

## In This Section

| Page | What it covers |
|---|---|
| [Document Ingestion →](/docs/rag-integration/document-ingestion) | `IRAGAdapter.ingest()`, `InMemoryRAGAdapter` for testing, chunking strategies |
| [Query Optimization →](/docs/rag-integration/query-optimization) | `topK`, `minScore`, `ragTokenBudget`, multi-tenant collection IDs |
| [Vector Stores →](/docs/rag-integration/vector-stores) | Building a production adapter (Pinecone example), popular targets |

---

## Quick Start — In-Memory RAG

The `InMemoryRAGAdapter` uses cosine similarity on simple word-frequency vectors. It has no external dependencies — ideal for development and testing:

```typescript
import { SessionManager, OpenAICompatibleAdapter } from 'lemura';
import { InMemoryRAGAdapter } from 'lemura/rag';

const rag = new InMemoryRAGAdapter();

// Ingest your knowledge base
await rag.ingest({
  documents: [
    {
      id: 'note-paris',
      content: 'Paris trip decision: chose train over plane. Budget €800. Must visit Musée d\'Orsay.',
      metadata: { category: 'travel', destination: 'paris' },
    },
    {
      id: 'note-food',
      content: 'Food preferences: no shellfish allergy. Love Japanese and Mediterranean food. Hate cilantro.',
      metadata: { category: 'preferences' },
    },
    {
      id: 'note-tokyo',
      content: 'Tokyo hotels shortlisted: Aman Tokyo, Park Hyatt Tokyo, Andaz Shinjuku. Budget ¥50,000/night.',
      metadata: { category: 'travel', destination: 'tokyo' },
    },
  ],
});

const session = new SessionManager({
  adapter: new OpenAICompatibleAdapter({ /* config */ }),
  model: 'gpt-4o',
  maxTokens: 128_000,
  ragAdapter: rag,
  ragTokenBudget: 10_000,  // max tokens for RAG results
});

// The rag_query tool is now available to the agent
const answer = await session.run("What hotels did I shortlist for Tokyo?");
// → "Based on your notes, you shortlisted the Aman Tokyo, Park Hyatt Tokyo, and Andaz Shinjuku,
//    with a budget of ¥50,000 per night."
```

---

## Production RAG — Implementing a Custom Adapter

For production, connect your own vector database by implementing `IRAGAdapter`:

```typescript
import type { IRAGAdapter, RAGIngestRequest, RAGIngestResponse, RAGQueryRequest, RAGQueryResponse } from 'lemura/types';
import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';

export class PineconeRAGAdapter implements IRAGAdapter {
  private pinecone: Pinecone;
  private openai: OpenAI;
  private indexName: string;

  constructor(config: { pineconeApiKey: string; openaiApiKey: string; indexName: string }) {
    this.pinecone  = new Pinecone({ apiKey: config.pineconeApiKey });
    this.openai    = new OpenAI({ apiKey: config.openaiApiKey });
    this.indexName = config.indexName;
  }

  async ingest(request: RAGIngestRequest): Promise<RAGIngestResponse> {
    const index = this.pinecone.index(this.indexName);

    // Embed all documents
    const embeddings = await this.openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: request.documents.map(d => d.content),
    });

    // Upsert to Pinecone
    const vectors = request.documents.map((doc, i) => ({
      id:       doc.id,
      values:   embeddings.data[i]!.embedding,
      metadata: { content: doc.content, ...doc.metadata },
    }));

    await index.upsert(vectors);
    return { count: vectors.length };
  }

  async query(request: RAGQueryRequest): Promise<RAGQueryResponse> {
    const index = this.pinecone.index(this.indexName);

    // Embed the query
    const embedding = await this.openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: request.query,
    });

    // Query Pinecone
    const results = await index.query({
      vector:          embedding.data[0]!.embedding,
      topK:            request.topK ?? 5,
      filter:          request.filter,
      includeMetadata: true,
    });

    return {
      documents: results.matches
        .filter(m => m.score !== undefined && m.score >= (request.minScore ?? 0))
        .map(m => ({
          id:       m.id,
          content:  (m.metadata?.['content'] as string) ?? '',
          score:    m.score!,
          metadata: m.metadata as Record<string, unknown>,
        })),
    };
  }
}

// Usage:
const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  ragAdapter: new PineconeRAGAdapter({
    pineconeApiKey: process.env.PINECONE_API_KEY!,
    openaiApiKey:   process.env.OPENAI_API_KEY!,
    indexName:      'my-knowledge-base',
  }),
  ragTokenBudget: 12_000,
});
```

---

## RAG Token Budget

`ragTokenBudget` controls how many tokens RAG results may consume per turn. When results exceed the budget, the lowest-scoring results are dropped first:

```typescript
// For a 128k model — generous budget
ragTokenBudget: 12_000

// For a 16k model — be conservative
ragTokenBudget: 3_000
```

**How RAG results appear in context:**

```
[tool: rag_query]
[RAG CONTEXT — 3 results for "Tokyo hotels shortlist"]

Result 1 (score: 0.92):
Tokyo hotels shortlisted: Aman Tokyo, Park Hyatt Tokyo, Andaz Shinjuku...

Result 2 (score: 0.78):
Tokyo itinerary notes: 5 nights, arrive Haneda, Shinjuku base...

Result 3 (score: 0.71):
Budget allocation: Tokyo ¥300,000 total, hotels ¥150,000...
[/RAG CONTEXT]
```

---

## Tips & Tricks

> **Tip:** Use `minScore` filtering (e.g., `0.7`) to prevent low-relevance results from polluting the context. A result with 0.35 cosine similarity is unlikely to be relevant and wastes your `ragTokenBudget`.

> **Tip:** Chunk your documents thoughtfully. A 10,000-word PDF should be split into 200–500 token chunks before ingestion. Retrieving a relevant 400-token chunk is far more useful to the agent than retrieving an irrelevant 5,000-token section of the same document.

> **Tip:** Use metadata filters to scope queries when you have multiple users' data. Implement a `collectionId` per user (e.g., `user_123`) and filter every query to that collection. This prevents one user's notes from appearing in another user's results.
