import { IProviderAdapter } from './adapters.js';
import { IContextStrategy } from './context.js';
import { IToolDefinition } from './tools.js';
import { ILogger } from './logger.js';
import { ISkill } from './skills.js';
import { IRAGAdapter } from './rag.js';
import { ShortTermMemoryRegistry } from '../context/ShortTermMemoryRegistry.js';
import { MCPServerConfig } from './mcp.js';

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

export interface MediaConfig {
    enableTools?: boolean;
    toolPrefix?: string;
}

export type ToolDecision = 'accept' | 'deny' | 'ask';

export interface ToolFirewallRule {
    /** Regex pattern matched against the tool name */
    name?: string;
    /** Regex pattern matched against the serialised arguments JSON */
    arguments?: string;
    /** Decision to apply when this rule matches */
    decision: ToolDecision;
    /** Human-readable reason surfaced to the agent when blocked */
    reason?: string;
}

export interface ToolFirewallConfig {
    /** Decision applied when no rule matches. Defaults to 'ask'. */
    defaultDecision?: ToolDecision;
    /** Ordered list of firewall rules — first match wins */
    rules?: ToolFirewallRule[];
    /**
     * Called when a tool hits the 'ask' decision.
     * Return 'accept' or 'deny'. If omitted, 'ask' behaves like 'deny'.
     */
    onAsk?: (toolName: string, argsJson: string) => Promise<'accept' | 'deny'> | 'accept' | 'deny';
}

/**
 * Execution budget constraints for tool calls within a session.
 *
 * @example
 * toolExecutionBudget: {
 *   maxCallsPerSession: 50,
 *   maxCallsPerTool: { search_web: 10 },
 *   maxConcurrentCalls: 4,
 * }
 */
export interface ToolExecutionBudget {
    /** Maximum total tool calls allowed for the entire session */
    maxCallsPerSession?: number;
    /** Maximum calls per named tool within the session */
    maxCallsPerTool?: Record<string, number>;
    /** Maximum simultaneous parallel tool executions (default: unlimited) */
    maxConcurrentCalls?: number;
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

    /** Media bridge config */
    media?: MediaConfig;

    /** Tool firewall config */
    toolFirewall?: ToolFirewallConfig;

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

    // Tool execution controls
    /**
     * Execution budget constraints: call quotas and concurrency cap.
     * Enforced in the ReAct loop before each tool call.
     */
    toolExecutionBudget?: ToolExecutionBudget;
    /**
     * When true, independent tool calls within a single assistant response are
     * executed in parallel using `Promise.all`. Defaults to false (sequential).
     */
    parallelToolCalls?: boolean;
    /**
     * Default timeout in ms for each tool execution.
     * Passed to `ToolRegistry`. Defaults to 30 000.
     */
    toolRegistryTimeoutMs?: number;

    /** Callback for granular trace events (planning, budgets, tools, etc.) */
    onTrace?: (event: TraceEvent) => void;

    /**
     * MCP (Model Context Protocol) server configurations.
     * Each server is connected at session construction, its tools are discovered
     * and registered alongside native tools — fully transparent to the ReAct loop.
     *
     * @example
     * mcpServers: [
     *   { name: 'github', transport: 'stdio', command: 'npx', args: ['@modelcontextprotocol/server-github'] },
     *   { name: 'db_tools', transport: 'http', url: 'http://localhost:3001' }
     * ]
     */
    mcpServers?: MCPServerConfig[];
}

/** Rich trace event for observability */
export interface TraceEvent {
    sessionId?: string;
    type: 'planning' | 'budget' | 'tool_call' | 'tool_result' | 'thinking' | 'system' | 'compression' | 'error';
    name: string;
    input?: any;
    output?: any;
    durationMs?: number;
    startedAt?: number;
    status?: 'running' | 'done' | 'error';
    metadata?: Record<string, any>;
}
