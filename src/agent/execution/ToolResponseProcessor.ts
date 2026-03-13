import { IToolResponseProcessor, ToolResponseEvaluation, IToolDefinition } from '../../types/index.js';

/**
 * Configuration for `ToolResponseProcessor`.
 *
 * Token thresholds define the boundaries between size classes.
 * `budgetPercent` caps the combined token spend of all tool results per iteration.
 */
export interface ToolResponseProcessorConfig {
    /** Max tokens for a `small` response. Responses at or below this are verbatim. Default: 200 */
    smallMaxTokens?: number;
    /** Max tokens for a `medium` response. Responses at or below this are verbatim. Default: 800 */
    mediumMaxTokens?: number;
    /** Max tokens for a `large` response. Above this threshold → `oversized`. Default: 2000 */
    largeMaxTokens?: number;
    /**
     * Cap total tool-response tokens per iteration as a fraction of session `maxTokens`.
     * E.g. `0.15` means all tool results combined must fit within 15% of the context window.
     * Not enforced by the processor itself — SessionManager uses this to decide when to
     * apply extra compression after all tool results are collected. Default: undefined (no cap).
     */
    budgetPercent?: number;
}

/**
 * Evaluates and compresses tool response strings before they are appended to the
 * context window, preventing large tool outputs from flooding the token budget.
 *
 * @example
 * ```typescript
 * toolResponseProcessor: new ToolResponseProcessor({
 *   smallMaxTokens:  200,
 *   mediumMaxTokens: 800,
 *   largeMaxTokens:  2000,
 *   budgetPercent:   0.15,
 * })
 * ```
 */
export class ToolResponseProcessor implements IToolResponseProcessor {
    private readonly smallMax: number;
    private readonly mediumMax: number;
    private readonly largeMax: number;
    readonly budgetPercent: number | undefined;

    constructor(config: ToolResponseProcessorConfig = {}) {
        this.smallMax = config.smallMaxTokens ?? 200;
        this.mediumMax = config.mediumMaxTokens ?? 800;
        this.largeMax = config.largeMaxTokens ?? 2000;
        this.budgetPercent = config.budgetPercent;
    }

    evaluate(response: string, tool: IToolDefinition, context: unknown): ToolResponseEvaluation {
        const estimatedTokens = response.length / 4;

        let sizeClass: ToolResponseEvaluation['sizeClass'] = 'small';
        if (estimatedTokens > this.largeMax) sizeClass = 'oversized';
        else if (estimatedTokens > this.mediumMax) sizeClass = 'large';
        else if (estimatedTokens > this.smallMax) sizeClass = 'medium';

        // Detect common soft-error patterns even when HTTP status is 200
        const lc = response.toLowerCase();
        const errorDetected =
            lc.includes('error:') ||
            lc.includes('exception:') ||
            lc.includes('"error"') ||
            lc.includes('"status":"error"') ||
            lc.includes('"status": "error"') ||
            lc.includes('failed:') ||
            lc.includes('connection refused') ||
            lc.includes('timed out');

        const suggestedAction: ToolResponseEvaluation['suggestedAction'] = errorDetected
            ? 'retry'
            : sizeClass === 'oversized' || sizeClass === 'large'
                ? 'continue'
                : 'continue';

        return {
            relevanceScore: 1.0,
            sizeClass,
            shouldCompress: sizeClass === 'large' || sizeClass === 'oversized',
            suggestedMaxTokens: this.mediumMax,
            answered: !errorDetected,
            answeredPartially: errorDetected,
            errorDetected,
            suggestedAction,
        };
    }

    compress(response: string, evaluation: ToolResponseEvaluation): string {
        if (!evaluation.shouldCompress || evaluation.errorDetected) {
            // Never drop error signals — the model must see them
            return response;
        }

        if (evaluation.sizeClass === 'oversized') {
            // Truncative: keep head (first ~4000 chars) + tail (last ~2000 chars)
            const headChars = this.largeMax * 4;         // approx chars for largeMax tokens
            const tailChars = this.mediumMax * 2;        // approx chars for half mediumMax tokens
            if (response.length > headChars + tailChars) {
                const skipped = response.length - headChars - tailChars;
                return (
                    response.slice(0, headChars) +
                    `\n\n...[${skipped} characters omitted — response too large]...\n\n` +
                    response.slice(-tailChars)
                );
            }
        }

        if (evaluation.sizeClass === 'large') {
            // Extractive: keep first N + last M lines
            const lines = response.split('\n');
            const keepLines = Math.ceil(this.mediumMax / 10); // heuristic
            if (lines.length > keepLines * 2) {
                const skipped = lines.length - keepLines * 2;
                return [
                    ...lines.slice(0, keepLines),
                    `... [${skipped} lines omitted] ...`,
                    ...lines.slice(-keepLines),
                ].join('\n');
            }
        }

        return response;
    }
}
