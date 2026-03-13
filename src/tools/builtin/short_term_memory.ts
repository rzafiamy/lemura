import { IToolDefinition, ToolContext } from '../../types/index.js';
import { ShortTermMemoryRegistry } from '../../context/ShortTermMemoryRegistry.js';
import { SandwichCompressionStrategy } from '../../context/SandwichCompressionStrategy.js';

/**
 * Tool to read a chunk from Short Term Memory.
 */
export const readChunkTool: IToolDefinition = {
    name: 'read_chunk',
    description: 'Reads a specific portion or chunk of memory from a Short Term Memory reference.',
    parameters: {
        type: 'object',
        properties: {
            ref: { type: 'string', description: 'The STM reference (e.g., [STM:uuid])' },
            start: { type: 'number', description: 'Starting index or page' },
            end: { type: 'number', description: 'Ending index or page' }
        },
        required: ['ref']
    },
    async execute(params: any, context: ToolContext) {
        if (!context.stmRegistry) throw new Error('STM Registry not available in context');
        const item = await context.stmRegistry.getByRef(params.ref);
        if (!item) throw new Error(`STM item not found: ${params.ref}`);

        // Basic chunking logic for demo purposes
        const content = String(item.content);
        if (params.start !== undefined || params.end !== undefined) {
            return content.slice(params.start ?? 0, params.end ?? content.length);
        }
        return content;
    }
};

/**
 * Tool to search for content within chunks.
 */
export const searchChunkTool: IToolDefinition = {
    name: 'search_chunk',
    description: 'Searches for specific content or patterns within Short Term Memory chunks.',
    parameters: {
        type: 'object',
        properties: {
            ref: { type: 'string', description: 'The STM reference' },
            query: { type: 'string', description: 'The search query or keyword' }
        },
        required: ['ref', 'query']
    },
    async execute(params: any, context: ToolContext) {
        if (!context.stmRegistry) throw new Error('STM Registry not available in context');
        const item = await context.stmRegistry.getByRef(params.ref);
        if (!item) throw new Error(`STM item not found: ${params.ref}`);

        const content = String(item.content);
        const index = content.toLowerCase().indexOf(params.query.toLowerCase());
        if (index === -1) return 'No matches found.';

        // Return a snippet around the match
        const start = Math.max(0, index - 100);
        const end = Math.min(content.length, index + 100);
        return `Match found at index ${index}: ...${content.slice(start, end)}...`;
    }
};

/**
 * Tool to list chunks of an STM reference.
 */
export const listChunksTool: IToolDefinition = {
    name: 'list_chunks',
    description: 'Lists available chunks or structural breakdown of a Short Term Memory reference.',
    parameters: {
        type: 'object',
        properties: {
            ref: { type: 'string', description: 'The STM reference' }
        },
        required: ['ref']
    },
    async execute(params: any, context: ToolContext) {
        if (!context.stmRegistry) throw new Error('STM Registry not available in context');
        const item = await context.stmRegistry.getByRef(params.ref);
        if (!item) throw new Error(`STM item not found: ${params.ref}`);

        const size = String(item.content).length;
        const chunkSize = 2000;
        const totalChunks = Math.ceil(size / chunkSize);

        return {
            totalSize: size,
            chunkSize,
            totalChunks,
            chunks: Array.from({ length: totalChunks }, (_, i) => ({
                index: i,
                start: i * chunkSize,
                end: Math.min((i + 1) * chunkSize, size)
            }))
        };
    }
};

/**
 * Tool to update a chunk in STM.
 */
export const updateChunkTool: IToolDefinition = {
    name: 'update_chunk',
    description: 'Updates or appends content to a specific Short Term Memory reference.',
    parameters: {
        type: 'object',
        properties: {
            ref: { type: 'string', description: 'The STM reference' },
            content: { type: 'string', description: 'The new content or update' },
            mode: { type: 'string', enum: ['append', 'replace'], default: 'append' }
        },
        required: ['ref', 'content']
    },
    async execute(params: any, context: ToolContext) {
        if (!context.stmRegistry) throw new Error('STM Registry not available in context');
        const item = await context.stmRegistry.getByRef(params.ref);
        if (!item) throw new Error(`STM item not found: ${params.ref}`);

        let newContent = String(item.content);
        if (params.mode === 'replace') {
            newContent = params.content;
        } else {
            newContent += params.content;
        }

        const uuid = params.ref.match(/\[STM:(.+)\]/)?.[1];
        if (!uuid) throw new Error('Invalid STM reference');

        await context.stmRegistry.update(uuid, { content: newContent });
        return { status: 'success', ref: params.ref };
    }
};

/**
 * Tool to read the scratchpad.
 */
export const readScratchpadTool: IToolDefinition = {
    name: 'read_scratchpad',
    description: 'Reads the content from the current agent scratchpad.',
    parameters: { type: 'object', properties: {} },
    async execute(_params: any, context: ToolContext) {
        if (context.scratchpadAdapter) {
            const stored = await context.scratchpadAdapter.read(context.sessionId);
            return stored ?? '';
        }
        return context.scratchpad ?? '';
    }
};

/**
 * Tool to write to the scratchpad.
 */
export const writeScratchpadTool: IToolDefinition = {
    name: 'write_scratchpad',
    description: 'Writes content to the agent scratchpad for long-term reasoning steps.',
    parameters: {
        type: 'object',
        properties: {
            content: { type: 'string', description: 'Content to write' },
            append: { type: 'boolean', default: true }
        },
        required: ['content']
    },
    async execute(params: any, context: ToolContext) {
        let current = context.scratchpad ?? '';
        if (context.scratchpadAdapter) {
            const stored = await context.scratchpadAdapter.read(context.sessionId);
            if (stored !== undefined) current = stored;
        }
        let newScratchpad = current;
        if (params.append) {
            newScratchpad += (newScratchpad ? '\n' : '') + params.content;
        } else {
            newScratchpad = params.content;
        }
        if (context.scratchpadAdapter) {
            await context.scratchpadAdapter.write(context.sessionId, newScratchpad);
        }
        return { status: 'success', newScratchpad, note: 'Scratchpad updated' };
    }
};

/**
 * Tool to remove scratchpad content.
 */
export const removeScratchpadTool: IToolDefinition = {
    name: 'remove_scratchpad',
    description: 'Clears or removes content from the scratchpad.',
    parameters: { type: 'object', properties: {} },
    async execute(_params: any, context: ToolContext) {
        if (context.scratchpadAdapter) {
            await context.scratchpadAdapter.clear(context.sessionId);
        }
        return { status: 'success', newScratchpad: '', note: 'Scratchpad cleared' };
    }
};

/**
 * Tool to summarize via sandwich strategy.
 */
export const summarizeSandwichTool: IToolDefinition = {
    name: 'summarize_sandwich',
    description: 'Generated a layered sandwich summary of a large STM reference.',
    parameters: {
        type: 'object',
        properties: {
            ref: { type: 'string', description: 'The STM reference' },
            instructions: { type: 'string', description: 'Summarization instructions' }
        },
        required: ['ref']
    },
    async execute(params: any, context: ToolContext) {
        if (!context.stmRegistry) throw new Error('STM Registry not available in context');
        const item = await context.stmRegistry.getByRef(params.ref);
        if (!item) throw new Error(`STM item not found: ${params.ref}`);

        // This tool needs a provider adapter. In a real scenario, this might be passed in context or config.
        // For now, let's assume we can use a strategy if provided.
        // This highlights that some tools might need more context.
        return { status: 'pending', note: 'Summarization requires AI provider' };
    }
};
