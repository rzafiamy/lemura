# Long-Term Memory Subsystem — lemura v1.8.0 Spec

> Status: **proposed** · Target: `1.8.0` (additive minor, semver-safe) · Embedding-free by default

A persistent, cross-session, ranked, decaying, **token-budget-aware** memory that the agent
writes to autonomously and recalls selectively into context. This is the "memoria /
generative-agents" capability — distinct from STM (blobs), Scratchpad (session notes), and RAG
(passive document store).

The design reuses lemura's existing seams (`IStorageAdapter`, `IContextStrategy`, builtin-tool
auto-registration, trace events) rather than inventing parallel machinery. It is **opt-in**:
when `SessionConfig.memory` is absent, behavior is identical to 1.7.0.

---

## 1. Where it sits among the existing memory layers

| Layer | Sent to model | Scope | Ranked | Decays | Autonomous write |
|---|---|---|---|---|---|
| Turn history | yes | session | — | — | — |
| Scratchpad | no | session | — | — | — |
| STM | via `[STM:uuid]` | session | — | — | — |
| RAG | tool-only | corpus | by query | — | no |
| **Long-Term Memory (new)** | **budget-aware inject** | **cross-session** | **yes** | **yes** | **yes** |

---

## 2. New module layout (mirrors `src/rag`, `src/context`)

```
src/memory/
  MemoryManager.ts            // orchestrator: write/recall/reflect/consolidate/forget
  MemoryInjectionStrategy.ts  // IContextStrategy — budget-aware recall into context
  scorers/
    LexicalScorer.ts          // default, embedding-free (BM25-ish)
    EmbeddingScorer.ts        // opt-in (uses adapter.embed?())
    LLMReRankScorer.ts        // opt-in (uses existing complete())
  stores/
    StorageMemoryStore.ts     // IMemoryStore over any IStorageAdapter
  index.ts
src/tools/builtin/memory.ts   // remember / recall / forget tools (auto-registered)
src/types/memory.ts           // interfaces + records + config
```

New `package.json` export: `"./memory"` → `./dist/memory/index.{mjs,js,d.ts}`, plus
`export * from './memory/index.js'` in `src/index.ts`.

---

## 3. Core types (`src/types/memory.ts`)

```ts
export type MemoryKind = 'fact' | 'preference' | 'episode' | 'entity' | 'summary';

export interface MemoryRecord {
  id: string;
  content: string;
  kind: MemoryKind;
  importance: number;          // 1–10, rated by LLM at write time (default 5)
  createdAt: number;           // epoch ms
  lastAccessedAt: number;
  accessCount: number;
  tags?: string[];
  entities?: string[];         // people/places/things — graph recall keys
  links?: string[];            // ids of related memories (graph edges)
  embedding?: number[];        // OPTIONAL — present only with an embedding scorer
  source?: 'auto' | 'user' | 'tool';
  scope?: string;              // partition key (e.g. userId) for multi-tenant stores
  metadata?: Record<string, unknown>;
}

/** Pluggable relevance term. The ONLY place embeddings could enter. */
export interface IMemoryScorer {
  readonly name: string;
  /** 0..1 relevance of a record to the query. Embedding-free implementations ignore embeddings. */
  relevance(query: string, record: MemoryRecord): number | Promise<number>;
  /** Optional: compute & attach an embedding at write time (no-op for lexical). */
  prepare?(record: MemoryRecord): Promise<MemoryRecord>;
}

/** Persistence contract — rides on any IStorageAdapter; "Any storage". */
export interface IMemoryStore {
  put(record: MemoryRecord): Promise<void>;
  get(id: string): Promise<MemoryRecord | undefined>;
  /** Return candidate set to score. May pre-filter by scope/tags/entities for large stores. */
  list(filter?: MemoryFilter): Promise<MemoryRecord[]>;
  delete(id: string): Promise<void>;
  healthCheck?(): Promise<boolean>;
}

export interface MemoryFilter {
  scope?: string;
  kinds?: MemoryKind[];
  tags?: string[];
  entities?: string[];
  /** Hard cap on candidates returned to the scorer (default 500). */
  limit?: number;
}

export interface MemoryScoreWeights {
  relevance?: number;   // wR, default 1.0
  recency?: number;     // wT, default 0.5
  importance?: number;  // wI, default 0.3
  frequency?: number;   // wF, default 0.1
}

export interface MemoryConfig {
  store: IMemoryStore;
  scorer?: IMemoryScorer;            // default: LexicalScorer (embedding-free)
  scope?: string;                    // partition key for this session
  weights?: MemoryScoreWeights;
  recencyHalfLifeMs?: number;        // default 7 days
  /** Token budget for the recalled-memory block injected each turn. Default 800. */
  recallTokenBudget?: number;
  /** Max records considered for injection regardless of budget. Default 8. */
  recallTopK?: number;
  /** Minimum composite score to be eligible for injection. Default 0.15. */
  minScore?: number;
  /** Run reflection (autonomous write) automatically at session end. Default false. */
  autoReflect?: boolean;
  /** Run consolidation every N writes (0 = never). Default 0. */
  consolidateEvery?: number;
  /** Strategy priority for MemoryInjectionStrategy. Default 2 (after summary injection). */
  injectionPriority?: number;
  /** Header label for the injected block. */
  injectionLabel?: string;
}
```

