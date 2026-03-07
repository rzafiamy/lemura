import { IToolResponseProcessor, ToolResponseEvaluation, IToolDefinition } from '../../types/index.js';

/**
 * Advanced Execution: ToolResponseProcessor handles compression
 * and evaluation of tool outputs, flagging errors, mapping tool size classes
 * and compressing large responses to save token bandwidth.
 */
export class ToolResponseProcessor implements IToolResponseProcessor {

    evaluate(response: string, tool: IToolDefinition, context: unknown): ToolResponseEvaluation {
        const length = response.length;
        // Approximating tokens (length / 4)
        const estimatedTokens = length / 4;

        let sizeClass: ToolResponseEvaluation['sizeClass'] = 'small';
        if (estimatedTokens > 2000) sizeClass = 'oversized';
        else if (estimatedTokens > 800) sizeClass = 'large';
        else if (estimatedTokens > 200) sizeClass = 'medium';

        return {
            relevanceScore: 1.0,
            sizeClass,
            shouldCompress: sizeClass === 'large' || sizeClass === 'oversized',
            suggestedMaxTokens: 500,
            answered: true,
            answeredPartially: false,
            errorDetected: response.toLowerCase().includes('error'),
            suggestedAction: 'continue'
        };
    }

    compress(response: string, evaluation: ToolResponseEvaluation): string {
        if (!evaluation.shouldCompress || evaluation.errorDetected) {
            return response;
        }

        // Very basic extactive/truncative compression: Return first 1000 characters and note truncation.
        if (response.length > 1000) {
            return response.substring(0, 1000) + '\n...[COMPRESSED TO SAVE TOKENS]...';
        }

        return response;
    }
}
