import { ContextWindow, IContextStrategy, Turn } from '../types/context.js';
import { MemoryManager } from './MemoryManager.js';

export interface MemoryInjectionConfig {
    /** Strategy priority — lower runs first. Default 2 (after SummaryInjectionStrategy at 1). */
    priority?: number;
    /** Header label for the injected block. Default 'Relevant memories'. */
    label?: string;
    /** Token budget for the recalled-memory block. Default 800. */
    tokenBudget?: number;
    /** Estimate tokens for a string. Default: ceil(len/4). */
    estimateTokens?: (text: string) => number;
}

// Synthetic turn marker: distinct from the summary turn (-1) so both coexist.
const MEMORY_TURN_INDEX = -2;

/**
 * Token-budget-aware long-term memory recall as an {@link IContextStrategy}.
 *
 * Runs inside `ContextManager.prepare()` (exactly like `SummaryInjectionStrategy`),
 * so the recalled block is counted against `maxTokens` — memory can never overflow
 * the window. It scores all stored memories against the latest user turn, greedily
 * fills `tokenBudget` with the top records, and injects them as a single synthetic
 * system turn that is updated **in place** across iterations (idempotent).
 *
 * @since 1.8.0
 */
export class MemoryInjectionStrategy implements IContextStrategy {
    readonly name = 'memory_injection';
    readonly priority: number;

    private label: string;
    private tokenBudget: number;
    private estimateTokens: (text: string) => number;

    constructor(
        private manager: MemoryManager,
        config: MemoryInjectionConfig = {}
    ) {
        this.priority = config.priority ?? 2;
        this.label = config.label ?? 'Relevant memories';
        this.tokenBudget = config.tokenBudget ?? 800;
        this.estimateTokens = config.estimateTokens ?? ((t: string) => Math.ceil(t.length / 4));
    }

    shouldApply(ctx: ContextWindow): boolean {
        return this.latestUserQuery(ctx).trim().length > 0;
    }

    async apply(ctx: ContextWindow): Promise<ContextWindow> {
        const query = this.latestUserQuery(ctx);
        const ranked = await this.manager.recall(query);

        // Greedily fill the token budget with the highest-scored memories. The fixed
        // wrapper (<lemura:memory>…</lemura:memory> + label) is charged up front so the
        // *final* block — wrapper included — never exceeds tokenBudget.
        const openTag = `<lemura:memory label="${this.label}">`;
        const wrapperOverhead = this.estimateTokens(`${openTag}\n\n</lemura:memory>`);
        const lines: string[] = [];
        let used = wrapperOverhead;
        for (const r of ranked) {
            const line = `- [${r.record.kind}] ${r.record.content} (importance ${r.record.importance})`;
            const cost = this.estimateTokens(line + '\n');
            if (used + cost > this.tokenBudget) break;
            lines.push(line);
            used += cost;
        }

        const existingIndex = ctx.turns.findIndex(
            t => t.compressed && t.role === 'system' && t.turnIndex === MEMORY_TURN_INDEX
        );

        // No memories to inject — remove any stale block, leave everything else.
        if (lines.length === 0) {
            if (existingIndex === -1) return ctx;
            const turns = ctx.turns.filter((_, i) => i !== existingIndex);
            return { ...ctx, turns, tokenCount: turns.reduce((s, t) => s + t.tokenCount, 0) };
        }

        const content = `${openTag}\n${lines.join('\n')}\n</lemura:memory>`;
        const tokenCount = this.estimateTokens(content);

        let newTurns: Turn[];
        if (existingIndex !== -1) {
            newTurns = ctx.turns.map((t, i) =>
                i === existingIndex ? { ...t, content, tokenCount } : t
            );
        } else {
            const memoryTurn: Turn = {
                role: 'system',
                content,
                tokenCount,
                turnIndex: MEMORY_TURN_INDEX,
                compressed: true,
            };
            // Place after a summary turn (-1) if present, else at the front.
            const summaryIdx = ctx.turns.findIndex(t => t.turnIndex === -1 && t.compressed);
            if (summaryIdx !== -1) {
                newTurns = [
                    ...ctx.turns.slice(0, summaryIdx + 1),
                    memoryTurn,
                    ...ctx.turns.slice(summaryIdx + 1),
                ];
            } else {
                newTurns = [memoryTurn, ...ctx.turns];
            }
        }

        return { ...ctx, turns: newTurns, tokenCount: newTurns.reduce((s, t) => s + t.tokenCount, 0) };
    }

    private latestUserQuery(ctx: ContextWindow): string {
        for (let i = ctx.turns.length - 1; i >= 0; i--) {
            const t = ctx.turns[i]!;
            if (t.role === 'user') {
                return typeof t.content === 'string' ? t.content : JSON.stringify(t.content);
            }
        }
        return '';
    }
}