`SessionConfig` gains one optional field: `memory?: MemoryConfig;`. Absent ⇒ no memory wiring.

---

## 4. The scoring model (generative-agents formula, embedding-free default)

For each candidate record, given the current `query` (latest user message):

```
recency    = exp(-(now - lastAccessedAt) / recencyHalfLifeMs)      // 0..1
frequency  = 1 - 1/(1 + accessCount)                                // 0..1, diminishing
importance = record.importance / 10                                 // 0..1
relevance  = await scorer.relevance(query, record)                  // 0..1  ← pluggable

score = wR*relevance + wT*recency + wI*importance + wF*frequency
```

- **`LexicalScorer`** (default): tokenize query + content, score by overlap weighted by inverse
  document frequency across the candidate set (BM25-ish). Zero API calls, fully offline. This is
  what makes the subsystem usable on Android with no embeddings.
- **`EmbeddingScorer`** (opt-in): cosine of `record.embedding` vs. a query embedding from
  `adapter.embed?()`. `prepare()` attaches the embedding at write time. Falls back to lexical if
  `adapter.embed` is absent.
- **`LLMReRankScorer`** (opt-in): cheap `complete()` call asking the model to pick relevant ids
  from a compact candidate index. Paraphrase-robust without a vector store.

Only `relevance` ever touches embeddings; decay, importance, and frequency are pure arithmetic.

---

## 5. Budget-aware recall — the key integration point

`MemoryInjectionStrategy implements IContextStrategy`, registered exactly like
`SummaryInjectionStrategy` (priority-ordered, runs inside `ContextManager.prepare()`):

```ts
class MemoryInjectionStrategy implements IContextStrategy {
  name = 'memory_injection';
  priority: number;                  // default 2
  shouldApply(ctx): boolean          // true when a query exists & store non-empty
  async apply(ctx): Promise<ContextWindow> {
    const ranked = await manager.recall(queryFromLatestUserTurn(ctx));
    // Greedily fill recallTokenBudget with top records, newest-relevant first.
    // Inject as a single synthetic system turn (turnIndex = -2, compressed-marked)
    // so it is idempotently updated in place across iterations (same pattern as
    // SummaryInjectionStrategy's turnIndex = -1).
    // Bump lastAccessedAt/accessCount on injected records (reinforcement).
  }
}
```

Because it runs *inside* `ContextManager.prepare()`, the recalled block is counted against
`maxTokens`; memory can never overflow the window. `recallTokenBudget` caps the block; the
overall budget caps everything. This is the "token-window-aware" guarantee.

Injected block shape (namespaced like other lemura blocks):

```
<lemura:memory>
- [preference] User prefers metric units. (importance 7)
- [fact] User's dog is named Rex. (importance 6)
</lemura:memory>
```

---

## 6. Autonomous write (reflection) + tools

`MemoryManager.reflect(turns)`: one temperature-0 `complete()` call that extracts durable
facts/preferences/episodes from recent turns and rates each `importance` 1–10. De-duplicates
against existing records (scorer relevance > 0.9 ⇒ reinforce instead of insert). This is the
generative-agents *reflection* step.

- **Automatic**: when `memory.autoReflect === true`, `SessionManager` calls `reflect()` once at
  session end (the only added LLM call; off by default).
- **Explicit / tool-driven** (always available, no extra calls): three builtin tools, auto-registered
  when `config.memory` is present and auto-trusted by the firewall (they only mutate the memory
  store, no external side effects — same treatment as `load_skill`):

| Tool | Purpose |
|---|---|
| `remember` | `{ content, kind?, importance?, tags?, entities? }` → insert a memory |
| `recall` | `{ query, topK? }` → ranked memories (lets the model query on demand) |
| `forget` | `{ id }` or `{ query }` → delete a memory (firewall may downgrade to `ask`) |

`ToolContext` gains `memory?: MemoryManager` (additive, alongside `ragAdapter`/`stmRegistry`).

---

## 7. Decay & consolidation (bounded growth)

- **Decay** is implicit via the recency term — old, unreinforced memories sink below `minScore`
  and stop being recalled without ever being deleted.
