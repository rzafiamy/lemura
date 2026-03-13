import { ISkill } from '../types/index.js';

/**
 * Manages skill registration and injects skills into the system prompt at the
 * appropriate position (system_prompt | pre_turn).
 *
 * Skills are sorted by `priority` (lower = higher priority). When a `tokenBudget`
 * is provided, skills are included in priority order until the budget is exhausted —
 * lower-tier content variants (`micro`, `nano`, `description`) are selected first
 * so as many skills as possible fit within the budget.
 */
export class SkillInjector {
    private skills: ISkill[] = [];

    constructor(skills: ISkill[] = []) {
        this.skills = [...skills];
        this.sortSkills();
    }

    register(skill: ISkill): void {
        this.skills.push(skill);
        this.sortSkills();
    }

    private sortSkills(): void {
        this.skills.sort((a, b) => a.priority - b.priority);
    }

    getSkillsForInjection(position: ISkill['inject']): ISkill[] {
        return this.skills.filter(s => s.inject === position);
    }

    /**
     * Builds the combined injection block for all skills at the given position.
     *
     * @param position  - Which injection point to target.
     * @param tokenBudget - Optional maximum token budget. Skills are added in priority
     *   order until the budget would be exceeded. When `undefined`, all skills are included.
     */
    buildInjectionBlock(position: ISkill['inject'], tokenBudget?: number): string {
        const relevantSkills = this.getSkillsForInjection(position);
        if (relevantSkills.length === 0) return '';

        let block = '';
        let usedTokens = 0;

        for (const skill of relevantSkills) {
            // Choose the most compact variant that still carries useful information
            const content = this._pickContent(skill, tokenBudget !== undefined);
            const skillEntry = `\n[Skill: ${skill.name} (Tier: ${skill.tier})]\n${content}\n`;

            // Approximate token count (4 chars ≈ 1 token)
            const skillTokens = Math.ceil(skillEntry.length / 4);

            if (tokenBudget !== undefined && usedTokens + skillTokens > tokenBudget) {
                // Skip this skill — would exceed budget
                continue;
            }

            block += skillEntry;
            usedTokens += skillTokens;
        }

        return block.trim();
    }

    /**
     * Picks the content variant to use for a skill.
     * When `budgetAware` is true, prefer smaller variants to maximise skill count.
     */
    private _pickContent(skill: ISkill, budgetAware: boolean): string {
        if (budgetAware) {
            // Compact order: nano → micro → standard → description
            return skill.nano || skill.micro || skill.standard || skill.description;
        }
        // Full order: standard → micro → nano → description
        return skill.standard || skill.micro || skill.nano || skill.description;
    }
}
