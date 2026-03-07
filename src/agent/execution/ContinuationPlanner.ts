export interface ContinuationStep {
    stepId: string;
    toolName: string;
    description: string;
    dependsOn: string[];
    status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
    outputKey?: string;
    inputMapping?: Record<string, string>;
}

export interface ContinuationPlan {
    steps: ContinuationStep[];
    currentStepIndex: number;
    strategy: 'sequential' | 'parallel' | 'conditional';
}

export class ContinuationPlanner {
    constructor(private plan: ContinuationPlan) { }

    getPlanStatusString(): string {
        let result = `[CONTINUATION PLAN — Step ${this.plan.currentStepIndex + 1}/${this.plan.steps.length}]\n`;
        for (const step of this.plan.steps) {
            const getIcon = (status: string) => {
                switch (status) {
                    case 'done': return '✅';
                    case 'running': return '▶';
                    case 'failed': return '❌';
                    case 'skipped': return '⏭';
                    default: return '⏳';
                }
            };

            const statusText = step.status === 'pending' && step.dependsOn.length > 0
                ? `Waiting on Step ${step.dependsOn.join(', ')}`
                : step.status.charAt(0).toUpperCase() + step.status.slice(1);

            result += `${getIcon(step.status)} Step ${step.stepId} (${step.toolName}): ${statusText}\n`;
        }
        return result;
    }
}