- **Consolidation** (`consolidateEvery > 0`): every N writes, cluster near-duplicate records (by
  scorer relevance), summarize each cluster into one `kind:'summary'` record, and delete the
  members. Keeps the store small and recall fast — the alternative to an ever-growing vector index.

---

## 8. Storage: "Any storage" via `IStorageAdapter`

`StorageMemoryStore` is the default `IMemoryStore`, implemented over any existing
`IStorageAdapter` (`get`/`set`/`delete`). It keeps a lightweight index record (list of ids +
their tags/entities/scope) under a fixed key so `list(filter)` is O(index) not O(scan). Works
unchanged against:

- `InMemoryStorageAdapter` (already in `src/context`)
- IndexedDB / localStorage (browser, Cordova)
- SQLite / Redis / file store (Node, your Cordova file-system module)

No new storage dependency is introduced.

---

## 9. Adapter contract change (additive, optional)

`IProviderAdapter` gains **one optional** method — backward-compatible, existing adapters
unaffected:

```ts
/** Optional. Returns an embedding vector for text. Enables EmbeddingScorer. */
embed?(text: string, model?: string): Promise<number[]>;
```

`EmbeddingScorer` requires it; if absent it is unavailable and `LexicalScorer` is used. The
subsystem is **fully functional with zero embeddings** — `embed()` is a drop-in upgrade, not a
prerequisite.

---

## 10. Public API — consumer's view

```ts
import { createOpenAICompatibleAdapter } from 'lemura/adapters';
import { InMemoryStorageAdapter } from 'lemura/context';
import { MemoryManager, StorageMemoryStore, LexicalScorer } from 'lemura/memory';
import { SessionManager } from 'lemura';

const store = new StorageMemoryStore(new InMemoryStorageAdapter());

const session = new SessionManager({
  adapter, model, maxTokens: 8000,
  memory: {
    store,
    // scorer omitted ⇒ LexicalScorer (no embeddings, offline)
    recallTokenBudget: 800,
    autoReflect: true,            // extract durable facts at session end
    consolidateEvery: 50,
  },
});

await session.run('Remember I prefer dark mode and metric units.');
// → `remember` tool (or reflection) persists two preferences.

// Next session, fresh SessionManager, same store:
await session2.run('What units should you use?');
// → MemoryInjectionStrategy recalls "prefers metric units" into context. No embeddings used.
```

Upgrade to semantic recall later — change one line, nothing else:

```ts
import { EmbeddingScorer } from 'lemura/memory';
memory: { store, scorer: new EmbeddingScorer(adapter) }   // needs adapter.embed?()
```

---

## 11. Tracing & observability

New `TraceEvent.type: 'memory'` with names: `memory_recall` (`{ injected, candidates, budgetUsed }`),
`memory_write` (`{ id, kind, importance, source }`), `memory_reflect` (`{ extracted, reinforced }`),
`memory_consolidate` (`{ merged, into }`), `memory_forget` (`{ id }`). Consistent with how routing,
skills, and goals already trace.

---

## 12. Backward-compatibility & semver

- New optional `SessionConfig.memory` — absent ⇒ identical to 1.7.0.
- New optional `IProviderAdapter.embed?()` — existing adapters compile and run unchanged.
- New `lemura/memory` export — additive.
- New optional `ToolContext.memory` — additive.
- Builtin memory tools registered **only** when `config.memory` is present.

⇒ Clean `1.8.0` minor. No breaking changes.

---

## 13. Test plan (per repo's 3-layer convention)

- **Unit**: `LexicalScorer` ranking; recency/importance/frequency math; `StorageMemoryStore`
  put/get/list/delete + index integrity; `MemoryInjectionStrategy` budget-fill & idempotent
  in-place update; reflection de-duplication; consolidation clustering.
- **Integration**: full `run()` with a mock adapter — `remember` persists, second session recalls
  into context, `autoReflect` fires once at session end, memory block counted against `maxTokens`.
- **Contract**: `IMemoryStore` contract suite (so community stores — Redis, SQLite — pass the same
  tests, mirroring the existing adapter/RAG contract suites).

---

## 14. Open decisions (resolved defaults)

| Decision | Chosen default | Rationale |
|---|---|---|
| Embedding contract | (A) optional `embed?()` on adapter | Most idiomatic; keeps embeddings out of core unless opted in |
| Reflection | Automatic (`autoReflect` flag, default **off**) **and** tool-driven | Powerful when on; zero cost when off; explicit path always free |
| Default scorer | `LexicalScorer` (embedding-free) | Offline/Android-friendly; no API dependency |
| Injection priority | 2 (after `SummaryInjectionStrategy` at 1) | Summary first, then memory, then compression |
```
