export class StepCounter {
    private toolCallCount: number = 0;

    constructor(private maxSteps: number = 20) { }

    increment(count: number = 1): void {
        this.toolCallCount += count;
    }

    get count(): number {
        return this.toolCallCount;
    }

    isMaxReached(): boolean {
        return this.toolCallCount >= this.maxSteps;
    }

    getForcedConclusionPrompt(): string {
        return `You have used ${this.toolCallCount}/${this.maxSteps} steps. Provide your final response now.\nDo not call any more tools. Use the required structure below.`;
    }
}
