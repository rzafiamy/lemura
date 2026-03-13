import { ContextWindow, IContextStrategy, IProviderAdapter, Turn } from '../types/index.js';

/**
 * ScratchpadStrategy manages the thinking process separate from the turn history.
 * It is primarily a marker/pre-turn strategy that ensures scratchpad gets tokenized properly
 * but is not compressed.
 */
export class ScratchpadStrategy implements IContextStrategy {
    readonly name = 'scratchpad_strategy';
    readonly priority = 10;

    shouldApply(ctx: ContextWindow): boolean {
        // Only apply if there's actual scratchpad content to track
        return ctx.scratchpad.length > 0;
    }

    async apply(ctx: ContextWindow): Promise<ContextWindow> {
        // Basic implementation: we don't compress the scratchpad, we just ensure its tokens are counted
        return ctx;
    }
}

export interface HistoryCompressionConfig {
    /** Number of oldest turns to summarize in each compression pass */
    windowSize: number;
    /** Fire when context reaches this fraction of maxTokens (e.g. 0.8 = 80%) */
    triggerAtPercent: number;
    /** Strategy execution priority — lower number runs first. Default: 30 */
    priority?: number;
}

/**
 * Summarizes the oldest N uncompressed turns using a rolling-window approach.
 *
 * Pair with `SummaryInjectionStrategy` (priority < this one) to ensure the
 * accumulated summary is re-injected before each provider call.
 */
export class HistoryCompressionStrategy implements IContextStrategy {
    readonly name = 'history_compression';
    readonly priority: number;

    constructor(
        private adapter: IProviderAdapter,
        private config: HistoryCompressionConfig
    ) {
        this.priority = config.priority ?? 30;
    }

    shouldApply(ctx: ContextWindow): boolean {
        const triggerTokens = ctx.maxTokens * this.config.triggerAtPercent;
        // Apply if we are over the trigger threshold and have at least enough turns
        // Ignore system prompts and already compressed turns
        const uncompressedTurns = ctx.turns.filter(t => t.role !== 'system' && !t.compressed);
        return ctx.tokenCount >= triggerTokens && uncompressedTurns.length > this.config.windowSize;
    }

    async apply(ctx: ContextWindow): Promise<ContextWindow> {
        // Find the oldest N uncompressed turns that aren't the system prompt
        const uncompressedIndices = ctx.turns
            .map((t, i) => ({ t, i }))
            .filter(({ t }) => t.role !== 'system' && !t.compressed)
            .slice(0, this.config.windowSize);

        const targetTurns = uncompressedIndices.map(u => u.t);
        const middleText = targetTurns.map(t => `${t.role}: ${JSON.stringify(t.content)}`).join('\n');

        const summaryResponse = await this.adapter.complete({
            model: '',
            messages: [{
                role: 'user',
                content: `Summarize the oldest part of this conversation:\n${middleText}`
            }]
        });

        const summaryStr = summaryResponse.content;
        const newCompressionSummary = ctx.compressionSummary
            ? `${ctx.compressionSummary}\n${summaryStr}`
            : summaryStr;

        // Filter out the summarized turns
        const indicesToRemove = new Set(uncompressedIndices.map(u => u.i));
        const newTurns = ctx.turns.filter((_, i) => !indicesToRemove.has(i));

        const TokenCount = newTurns.reduce((sum, t) => sum + t.tokenCount, 0) +
            this.adapter.estimateTokens(ctx.systemPrompt) +
            this.adapter.estimateTokens(ctx.scratchpad);

        return {
            ...ctx,
            turns: newTurns,
            tokenCount: TokenCount,
            compressionSummary: newCompressionSummary,
        };
    }
}
