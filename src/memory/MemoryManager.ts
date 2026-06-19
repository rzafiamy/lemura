import { randomUUID } from 'crypto';
import {
    IMemoryStore,
    IMemoryScorer,
    MemoryRecord,
    MemoryKind,
    MemoryScoreWeights,
    RankedMemory,
} from '../types/memory.js';
import { IProviderAdapter } from '../types/adapters.js';
import { Turn } from '../types/context.js';
import { ILogger } from '../types/logger.js';
import { LexicalScorer } from './scorers/LexicalScorer.js';

export interface MemoryManagerConfig {
    store: IMemoryStore;
    scorer?: IMemoryScorer;
    adapter?: IProviderAdapter;
    model?: string;
    logger?: ILogger;
    scope?: string;
    weights?: MemoryScoreWeights;
    recencyHalfLifeMs?: number;
    recallTopK?: number;
    minScore?: number;
    consolidateEvery?: number;
    /** Called for trace emission. */
    onTrace?: (name: string, metadata: Record<string, unknown>) => void;
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * Orchestrates long-term memory: autonomous write (reflection), explicit write,
 * ranked recall (composite score with decay), consolidation, and forgetting.
 *
 * Embedding-free by default — the relevance term is delegated to a pluggable
 * {@link IMemoryScorer}; everything else (recency, importance, frequency, storage)
 * is provider- and embedding-independent.
 *
 * @since 1.8.0
 */
export class MemoryManager {
    private store: IMemoryStore;
    private scorer: IMemoryScorer;
    private weights: Required<MemoryScoreWeights>;
    private halfLifeMs: number;
    private recallTopK: number;
    private minScore: number;
    private consolidateEvery: number;
    private writesSinceConsolidate = 0;

    constructor(private cfg: MemoryManagerConfig) {
        this.store = cfg.store;
        this.scorer = cfg.scorer ?? new LexicalScorer();
        this.weights = {
            relevance: cfg.weights?.relevance ?? 1.0,
            recency: cfg.weights?.recency ?? 0.5,
            importance: cfg.weights?.importance ?? 0.3,
            frequency: cfg.weights?.frequency ?? 0.1,
        };
        this.halfLifeMs = cfg.recencyHalfLifeMs ?? 7 * DAY;
        this.recallTopK = cfg.recallTopK ?? 8;
        this.minScore = cfg.minScore ?? 0.15;
        this.consolidateEvery = cfg.consolidateEvery ?? 0;
    }

    private trace(name: string, metadata: Record<string, unknown>): void {
        this.cfg.onTrace?.(name, metadata);
    }

    // ── Write ───────────────────────────────────────────────────────────────

    /**
     * Persist a memory. De-duplicates against existing records: if an existing
     * record is near-identical (relevance > 0.9) it is reinforced (importance bumped,
     * lastAccessedAt refreshed) instead of inserting a duplicate.
     */
    async remember(input: {
        content: string;
        kind?: MemoryKind;
        importance?: number;
        tags?: string[];
        entities?: string[];
        source?: MemoryRecord['source'];
    }): Promise<MemoryRecord> {
        const content = input.content.trim();
        const candidates = await this.store.list({
            ...(this.cfg.scope !== undefined ? { scope: this.cfg.scope } : {}),
        });

        // De-dup: reinforce a near-identical existing memory rather than insert.
        for (const c of candidates) {
            const rel = await this.scorer.relevance(content, c, candidates);
            if (rel > 0.9 && c.content.trim().toLowerCase() === content.toLowerCase()) {
                c.accessCount += 1;
                c.lastAccessedAt = Date.now();
                c.importance = Math.min(10, Math.max(c.importance, input.importance ?? c.importance));
                await this.store.put(c);
                this.trace('memory_write', { id: c.id, reinforced: true, kind: c.kind });
                return c;
            }
        }

        const now = Date.now();
        let record: MemoryRecord = {
            id: randomUUID(),
            content,
            kind: input.kind ?? 'fact',
            importance: clamp(input.importance ?? 5, 1, 10),
            createdAt: now,
            lastAccessedAt: now,
            accessCount: 0,
            ...(input.tags ? { tags: input.tags } : {}),
            ...(input.entities ? { entities: input.entities } : {}),
            ...(input.source ? { source: input.source } : {}),
            ...(this.cfg.scope !== undefined ? { scope: this.cfg.scope } : {}),
        };

        if (this.scorer.prepare) record = await this.scorer.prepare(record);
        await this.store.put(record);
        this.trace('memory_write', {
            id: record.id,
            kind: record.kind,
            importance: record.importance,
            source: record.source,
        });

        this.writesSinceConsolidate++;
        if (this.consolidateEvery > 0 && this.writesSinceConsolidate >= this.consolidateEvery) {
            this.writesSinceConsolidate = 0;
            await this.consolidate();
        }
        return record;
    }

    // ── Recall ──────────────────────────────────────────────────────────────

