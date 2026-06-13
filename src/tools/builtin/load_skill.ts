import { IToolDefinition } from '../../types/index.js';
import { SkillInjector } from '../../skills/SkillInjector.js';
import { SkillSelectionConfig } from '../../types/skills.js';

/** Canonical name of the built-in progressive-skill loader tool. */
export const LOAD_SKILL_TOOL_NAME = 'load_skill';

/**
 * Creates the built-in `load_skill` tool that powers model-driven (`progressive`)
 * skill selection.
 *
 * The tool closes over the session's {@link SkillInjector}: when the agent calls
 * it, the named progressive skill is enabled so its full content is injected on
 * the next ReAct iteration. SessionManager registers this tool automatically when
 * any `progressive` skill is present, and resets progressive skills between turns
 * (when `persistence: 'per_turn'`), so host applications never wire it by hand.
 *
 * The `name` parameter is constrained with an `enum` of the available progressive
 * skill names, so a well-behaved model cannot request a skill that does not exist.
 * The tool still validates at runtime and returns a soft error (rather than
 * throwing) for unknown names or when `maxConcurrent` would be exceeded — soft
 * errors keep the ReAct loop going so the agent can recover.
 *
 * @param injector - The live skill injector to enable skills on.
 * @param config - Optional selection config; only `maxConcurrent` is consulted here.
 * @param onLoad - Optional callback invoked with the skill name when a skill is
 *   successfully enabled. SessionManager uses it to emit a `skill_enable` trace so
 *   the model's selection decision is observable in the trace stream.
 * @returns A tool definition ready to register on the session's `ToolRegistry`.
 *
 * @since 1.7.0
 *
 * @example
 * ```typescript
 * const tool = createLoadSkillTool(session.skills, { maxConcurrent: 3 });
 * session.tools.register(tool);
 * ```
 */
export function createLoadSkillTool(
    injector: SkillInjector,
    config?: SkillSelectionConfig,
    onLoad?: (name: string) => void
): IToolDefinition {
    const progressiveNames = injector.getProgressiveSkills().map(s => s.name);

    return {
        name: LOAD_SKILL_TOOL_NAME,
        description:
            'Load a specialized skill by name to get its full instructions for the ' +
            "current turn. Call this when the user's request matches a skill listed " +
            'in the "Available skills" catalog in your system prompt. Loading a skill ' +
            'injects its detailed guidance, which you should then follow.',
        category: 'utility',
        parameters: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description:
                        'The skill name, exactly as listed in the Available skills catalog.',
                    enum: progressiveNames,
                },
            },
            required: ['name'],
        },
        async execute(params: { name?: string }) {
            const name = params?.name;
            if (!name || !progressiveNames.includes(name)) {
                return `No progressive skill named "${name}". Available: ${progressiveNames.join(', ') || '(none)'}.`;
            }

            const max = config?.maxConcurrent;
            const alreadyEnabled = injector
                .getActiveSkills()
                .some(s => s.name === name && s.strategy === 'progressive');

            if (
                max !== undefined &&
                !alreadyEnabled &&
                injector.countEnabledProgressive() >= max
            ) {
                return `Cannot load "${name}": at most ${max} skill(s) may be active at once. Finish or skip a loaded skill first.`;
            }

            injector.enableSkill(name);
            onLoad?.(name);
            return `Skill "${name}" loaded. Follow its instructions for this response.`;
        },
    };
}
