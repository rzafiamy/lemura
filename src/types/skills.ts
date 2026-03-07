export interface ISkill {
    name: string;
    version: string;
    description: string;
    inject: 'system_prompt' | 'pre_turn' | 'post_history';
    priority: number;
    tier: 'nano' | 'micro' | 'standard' | 'extended';
    nano?: string;
    micro?: string;
    standard?: string;
    extended?: string;
}