    /**
     * Rank stored memories against a query using the composite score
     * `wR*relevance + wT*recency + wI*importance + wF*frequency`. Returns the top
     * records above `minScore`. Recalled records are reinforced (lastAccessedAt /
     * accessCount bumped) so frequently-useful memories stay salient.
     */
    async recall(query: string, topK?: number): Promise<RankedMemory[]> {
        if (!query.trim()) return [];
        const candidates = await this.store.list({
            ...(this.cfg.scope !== undefined ? { scope: this.cfg.scope } : {}),
        });
        if (candidates.length === 0) return [];

        const now = Date.now();
        const ranked: RankedMemory[] = [];
        for (const record of candidates) {
            const relevance = clamp01(await this.scorer.relevance(query, record, candidates));
            const recency = Math.exp(-(now - record.lastAccessedAt) / this.halfLifeMs);
            const importance = record.importance / 10;
            const frequency = 1 - 1 / (1 + record.accessCount);
            const score =
                this.weights.relevance * relevance +
                this.weights.recency * recency +
                this.weights.importance * importance +
                this.weights.frequency * frequency;
            ranked.push({ record, score, terms: { relevance, recency, importance, frequency } });
        }

        ranked.sort((a, b) => b.score - a.score);
        const limit = topK ?? this.recallTopK;
        const top = ranked.filter(r => r.score >= this.minScore).slice(0, limit);

        // Reinforce recalled records.
        for (const r of top) {
            r.record.lastAccessedAt = now;
            r.record.accessCount += 1;
            await this.store.put(r.record);
        }

        this.trace('memory_recall', {
            query: query.slice(0, 80),
            candidates: candidates.length,
            returned: top.length,
        });
        return top;
    }

    // ── Reflection (autonomous write) ─────────────────────────────────────────

    /**
     * Extract durable facts/preferences from recent turns and persist them, each
     * rated for importance. One temperature-0 LLM call. Requires an adapter; no-op
     * if none was supplied. This is the generative-agents "reflection" step.
     */
    async reflect(turns: Turn[]): Promise<MemoryRecord[]> {
        if (!this.cfg.adapter || !this.cfg.model) return [];
        const transcript = turns
            .filter(t => t.role === 'user' || t.role === 'assistant')
            .map(t => `${t.role}: ${typeof t.content === 'string' ? t.content : JSON.stringify(t.content)}`)
            .join('\n')
            .slice(-6000);
        if (!transcript.trim()) return [];

        const prompt =
            `Extract durable facts, preferences, and notable episodes worth remembering ` +
            `long-term from this conversation. Ignore ephemeral/task-specific chatter. ` +
            `Return ONLY a JSON array of objects ` +
            `{ "content": string, "kind": "fact"|"preference"|"episode"|"entity", "importance": 1-10 }. ` +
            `Empty array if nothing is worth keeping.\n\nConversation:\n${transcript}\n\nJSON:`;

        let extracted: Array<{ content: string; kind?: MemoryKind; importance?: number }> = [];
        try {
            const res = await this.cfg.adapter.complete({
                model: this.cfg.model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0,
                maxTokens: 512,
            });
            const match = res.content.match(/\[[\s\S]*\]/);
            if (match) {
                const parsed = JSON.parse(match[0]) as unknown;
                if (Array.isArray(parsed)) extracted = parsed as typeof extracted;
            }
        } catch (err: unknown) {
            this.cfg.logger?.warn?.('Memory reflection failed', { error: (err as Error)?.message });
            return [];
        }

        const written: MemoryRecord[] = [];
        for (const item of extracted) {
            if (!item?.content || typeof item.content !== 'string') continue;
            written.push(
                await this.remember({
                    content: item.content,
                    kind: item.kind ?? 'fact',
                    importance: item.importance ?? 5,
                    source: 'auto',
                })
            );
        }
        this.trace('memory_reflect', { extracted: extracted.length, written: written.length });
        return written;
    }

    // ── Consolidation ─────────────────────────────────────────────────────────

    /**
     * Merge near-duplicate records into one, keeping the store bounded. Conservative:
     * only collapses records whose mutual relevance exceeds 0.9 and that share a kind.
     * The survivor inherits the max importance and summed access count.
     */
    async consolidate(): Promise<{ merged: number }> {
        const records = await this.store.list({
            ...(this.cfg.scope !== undefined ? { scope: this.cfg.scope } : {}),
        });
        let merged = 0;
        const removed = new Set<string>();

        for (let i = 0; i < records.length; i++) {
            const a = records[i]!;
            if (removed.has(a.id)) continue;
            for (let j = i + 1; j < records.length; j++) {
                const b = records[j]!;
                if (removed.has(b.id) || a.kind !== b.kind) continue;
                const rel = await this.scorer.relevance(a.content, b, records);
                if (rel > 0.9) {
                    a.importance = Math.max(a.importance, b.importance);
                    a.accessCount += b.accessCount;
                    a.lastAccessedAt = Math.max(a.lastAccessedAt, b.lastAccessedAt);
                    await this.store.put(a);
                    await this.store.delete(b.id);
                    removed.add(b.id);
                    merged++;
                }
            }
        }
        if (merged > 0) this.trace('memory_consolidate', { merged });
        return { merged };
    }

    // ── Forget ────────────────────────────────────────────────────────────────

    /** Delete a memory by id, or the single best match for a query. */
    async forget(input: { id?: string; query?: string }): Promise<boolean> {
        if (input.id) {
            await this.store.delete(input.id);
            this.trace('memory_forget', { id: input.id });
            return true;
        }
        if (input.query) {
            const [top] = await this.recall(input.query, 1);
            if (top) {
                await this.store.delete(top.record.id);
                this.trace('memory_forget', { id: top.record.id, viaQuery: true });
                return true;
            }
        }
        return false;
    }
}

function clamp(n: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, n));
}
function clamp01(n: number): number {
    return Math.min(1, Math.max(0, n));
}
