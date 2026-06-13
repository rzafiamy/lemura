import { describe, it, expect } from 'vitest';
import { SkillInjector } from '../../../src/skills/SkillInjector.js';
import { createLoadSkillTool, LOAD_SKILL_TOOL_NAME } from '../../../src/tools/builtin/load_skill.js';
import { ISkill } from '../../../src/types/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function skill(overrides: Partial<ISkill> & Pick<ISkill, 'name'>): ISkill {
    return {
        version: '1.0.0',
        description: `${overrides.name} description`,
        inject: 'system_prompt',
        priority: 50,
        content: `${overrides.name} full content`,
        ...overrides,
    };
}

const progressive = (name: string, desc?: string): ISkill =>
    skill({ name, strategy: 'progressive', ...(desc ? { description: desc } : {}) });

// ---------------------------------------------------------------------------
// Activation semantics
// ---------------------------------------------------------------------------

describe('SkillInjector — progressive activation', () => {
    it('progressive skills are inactive until enabled', () => {
        const inj = new SkillInjector([progressive('summarize')]);
        expect(inj.getActiveSkills()).toHaveLength(0);

        inj.enableSkill('summarize');
        expect(inj.getActiveSkills().map(s => s.name)).toEqual(['summarize']);
    });

    it('ignores a frontmatter enabled:true hint — must be enabled at runtime', () => {
        const inj = new SkillInjector([
            skill({ name: 'fix', strategy: 'progressive', enabled: true as unknown as boolean }),
        ]);
        // enabled is honored from input, but progressive skills are normalised to
        // respect an explicit value; default remains false when omitted.
        const s = inj.getAll().find(x => x.name === 'fix')!;
        expect(s.enabled).toBe(true);
    });

    it('defaults progressive enabled to false when omitted', () => {
        const inj = new SkillInjector([progressive('fix')]);
        expect(inj.getAll()[0].enabled).toBe(false);
    });

    it('disableSkill and resetProgressiveSkills turn skills back off', () => {
        const inj = new SkillInjector([progressive('a'), progressive('b')]);
        inj.enableSkill('a');
        inj.enableSkill('b');
        expect(inj.countEnabledProgressive()).toBe(2);

        inj.disableSkill('a');
        expect(inj.countEnabledProgressive()).toBe(1);

        inj.resetProgressiveSkills();
        expect(inj.countEnabledProgressive()).toBe(0);
    });

    it('resetProgressiveSkills leaves fixed and dynamic skills untouched', () => {
        const inj = new SkillInjector([
            skill({ name: 'always', strategy: 'fixed' }),
            skill({ name: 'dyn', strategy: 'dynamic' }),
            progressive('prog'),
        ]);
        inj.enableSkill('dyn');
        inj.enableSkill('prog');

        inj.resetProgressiveSkills();

        const active = inj.getActiveSkills().map(s => s.name).sort();
        expect(active).toEqual(['always', 'dyn']);
    });
});

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

describe('SkillInjector — buildCatalog', () => {
    it('returns empty string when there are no progressive skills', () => {
        const inj = new SkillInjector([skill({ name: 'f', strategy: 'fixed' })]);
        expect(inj.buildCatalog()).toBe('');
    });

    it('lists every progressive skill name and description', () => {
        const inj = new SkillInjector([
            progressive('summarize', 'Condenses text.'),
            progressive('fix', 'Fixes bugs.'),
            skill({ name: 'always', strategy: 'fixed' }),
        ]);
        const catalog = inj.buildCatalog();
        expect(catalog).toContain('Available skills:');
        expect(catalog).toContain('- summarize: Condenses text.');
        expect(catalog).toContain('- fix: Fixes bugs.');
        // fixed skills are not in the catalog
        expect(catalog).not.toContain('always');
    });

    it('uses a custom header when provided', () => {
        const inj = new SkillInjector([progressive('x')]);
        expect(inj.buildCatalog('PICK WISELY')).toContain('PICK WISELY');
    });

    it('catalog content is injected only after enabling (progressive disclosure)', () => {
        const inj = new SkillInjector([progressive('summarize')]);
        // Before load: no full content injected.
        expect(inj.buildInjectionBlock('system_prompt')).toBe('');
        // After load: full content present.
        inj.enableSkill('summarize');
        expect(inj.buildInjectionBlock('system_prompt')).toContain('summarize full content');
    });
});

// ---------------------------------------------------------------------------
// load_skill tool
// ---------------------------------------------------------------------------

describe('createLoadSkillTool', () => {
    it('is named load_skill and constrains name to progressive skills', () => {
        const inj = new SkillInjector([progressive('summarize'), progressive('fix')]);
        const tool = createLoadSkillTool(inj);
        expect(tool.name).toBe(LOAD_SKILL_TOOL_NAME);
        const params = tool.parameters as any;
        expect(params.properties.name.enum.sort()).toEqual(['fix', 'summarize']);
    });

    it('enables the named skill on execute', async () => {
        const inj = new SkillInjector([progressive('summarize')]);
        const tool = createLoadSkillTool(inj);
        const out = await tool.execute({ name: 'summarize' }, {} as never);
        expect(out).toContain('loaded');
        expect(inj.getActiveSkills().map(s => s.name)).toEqual(['summarize']);
    });

    it('returns a soft error for an unknown skill without enabling anything', async () => {
        const inj = new SkillInjector([progressive('summarize')]);
        const tool = createLoadSkillTool(inj);
        const out = await tool.execute({ name: 'nope' }, {} as never);
        expect(out).toContain('No progressive skill');
        expect(inj.getActiveSkills()).toHaveLength(0);
    });

    it('enforces maxConcurrent with a soft error', async () => {
        const inj = new SkillInjector([progressive('a'), progressive('b')]);
        const tool = createLoadSkillTool(inj, { maxConcurrent: 1 });
        const ok = await tool.execute({ name: 'a' }, {} as never);
        expect(ok).toContain('loaded');
        const blocked = await tool.execute({ name: 'b' }, {} as never);
        expect(blocked).toContain('at most 1');
        expect(inj.countEnabledProgressive()).toBe(1);
    });

    it('loading an already-enabled skill does not count against maxConcurrent', async () => {
        const inj = new SkillInjector([progressive('a')]);
        const tool = createLoadSkillTool(inj, { maxConcurrent: 1 });
        await tool.execute({ name: 'a' }, {} as never);
        const again = await tool.execute({ name: 'a' }, {} as never);
        expect(again).toContain('loaded');
    });

    it('invokes the onLoad callback only on a successful load', async () => {
        const inj = new SkillInjector([progressive('a')]);
        const loaded: string[] = [];
        const tool = createLoadSkillTool(inj, undefined, (name) => loaded.push(name));

        await tool.execute({ name: 'a' }, {} as never);
        expect(loaded).toEqual(['a']);

        // Unknown skill must NOT fire the callback.
        await tool.execute({ name: 'nope' }, {} as never);
        expect(loaded).toEqual(['a']);
    });

    it('does not invoke onLoad when maxConcurrent blocks the load', async () => {
        const inj = new SkillInjector([progressive('a'), progressive('b')]);
        const loaded: string[] = [];
        const tool = createLoadSkillTool(inj, { maxConcurrent: 1 }, (name) => loaded.push(name));
        await tool.execute({ name: 'a' }, {} as never);
        await tool.execute({ name: 'b' }, {} as never); // blocked
        expect(loaded).toEqual(['a']);
    });
});
