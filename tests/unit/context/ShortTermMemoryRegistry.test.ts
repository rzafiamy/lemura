import { describe, it, expect, vi } from 'vitest';
import { ShortTermMemoryRegistry } from '../../../src/context/ShortTermMemoryRegistry.js';
import { InMemoryStorageAdapter } from '../../../src/context/InMemoryStorageAdapter.js';

describe('ShortTermMemoryRegistry', () => {
    it('should register and retrieve a text item', async () => {
        const storage = new InMemoryStorageAdapter();
        const registry = new ShortTermMemoryRegistry({ storage });

        const ref = await registry.register('hello world', 'text');
        expect(ref).toMatch(/^\[STM:.+\]$/);

        const item = await registry.getByRef(ref);
        expect(item?.content).toBe('hello world');
        expect(item?.type).toBe('text');
    });

    it('should throw if text exceeds max tokens', async () => {
        const storage = new InMemoryStorageAdapter();
        const registry = new ShortTermMemoryRegistry({
            storage,
            maxTextTokens: 2 // 2 tokens max
        });

        // 'hello world' is approx 3 tokens (11 chars / 4)
        await expect(registry.register('hello world', 'text'))
            .rejects.toThrow(/exceeds max tokens limit/);
    });

    it('should allow unlimited blob size', async () => {
        const storage = new InMemoryStorageAdapter();
        const registry = new ShortTermMemoryRegistry({
            storage,
            maxTextTokens: 1
        });

        const blobContent = new Uint8Array(1000);
        const ref = await registry.register(blobContent, 'blob');
        expect(ref).toBeDefined();

        const item = await registry.getByRef(ref);
        expect(item?.content).toBe(blobContent);
    });

    it('should update an existing item', async () => {
        const storage = new InMemoryStorageAdapter();
        const registry = new ShortTermMemoryRegistry({ storage });

        const ref = await registry.register('original', 'text');
        const uuid = ref.match(/\[STM:(.+)\]/)?.[1]!;

        await registry.update(uuid, { content: 'updated' });

        const item = await registry.getByRef(ref);
        expect(item?.content).toBe('updated');
    });
});
