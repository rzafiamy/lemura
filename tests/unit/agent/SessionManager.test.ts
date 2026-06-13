import { describe, it, expect, vi } from 'vitest';
import { SessionManager } from '../../../src/agent/SessionManager.js';
import { IProviderAdapter, LemuraAdapterError } from '../../../src/types/index.js';

const mockAdapter: IProviderAdapter = {
    name: 'mock',
    version: '1.0.0',
    complete: vi.fn().mockResolvedValue({
        content: 'Mocked response content',
        finishReason: 'stop',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    }),
    stream: vi.fn(),
    estimateTokens: vi.fn().mockReturnValue(10),
    getModelInfo: vi.fn(),
    healthCheck: vi.fn().mockResolvedValue(true),
    transcribe: vi.fn(),
    synthesize: vi.fn(),
    describeImage: vi.fn(),
    generateImage: vi.fn()
};

describe('SessionManager Unit Tests', () => {
    it('should execute a simple run completely', async () => {
        const session = new SessionManager({
            adapter: mockAdapter,
            model: 'mock-v1',
            maxTokens: 500
        });

        const res = await session.run('Hello agent');
        expect(res).toBe('Mocked response content');

        const history = session.getHistory();
        expect(history.length).toBe(2);
        expect(history[0].role).toBe('user');
        expect(history[1].role).toBe('assistant');
    });

    it('getContext returns correct values', () => {
        const session = new SessionManager({
            adapter: mockAdapter,
            model: 'mock-v1',
            maxTokens: 500,
            systemPrompt: 'System Core'
        });

        const ctx = session.getContext();
        expect(ctx.systemPrompt).toBe('System Core');
        expect(ctx.maxTokens).toBe(500);
    });
});

describe('SessionManager — progressive skills', () => {
    const progressiveSkill = {
        name: 'summarize',
        version: '1.0.0',
        description: 'Condenses text concisely.',
        inject: 'system_prompt' as const,
        priority: 30,
        strategy: 'progressive' as const,
        content: 'Lead with one sentence, then bullets.',
    };

    it('auto-registers the load_skill tool when a progressive skill is present', () => {
        const session = new SessionManager({
            adapter: mockAdapter,
            model: 'mock-v1',
            maxTokens: 500,
            skills: [progressiveSkill],
        });
        const toolNames = session.tools.getAll().map(t => t.name);
        expect(toolNames).toContain('load_skill');
    });

    it('does NOT register load_skill when there are no progressive skills', () => {
        const session = new SessionManager({
            adapter: mockAdapter,
            model: 'mock-v1',
            maxTokens: 500,
            skills: [{ ...progressiveSkill, strategy: 'fixed' as const }],
        });
        expect(session.tools.getAll().map(t => t.name)).not.toContain('load_skill');
    });

    it('progressive skills start inactive and become active once loaded', () => {
        const session = new SessionManager({
            adapter: mockAdapter,
            model: 'mock-v1',
            maxTokens: 500,
            skills: [progressiveSkill],
        });
        expect(session.skills.getActiveSkills()).toHaveLength(0);
        session.skills.enableSkill('summarize');
        expect(session.skills.getActiveSkills().map(s => s.name)).toEqual(['summarize']);
    });

    it('resets progressive skills between turns by default (per_turn)', async () => {
        const session = new SessionManager({
            adapter: mockAdapter,
            model: 'mock-v1',
            maxTokens: 500,
            skills: [progressiveSkill],
        });
        session.skills.enableSkill('summarize');
        expect(session.skills.countEnabledProgressive()).toBe(1);

        await session.run('next turn');
        // run() reset it at the start of the turn
        expect(session.skills.countEnabledProgressive()).toBe(0);
    });

    it('keeps progressive skills active across turns when persistence is session', async () => {
        const session = new SessionManager({
            adapter: mockAdapter,
            model: 'mock-v1',
            maxTokens: 500,
            skills: [progressiveSkill],
            skillSelection: { persistence: 'session' },
        });
        session.skills.enableSkill('summarize');
        await session.run('next turn');
        expect(session.skills.countEnabledProgressive()).toBe(1);
    });

    it('traces every registered skill at init even when inactive', () => {
        const events: any[] = [];
        new SessionManager({
            adapter: mockAdapter,
            model: 'mock-v1',
            maxTokens: 500,
            skills: [progressiveSkill],            // starts inactive
            onTrace: (e) => events.push(e),
        });
        const loads = events.filter(e => e.type === 'skill' && e.name === 'skill_load');
        expect(loads.map(e => e.metadata.name)).toContain('summarize');
        // enabled flag reflects activation state at init
        expect(loads.find(e => e.metadata.name === 'summarize').metadata.enabled).toBe(false);
    });

    it('emits skill_reset when a loaded skill is cleared at the start of a turn', async () => {
        const events: any[] = [];
        const session = new SessionManager({
            adapter: mockAdapter,
            model: 'mock-v1',
            maxTokens: 500,
            skills: [progressiveSkill],
            onTrace: (e) => events.push(e),
        });
        session.skills.enableSkill('summarize');

        events.length = 0;
        await session.run('next turn');

        const reset = events.find(e => e.type === 'skill' && e.name === 'skill_reset');
        expect(reset).toBeDefined();
        expect(reset.metadata.skills).toContain('summarize');
        expect(reset.metadata.reason).toBe('per_turn');
    });

    it('does NOT emit skill_reset when nothing was loaded', async () => {
        const events: any[] = [];
        const session = new SessionManager({
            adapter: mockAdapter,
            model: 'mock-v1',
            maxTokens: 500,
            skills: [progressiveSkill],
            onTrace: (e) => events.push(e),
        });
        events.length = 0;
        await session.run('a turn with no skill loaded');
        expect(events.some(e => e.name === 'skill_reset')).toBe(false);
    });
});
