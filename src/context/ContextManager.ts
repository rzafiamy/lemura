import { ContextWindow, IContextStrategy, LemuraContextOverflowError } from '../types/index.js';

/**
 * Orchestrates a stack of IContextStrategy implementations to keep the
 * token count within the maxTokens limit.
 */
export class ContextManager {
    private strategies: IContextStrategy[] = [];

    /**
     * Registers a new compression or pre-turn strategy and sorts the stack by priority.
     *
     * @param strategy - The strategy implementation to register
     */
    registerStrategy(strategy: IContextStrategy): void {
        this.strategies.push(strategy);
        this.strategies.sort((a, b) => a.priority - b.priority);
    }

    /**
     * Applies all registered strategies that return true for `shouldApply()`
     * until the context token count is safely below the maximum budget.
     *
     * @param context - The context window to prepare
     * @param safetyMargin - Modifier applied to maxTokens (default: 0.95 -> 95%)
     * @returns A new ContextWindow object potentially compressed
     * @throws {LemuraContextOverflowError} If the context is still over maxTokens after all strategies
     */
    async prepare(context: ContextWindow, safetyMargin = 0.95): Promise<ContextWindow> {
        let currentCtx = { ...context, turns: [...context.turns] };

        // Recalculate token count from actual turns + system prompt so compression
        // strategies always see an up-to-date figure regardless of how callers
        // track incremental additions (they often forget to update tokenCount).
        const systemTokens = currentCtx.systemPrompt
            ? Math.ceil(currentCtx.systemPrompt.length / 4)
            : 0;
        currentCtx.tokenCount =
            currentCtx.turns.reduce((sum, t) => sum + t.tokenCount, 0) + systemTokens;

        const targetTokenCount = currentCtx.maxTokens * safetyMargin;

        for (const strategy of this.strategies) {
            // If we are below the limit and it's not a pre-turn non-reducing strategy, skip it.
            // E.g., SummaryInjectionStrategy might still want to run.
            // But purely compression ones drop out early in our base architecture if they choose in `shouldApply`.
            if (strategy.shouldApply(currentCtx)) {
                currentCtx = await strategy.apply(currentCtx);
            }
        }

        if (currentCtx.tokenCount > currentCtx.maxTokens) {
            throw new LemuraContextOverflowError(
                `Context overflowed: ${currentCtx.tokenCount} tokens > ${currentCtx.maxTokens}`
            );
        }

        return currentCtx;
    }
}
