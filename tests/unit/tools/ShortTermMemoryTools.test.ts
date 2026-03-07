import { describe, it, expect, vi } from 'vitest';
import {
    readChunkTool,
    searchChunkTool,
    listChunksTool,
    writeScratchpadTool,
    removeScratchpadTool
} from '../../../src/tools/builtin/short_term_memory.js';
import { ShortTermMemoryRegistry } from '../../../src/context/ShortTermMemoryRegistry.js';
import { InMemoryStorageAdapter } from '../../../src/context/InMemoryStorageAdapter.js';
import { ToolContext } from '../../../src/types/index.js';

describe('STM Tools', () => {
    const storage = new InMemoryStorageAdapter();
    const registry = new ShortTermMemoryRegistry({ storage });
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    it('read_chunk should return slices of content', async () => {
        const ref = await registry.register('0123456789', 'text');
        const context: ToolContext = {
            sessionId: 'test',
            turnIndex: 0,
            logger,
            stmRegistry: registry
        };

        const result = await readChunkTool.execute({ ref, start: 0, end: 5 }, context);
        expect(result).toBe('01234');
    });

    it('search_chunk should find a match', async () => {
        const ref = await registry.register('find me in the text', 'text');
        const context: ToolContext = {
            sessionId: 'test',
            turnIndex: 0,
            logger,
            stmRegistry: registry
        };

        const result = await searchChunkTool.execute({ ref, query: 'find me' }, context) as string;
        expect(result).toContain('Match found at index 0');
    });

    it('list_chunks should return structure info', async () => {
        const ref = await registry.register('A'.repeat(5000), 'text');
        const context: ToolContext = {
            sessionId: 'test',
            turnIndex: 0,
            logger,
            stmRegistry: registry
        };

        const result = await listChunksTool.execute({ ref }, context) as any;
        expect(result.totalSize).toBe(5000);
        expect(result.totalChunks).toBe(3); // 5000 / 2000
    });

    it('write_scratchpad should return new scratchpad state', async () => {
        const context: ToolContext = {
            sessionId: 'test',
            turnIndex: 0,
            logger,
            scratchpad: 'Initial'
        };

        const result = await writeScratchpadTool.execute({ content: 'Update', append: true }, context) as any;
        expect(result.newScratchpad).toBe('Initial\nUpdate');
    });

    it('remove_scratchpad should clear state', async () => {
        const context: ToolContext = {
            sessionId: 'test',
            turnIndex: 0,
            logger,
            scratchpad: 'Full'
        };

        const result = await removeScratchpadTool.execute({}, context) as any;
        expect(result.newScratchpad).toBe('');
    });
});
