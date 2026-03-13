import { ContextWindow, IContextStrategy, Turn } from '../types/index.js';

export interface SummaryInjectionConfig {
    /** Strategy priority — lower number runs first. Default: 1 (runs before compression). */
    priority?: number;
    /** Label prepended to the injected summary block. */
    label?: string;
}

/**
 * SummaryInjectionStrategy ensures that whenever a `compressionSummary` exists on
 * the context window, it is re-injected as a synthetic system turn at the beginning
 * of the turn list before each provider call.
 *
 * **Why this matters:** `HistoryCompressionStrategy` and `SandwichCompressionStrategy`
 * store compressed context in `ctx.compressionSummary`, but without this strategy the
 * summary never reaches the model — the pruned turns are simply gone.
 *
 * Pair this with any compression strategy:
 *
 * @example
 * ```typescript
 * compressionStrategies: [
 *   new SummaryInjectionStrategy({ priority: 1 }),       // always runs first
 *   new SandwichCompressionStrategy(adapter, { priority: 2, triggerThreshold: 0.80 }),
 * ]
 * ```
 *
 * The strategy is idempotent: if a summary turn already exists it is updated in-place
 * rather than appended again.
 */
export class SummaryInjectionStrategy implements IContextStrategy {
    readonly name = 'summary_injection';
    readonly priority: number;

    private readonly label: string;

    constructor(config: SummaryInjectionConfig = {}) {
        this.priority = config.priority ?? 1;
        this.label = config.label ?? 'Earlier conversation summary';
    }

    shouldApply(ctx: ContextWindow): boolean {
        return !!ctx.compressionSummary && ctx.compressionSummary.trim().length > 0;
    }

    async apply(ctx: ContextWindow): Promise<ContextWindow> {
        const summaryContent = `[${this.label}]\n${ctx.compressionSummary}`;
        const summaryTokenCount = Math.ceil(summaryContent.length / 4);

        // Check if a summary turn already exists (role=system, compressed=true at turnIndex=-1)
        const existingIndex = ctx.turns.findIndex(t => t.compressed && t.role === 'system' && t.turnIndex === -1);

        let newTurns: Turn[];

        if (existingIndex !== -1) {
            // Update the existing summary turn in-place
            newTurns = ctx.turns.map((t, i) => {
                if (i !== existingIndex) return t;
                return {
                    ...t,
                    content: summaryContent,
                    tokenCount: summaryTokenCount,
                };
            });
        } else {
            // Prepend a new summary turn
            const summaryTurn: Turn = {
                role: 'system',
                content: summaryContent,
                tokenCount: summaryTokenCount,
                turnIndex: -1,
                compressed: true,
            };
            newTurns = [summaryTurn, ...ctx.turns];
        }

        // Recalculate token count
        const newTokenCount = newTurns.reduce((sum, t) => sum + t.tokenCount, 0);

        return {
            ...ctx,
            turns: newTurns,
            tokenCount: newTokenCount,
        };
    }
}
