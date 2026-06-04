import { describe, it, expect, vi } from 'vitest';
import { SessionManager } from '../../../src/agent/SessionManager.js';
import { LLMRouter } from '../../../src/agent/execution/Router.js';
import {
    IProviderAdapter,
    IToolDefinition,
    IRouterAdapter,
    ToolCategoryInfo,
} from '../../../src/types/index.js';

/**
 * Adapter that records the tool names exposed on the first completion, then
 * returns a plain stop response. Lets us assert which tools the router exposed.
 */
function makeToolCapturingAdapter(seen: { names: string[] }): IProviderAdapter {
    return {
        name: 'mock',
        version: '1.0.0',
        complete: vi.fn(async (req: { tools?: IToolDefinition[] }) => {
            seen.names = (req.tools ?? []).map(t => t.name);
            return {
                content: 'Done',
                finishReason: 'stop' as const,
                usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            };
        }),
        stream: vi.fn(async function* () {
            yield { delta: 'Done', finished: true, finishReason: 'stop' as const };
        }),
        estimateTokens: vi.fn().mockReturnValue(10),
        getModelInfo: vi.fn(),
        healthCheck: vi.fn().mockResolvedValue(true),
        transcribe: vi.fn(),
        synthesize: vi.fn(),
        describeImage: vi.fn(),
        generateImage: vi.fn(),
    } as unknown as IProviderAdapter;
}

function tool(name: string, category?: string): IToolDefinition {
    return {
        name,
        description: `tool ${name}`,
        parameters: { type: 'object', properties: {} },
        ...(category ? { category } : {}),
        execute: async () => 'ok',
    };
}

/** Router that always selects exactly the given categories. */
function fixedRouter(mode: 'chat' | 'task', categories: string[]): IRouterAdapter {
    return { route: () => ({ mode, categories }) };
}

describe('Router — tool narrowing', () => {
    it('exposes only tools in routed-in categories (plus uncategorized)', async () => {
        const seen = { names: [] as string[] };
        const session = new SessionManager({
            adapter: makeToolCapturingAdapter(seen),
            model: 'mock-v1',
            maxTokens: 5000,
            tools: [
                tool('search_web', 'SEARCH'),
                tool('write_file', 'FILES'),
                tool('get_datetime'), // uncategorized → always exposed
            ],
            enableRouting: true,
            router: fixedRouter('task', ['SEARCH']),
        });

        await session.run('find something');

        expect(seen.names.sort()).toEqual(['get_datetime', 'search_web']);
        expect(seen.names).not.toContain('write_file');
    });

    it('always exposes alwaysAvailableCategories regardless of the decision', async () => {
        const seen = { names: [] as string[] };
        const session = new SessionManager({
            adapter: makeToolCapturingAdapter(seen),
            model: 'mock-v1',
            maxTokens: 5000,
            tools: [tool('scratchpad_read', 'SCRATCHPAD'), tool('search_web', 'SEARCH')],
            enableRouting: true,
            alwaysAvailableCategories: ['SCRATCHPAD'],
            router: fixedRouter('task', []), // selects nothing
        });

        await session.run('hello there, do a thing');

        expect(seen.names).toContain('scratchpad_read');
        expect(seen.names).not.toContain('search_web');
    });

    it('exposes all tools when routing is disabled (default behavior)', async () => {
        const seen = { names: [] as string[] };
        const session = new SessionManager({
            adapter: makeToolCapturingAdapter(seen),
            model: 'mock-v1',
            maxTokens: 5000,
            tools: [tool('search_web', 'SEARCH'), tool('write_file', 'FILES')],
            // enableRouting omitted
        });

        await session.run('do anything');

        expect(seen.names.sort()).toEqual(['search_web', 'write_file']);
    });

    it('falls back to all tools when there are no categorized tools', async () => {
        const seen = { names: [] as string[] };
        const route = vi.fn();
        const session = new SessionManager({
            adapter: makeToolCapturingAdapter(seen),
            model: 'mock-v1',
            maxTokens: 5000,
            tools: [tool('a'), tool('b')], // no categories
            enableRouting: true,
            router: { route },
        });

        await session.run('do anything');

        // Router is never consulted when nothing is categorizable.
        expect(route).not.toHaveBeenCalled();
        expect(seen.names.sort()).toEqual(['a', 'b']);
    });
});

describe('LLMRouter — built-in', () => {
    const categories: ToolCategoryInfo[] = [
        { name: 'SEARCH', tools: ['search_web'] },
        { name: 'FILES', tools: ['write_file'] },
    ];

    it('uses the conversational fast-path without calling the LLM', async () => {
        const adapter = { complete: vi.fn() } as unknown as IProviderAdapter;
        const router = new LLMRouter({
            adapter,
            model: 'mock-v1',
            logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() } as any,
        });

        const decision = await router.route('hello', categories);

        expect(decision.mode).toBe('chat');
        expect(decision.categories).toEqual([]);
        expect(adapter.complete).not.toHaveBeenCalled();
    });

    it('parses an LLM decision and drops hallucinated categories', async () => {
        const adapter = {
            complete: vi.fn(async () => ({
                content: '{"mode":"task","categories":["SEARCH","NONEXISTENT"],"reason":"needs web"}',
            })),
        } as unknown as IProviderAdapter;
        const router = new LLMRouter({
            adapter,
            model: 'mock-v1',
            logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() } as any,
        });

        const decision = await router.route('search the web for cats', categories);

        expect(decision.mode).toBe('task');
        expect(decision.categories).toEqual(['SEARCH']); // hallucinated category dropped
    });

    it('fails safe to all categories on an unparseable response', async () => {
        const adapter = {
            complete: vi.fn(async () => ({ content: 'not json at all' })),
        } as unknown as IProviderAdapter;
        const router = new LLMRouter({
            adapter,
            model: 'mock-v1',
            logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() } as any,
        });

        const decision = await router.route('do something complex', categories);

        expect(decision.mode).toBe('task');
        expect(decision.categories.sort()).toEqual(['FILES', 'SEARCH']);
    });
});
