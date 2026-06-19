import { describe, it, expect, vi } from 'vitest';
import { SessionManager } from '../../../src/agent/SessionManager.js';
import { IProviderAdapter } from '../../../src/types/index.js';
import { InMemoryStorageAdapter } from '../../../src/context/InMemoryStorageAdapter.js';
import { StorageMemoryStore } from '../../../src/memory/stores/StorageMemoryStore.js';
import { MemoryManager } from '../../../src/memory/MemoryManager.js';

function baseAdapter(): IProviderAdapter {
    return {
        name: 'mock',
        version: '1.0.0',
        complete: vi.fn().mockResolvedValue({
            content: 'ok',
            finishReason: 'stop',
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        }),
        stream: vi.fn(),
        estimateTokens: (t: string) => Math.ceil((t?.length ?? 0) / 4),
        getModelInfo: vi.fn(),
        healthCheck: vi.fn().mockResolvedValue(true),
        transcribe: vi.fn(),
        synthesize: vi.fn(),
        describeImage: vi.fn(),
        generateImage: vi.fn(),
    };
}

describe('SessionManager — long-term memory wiring', () => {
    it('registers remember/recall/forget tools only when memory is configured', () => {
        const without = new SessionManager({ adapter: baseAdapter(), model: 'm', maxTokens: 500 });
        expect(without.tools.getAll().map(t => t.name)).not.toContain('remember');

        const store = new StorageMemoryStore(new InMemoryStorageAdapter());
        const withMem = new SessionManager({ adapter: baseAdapter(), model: 'm', maxTokens: 500, memory: { store } });
        const names = withMem.tools.getAll().map(t => t.name);
        expect(names).toEqual(expect.arrayContaining(['remember', 'recall', 'forget']));
    });

    it('recalls a persisted memory into context on a later session (cross-session)', async () => {
        const store = new StorageMemoryStore(new InMemoryStorageAdapter());

        // Session 1 seeds a memory (simulating a prior `remember`).
        const mgr = new MemoryManager({ store });
        await mgr.remember({ content: 'user prefers metric units', kind: 'preference', importance: 8 });

        // Session 2: fresh SessionManager, same store. Capture the messages the adapter sees.
        const adapter = baseAdapter();
        let seen = '';
        (adapter.complete as any).mockImplementation(async (req: any) => {
            seen = JSON.stringify(req.messages);
            return { content: 'ok', finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
        });

        const session = new SessionManager({ adapter, model: 'm', maxTokens: 8000, memory: { store } });
        await session.run('what units should you use?');

        expect(seen).toContain('metric');
        expect(seen).toContain('lemura:memory');
    });

    it('autoReflect runs an extra completion at session end and persists facts', async () => {
        const store = new StorageMemoryStore(new InMemoryStorageAdapter());
        const adapter = baseAdapter();

        // First complete() = the turn; second = reflection extraction.
        (adapter.complete as any)
            .mockResolvedValueOnce({ content: 'noted', finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } })
            .mockResolvedValueOnce({ content: '[{"content":"user is allergic to peanuts","kind":"fact","importance":9}]', finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } });

        const session = new SessionManager({
            adapter, model: 'm', maxTokens: 8000,
            memory: { store, autoReflect: true },
        });
        await session.run('btw I am allergic to peanuts');

        const all = await store.list();
        expect(all.length).toBe(1);
        expect(all[0]!.content).toContain('peanuts');
        expect(all[0]!.source).toBe('auto');
    });

    it('memory injection counts against the context budget (no overflow)', async () => {
        const store = new StorageMemoryStore(new InMemoryStorageAdapter());
        const mgr = new MemoryManager({ store, minScore: 0 });
        for (let i = 0; i < 50; i++) {
            await mgr.remember({ content: `fact ${i} about metric units and preferences`, kind: 'fact', importance: 5 });
        }
        const session = new SessionManager({
            adapter: baseAdapter(), model: 'm', maxTokens: 8000,
            memory: { store, recallTokenBudget: 200 },
        });
        // Should not throw a context-overflow error.
        await expect(session.run('metric units')).resolves.toBe('ok');
    });
});
