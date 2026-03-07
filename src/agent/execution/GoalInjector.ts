export interface Goal {
    id: string;
    statement: string;
    decomposition: string[];
    successCriteria: string[];
    injectionFrequency: 'always' | 'every_N_turns' | 'on_compression';
    injectionPosition: 'system_prompt' | 'pre_turn';
}

export class GoalInjector {
    constructor(private goal: Goal) { }

    injectInto(prompt: string): string {
        // Basic formatting for Goal Injection
        const formatting = `[CURRENT GOAL]\n${this.goal.statement}\n\nSuccess criteria:\n${this.goal.successCriteria.map(c => `- ${c}`).join('\n')}\n[/CURRENT GOAL]`;

        if (this.goal.injectionPosition === 'system_prompt') {
            return `${prompt}\n\n${formatting}`;
        }

        return prompt;
    }
}
