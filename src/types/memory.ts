/**
 * Long-Term Memory types — persistent, cross-session, ranked, decaying memory.
 *
 * Distinct from STM (large blobs), Scratchpad (per-session notes), and RAG (passive
 * document store): long-term memory is written autonomously, ranked by a composite
 * score (relevance + recency + importance + frequency), decays over time, and is
 * recalled into the context window under a token budget.
 *
 * Embedding-free by default: the only place embeddings can enter is the pluggable
 * {@link IMemoryScorer}. The default `LexicalScorer` needs no embeddings.
 *
 * @since 1.8.0
 */

export type MemoryKind = 'fact' | 'preference' | 'episode' | 'entity' | 'summary';

/** A single durable memory record. */
export interface MemoryRecord {
    /** Stable unique id. */
    id: string;
    /** The fact / observation text. */
    content: string;
    /** Category of memory. */
    kind: MemoryKind;
    /** Salience 1–10, rated by the LLM at write time (default 5). Higher = recalled more readily. */
    importance: number;
    /** Epoch ms of creation. */
    createdAt: number;
    /** Epoch ms of last recall — drives the recency decay term. */
    lastAccessedAt: number;
    /** Number of times this record has been recalled — drives the frequency term. */
    accessCount: number;
    /** Free-form tags for filtering. */
    tags?: string[];
    /** People/places/things mentioned — keys for graph recall and pre-filtering. */
    entities?: string[];
    /** Ids of related memories (graph edges). */
    links?: string[];
    /** Optional embedding vector — present only when an embedding scorer is used. */
    embedding?: number[];
    /** Provenance of the write. */
    source?: 'auto' | 'user' | 'tool';
    /** Partition key (e.g. userId) for multi-tenant stores. */
    scope?: string;
    /** Arbitrary extra metadata. */
    metadata?: Record<string, unknown>;
}

/**
 * Pluggable relevance term. The ONLY place embeddings could enter the subsystem.
 * Embedding-free implementations (the default) ignore `record.embedding`.
 */
export interface IMemoryScorer {
    readonly name: string;
    /**
     * Relevance of a record to the query, normalized 0..1.
     *
     * @param query - The current user message (or an explicit recall query).
     * @param record - The candidate memory record.
     * @param corpus - All candidate records, supplied so lexical scorers can compute
     *   inverse-document-frequency weighting. May be ignored.
     */
    relevance(query: string, record: MemoryRecord, corpus?: MemoryRecord[]): number | Promise<number>;
    /**
     * Optional hook to enrich a record at write time (e.g. attach an embedding).
     * No-op for lexical scorers. Returns the (possibly mutated) record.
     */
    prepare?(record: MemoryRecord): Promise<MemoryRecord>;
}

/** Filter passed to {@link IMemoryStore.list} to narrow the candidate set. */
export interface MemoryFilter {
    scope?: string;
    kinds?: MemoryKind[];
    tags?: string[];
    entities?: string[];
    /** Hard cap on candidates returned to the scorer. Default 500. */
    limit?: number;
}

/**
 * Persistence contract for memory records. The default implementation
 * ({@link StorageMemoryStore}) rides on any {@link IStorageAdapter}, so the same
 * memory works against in-memory, IndexedDB, SQLite, Redis, or a file store.
 */
export interface IMemoryStore {
    put(record: MemoryRecord): Promise<void>;
    get(id: string): Promise<MemoryRecord | undefined>;
    /** Returns candidate records to score. May pre-filter by scope/tags/entities. */
    list(filter?: MemoryFilter): Promise<MemoryRecord[]>;
    delete(id: string): Promise<void>;
    healthCheck?(): Promise<boolean>;
}

/** Relative weights for the composite retrieval score. */
export interface MemoryScoreWeights {
    /** Weight of the (pluggable) relevance term. Default 1.0. */
    relevance?: number;
    /** Weight of the recency decay term. Default 0.5. */
    recency?: number;
    /** Weight of the importance term. Default 0.3. */
    importance?: number;
    /** Weight of the access-frequency term. Default 0.1. */
    frequency?: number;
}

/** A scored memory record returned by recall. */
export interface RankedMemory {
    record: MemoryRecord;
    score: number;
    /** Per-term breakdown, for tracing/debugging. */
    terms: { relevance: number; recency: number; importance: number; frequency: number };
}

/**
 * Configuration for the long-term memory subsystem. Attach to
 * `SessionConfig.memory`. Absent ⇒ no memory wiring (identical to 1.7.0).
 */
export interface MemoryConfig {
    /** Persistence backend. Required. */
    store: IMemoryStore;
    /** Relevance scorer. Default: `LexicalScorer` (embedding-free). */
    scorer?: IMemoryScorer;
    /** Partition key applied to all writes/reads for this session. */
    scope?: string;
    /** Composite-score weights. */
    weights?: MemoryScoreWeights;
    /** Recency half-life in ms. Default 7 days. */
    recencyHalfLifeMs?: number;
    /** Token budget for the recalled-memory block injected each turn. Default 800. */
    recallTokenBudget?: number;
    /** Max records considered for injection regardless of budget. Default 8. */
    recallTopK?: number;
    /** Minimum composite score to be eligible for injection/recall. Default 0.15. */
    minScore?: number;
    /** Run reflection (autonomous write) automatically at session end. Default false. */
    autoReflect?: boolean;
    /** Run consolidation every N writes (0 = never). Default 0. */
    consolidateEvery?: number;
    /** Priority of the MemoryInjectionStrategy. Default 2 (after summary injection at 1). */
    injectionPriority?: number;
    /** Header label for the injected block. Default 'Relevant memories'. */
    injectionLabel?: string;
}
