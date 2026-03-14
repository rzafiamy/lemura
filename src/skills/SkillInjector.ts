import { ISkill } from '../types/index.js';

/**
 * Manages skill registration and injects skills into the system prompt at the
 * appropriate position (system_prompt | pre_turn | post_history).
 *
 * ## Fixed vs Dynamic skills
 *
 * Skills can declare a `strategy` field:
 *
 * - **`'fixed'`** (default) — Always active. Injected on every iteration.
 *   All skills without a `strategy` field are treated as fixed for full
 *   backward compatibility.
 *
 * - **`'dynamic'`** — Part of an opt-in pool. A dynamic skill is only injected
 *   when its `enabled` flag is `true`. Enable skills at construction time via
 *   `SessionConfig.activeDynamicSkills` / `SessionConfig.activeDynamicTags`, or
 *   at runtime with `enableSkill()` / `enableByTags()`.
 *
 * ## Token budget
 *
 * Skills are sorted by `priority` (lower = higher priority). When a `tokenBudget`
 * is provided, skills are included in priority order until the budget is exhausted —
 * lower-tier content variants (`micro`, `nano`) are selected first so as many
 * skills as possible fit within the budget.
 *
 * ## Content resolution
 *
 * Content is resolved in this order (most compact first when budget-aware):
 * `nano` → `micro` → `standard` → `content` → `description`
 * (reversed for full output: `standard` → `content` → `micro` → `nano` → `description`)
 */
export class SkillInjector {
    private skills: ISkill[] = [];

    constructor(skills: ISkill[] = []) {
        this.skills = skills.map(s => this._normalise(s));
        this.sortSkills();
    }

    // -----------------------------------------------------------------------
    // Registration
    // -----------------------------------------------------------------------

    register(skill: ISkill): void {
        this.skills.push(this._normalise(skill));
        this.sortSkills();
    }

    private sortSkills(): void {
        this.skills.sort((a, b) => a.priority - b.priority);
    }

    /**
     * Normalises a skill to ensure consistent defaults.
     * For dynamic skills, `enabled` defaults to `false` unless explicitly set.
     * For fixed skills (or those without a strategy), `enabled` is ignored.
     */
    private _normalise(skill: ISkill): ISkill {
        const strategy = skill.strategy ?? 'fixed';
        const enabled = strategy === 'dynamic'
            ? (skill.enabled ?? false)
            : true; // fixed skills are always conceptually enabled
        return { ...skill, strategy, enabled };
    }

    // -----------------------------------------------------------------------
    // Dynamic skill activation
    // -----------------------------------------------------------------------

    /**
     * Enable a dynamic skill by name.
     * Has no effect on fixed skills (they are always active).
     */
    enableSkill(name: string): void {
        const skill = this.skills.find(s => s.name === name);
        if (skill && skill.strategy === 'dynamic') {
            skill.enabled = true;
        }
    }

    /**
     * Disable a dynamic skill by name.
     * Has no effect on fixed skills.
     */
    disableSkill(name: string): void {
        const skill = this.skills.find(s => s.name === name);
        if (skill && skill.strategy === 'dynamic') {
            skill.enabled = false;
        }
    }

    /**
     * Enable all dynamic skills whose `tags` array intersects with `tags`.
     */
    enableByTags(tags: string[]): void {
        const tagSet = new Set(tags);
        for (const skill of this.skills) {
            if (skill.strategy === 'dynamic' && skill.tags?.some(t => tagSet.has(t))) {
                skill.enabled = true;
            }
        }
    }

    /**
     * Disable all dynamic skills whose `tags` array intersects with `tags`.
     */
    disableByTags(tags: string[]): void {
        const tagSet = new Set(tags);
        for (const skill of this.skills) {
            if (skill.strategy === 'dynamic' && skill.tags?.some(t => tagSet.has(t))) {
                skill.enabled = false;
            }
        }
    }

    // -----------------------------------------------------------------------
    // Queries
    // -----------------------------------------------------------------------

    /**
     * Returns all registered skills (fixed and dynamic, enabled or not).
     */
    getAll(): ISkill[] {
        return [...this.skills];
    }

    /**
     * Returns currently active skills — fixed skills always, dynamic skills
     * only when `enabled === true`.
     */
    getActiveSkills(): ISkill[] {
        return this.skills.filter(s => this._isActive(s));
    }

    /**
     * Returns skills at a given injection position, active only.
     */
    getSkillsForInjection(position: ISkill['inject']): ISkill[] {
        return this.skills.filter(s => s.inject === position && this._isActive(s));
    }

    /**
     * Returns the union of `requiredTools` from all currently active skills.
     * Use this to determine which tools the active skill set depends on.
     *
     * @since 1.4.0
     */
    getRequiredTools(): string[] {
        const tools = new Set<string>();
        for (const skill of this.getActiveSkills()) {
            for (const t of skill.requiredTools ?? []) {
                tools.add(t);
            }
        }
        return [...tools];
    }

    private _isActive(skill: ISkill): boolean {
        return skill.strategy !== 'dynamic' || skill.enabled === true;
    }

    // -----------------------------------------------------------------------
    // Injection block builder
    // -----------------------------------------------------------------------

    /**
     * Builds the combined injection block for all active skills at the given position.
     *
     * @param position  - Which injection point to target.
     * @param tokenBudget - Optional maximum token budget. Skills are added in priority
     *   order until the budget would be exceeded. When `undefined`, all active skills
     *   at the position are included.
     */
    buildInjectionBlock(position: ISkill['inject'], tokenBudget?: number): string {
        const relevantSkills = this.getSkillsForInjection(position);
        if (relevantSkills.length === 0) return '';

        let block = '';
        let usedTokens = 0;

        for (const skill of relevantSkills) {
            // Choose the most compact variant that still carries useful information
            const content = this._pickContent(skill, tokenBudget !== undefined);
            if (!content) continue;

            const tierLabel = skill.tier ?? 'standard';
            const skillEntry = `\n[Skill: ${skill.name} (Tier: ${tierLabel})]\n${content}\n`;

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

    // -----------------------------------------------------------------------
    // Content picking
    // -----------------------------------------------------------------------

    /**
     * Picks the content variant to use for a skill.
     *
     * Resolution order when budget-aware (compact first):
     *   nano → micro → standard → content → description
     *
     * Resolution order when not budget-aware (richest first):
     *   standard → content → micro → nano → description
     */
    private _pickContent(skill: ISkill, budgetAware: boolean): string {
        if (budgetAware) {
            return skill.nano
                || skill.micro
                || skill.standard
                || skill.content
                || skill.description
                || '';
        }
        return skill.standard
            || skill.content
            || skill.micro
            || skill.nano
            || skill.description
            || '';
    }
}
