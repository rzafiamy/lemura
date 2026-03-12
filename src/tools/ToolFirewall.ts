import { ToolFirewallConfig, ToolDecision } from '../types/agent.js';
import { ILogger } from '../types/logger.js';

export interface ToolFirewallResult {
    decision: ToolDecision;
    reason: string;
}

function matchesRule(pattern: string | undefined, value: string, logger?: ILogger): boolean {
    if (!pattern) return true;
    try {
        const re = new RegExp(pattern);
        return re.test(value);
    } catch (err: any) {
        if (logger) logger.warn(`Invalid firewall regex: ${pattern}`, { error: err?.message });
        return false;
    }
}

export function evaluateToolFirewall(
    config: ToolFirewallConfig | undefined,
    toolName: string,
    argsJson: string,
    logger?: ILogger
): ToolFirewallResult {
    const defaultDecision: ToolDecision = config?.defaultDecision || 'ask';
    const rules = config?.rules || [];

    for (const rule of rules) {
        const nameOk = matchesRule(rule.name, toolName, logger);
        const argsOk = matchesRule(rule.arguments, argsJson, logger);
        if (nameOk && argsOk) {
            return {
                decision: rule.decision,
                reason: rule.reason || 'Matched firewall rule'
            };
        }
    }

    return {
        decision: defaultDecision,
        reason: 'Default firewall decision'
    };
}
