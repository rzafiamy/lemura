/**
 * Loading strategy for a skill.
 *
 * - `'fixed'`       — Always active. Injected on every iteration regardless of any
 *                     selector. This is the default and maintains full backward compatibility.
 * - `'dynamic'`     — Part of a pool. Only injected when explicitly enabled by the
 *                     host application via `SessionConfig.activeDynamicSkills`,
 *                     `SessionConfig.activeDynamicTags`, or a runtime call to
 *                     `session.skills.enableSkill()`.
 * - `'progressive'` — Model-driven selection. The skill's `description` is surfaced
 *                     to the agent in a lightweight catalog (see
 *                     {@link SkillInjector.buildCatalog}); the full content is injected
 *                     only after the model calls the built-in `load_skill` tool to
 *                     request it. Lemura registers `load_skill`, appends the catalog,
 *                     and resets progressive skills between turns automatically — no
 *                     host glue required. This is the "progressive disclosure" pattern.
 *
 * @since 1.4.0
 */
export type SkillStrategy = 'fixed' | 'dynamic' | 'progressive';

/**
 * Configuration for model-driven (`progressive`) skill selection.
 *
 * When a session has any `progressive` skills, Lemura automatically appends a
 * skill catalog to the system prompt, registers the built-in `load_skill` tool,
 * and resets progressive skills according to `persistence`. This config tunes
 * that behaviour. All fields are optional with sensible defaults.
 *
 * @since 1.7.0
 *
 * @example
 * ```typescript
 * new SessionManager({
 *   adapter, model, maxTokens: 8000,
 *   skills,                       // some with strategy: 'progressive'
 *   skillSelection: {
 *     persistence: 'per_turn',    // reset each user turn (default)
 *     maxConcurrent: 3,           // load at most 3 skills per turn
 *   },
 * });
 * ```
 */
export interface SkillSelectionConfig {
    /**
     * How long a skill loaded via `load_skill` stays active.
     *
     * - `'per_turn'` (default) — the skill is injected for the current user turn
     *   only; all progressive skills are reset at the start of the next `run()`.
     * - `'session'` — once loaded, the skill stays active for the rest of the
     *   session until explicitly disabled.
     *
     * @default 'per_turn'
     */
    persistence?: 'per_turn' | 'session';

    /**
     * Maximum number of progressive skills that may be active at once. When the
     * model tries to load more, the `load_skill` tool returns a soft error instead
     * of enabling the skill. `undefined` means no limit.
     */
    maxConcurrent?: number;

    /**
     * Override the instructional preamble that introduces the skill catalog in the
     * system prompt. When omitted, a sensible default is used. The catalog list of
     * `name: description` entries is appended after this text.
     */
    catalogHeader?: string;
}

export interface ISkill {
    name: string;
    version: string;
    description: string;
    inject: 'system_prompt' | 'pre_turn' | 'post_history';
    priority: number;
    /** Display tier used in the injection block header. Optional. */
    tier?: 'nano' | 'micro' | 'standard' | 'extended';
    nano?: string;
    micro?: string;
    standard?: string;
    extended?: string;

    /**
     * Full markdown content of the skill (body only, without frontmatter).
     * When provided, used as the `standard`-level content if `standard` is absent.
     * Also accepted as the sole field when constructing a skill object from a
     * parsed markdown file — `SkillInjector` will use it automatically.
     *
     * @since 1.4.0
     */
    content?: string;

    /**
     * Loading strategy. Defaults to `'fixed'` when omitted (backward compatible).
     *
     * @since 1.4.0
     */
    strategy?: SkillStrategy;

    /**
     * Tool names that this skill requires or activates.
     * Accessible at runtime via `session.skills.getRequiredTools()` so the host
     * application can expose only the tools that active skills actually need.
     *
     * @since 1.4.0
     */
    requiredTools?: string[];

    /**
     * Arbitrary tags for dynamic skill selection.
     * Pass tags to `SessionConfig.activeDynamicTags` or call
     * `session.skills.enableByTags(tags)` to activate all matching dynamic skills.
     *
     * @since 1.4.0
     */
    tags?: string[];

    /**
     * Activation state for `dynamic` and `progressive` skills.
     * Ignored for `fixed` skills (always active).
     * Defaults to `false` — `dynamic` skills must be enabled by the host, and
     * `progressive` skills are enabled by the model via the `load_skill` tool.
     *
     * @since 1.4.0
     */
    enabled?: boolean;
}
