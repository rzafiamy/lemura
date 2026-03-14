/**
 * Loading strategy for a skill.
 *
 * - `'fixed'`   — Always active. Injected on every iteration regardless of any
 *                 selector. This is the default and maintains full backward compatibility.
 * - `'dynamic'` — Part of a pool. Only injected when explicitly enabled via
 *                 `SessionConfig.activeDynamicSkills`, `SessionConfig.activeDynamicTags`,
 *                 or a runtime call to `session.skills.enableSkill()`.
 *
 * @since 1.4.0
 */
export type SkillStrategy = 'fixed' | 'dynamic';

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
     * Activation state for `dynamic` skills.
     * Ignored for `fixed` skills (always active).
     * Defaults to `false` for dynamic skills — they must be explicitly enabled.
     *
     * @since 1.4.0
     */
    enabled?: boolean;
}
