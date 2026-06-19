import { describe, it, expect, vi } from 'vitest';
import { InMemoryStorageAdapter } from '../../../src/context/InMemoryStorageAdapter.js';
import { StorageMemoryStore } from '../../../src/memory/stores/StorageMemoryStore.js';
import { LexicalScorer } from '../../../src/memory/scorers/LexicalScorer.js';
import { MemoryManager } from '../../../src/memory/MemoryManager.js';
import { MemoryInjectionStrategy } from '../../../src/memory/MemoryInjectionStrategy.js';
import { ContextWindow, MemoryRecord } from '../../../src/types/index.js';

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function makeStore() {
    return new StorageMemoryStore(new InMemoryStorageAdapter());
}

describe('StorageMemoryStore', () => {
    it('puts, gets, lists and deletes records', async () => {
        const store = makeStore();
        const rec: MemoryRecord = {
            id: 'a', content: 'user likes coffee', kind: 'preference',
            importance: 6, createdAt: 1, lastAccessedAt: 1, accessCount: 0,
            tags: ['drink'], entities: ['coffee'],
        };
        await store.put(rec);

        expect((await store.get('a'))?.content).toBe('user likes coffee');
        expect((await store.list()).length).toBe(1);
        expect((await store.list({ tags: ['drink'] })).length).toBe(1);
        expect((await store.list({ tags: ['nope'] })).length).toBe(0);
        expect((await store.list({ kinds: ['fact'] })).length).toBe(0);

        await store.delete('a');
        expect(await store.get('a')).toBeUndefined();
        expect((await store.list()).length).toBe(0);
    });

    it('isolates records by scope', async () => {
        const store = makeStore();
        await store.put({ id: 'u1', content: 'x', kind: 'fact', importance: 5, createdAt: 1, lastAccessedAt: 1, accessCount: 0, scope: 'user1' });
        await store.put({ id: 'u2', content: 'y', kind: 'fact', importance: 5, createdAt: 1, lastAccessedAt: 1, accessCount: 0, scope: 'user2' });
        expect((await store.list({ scope: 'user1' })).length).toBe(1);
        expect((await store.list({ scope: 'user1' }))[0]!.id).toBe('u1');
    });
});

describe('LexicalScorer', () => {
    it('scores term overlap higher than no overlap', async () => {
        const scorer = new LexicalScorer();
        const corpus: MemoryRecord[] = [
            { id: '1', content: 'the user owns a golden retriever named Rex', kind: 'fact', importance: 5, createdAt: 1, lastAccessedAt: 1, accessCount: 0 },
            { id: '2', content: 'the capital of France is Paris', kind: 'fact', importance: 5, createdAt: 1, lastAccessedAt: 1, accessCount: 0 },
        ];
        const dog = await scorer.relevance('tell me about Rex the retriever', corpus[0]!, corpus);
        const france = await scorer.relevance('tell me about Rex the retriever', corpus[1]!, corpus);
        expect(dog).toBeGreaterThan(france);
    });

    it('returns 0 for empty query', async () => {
        const scorer = new LexicalScorer();
        const r = await scorer.relevance('', { id: '1', content: 'anything', kind: 'fact', importance: 5, createdAt: 1, lastAccessedAt: 1, accessCount: 0 });
        expect(r).toBe(0);
    });
});

