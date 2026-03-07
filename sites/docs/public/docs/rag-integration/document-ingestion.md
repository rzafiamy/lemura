# Document Ingestion

Ingesting documents correctly is just as important as querying them. This page covers chunking strategies, batch ingestion, metadata design, and keeping your knowledge base fresh.

---

## Why Chunking Matters

RAG retrieval works by matching the **query embedding** to **document embeddings**. The match quality depends heavily on chunk size:

```
Too large (entire document):
  Query: "What is the refund policy?"
  Chunk: [20 pages of Terms of Service]
  → Similarity score: 0.3 — the chunk contains the answer but also a lot of noise

Too small (sentence fragments):
  Query: "What is the refund policy?"
  Chunk: "Refunds are processed within"
  → The chunk is incomplete and meaningless without context

Just right (~300-500 tokens):
  Query: "What is the refund policy?"
  Chunk: "Customers may request a full refund within 30 days of purchase.
          After 30 days, store credit is offered at 100% of purchase value.
          To request a refund, contact support@acme.com with your order number."
  → Similarity score: 0.92 — direct, complete answer
```

---

## Chunking Strategies

### Strategy 1: Fixed-Size with Overlap

Split at a fixed token count with overlap to preserve context across boundaries:

```typescript
function chunkWithOverlap(
  text: string,
  chunkSize: number = 400,
  overlap: number = 50
): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];

  for (let i = 0; i < words.length; i += chunkSize - overlap) {
    const chunk = words.slice(i, i + chunkSize).join(' ');
    if (chunk.trim()) chunks.push(chunk);
  }

  return chunks;
}

// Usage
const doc = await readFile('terms-of-service.txt', 'utf8');
const chunks = chunkWithOverlap(doc, 400, 50);
```

### Strategy 2: Semantic Chunking (by section)

For structured documents, split at semantic boundaries:

```typescript
function chunkBySection(markdown: string): string[] {
  // Split on H2 and H3 headers
  return markdown
    .split(/(?=^##\s)/m)
    .map(section => section.trim())
    .filter(section => section.length > 50); // skip tiny sections
}

// For code files: split by function/class
function chunkCodeByFunction(code: string): string[] {
  // Simple regex — use a real AST parser for production
  return code
    .split(/(?=\n(?:export\s+)?(?:async\s+)?function\s|\n(?:export\s+)?class\s)/m)
    .filter(chunk => chunk.trim().length > 30);
}
```

### Strategy 3: Paragraph-Based with Sentence Grouping

Natural paragraph boundaries with minimum size enforcement:

```typescript
function chunkByParagraph(
  text: string,
  minChunkTokens: number = 100,
  maxChunkTokens: number = 500
): string[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let currentChunk = '';

  for (const paragraph of paragraphs) {
    const paraTokens = Math.ceil(paragraph.length / 4);

    if (currentChunk && Math.ceil(currentChunk.length / 4) + paraTokens > maxChunkTokens) {
      chunks.push(currentChunk.trim());
      currentChunk = paragraph;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
    }
  }

  if (currentChunk.trim()) chunks.push(currentChunk.trim());
  return chunks;
}
```

---

## Batch Ingestion

Ingesting documents one-at-a-time is slow and expensive (one embedding API call per document). Always batch:

```typescript
async function ingestDocuments(
  ragAdapter: IRAGAdapter,
  files: string[],
  options: {
    collectionId?: string;
    chunkSize?: number;
    batchSize?: number;
    onProgress?: (done: number, total: number) => void;
  } = {}
): Promise<{ total: number; ingested: number; failed: number }> {
  const { chunkSize = 400, batchSize = 50, collectionId } = options;

  const allChunks: RAGDocument[] = [];

  // 1. Read and chunk all files
  for (const filePath of files) {
    const content = await readFile(filePath, 'utf8');
    const chunks = chunkWithOverlap(content, chunkSize);

    chunks.forEach((chunk, i) => {
      allChunks.push({
        id: `${filePath}#chunk-${i}`,
        content: chunk,
        metadata: {
          source: filePath,
          chunkIndex: i,
          totalChunks: chunks.length,
          ingestedAt: new Date().toISOString(),
        },
      });
    });
  }

  console.log(`Ingesting ${allChunks.length} chunks from ${files.length} files...`);

  let ingested = 0;
  let failed = 0;

  // 2. Ingest in batches
  for (let i = 0; i < allChunks.length; i += batchSize) {
    const batch = allChunks.slice(i, i + batchSize);

    const result = await ragAdapter.ingest({
      documents: batch,
      collectionId,
    });

    ingested += result.ingestedCount;
    failed   += result.failedCount;

    if (result.failures?.length) {
      console.warn(`Batch ${i / batchSize + 1} had ${result.failures.length} failures:`, result.failures);
    }

    options.onProgress?.(Math.min(i + batchSize, allChunks.length), allChunks.length);
  }

  return { total: allChunks.length, ingested, failed };
}

