import { IMemoryScorer, MemoryRecord } from '../../types/memory.js';
import { IProviderAdapter } from '../../types/adapters.js';
import { ILogger } from '../../types/logger.js';

/**
 * Paraphrase-robust relevance without a vector store. On the first `relevance()`
 * call for a given query, it asks the model (one cheap temperature-0 completion) to
 * pick the relevant record ids from a compact candidate index, then caches a 0/1
 * relevance per id for that query. Subsequent calls within the same recall reuse
 * the cache, so the whole corpus costs a single LLM round-trip.
 *
 * Opt-in — uses the existing `complete()` surface (no embeddings, no `embed?()`).
 *
 * @since 1.8.0
 */
export class LLMReRankScorer implements IMemoryScorer {
    readonly name = 'llm_rerank';
    private cache = new Map<string, Set<string>>();

    constructor(
        private adapter: IProviderAdapter,
        private model: string,
        private logger?: ILogger,
        /** How many of the top lexical/recent candidates to send to the model. Default 30. */
        private maxCandidates = 30
    ) {}

    async relevance(query: string, record: MemoryRecord, corpus?: MemoryRecord[]): Promise<number> {
        const selected = await this.selectForQuery(query, corpus ?? [record]);
        return selected.has(record.id) ? 1 : 0;
    }

    private async selectForQuery(query: string, corpus: MemoryRecord[]): Promise<Set<string>> {
        const cached = this.cache.get(query);
        if (cached) return cached;

        const candidates = corpus.slice(0, this.maxCandidates);
        const index = candidates.map(r => `${r.id}: ${r.content}`).join('\n');
        const prompt =
            `Given the user query and a list of memory records, return ONLY the ids of records ` +
            `relevant to the query, as a JSON array of strings. No prose.\n\n` +
            `Query: ${query}\n\nRecords:\n${index}\n\nRelevant ids (JSON array):`;

        const selected = new Set<string>();
        try {
            const res = await this.adapter.complete({
                model: this.model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0,
                maxTokens: 256,
            });
            const match = res.content.match(/\[[\s\S]*\]/);
            if (match) {
                const ids = JSON.parse(match[0]) as unknown;
                if (Array.isArray(ids)) {
                    for (const id of ids) if (typeof id === 'string') selected.add(id);
                }
            }
        } catch (err: unknown) {
            // Fail open: an empty set just means this scorer contributes nothing,
            // so recency/importance still rank memories. Never breaks recall.
            this.logger?.warn?.('LLMReRankScorer failed; relevance term contributes 0', {
                error: (err as Error)?.message,
            });
        }

        this.cache.set(query, selected);
        return selected;
    }
}
