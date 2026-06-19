import { IToolDefinition, ToolContext } from '../../types/index.js';

/** Tool names treated as trusted control-plane builtins by SessionManager's firewall. */
export const MEMORY_REMEMBER_TOOL = 'remember';
export const MEMORY_RECALL_TOOL = 'recall';
export const MEMORY_FORGET_TOOL = 'forget';

export const MEMORY_TOOL_NAMES = [
    MEMORY_REMEMBER_TOOL,
    MEMORY_RECALL_TOOL,
    MEMORY_FORGET_TOOL,
] as const;

const MEMORY_CATEGORY = 'memory';

/** Persist a durable memory the model judges worth keeping across sessions. */
export const rememberTool: IToolDefinition = {
    name: MEMORY_REMEMBER_TOOL,
    description:
        'Store a durable fact, preference, or episode in long-term memory so it can be ' +
        'recalled in future sessions. Use for stable user details, not ephemeral task data.',
    category: MEMORY_CATEGORY,
    parameters: {
        type: 'object',
        properties: {
            content: { type: 'string', description: 'The fact to remember.' },
            kind: {
                type: 'string',
                enum: ['fact', 'preference', 'episode', 'entity', 'summary'],
                description: 'Category of memory. Default: fact.',
            },
            importance: { type: 'number', description: 'Salience 1–10. Default 5.' },
            tags: { type: 'array', items: { type: 'string' } },
            entities: { type: 'array', items: { type: 'string' } },
        },
        required: ['content'],
    },
    async execute(params: any, context: ToolContext) {
        if (!context.memory) throw new Error('Memory not available in context');
        const rec = await context.memory.remember({
            content: params.content,
            kind: params.kind,
            importance: params.importance,
            tags: params.tags,
            entities: params.entities,
            source: 'tool',
        });
        return { status: 'success', id: rec.id, kind: rec.kind };
    },
};

/** Query long-term memory on demand. */
export const recallTool: IToolDefinition = {
    name: MEMORY_RECALL_TOOL,
    description:
        'Search long-term memory for facts relevant to a query. Returns ranked memories. ' +
        'Relevant memories are also auto-injected each turn; use this for targeted lookups.',
    category: MEMORY_CATEGORY,
    parameters: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'What to look up.' },
            topK: { type: 'number', description: 'Max results. Default 8.' },
        },
        required: ['query'],
    },
    async execute(params: any, context: ToolContext) {
        if (!context.memory) throw new Error('Memory not available in context');
        const ranked = await context.memory.recall(params.query, params.topK);
        return {
            results: ranked.map(r => ({
                id: r.record.id,
                content: r.record.content,
                kind: r.record.kind,
                importance: r.record.importance,
                score: Number(r.score.toFixed(3)),
            })),
        };
    },
};

/** Delete a memory by id or by best query match. */
export const forgetTool: IToolDefinition = {
    name: MEMORY_FORGET_TOOL,
    description: 'Delete a memory from long-term memory by id, or the best match for a query.',
    category: MEMORY_CATEGORY,
    parameters: {
        type: 'object',
        properties: {
            id: { type: 'string', description: 'Exact memory id to delete.' },
            query: { type: 'string', description: 'Delete the single best match for this query.' },
        },
    },
    async execute(params: any, context: ToolContext) {
        if (!context.memory) throw new Error('Memory not available in context');
        const ok = await context.memory.forget({ id: params.id, query: params.query });
        return { status: ok ? 'success' : 'not_found' };
    },
};

/** All builtin memory tools, registered when `SessionConfig.memory` is present. */
export function createMemoryTools(): IToolDefinition[] {
    return [rememberTool, recallTool, forgetTool];
}