describe('MemoryManager', () => {
    it('remembers and recalls the most relevant memory first', async () => {
        const mgr = new MemoryManager({ store: makeStore(), logger });
        await mgr.remember({ content: 'user prefers metric units', kind: 'preference', importance: 8 });
        await mgr.remember({ content: 'user lives in Berlin', kind: 'fact', importance: 5 });

        const ranked = await mgr.recall('which units do you use');
        expect(ranked.length).toBeGreaterThan(0);
        expect(ranked[0]!.record.content).toContain('metric');
    });

    it('reinforces a recalled memory (accessCount increments)', async () => {
        const store = makeStore();
        const mgr = new MemoryManager({ store, logger });
        const rec = await mgr.remember({ content: 'user prefers dark mode', kind: 'preference' });
        expect(rec.accessCount).toBe(0);

        await mgr.recall('dark mode preference');
        const after = await store.get(rec.id);
        expect(after!.accessCount).toBe(1);
    });

    it('de-duplicates identical content by reinforcing instead of inserting', async () => {
        const store = makeStore();
        const mgr = new MemoryManager({ store, logger });
        await mgr.remember({ content: 'user is vegetarian', kind: 'preference', importance: 5 });
        await mgr.remember({ content: 'user is vegetarian', kind: 'preference', importance: 9 });

        const all = await store.list();
        expect(all.length).toBe(1);
        expect(all[0]!.importance).toBe(9); // bumped to the higher importance
    });

    it('reflect() extracts facts via the adapter and persists them', async () => {
        const store = makeStore();
        const adapter: any = {
            complete: vi.fn().mockResolvedValue({
                content: '[{"content":"user is allergic to peanuts","kind":"fact","importance":9}]',
                finishReason: 'stop', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
            }),
        };
        const mgr = new MemoryManager({ store, adapter, model: 'test', logger });
        const written = await mgr.reflect([
            { role: 'user', content: 'btw I am allergic to peanuts', tokenCount: 5, turnIndex: 0, compressed: false },
        ]);
        expect(written.length).toBe(1);
        expect((await store.list())[0]!.content).toContain('peanuts');
        expect((await store.list())[0]!.source).toBe('auto');
    });

    it('forget() deletes by id', async () => {
        const store = makeStore();
        const mgr = new MemoryManager({ store, logger });
        const rec = await mgr.remember({ content: 'temporary note', kind: 'fact' });
        expect(await mgr.forget({ id: rec.id })).toBe(true);
        expect(await store.get(rec.id)).toBeUndefined();
    });
});

describe('MemoryInjectionStrategy', () => {
    function ctxWith(userMsg: string): ContextWindow {
        return {
            systemPrompt: '', scratchpad: '', tokenCount: 0, maxTokens: 8000, metadata: {},
            turns: [{ role: 'user', content: userMsg, tokenCount: 5, turnIndex: 0, compressed: false }],
        };
    }

    it('injects a budget-bounded memory block as a synthetic system turn', async () => {
        const mgr = new MemoryManager({ store: makeStore(), logger });
        await mgr.remember({ content: 'user prefers metric units', kind: 'preference', importance: 8 });

        const strat = new MemoryInjectionStrategy(mgr, { tokenBudget: 800 });
        const ctx = ctxWith('what units should you use');
        expect(strat.shouldApply(ctx)).toBe(true);

        const out = await strat.apply(ctx);
        const memTurn = out.turns.find(t => t.turnIndex === -2 && t.compressed);
        expect(memTurn).toBeDefined();
        expect(memTurn!.content).toContain('metric');
        expect(memTurn!.content).toContain('<lemura:memory');
    });

    it('updates the memory turn in place (idempotent) rather than duplicating', async () => {
        const mgr = new MemoryManager({ store: makeStore(), logger });
        await mgr.remember({ content: 'user prefers metric units', kind: 'preference', importance: 8 });
        const strat = new MemoryInjectionStrategy(mgr);

        let ctx = ctxWith('units?');
        ctx = await strat.apply(ctx);
        ctx = await strat.apply(ctx);
        const memTurns = ctx.turns.filter(t => t.turnIndex === -2);
        expect(memTurns.length).toBe(1);
    });

    it('respects the token budget (drops overflow memories)', async () => {
        const mgr = new MemoryManager({ store: makeStore(), logger, minScore: 0 });
        for (let i = 0; i < 20; i++) {
            await mgr.remember({ content: `memory number ${i} about units and metric stuff`, kind: 'fact', importance: 5 });
        }
        // Tiny budget — only a couple of lines should fit.
        const strat = new MemoryInjectionStrategy(mgr, { tokenBudget: 60, estimateTokens: (t) => Math.ceil(t.length / 4) });
        const ctx = await strat.apply(ctxWith('metric units'));
        const memTurn = ctx.turns.find(t => t.turnIndex === -2);
        const lineCount = (memTurn!.content as string).split('\n').filter(l => l.startsWith('- ')).length;
        expect(lineCount).toBeLessThan(20);
        expect(memTurn!.tokenCount).toBeLessThanOrEqual(60);
    });
});
