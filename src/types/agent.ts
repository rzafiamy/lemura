import { IProviderAdapter } from './adapters.js';
import { IContextStrategy } from './context.js';
import { IToolDefinition } from './tools.js';
import { ILogger } from './logger.js';
import { ISkill } from './skills.js';
import { IRAGAdapter } from './rag.js';
import { ShortTermMemoryRegistry } from '../context/ShortTermMemoryRegistry.js';

export interface ToolResponseEvaluation {
    relevanceScore: number;
    sizeClass: 'small' | 'medium' | 'large' | 'oversized';
    shouldCompress: boolean;
    suggestedMaxTokens: number;
    answered: boolean;
    answeredPartially: boolean;
    errorDetected: boolean;
    suggestedAction: 'continue' | 'retry' | 'retry_with_params' | 'skip' | 'escalate';
}

export interface IToolResponseProcessor {
    evaluate(response: string, tool: IToolDefinition, context: unknown): ToolResponseEvaluation;
    compress(response: string, evaluation: ToolResponseEvaluation): string;
}

/** Configuration for a lemura Session */
export interface SessionConfig {
    /** The provider adapter to use */
    adapter: IProviderAdapter;
    /** Model string */
    model: string;
    /** Max context tokens */
    maxTokens: number;
    /** Max ReAct cycles */
    maxIterations?: number;
    /** Explicit tools */
    tools?: IToolDefinition[];
    /** Explicit skills */
    skills?: ISkill[];
    /** RAG adapter */
    ragAdapter?: IRAGAdapter;
    /** Context compression strategies */
    compressionStrategies?: IContextStrategy[];
    /** System prompt base */
    systemPrompt?: string;
    /** Logger */
    logger?: ILogger;

    // Advanced execution config
    /** Budget for tool responses before compression */
    toolResponseTokenBudget?: number;
    /** Processor for tool responses */
    toolResponseProcessor?: IToolResponseProcessor;
    /** Max single steps (tool calls) */
    maxSteps?: number;
    /** Enable tool continuation planning */
    enableContinuationPlanning?: boolean;
    continuationStrategy?: 'sequential' | 'parallel' | 'conditional';
    /** Enable goal planning */
    enableGoalPlanning?: boolean;
    goalInjectionFrequency?: 'always' | 'every_N_turns' | 'on_compression';
    goalInjectionPosition?: 'system_prompt' | 'pre_turn';
    /** Skill budget */
    skillTokenBudget?: number;
    /** Callback for each turn in the session */
    onTurn?: (turn: any) => void;

    // STM and Limits
    /** Short Term Memory Registry */
    stmRegistry?: ShortTermMemoryRegistry;
    /** Max tokens allowed for a single tool response */
    maxTokensPerTool?: number;
}
