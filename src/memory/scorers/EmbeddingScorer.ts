import { IMemoryScorer, MemoryRecord } from '../../types/memory.js';
import { IProviderAdapter } from '../../types/adapters.js';

/**
 * Semantic relevance scorer backed by vector embeddings. Opt-in — requires an
 * adapter that implements the optional `embed?()` method. Attaches an embedding to
 * each record at write time via {@link prepare} and scores by cosine similarity.
 *
 * If the adapter has no `embed`, construction throws; callers should fall back to
 * `LexicalScorer`. The rest of the subsystem (decay, importance, frequency, storage,
 * budget-aware injection) is identical regardless of which scorer is used.
 *
 * @since 1.8.0
 */
export class EmbeddingScorer implements IMemoryScorer {
    readonly name = 'embedding';
    private cache = new Map<string, number[]>();

    constructor(
        private adapter: IProviderAdapter,
        private model?: string
    ) {
        if (typeof adapter.embed !== 'function') {
            throw new Error(
                'EmbeddingScorer requires an adapter with embed(); use LexicalScorer for embedding-free recall.'
            );
        }
    }

    private async embed(text: string): Promise<number[]> {
        const cached = this.cache.get(text);
        if (cached) return cached;
        const vec = await this.adapter.embed!(text, this.model);
        this.cache.set(text, vec);
        return vec;
    }

    async prepare(record: MemoryRecord): Promise<MemoryRecord> {
        if (record.embedding && record.embedding.length > 0) return record;
        record.embedding = await this.embed(record.content);
        return record;
    }

    async relevance(query: string, record: MemoryRecord): Promise<number> {
        const target = record.embedding ?? (await this.embed(record.content));
        const q = await this.embed(query);
        return cosineSimilarity(q, target);
    }
}

/** Cosine similarity, clamped to 0..1 (negatives floored to 0). */
function cosineSimilarity(a: number[], b: number[]): number {
    const len = Math.min(a.length, b.length);
    if (len === 0) return 0;
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < len; i++) {
        dot += a[i]! * b[i]!;
        na += a[i]! * a[i]!;
        nb += b[i]! * b[i]!;
    }
    if (na === 0 || nb === 0) return 0;
    return Math.max(0, dot / (Math.sqrt(na) * Math.sqrt(nb)));
}
