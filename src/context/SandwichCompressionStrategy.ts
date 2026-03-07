import { ContextWindow, IContextStrategy, IProviderAdapter, Turn } from '../types/index.js';

export interface SandwichCompressionConfig {
    preserveFirst: number;
    preserveLast: number;
    triggerThreshold: number; // e.g. 0.8
}

/**
 * Sandwich compression preserves the beginning and end of the conversation,
 * replacing the middle with a generated summary.
 */
export class SandwichCompressionStrategy implements IContextStrategy {
    readonly name = 'sandwich_compression';
    readonly priority = 20;

    constructor(
        private adapter: IProviderAdapter,
        private config: SandwichCompressionConfig
    ) { }

    shouldApply(ctx: ContextWindow): boolean {
        return (
            ctx.tokenCount >= ctx.maxTokens * this.config.triggerThreshold &&
            ctx.turns.length > this.config.preserveFirst + this.config.preserveLast
        );
    }

    async apply(ctx: ContextWindow): Promise<ContextWindow> {
        const { preserveFirst, preserveLast } = this.config;

        const head = ctx.turns.slice(0, preserveFirst);
        const tail = ctx.turns.slice(ctx.turns.length - preserveLast);
        const middle = ctx.turns.slice(preserveFirst, ctx.turns.length - preserveLast);

        const middleText = middle.map(t => `${t.role}: ${JSON.stringify(t.content)}`).join('\n');

        const summaryResponse = await this.adapter.complete({
            model: '',
            messages: [{
                role: 'user',
                content: `Summarize the following conversation history briefly:\n${middleText}`
            }]
        });

        const summaryStr = summaryResponse.content;

        const newCompressionSummary = ctx.compressionSummary
            ? `${ctx.compressionSummary}\n${summaryStr}`
            : summaryStr;

        const summaryTurn: Turn = {
            role: 'system',
            content: `[COMPRESSED HISTORY SUMMARY]\n${newCompressionSummary}`,
            tokenCount: this.adapter.estimateTokens(newCompressionSummary),
            turnIndex: -1,
            compressed: true,
        };

        const newTurns = [...head, summaryTurn, ...tail];
        const newTokenCount = newTurns.reduce((sum, t) => sum + t.tokenCount, 0) +
            this.adapter.estimateTokens(ctx.systemPrompt) +
            this.adapter.estimateTokens(ctx.scratchpad);

        return {
            ...ctx,
            turns: newTurns,
            tokenCount: newTokenCount,
            compressionSummary: newCompressionSummary,
        };
    }

    /**
     * Applies sandwich compression specifically to a Short Term Memory item's content.
     * Implements a 3-layer pipeline: Pre-Layer (encoding), Core Layer (dense summary), Post-Layer (refinement cues).
     * 
     * @param content - The heavy text content to compress
     * @param instructions - Guiding instructions for the core layer summary
     * @returns The three-layer sandwich result
     */
    async compressMemoryItem(content: string, instructions: string = 'Extract the key information'): Promise<{
        preLayer: string;
        coreLayer: string;
        postLayer: string;
    }> {
        // Pre-Layer: Chunking and initial encoding
        // Here we do a naive encoding representation to signify the pre-processed chunks
        const estimatedChunks = Math.max(1, Math.ceil(this.adapter.estimateTokens(content) / 2000));
        const preLayer = `[PRE-LAYER ENCODED: ${estimatedChunks} internal chunks]`;

        // Core Layer: Dense summary sandwich with instructions
        // We sandwich the content between the instructions to guide extraction
        // If content is extremely large, we might trim it here, but ideally the provider streaming handles it.
        const summaryResponse = await this.adapter.complete({
            model: '',
            messages: [{
                role: 'user',
                content: `### INSTRUCTIONS ###\n${instructions}\n\n### CONTENT ###\n${content}\n\n### INSTRUCTIONS ###\n${instructions}`
            }]
        });
        const coreLayer = summaryResponse.content;

        // Post-Layer: Decoding/Refinement hooks
        // Indicates that the LLM can use tools to drill down into specific chunks
        const postLayer = `[POST-LAYER DECODING: Use \`refine_layer\` or \`read_chunk\` tools to expand specific sections]`;

        return { preLayer, coreLayer, postLayer };
    }
}
