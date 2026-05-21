/**
 * An optional condition that gates a step's execution on the output of a prior step.
 * When the condition is not met, the step is automatically marked `skipped`.
 */
export interface StepCondition {
    /** stepId whose output is inspected */
    step: string;
    /** Substring that must be present in the prior step's output to allow this step to run */
    outputContains: string;
}

/**
 * Result returned by a `StepVerifier.check` function.
 * - `pass`  — the sub-goal is achieved; the step is marked `done`.
 * - `fail`  — the sub-goal failed; the step is marked `failed` and BFS propagates to dependants.
 * - `retry` — the output is unsatisfactory but retriable; the step is reset to `pending`.
 */
export interface StepVerifierResult {
    status: 'pass' | 'fail' | 'retry';
    reason?: string;
}

/**
 * Optional semantic verifier attached to a `ContinuationStep`.
 * Called after the tool executes successfully to confirm the sub-goal is actually met.
 *
 * @example
 * verify: {
 *   maxRetries: 2,
 *   check: (output) => {
 *     const data = JSON.parse(output);
 *     return data.rows?.length > 0
 *       ? { status: 'pass' }
 *       : { status: 'retry', reason: 'Empty result set' };
 *   }
 * }
 */
export interface StepVerifier {
    /**
     * Inspects the tool output and decides whether the sub-goal is satisfied.
     * @param output  - Serialised tool result string
     * @param args    - The resolved arguments that were passed to the tool
     */
    check: (output: string, args: Record<string, unknown>) => Promise<StepVerifierResult> | StepVerifierResult;
    /**
     * Maximum number of `retry` verdicts allowed before the step is forced to `failed`.
     * Defaults to 0 (no retries — a `retry` verdict immediately becomes `failed`).
     */
    maxRetries?: number;
}

export interface ContinuationStep {
    stepId: string;
    toolName: string;
    description: string;
    /** stepIds that must be `done` before this step may run */
    dependsOn: string[];
    status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
    /**
     * When provided, the step's output is stored under this key in
     * `context.metadata['toolOutputs']` for downstream steps to reference.
     */
    outputKey?: string;
    /**
     * Maps prior step `outputKey` values to this step's tool parameter names.
     * E.g. `{ data: 'rawData' }` means the tool's `data` param gets the value
     * stored under the `rawData` output key from an earlier step.
     */
    inputMapping?: Record<string, string>;
    /**
     * Optional condition: the step only runs if the referenced prior step's output
     * contains the given substring. When the condition is not met, the step is skipped.
     */
    condition?: StepCondition;
    /**
     * Optional semantic verifier: called after the tool executes to confirm the
     * sub-goal is actually satisfied. Supports `pass / fail / retry` verdicts
     * with a configurable `maxRetries` count.
     *
     * @since 1.4.4
     */
    verify?: StepVerifier;
}

export interface ContinuationPlan {
    steps: ContinuationStep[];
    currentStepIndex: number;
    strategy: 'sequential' | 'parallel' | 'conditional';
}

/**
 * Manages a structured multi-step continuation plan for the ReAct loop.
 *
 * Steps are tracked by status (`pending`, `running`, `done`, `failed`, `skipped`).
 * Dependency failures automatically propagate `skipped` to all downstream steps.
 * Step outputs are stored by `outputKey` and made available for `inputMapping`.
 *
 * @example
 * ```typescript
 * const planner = new ContinuationPlanner({
 *   steps: [
 *     { stepId: 'fetch', toolName: 'fetch_data', description: 'Get raw data', dependsOn: [], outputKey: 'rawData' },
 *     { stepId: 'analyze', toolName: 'analyze', description: 'Run analysis', dependsOn: ['fetch'], inputMapping: { data: 'rawData' } },
 *   ],
 *   currentStepIndex: 0,
 *   strategy: 'sequential',
 * });
 * ```
 */
export class ContinuationPlanner {
    private plan: ContinuationPlan;
    private outputs: Map<string, string> = new Map();
    private retryCount: Map<string, number> = new Map();
    private onStepSkipped: ((stepId: string, reason: string) => void) | undefined;
    private onStepFailed: ((stepId: string, reason: string) => void) | undefined;

    constructor(
        plan: ContinuationPlan,
        callbacks?: {
            onStepSkipped?: (stepId: string, reason: string) => void;
            onStepFailed?: (stepId: string, reason: string) => void;
        }
    ) {
        this.plan = { ...plan, steps: plan.steps.map(s => ({ ...s })) };
        this.onStepSkipped = callbacks?.onStepSkipped;
        this.onStepFailed = callbacks?.onStepFailed;
    }

    // -------------------------------------------------------------------------
    // State queries
    // -------------------------------------------------------------------------

    /** Returns the current plan (deep copy) */
    getPlan(): ContinuationPlan {
        return { ...this.plan, steps: this.plan.steps.map(s => ({ ...s })) };
    }

    /** Returns a human-readable status string with icons (injected before each iteration) */
    getPlanStatusString(): string {
        let result = `[CONTINUATION PLAN — Step ${this.plan.currentStepIndex + 1}/${this.plan.steps.length}]\n`;
        for (const step of this.plan.steps) {
            const icon = this._icon(step.status);
            const statusText = step.status === 'pending' && step.dependsOn.length > 0
                ? `Waiting on Step ${step.dependsOn.join(', ')}`
                : step.status.charAt(0).toUpperCase() + step.status.slice(1);
            result += `${icon} Step ${step.stepId} (${step.toolName}): ${statusText}\n`;
        }
        return result;
    }

