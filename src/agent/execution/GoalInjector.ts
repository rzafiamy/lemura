export interface Goal {
    id: string;
    statement: string;
    /** High-level sub-goals decomposed from the main statement */
    decomposition: string[];
    successCriteria: string[];
    injectionFrequency: 'always' | 'every_N_turns' | 'on_compression';
    injectionPosition: 'system_prompt' | 'pre_turn';
    /** Sub-goals already completed — updated via `markSubGoalDone()` */
    completedSubGoals?: string[];
}

/**
 * GoalInjector keeps the original task objective visible throughout the ReAct loop,
 * preventing goal drift after many tool calls and context compressions.
 *
 * Usage in SessionManager:
 * - For `system_prompt` position: call `injectInto(prompt)` which appends the goal block.
 * - For `pre_turn` position: call `getFormattedBlock()` and push as a system message.
 */
export class GoalInjector {
    private goal: Goal;
    private turnsSinceInjection: number = 0;

    constructor(goal: Goal) {
        this.goal = {
            ...goal,
            completedSubGoals: goal.completedSubGoals ?? [],
        };
    }

    /**
     * Returns the formatted `[CURRENT GOAL]` block string — without caring about
     * where it will be placed. Callers decide whether to append to a system prompt
     * or push as a separate message.
     */
    getFormattedBlock(): string {
        const { statement, successCriteria, decomposition, completedSubGoals = [] } = this.goal;

        const pending = decomposition.filter(sg => !completedSubGoals.includes(sg));
        const completed = decomposition.filter(sg => completedSubGoals.includes(sg));

        let block = `[CURRENT GOAL]\n${statement}\n`;

        if (successCriteria.length > 0) {
            block += `\nSuccess criteria:\n${successCriteria.map(c => `- ${c}`).join('\n')}`;
        }

        if (pending.length > 0) {
            block += `\n\nSub-goals remaining:\n${pending.map(sg => `- ${sg} ← pending`).join('\n')}`;
        }

        if (completed.length > 0) {
            block += `\n\nSub-goals completed:\n${completed.map(sg => `- ✅ ${sg}`).join('\n')}`;
        }

        block += '\n[/CURRENT GOAL]';
        return block;
    }

    /**
     * Appends the goal block to the given prompt string (for `system_prompt` position).
     * For `pre_turn` position, use `getFormattedBlock()` directly.
     *
     * @param prompt - The existing system prompt to append to.
     */
    injectInto(prompt: string): string {
        const block = this.getFormattedBlock();
        return prompt ? `${prompt}\n\n${block}` : block;
    }

    /**
     * Returns true when the goal should be re-injected this turn,
     * based on `injectionFrequency`.
     *
     * @param turnIndex - The current turn index in the ReAct loop (0-based)
     * @param compressionOccurred - Whether context was compressed this iteration
     * @param injectionN - The N for 'every_N_turns' frequency (default: 3)
     */
    shouldInjectThisTurn(
        turnIndex: number,
        compressionOccurred: boolean = false,
        injectionN: number = 3
    ): boolean {
        const { injectionFrequency } = this.goal;

        if (injectionFrequency === 'always') return true;

        if (injectionFrequency === 'every_N_turns') {
            return turnIndex % injectionN === 0;
        }

        if (injectionFrequency === 'on_compression') {
            return compressionOccurred;
        }

        return true;
    }

    /**
     * Updates the goal with new sub-goal decomposition and success criteria,
     * typically populated by the mini-planning LLM call.
     */
    updateDecomposition(decomposition: string[], successCriteria?: string[]): void {
        this.goal = {
            ...this.goal,
            decomposition,
            ...(successCriteria ? { successCriteria } : {}),
        };
    }

    /**
     * Marks a sub-goal as completed so it moves to the "completed" section
     * in subsequent injections.
     */
    markSubGoalDone(subGoal: string): void {
        const completed = this.goal.completedSubGoals ?? [];
        if (!completed.includes(subGoal)) {
            this.goal = {
                ...this.goal,
                completedSubGoals: [...completed, subGoal],
            };
        }
    }

    /** Returns a snapshot of the current goal state (safe to store in context.metadata). */
    getGoal(): Goal {
        return { ...this.goal, completedSubGoals: [...(this.goal.completedSubGoals ?? [])] };
    }

    /** Increments the internal turn counter (used for `every_N_turns` frequency). */
    incrementTurn(): void {
        this.turnsSinceInjection++;
    }
}