// Usage:
const files = await glob('./docs/**/*.md');
const stats = await ingestDocuments(ragAdapter, files, {
  collectionId: 'product-docs',
  onProgress: (done, total) => {
    process.stdout.write(`\rIngesting: ${done}/${total} chunks...`);
  },
});
console.log(`\nDone: ${stats.ingested}/${stats.total} ingested, ${stats.failed} failed`);
```

---

## Metadata Design

Metadata enables powerful filtering. Design metadata fields around your query patterns:

```typescript
// E-commerce knowledge base
{
  id: 'policy-refunds-v2',
  content: 'Customers may request a full refund within 30 days...',
  metadata: {
    category: 'policy',         // filter: { category: 'policy' }
    topic: 'refunds',           // filter: { topic: 'refunds' }
    version: '2024-01',         // date-based filtering
    language: 'en',             // multi-language support
    audience: 'customer',       // customer vs agent vs internal
    lastUpdated: '2024-01-15',
  },
}

// Code repository
{
  id: 'src/auth/JWTService.ts#chunk-3',
  content: 'export class JWTService { ...',
  metadata: {
    filePath: 'src/auth/JWTService.ts',
    language: 'typescript',
    module: 'auth',               // filter by module
    functionName: 'JWTService',   // search within class
    gitCommit: 'a3f9b2c',
    indexed: '2024-01-15T10:00:00Z',
  },
}
```

### Filtering in queries

```typescript
await ragAdapter.query({
  query: 'How do I process a refund?',
  topK: 5,
  filter: {
    category: 'policy',
    language: 'en',
    audience: { $in: ['customer', 'agent'] },  // filter syntax is adapter-specific
  },
  minScore: 0.65,
});
```

---

## Re-Ingestion & Updates

When documents change, re-ingest with the same `id` — adapters use `upsert` semantics:

```typescript
// Single document update
await ragAdapter.ingest({
  documents: [{
    id: 'policy-refunds',  // same ID — updates the existing embedding
    content: updatedPolicyText,
    metadata: { updatedAt: new Date().toISOString() },
  }],
});

// Watch for file changes (development)
import { watch } from 'fs';

watch('./docs', { recursive: true }, async (event, filename) => {
  if (!filename?.endsWith('.md')) return;

  const content = await readFile(`./docs/${filename}`, 'utf8');
  const chunks = chunkWithOverlap(content, 400);

  // Delete old chunks for this file
  const oldIds = getExistingChunkIds(filename); // your tracking logic
  await ragAdapter.delete?.(oldIds);

  // Re-ingest
  await ragAdapter.ingest({
    documents: chunks.map((chunk, i) => ({
      id: `${filename}#chunk-${i}`,
      content: chunk,
      metadata: { source: filename, chunkIndex: i },
    })),
  });

  console.log(`Re-indexed: ${filename} (${chunks.length} chunks)`);
});
```

---

## Tips & Tricks

> **Tip:** Add the document title or section heading to the beginning of each chunk. This gives the embedding model crucial context that dramatically improves retrieval: `"## Refund Policy\n\nCustomers may request..."` retrieves much better than just `"Customers may request..."`.

> **Tip:** For code ingestion, include the function signature and docstring in every chunk, even if the chunk primarily contains the function body. This allows queries like "how do I call the payment function?" to find implementation details.

> **Tip:** Save your chunk IDs to a database or file so you can delete and re-ingest individual documents cleanly. A simple approach: `{ fileHash: string; chunkIds: string[] }` per file, stored in a `rag_index_state.json`.
