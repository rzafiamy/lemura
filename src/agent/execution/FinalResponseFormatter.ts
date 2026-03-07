export class FinalResponseFormatter {
    static getRequiredStructure(): string {
        return `## Goal Status: [ACHIEVED | PARTIALLY_ACHIEVED | FAILED]

### What was accomplished
[Summary of completed work]

### Remaining tasks
[Bulleted list, or "None"]

### Failed steps
[Tool/step name + error context, or "None"]

### Result
[The actual answer or deliverable]`;
    }

    static validateStructure(response: string): boolean {
        // Very basic validation heuristics
        if (!response.includes('## Goal Status:')) return false;
        if (!response.includes('### What was accomplished')) return false;
        if (!response.includes('### Remaining tasks')) return false;
        if (!response.includes('### Failed steps')) return false;
        if (!response.includes('### Result')) return false;
        return true;
    }
}
