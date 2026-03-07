import { ISkill } from '../types/index.js';

export class SkillInjector {
    private skills: ISkill[] = [];

    constructor(skills: ISkill[] = []) {
        this.skills = [...skills];
        this.sortSkills();
    }

    register(skill: ISkill) {
        this.skills.push(skill);
        this.sortSkills();
    }

    private sortSkills() {
        this.skills.sort((a, b) => a.priority - b.priority);
    }

    getSkillsForInjection(position: ISkill['inject']): ISkill[] {
        return this.skills.filter(s => s.inject === position);
    }

    /**
     * Generates a combined prompt block for all skills targeting a specific injection position.
     */
    buildInjectionBlock(position: ISkill['inject']): string {
        const relevantSkills = this.getSkillsForInjection(position);
        if (relevantSkills.length === 0) return '';

        let block = '';
        for (const skill of relevantSkills) {
            // Very basic tier logic, full compression handling would be tied to budgets
            const content = skill.standard || skill.micro || skill.nano || skill.description;
            block += `\n[Skill: ${skill.name} (Tier: ${skill.tier})]\n${content}\n`;
        }

        return block.trim();
    }
}