    private _icon(status: ContinuationStep['status']): string {
        switch (status) {
            case 'done': return '✅';
            case 'running': return '▶';
            case 'failed': return '❌';
            case 'skipped': return '⏭';
            default: return '⏳';
        }
    }

    /** Returns all steps whose dependencies are satisfied and that are still pending */
    getReadySteps(): ContinuationStep[] {
        return this.plan.steps.filter(step => {
            if (step.status !== 'pending') return false;

            // All dependencies must be done
            const depsOk = step.dependsOn.every(depId => {
                const dep = this.plan.steps.find(s => s.stepId === depId);
                return dep?.status === 'done';
            });
            if (!depsOk) return false;

            // Evaluate optional condition
            if (step.condition) {
                const condDepOutput = this.outputs.get(step.condition.step) ?? '';
                if (!condDepOutput.includes(step.condition.outputContains)) {
                    return false;
                }
            }

            return true;
        });
    }

    /** Returns true when all steps have reached a terminal state */
    isComplete(): boolean {
        return this.plan.steps.every(
            s => s.status === 'done' || s.status === 'failed' || s.status === 'skipped'
        );
    }

    // -------------------------------------------------------------------------
    // State mutations
    // -------------------------------------------------------------------------

    /** Marks a step as running */
    markStepRunning(stepId: string): void {
        this._updateStep(stepId, { status: 'running' });
    }

    /**
     * Marks a step as done, stores its output under `outputKey` (if set),
     * and advances `currentStepIndex` to the next pending step.
     */
    markStepDone(stepId: string, output?: string): void {
        const step = this.plan.steps.find(s => s.stepId === stepId);
        if (step?.outputKey && output !== undefined) {
            this.outputs.set(step.outputKey, output);
        }
        this._updateStep(stepId, { status: 'done' });
        this._advanceIndex();
    }

    /**
     * Marks a step as failed and propagates `skipped` to all transitively dependent steps.
     */
    markStepFailed(stepId: string, reason = 'step failed'): void {
        this._updateStep(stepId, { status: 'failed' });
        this.onStepFailed?.(stepId, reason);
        this._skipDependants(stepId);
    }

    /**
     * Marks a step as skipped (e.g., condition not met) and propagates to its dependants.
     */
    markStepSkipped(stepId: string, reason = 'condition not met'): void {
        this._updateStep(stepId, { status: 'skipped' });
        this.onStepSkipped?.(stepId, reason);
        this._skipDependants(stepId);
    }

    /**
     * Resets a step back to `pending` for a retry attempt.
     * Increments the internal retry counter for the step.
     */
    markStepPending(stepId: string): void {
        this._updateStep(stepId, { status: 'pending' });
        this.retryCount.set(stepId, (this.retryCount.get(stepId) ?? 0) + 1);
    }

    /** Returns how many times a step has been retried. */
    getRetryCount(stepId: string): number {
        return this.retryCount.get(stepId) ?? 0;
    }

    // -------------------------------------------------------------------------
    // Output / input mapping helpers
    // -------------------------------------------------------------------------

    /** Retrieves an output stored by `outputKey` from a completed step */
    getOutput(key: string): string | undefined {
        return this.outputs.get(key);
    }

    /**
     * Resolves the `inputMapping` for a step into a concrete parameter map,
     * substituting `outputKey` values from prior steps. Static (non-key) values
     * in the mapping are passed through unchanged.
     */
    resolveInputs(step: ContinuationStep, baseArgs: Record<string, unknown> = {}): Record<string, unknown> {
        if (!step.inputMapping) return baseArgs;

        const resolved: Record<string, unknown> = { ...baseArgs };
        for (const [paramName, outputKey] of Object.entries(step.inputMapping)) {
            const value = this.outputs.get(outputKey);
            // Only substitute if we have a stored output for this key
            if (value !== undefined) {
                resolved[paramName] = value;
            } else {
                // Treat as a static value (e.g. quarter: 'Q4 2025')
                resolved[paramName] = outputKey;
            }
        }
        return resolved;
    }

    // -------------------------------------------------------------------------
    // Internals
    // -------------------------------------------------------------------------

    private _updateStep(stepId: string, patch: Partial<ContinuationStep>): void {
        this.plan.steps = this.plan.steps.map(s =>
            s.stepId === stepId ? { ...s, ...patch } : s
        );
    }

    private _skipDependants(failedStepId: string): void {
        // BFS / iterative propagation of skipped status
        const toSkip = new Set<string>([failedStepId]);
        let changed = true;
        while (changed) {
            changed = false;
            for (const step of this.plan.steps) {
                if (step.status === 'pending' && step.dependsOn.some(d => toSkip.has(d))) {
                    this._updateStep(step.stepId, { status: 'skipped' });
                    this.onStepSkipped?.(step.stepId, `dependency '${failedStepId}' failed or was skipped`);
                    toSkip.add(step.stepId);
                    changed = true;
                }
            }
        }
    }

    private _advanceIndex(): void {
        const nextPending = this.plan.steps.findIndex(
            (s, i) => i > this.plan.currentStepIndex && s.status === 'pending'
        );
        if (nextPending !== -1) {
            this.plan.currentStepIndex = nextPending;
        }
    }
}
