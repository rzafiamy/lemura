import { IMemoryScorer, MemoryRecord } from '../../types/memory.js';

/**
 * Embedding-free relevance scorer. Ranks a record by query/content term overlap,
 * weighting each shared term by its rarity across the candidate corpus (a BM25-ish
 * idf weighting). Needs no API calls and works fully offline — the default scorer.
 *
 * It is paraphrase-blind (it will not match "car" to "vehicle"); upgrade to
 * `EmbeddingScorer` or `LLMReRankScorer` for semantic recall.
 *
 * @since 1.8.0
 */
export class LexicalScorer implements IMemoryScorer {
    readonly name = 'lexical';

    private tokenize(text: string): string[] {
        return text
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')
            .split(/\s+/)
            .filter(t => t.length > 1);
    }

    relevance(query: string, record: MemoryRecord, corpus?: MemoryRecord[]): number {
        const qTerms = new Set(this.tokenize(query));
        if (qTerms.size === 0) return 0;

        const recordText = `${record.content} ${(record.tags ?? []).join(' ')} ${(record.entities ?? []).join(' ')}`;
        const docTerms = this.tokenize(recordText);
        if (docTerms.length === 0) return 0;

        const docTermSet = new Set(docTerms);

        // Document frequency of each query term across the candidate corpus, computed
        // once (rarer term = more signal). Tokenize each doc to a Set a single time.
        const docs = corpus ?? [record];
        const N = docs.length;
        const df = new Map<string, number>();
        for (const d of docs) {
            const dt = new Set(
                this.tokenize(`${d.content} ${(d.tags ?? []).join(' ')} ${(d.entities ?? []).join(' ')}`)
            );
            for (const term of qTerms) {
                if (dt.has(term)) df.set(term, (df.get(term) ?? 0) + 1);
            }
        }
        // Smoothed idf, always positive.
        const idf = (term: string): number => Math.log(1 + N / (1 + (df.get(term) ?? 0)));

        let matched = 0;
        let totalWeight = 0;
        for (const term of qTerms) {
            const w = idf(term);
            totalWeight += w;
            if (docTermSet.has(term)) matched += w;
        }
        if (totalWeight === 0) return 0;
        return Math.min(1, matched / totalWeight);
    }
}
