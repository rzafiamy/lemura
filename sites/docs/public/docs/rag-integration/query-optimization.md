# Query Optimization

Getting good RAG retrieval results requires careful query formulation, score threshold tuning, and understanding how semantic search works.

---

## How Semantic Search Works

RAG retrieval uses **cosine similarity** between embeddings:
1. Your query text → embedding vector (e.g., 1536 dimensions)
2. Each stored document chunk → embedding vector
3. Similarity score = cosine angle between query and document vectors
4. Top K highest-similarity documents are returned

The quality of results depends on:
- **Query quality** — specific queries beat vague ones
- **Chunk quality** — well-formed chunks with context beat raw text dumps
- **Embedding model** — larger models produce better representations
- **Score threshold** — `minScore` filters out irrelevant results

---

## Query Formulation Best Practices

### Be specific and concrete

```typescript
// ❌ Vague — matches too many documents
await ragAdapter.query({ query: 'help' });

// ✅ Specific — matches exactly what you need
await ragAdapter.query({ query: 'how to process a customer refund request within 30 days' });
```

### Match the style of your documents

If your knowledge base contains technical documentation, use technical terms:
```typescript
// Documents: TypeScript API docs
// ✅ Good
query: 'SessionManager constructor parameters typescript interface'

// ❌ Bad (conversational style won't match technical doc embeddings as well)
query: 'how do I set up the session thingy'
```

### Include domain-specific terminology

```typescript
// For medical knowledge base:
query: 'hypertension treatment guidelines ACE inhibitor first-line therapy'
// Rather than:
query: 'high blood pressure medication'
```

---

## Tuning `minScore`

`minScore` is the similarity threshold below which results are excluded:

| Value | Effect | Use when |
|---|---|---|
| `0.9+` | Very strict — only near-exact semantic matches | High-precision, low-recall tasks |
| `0.7–0.9` | Recommended default range | Most production use cases |
| `0.5–0.7` | Moderate — some noise in results | Broad exploration queries |
| `< 0.5` | Low — many irrelevant results | Almost never useful |

```typescript
// Start with 0.75 and adjust based on results:
const results = await ragAdapter.query({
  query: request.query,
  topK: 5,
  minScore: 0.75,
});

if (results.results.length === 0) {
  // Try with lower threshold
  const broader = await ragAdapter.query({
    query: request.query,
    topK: 5,
    minScore: 0.55,
  });
  // Log that we fell back — this signals corpus gap
}
```

---

## topK Tuning

More results = more context tokens = higher cost + potentially lower signal-to-noise:

```typescript
// Dense chunks (~500 tokens each) — lower topK
query({ query, topK: 3 })   // ~1500 tokens of context

// Short snippets (~100 tokens each) — higher topK
query({ query, topK: 15 })  // ~1500 tokens of context
```

Guideline: `topK × avgChunkTokens ≤ ragTokenBudget`

```typescript
const ragTokenBudget = 0.20 * maxTokens;   // 25,600 tokens for 128k model
const avgChunkTokens = 400;                  // your average chunk size
const maxTopK = Math.floor(ragTokenBudget / avgChunkTokens);  // 64
// In practice, use 5-10 — more context doesn't mean better answers
```

---

## Metadata Filtering

Filter results to a specific namespace before semantic search:

```typescript
// Multi-tenant: only search within the current user's documents
await ragAdapter.query({
  query: 'refund policy',
  topK: 5,
  collectionId: `tenant-${tenantId}`,  // collection-level isolation
});

// Category filtering (adapter-specific syntax)
await ragAdapter.query({
  query: 'shipping times',
  filter: {
    category: 'support',
    language: user.language,
    status: 'active',
  },
});
```

> **Note:** Filter syntax varies by vector store adapter. Pinecone uses `{ $eq: value }`, Weaviate uses `{ path: [...], operator: 'Equal', valueText: '...' }`, Chroma uses `{ '$eq': value }`. Your adapter handles normalization.

---

## Hybrid Search (Dense + Sparse)

For production systems, combining semantic search with keyword search ("hybrid" or "BM25+vector") significantly improves quality:

```typescript
class HybridRAGAdapter implements IRAGAdapter {
  constructor(
    private semantic: IRAGAdapter,  // vector similarity search
    private keyword: SearchEngine,  // BM25 keyword search
    private alpha: number = 0.7     // 70% semantic, 30% keyword
  ) {}

  async query(request: RAGQueryRequest): Promise<RAGQueryResponse> {
    // Run both searches in parallel
    const [semanticResults, keywordResults] = await Promise.all([
      this.semantic.query(request),
      this.keyword.search(request.query, request.topK ?? 5),
    ]);

    // Reciprocal Rank Fusion (RRF) scoring
    const scores = new Map<string, number>();

    semanticResults.results.forEach((result, rank) => {
      const rrf = this.alpha * (1 / (60 + rank + 1));
      scores.set(result.document.id, (scores.get(result.document.id) ?? 0) + rrf);
    });

    keywordResults.forEach((result: { id: string }, rank: number) => {
      const rrf = (1 - this.alpha) * (1 / (60 + rank + 1));
      scores.set(result.id, (scores.get(result.id) ?? 0) + rrf);
    });

    // Merge and sort by combined score
    const allResults = new Map<string, { document: RAGDocument; score: number }>();
    [...semanticResults.results, ...keywordResults].forEach((r: { document?: RAGDocument; id?: string; content?: string }) => {
      const doc = r.document ?? { id: r.id!, content: r.content ?? '' };
      const id = doc.id;
      allResults.set(id, { document: doc, score: scores.get(id) ?? 0 });
    });

    return {
      results: Array.from(allResults.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, request.topK ?? 5),
    };
  }

  async ingest(request: RAGIngestRequest): Promise<RAGIngestResponse> {
    return this.semantic.ingest(request);  // keyword index typically auto-builds from text
  }
}
```

---

## Debugging Query Quality

When results aren't good, diagnose with these techniques:

```typescript
// 1. Log scores of returned results
const results = await ragAdapter.query({ query, topK: 10, minScore: 0 });
console.table(results.results.map(r => ({
  id: r.document.id,
  score: r.score.toFixed(3),
  preview: r.document.content.slice(0, 100),
})));

// 2. Try multiple query phrasings and compare
const phrasings = [
  'refund policy',
  'how to get a refund',
  'money back guarantee terms',
  'return and refund rules',
];
for (const q of phrasings) {
  const results = await ragAdapter.query({ query: q, topK: 3 });
  console.log(`"${q}": top score = ${results.results[0]?.score.toFixed(3) ?? 'no results'}`);
}

// 3. Verify the document is actually in the index
const testIngest = await ragAdapter.ingest({ documents: [testDoc] });
const testQuery  = await ragAdapter.query({ query: testDoc.content.slice(0, 100) });
console.log('Self-retrieval score:', testQuery.results[0]?.score);
// Should be > 0.95 if the adapter is working correctly
```

---

## Tips & Tricks

> **Tip:** Query with the same terminology used in your documents. If your docs say "refund policy", query "refund policy" — not "how do I get my money back". The embedding model represents domain-specific terminology well when both sides use it consistently.

> **Tip:** Test your RAG pipeline with a handful of "gold standard" query→expected document pairs before going to production. This reveals scoring, chunking, and metadata issues before users encounter them.

> **Tip:** Rewrite queries before embedding them. For example, prepend the question type: "question: What is the refund policy?" → the embedding model may represent this differently and more accurately than the raw question. Some models are specifically fine-tuned to handle "question: ..." prefixes.
