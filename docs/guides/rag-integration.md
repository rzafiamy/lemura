# RAG Integration

## What this is
lemura does not bundle a vector database or embeddings engine. Instead it defines `IRAGAdapter` — an interface that consumer applications implement to connect their own RAG systems.

## How it works
The `IRAGAdapter` enforces two main patterns: `ingest` and `query`. These align directly with standard semantic search systems (like Pinecone, ChromaDB, or Weaviate).

When `ragAdapter` is supplied to `SessionConfig`, the built-in `rag_query` and `rag_ingest` tools automatically register and format document injections into agent context.

```ts
interface IRAGAdapter {
  ingest(request: RAGIngestRequest): Promise<RAGIngestResponse>;
  query(request: RAGQueryRequest): Promise<RAGQueryResponse>;
}
```

## Configuration

Setting the adapter logic into the master `SessionManager`:
| Field | Type | Default | Description |
|---|---|---|---|
| `ragAdapter` | `IRAGAdapter` | `undefined` | The integration adapter wrapping Pinecone/Chroma/etc. |

## Examples

Using the bundled `InMemoryRAGAdapter` (test-only version):

```ts
import { SessionManager } from 'lemura/agent';
import { InMemoryRAGAdapter } from 'lemura/rag';

const ragAdapter = new InMemoryRAGAdapter();

await ragAdapter.ingest({
  documents: [{ id: 'doc-1', content: 'Agentic workflows run on RAG interfaces' }]
});

const session = new SessionManager({
  adapter,
  model: 'gpt-4o',
  maxTokens: 50000,
  ragAdapter // Passes into ToolRegistry contexts!
});
```

## When things go wrong
- **Missing Results:** Check `query()` minScore boundary rules.
- **Lost Embeddings:** Reingest the namespace collection and ensure that document IDs are mapped uniquely.
