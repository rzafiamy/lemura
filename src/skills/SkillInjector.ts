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
 * - **`'progressive'`** — Model-driven. Behaves like a `dynamic` skill for
 *   activation (inactive until enabled), but is additionally surfaced in the
 *   catalog produced by {@link buildCatalog} so the agent can request it via the
 *   built-in `load_skill` tool. SessionManager enables it on the model's behalf.
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
     * Strategies whose skills form an opt-in pool — inactive until explicitly
     * enabled. Both `dynamic` (host-enabled) and `progressive` (model-enabled via
     * the `load_skill` tool) behave this way.
     */
    private _isPoolStrategy(strategy: ISkill['strategy']): boolean {
        return strategy === 'dynamic' || strategy === 'progressive';
    }

    /**
     * Normalises a skill to ensure consistent defaults.
     * For pool skills (`dynamic` / `progressive`), `enabled` defaults to `false`
     * unless explicitly set. For `fixed` skills, `enabled` is ignored.
     */
    private _normalise(skill: ISkill): ISkill {
        const strategy = skill.strategy ?? 'fixed';
        const enabled = this._isPoolStrategy(strategy)
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
        if (skill && this._isPoolStrategy(skill.strategy)) {
            skill.enabled = true;
        }
    }

    /**
     * Disable a pool skill (`dynamic` or `progressive`) by name.
     * Has no effect on fixed skills.
     */
    disableSkill(name: string): void {
        const skill = this.skills.find(s => s.name === name);
        if (skill && this._isPoolStrategy(skill.strategy)) {
            skill.enabled = false;
        }
    }

    /**
     * Enable all pool skills (`dynamic` / `progressive`) whose `tags` array
     * intersects with `tags`.
     */
    enableByTags(tags: string[]): void {
        const tagSet = new Set(tags);
        for (const skill of this.skills) {
            if (this._isPoolStrategy(skill.strategy) && skill.tags?.some(t => tagSet.has(t))) {
                skill.enabled = true;
            }
        }
    }

    /**
     * Disable all pool skills (`dynamic` / `progressive`) whose `tags` array
     * intersects with `tags`.
     */
    disableByTags(tags: string[]): void {
        const tagSet = new Set(tags);
        for (const skill of this.skills) {
            if (this._isPoolStrategy(skill.strategy) && skill.tags?.some(t => tagSet.has(t))) {
                skill.enabled = false;
            }
        }
    }

    /**
     * Disable every progressive skill. Called by SessionManager between turns when
     * `skillSelection.persistence` is `'per_turn'` so each turn re-decides from the
     * catalog. Has no effect on `fixed` or `dynamic` skills.
     *
     * @since 1.7.0
     */
    resetProgressiveSkills(): void {
        for (const skill of this.skills) {
            if (skill.strategy === 'progressive') {
                skill.enabled = false;
            }
        }
    }

    /**
     * Returns all progressive skills, regardless of enabled state. Used to detect
     * whether the catalog / `load_skill` machinery should be activated.
     *
     * @since 1.7.0
     */
    getProgressiveSkills(): ISkill[] {
        return this.skills.filter(s => s.strategy === 'progressive');
    }

    /**
     * Number of currently-enabled progressive skills. Used to enforce
     * `skillSelection.maxConcurrent`.
     *
     * @since 1.7.0
     */
    countEnabledProgressive(): number {
        return this.skills.filter(s => s.strategy === 'progressive' && s.enabled === true).length;
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
        // Fixed skills are always active; pool skills (dynamic/progressive) only
        // when explicitly enabled.
        return !this._isPoolStrategy(skill.strategy) || skill.enabled === true;
    }

    // -----------------------------------------------------------------------
    // Catalog builder (progressive skills)
    // -----------------------------------------------------------------------

    /**
     * Builds a compact `name: description` catalog of all progressive skills, with
     * an instructional preamble telling the agent to call `load_skill` for relevant
     * entries. SessionManager appends this to the system prompt so the model can
     * decide which skills to pull in — full content is injected only on `load_skill`.
     *
     * Returns an empty string when there are no progressive skills (the catalog and
     * `load_skill` tool are then never activated).
     *
     * @param header - Optional override for the instructional preamble.
     * @returns The catalog block, or `''` when no progressive skills exist.
     *
     * @since 1.7.0
     *
     * @example
     * ```typescript
     * const catalog = injector.buildCatalog();
     * // You have access to specialized skills...
     * // Available skills:
     * // - summarize: Condenses text or documents concisely.
     * ```
     */
    buildCatalog(header?: string): string {
        const progressive = this.getProgressiveSkills();
        if (progressive.length === 0) return '';

        const preamble = header ?? SkillInjector.DEFAULT_CATALOG_HEADER;
        const lines = progressive.map(s => `- ${s.name}: ${s.description}`);
        return `${preamble}\n\nAvailable skills:\n${lines.join('\n')}`;
    }

    /** Default instructional preamble for the progressive-skill catalog. */
    static readonly DEFAULT_CATALOG_HEADER =
        'You have access to specialized skills. Each provides focused guidance for a ' +
        "particular kind of request. When a skill is relevant to the user's message, " +
        'call the `load_skill` tool with its name BEFORE answering — its full ' +
        'instructions will then be injected for you to follow. Load only what is ' +
        'relevant; skip it for small talk or unrelated questions.';

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
            const skillEntry = `\n<lemura:skill name="${skill.name}" tier="${tierLabel}">\n${content}\n</lemura:skill>\n`;

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
