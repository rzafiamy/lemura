# RAG Integration

RAG (Retrieval-Augmented Generation) lets your agent access a **knowledge base** at runtime — documents, notes, preferences, summaries — anything embedded into a vector database.

lemura defines `IRAGAdapter`, an interface your app implements to connect its own embedding store. lemura stays provider-agnostic right down to the data layer.

> 🌿 **Makix Context** 📚: Makix keeps a **personal knowledge base** — the user's travel notes, preferences, meeting summaries, and saved decisions. When the user asks _"What did I decide about the Paris trip?"_, Makix queries this store instead of guessing. With a 16K context window, you can't stuff all your notes into context — RAG retrieves only the 3–5 most relevant ones.

![RAG Integration — Retrieval Flow](/images/rag-integration-diagram.png)

---

## How It Works

```
ragAdapter detected in SessionConfig
  → rag_query + rag_ingest tools auto-register
  ↓
User: "What did I decide about the Paris trip?"
  → Makix calls rag_query({ query: "Paris trip decisions", topK: 3 })
  → Results injected as [RAG CONTEXT] blocks
  → Makix answers grounded in real user notes
```

---

## In This Section

| Page | What it covers |
|---|---|
| [Document Ingestion →](/docs/rag-integration/document-ingestion) | `IRAGAdapter.ingest()`, `InMemoryRAGAdapter` for testing, chunking strategies |
| [Query Optimization →](/docs/rag-integration/query-optimization) | `topK`, `minScore`, `ragTokenBudget`, multi-tenant collection IDs |
| [Vector Stores →](/docs/rag-integration/vector-stores) | Building a production adapter (Pinecone example), popular targets |

---

## Quick Reference — Makix Personal Notes

```typescript
import { InMemoryRAGAdapter } from 'lemura/rag';

const rag = new InMemoryRAGAdapter();
await rag.ingest({
  documents: [
    { id: 'note-paris', content: 'Paris trip: decided train not plane. Budget €800. Musée d\'Orsay a must.', metadata: { category: 'travel' } },
    { id: 'note-food',  content: 'Food: no shellfish, love Japanese & Mediterranean, hate cilantro.', metadata: { category: 'preferences' } },
  ],
});

const session = new SessionManager({
  adapter, model: 'qwen3.5-4b', maxTokens: 16_000,
  ragAdapter: rag,
  ragTokenBudget: 3_200,   // 20% of 16K for personal notes
});
// rag_query is now available to Makix automatically
```

See [Document Ingestion →](/docs/rag-integration/document-ingestion) to build and test your knowledge base, and [Vector Stores →](/docs/rag-integration/vector-stores) for the production Pinecone adapter.
