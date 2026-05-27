import { describe, it, expect, vi } from 'vitest';
import { SessionManager } from '../../../src/agent/SessionManager.js';
import type { IProviderAdapter, GoalVerifierResult } from '../../../src/types/index.js';
import type { Goal } from '../../../src/agent/execution/GoalInjector.js';
import type { Turn } from '../../../src/types/context.js';

function makeMockAdapter(responses: Array<{ content: string; finishReason?: string }>) {
    let callIndex = 0;
    return {
        name: 'mock',
        version: '1.0.0',
        complete: vi.fn().mockImplementation(() => {
            const r = responses[callIndex] ?? responses[responses.length - 1];
            callIndex++;
            return Promise.resolve({
                content: r.content,
                finishReason: r.finishReason ?? 'stop',
                usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
            });
        }),
        stream: vi.fn(),
        estimateTokens: vi.fn().mockReturnValue(10),
        getModelInfo: vi.fn(),
        healthCheck: vi.fn().mockResolvedValue(true),
        transcribe: vi.fn(),
        synthesize: vi.fn(),
        describeImage: vi.fn(),
        generateImage: vi.fn()
    } as unknown as IProviderAdapter;
}

describe('Goal Verification', () => {
    it('(A) custom goalVerifier returning achieved=true — loop stops normally', async () => {
        const adapter = makeMockAdapter([{ content: 'Task done', finishReason: 'stop' }]);
        const verifier = vi.fn<(goal: Goal, turns: Turn[]) => GoalVerifierResult>()
            .mockReturnValue({ achieved: true, reason: 'All criteria met' });

        const session = new SessionManager({
            adapter,
            model: 'mock-v1',
            maxTokens: 500,
            enableGoalPlanning: true,
            goalVerifier: verifier
        });

        const result = await session.run('Write a hello world script');
        expect(result).toBe('Task done');
        expect(verifier).toHaveBeenCalledOnce();
    });

    it('(A) custom goalVerifier returning achieved=false — loop continues once then stops', async () => {
        const adapter = makeMockAdapter([
            { content: 'Partial work', finishReason: 'stop' },
            { content: 'Complete work', finishReason: 'stop' }
        ]);
        const verifier = vi.fn<(goal: Goal, turns: Turn[]) => GoalVerifierResult>()
            .mockReturnValueOnce({ achieved: false, missing: 'Tests were not written', reason: 'Missing tests' })
            .mockReturnValueOnce({ achieved: true });

        const session = new SessionManager({
            adapter,
            model: 'mock-v1',
            maxTokens: 500,
            enableGoalPlanning: true,
            goalVerifier: verifier
        });

        const result = await session.run('Write code with tests');
        expect(result).toBe('Complete work');
        // Verifier called once (cap is 1 retry — second stop has goalVerificationDone=true)
        expect(verifier).toHaveBeenCalledOnce();
    });

    it('(C) built-in successCriteria check fires when no custom verifier given', async () => {
        // First call: agent response; Second call: verifier LLM call (returns achieved=true)
        const adapter = makeMockAdapter([
            { content: 'Agent response', finishReason: 'stop' },
            { content: '{"achieved": true, "reason": "All criteria met", "missing": ""}', finishReason: 'stop' }
        ]);

        const session = new SessionManager({
            adapter,
            model: 'mock-v1',
            maxTokens: 500,
            enableGoalPlanning: true
        });

        // Set a goal with real successCriteria (bypass auto-planning which would call adapter too)
        session.setGoal({
            id: 'test-goal',
            statement: 'Create a sorting algorithm',
            decomposition: [],
            successCriteria: ['Algorithm is implemented', 'It handles empty arrays'],
            injectionFrequency: 'always',
            injectionPosition: 'system_prompt'
        });

        const result = await session.run('Create a sorting algorithm');
        expect(result).toBe('Agent response');
        // Adapter called twice: once for agent run, once for built-in verifier
        expect((adapter.complete as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
    });

    it('(A) verification skipped when enableGoalPlanning is false', async () => {
        const adapter = makeMockAdapter([{ content: 'Done', finishReason: 'stop' }]);
        const verifier = vi.fn().mockReturnValue({ achieved: false, missing: 'Something' });

        const session = new SessionManager({
            adapter,
            model: 'mock-v1',
            maxTokens: 500,
            enableGoalPlanning: false,
            goalVerifier: verifier
        });

        const result = await session.run('Do something');
        expect(result).toBe('Done');
        expect(verifier).not.toHaveBeenCalled();
    });
});
