import { IProviderAdapter } from './adapters.js';
import { IContextStrategy } from './context.js';
import { IToolDefinition } from './tools.js';
import { ILogger } from './logger.js';
import { ISkill } from './skills.js';
import { IRAGAdapter } from './rag.js';
import { ShortTermMemoryRegistry } from '../context/ShortTermMemoryRegistry.js';
import { MCPServerConfig } from './mcp.js';
import { IScratchpadAdapter } from './storage.js';
import type { Turn } from './context.js';
import type { Goal } from '../agent/execution/GoalInjector.js';

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
     *
     * Return `'accept'` (or `true`) to allow the tool to run; return `'deny'`
     * (or `false`) to block it. The decision is **fail-safe**: only an explicit
     * accept signal allows execution — any other value (`'deny'`, `false`,
     * `undefined`, `null`, a thrown error) blocks the tool. If `onAsk` is
     * omitted entirely, an `'ask'` decision behaves like `'deny'`.
     */
    onAsk?: (
        toolName: string,
        argsJson: string
    ) =>
        | Promise<'accept' | 'deny' | boolean | void>
        | 'accept'
        | 'deny'
        | boolean
        | void;
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

/**
 * Result returned by a `goalVerifier` callback or the built-in `successCriteria` checker.
 *
 * @since 1.5.0
 */
export interface GoalVerifierResult {
    /** Whether the original goal was fully achieved */
    achieved: boolean;
    /**
     * When `achieved` is false, describes what is still missing.
     * This text is injected as a follow-up user message to continue the loop.
     */
    missing?: string;
    /** Short human-readable reason for the verdict — surfaced in trace events */
    reason?: string;
}

/**
 * Lightweight description of a tool category, passed to a router so it can
 * decide which categories are relevant to the current user message.
 *
 * @since 1.6.0
 */
export interface ToolCategoryInfo {
    /** The category name (matches `IToolDefinition.category`). */
    name: string;
    /** Names of the tools belonging to this category — gives the router context. */
    tools: string[];
}

/**
 * Verdict returned by a router for a single user turn.
 *
 * @since 1.6.0
 */
export interface RouterDecision {
    /**
     * `'chat'` marks a purely conversational turn — the consumer/loop should
     * skip the heavy pipeline (no tool exposure beyond always-available
     * categories, and goal planning/verification suppressed for this turn).
     * `'task'` runs the full pipeline.
     */
    mode: 'chat' | 'task';
    /**
     * Tool categories selected as relevant. Empty implies no categorized tools
     * are exposed (typical for `mode: 'chat'`). Always-available categories
     * (see `SessionConfig.alwaysAvailableCategories`) and uncategorized tools
     * are exposed regardless of this list.
     */
    categories: string[];
    /** Short human-readable reason — surfaced in trace events. */
    reason?: string;
}

/**
 * Pluggable router. Maps a user message to a {@link RouterDecision} that
 * narrows the tool surface for the turn. Supply your own, or enable the
 * built-in LLM router via `SessionConfig.enableRouting`.
 *
 * Implementations should **fail safe**: on any internal error, return
 * `{ mode: 'task', categories: <all categories> }` so the agent never loses
 * access to tools because routing hiccupped.
 *
 * @since 1.6.0
 */
export interface IRouterAdapter {
    route(
        userMessage: string,
        availableCategories: ToolCategoryInfo[]
    ): Promise<RouterDecision> | RouterDecision;
}

/** Configuration for a lemura Session */
export interface SessionConfig {
    /** The provider adapter to use */
    adapter: IProviderAdapter;
    /** Model string */
    model: string;
    /** Optional session id for scratchpad and tracing */
    sessionId?: string;
    /** Max context tokens */
    maxTokens: number;
    /** Max ReAct cycles */
    maxIterations?: number;
    /** Explicit tools */
    tools?: IToolDefinition[];
    /** Explicit skills */
    skills?: ISkill[];

    /**
     * Names of dynamic skills (those with `strategy: 'dynamic'`) to enable
     * automatically at session construction. Fixed skills are always active
     * regardless of this list.
     *
     * @since 1.4.0
     */
    activeDynamicSkills?: string[];

    /**
     * Tags used to bulk-enable dynamic skills at session construction.
     * Any dynamic skill whose `tags` array intersects with this list will be
     * activated automatically.
     *
     * @since 1.4.0
     */
    activeDynamicTags?: string[];
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
    /**
     * Enable post-run goal verification (Option A + C).
     * When true, Lemura checks whether the goal was actually achieved after each stop.
     * Requires `enableGoalPlanning` to also be true. Defaults to true.
     * @since 1.5.0
     */
    enableGoalVerification?: boolean;
    /**
     * Maximum number of goal-verification corrections per run. When verification
     * finds the response incomplete, the agent re-enters the ReAct loop (with full
     * tool access) up to this many times to actually resolve what is missing,
     * rather than emitting a tool-less one-shot rewrite. Defaults to 1.
     * Set to 0 to disable corrective re-entry (a warning is surfaced instead).
     * @since 1.5.4
     */
    maxGoalCorrections?: number;
    /**
     * When true, the agent periodically reconciles which decomposed sub-goals are
     * already complete (one small LLM call every `goalInjectionN` tool rounds) and
     * marks them done, so the re-injected goal block reflects real progress instead
     * of always showing every sub-goal as pending. Counters goal drift on long runs.
     * Defaults to false (no extra calls). Requires `enableGoalPlanning`.
     * @since 1.5.4
     */
    goalProgressReconciliation?: boolean;
    goalInjectionFrequency?: 'always' | 'every_N_turns' | 'on_compression';
    goalInjectionPosition?: 'system_prompt' | 'pre_turn';
    /** Skill budget — max tokens the skill injection block may consume */
    skillTokenBudget?: number;
    /**
     * Maximum tokens the provider may generate per completion call.
     * Defaults to 4 000 when not set. This is separate from `maxTokens`
     * which controls the total context window size.
     */
    maxCompletionTokens?: number;
    /**
     * When `goalInjectionFrequency` is `'every_N_turns'`, re-inject the goal
     * every N ReAct iterations. Default: 3.
     */
    goalInjectionN?: number;
    /** Callback for each turn in the session */
    onTurn?: (turn: any) => void;

    // STM and Limits
    /** Short Term Memory Registry */
    stmRegistry?: ShortTermMemoryRegistry;
    /** Scratchpad storage adapter */
    scratchpadAdapter?: IScratchpadAdapter;
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

    /**
     * When true, the system prompt is built once and kept identical across all
     * ReAct iterations. Dynamic content (continuation plan, per-turn goal injection)
     * is moved to the last user/tool message instead, so the KV-cache prefix is
     * never invalidated. Recommended for reasoning models and long agentic runs.
     * @default false
     */
    staticSystemPrompt?: boolean;

    /** Callback for granular trace events (planning, budgets, tools, etc.) */
    onTrace?: (event: TraceEvent) => void;

    /**
     * Optional callback invoked after the ReAct loop reaches a `stop` finish reason.
     *
     * Return `{ achieved: false, missing: '...' }` to continue the loop with the
     * missing work injected as a follow-up user message (capped at one retry).
     * Return `{ achieved: true }` to stop normally.
     *
     * Only called when `enableGoalPlanning` is `true` and a goal statement exists.
     * When omitted and `successCriteria` is non-empty, Lemura falls back to a
     * built-in LLM-based check against those criteria.
     *
     * @since 1.5.0
     * @example
     * goalVerifier: async (goal, turns) => {
     *   const last = turns.at(-1)?.content ?? '';
     *   return last.includes('DONE')
     *     ? { achieved: true }
     *     : { achieved: false, missing: 'Final DONE marker not found in output' };
     * }
     */
    goalVerifier?: (goal: Goal, turns: Turn[]) => Promise<GoalVerifierResult> | GoalVerifierResult;

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

    // ── Routing (MetaRouter) ──────────────────────────────────────────────────
    /**
     * When true, a router runs once at the start of each turn (before the ReAct
     * loop) to classify the message (`chat`/`task`) and select relevant tool
     * categories. Tools whose `category` is not selected are hidden from the
     * model for that turn — fewer, more relevant tools means less confusion and
     * lower token cost. A `chat` verdict also suppresses goal planning and
     * verification for that turn.
     *
     * If `router` is supplied it is used; otherwise lemura's built-in
     * {@link LLMRouter} is used. Defaults to false (no routing — all tools
     * always exposed, identical to pre-1.6.0 behavior).
     *
     * @since 1.6.0
     */
    enableRouting?: boolean;
    /**
     * Custom router implementation. Takes precedence over the built-in router
     * when `enableRouting` is true.
     *
     * @since 1.6.0
     */
    router?: IRouterAdapter;
    /**
     * Model used by the built-in router. Defaults to `config.model`. Point this
     * at a small/cheap model for fast, low-cost classification.
     *
     * @since 1.6.0
     */
    routerModel?: string;
    /**
     * Categories that are always exposed regardless of the router decision
     * (e.g. a scratchpad category). Uncategorized tools are also always exposed.
     *
     * @since 1.6.0
     */
    alwaysAvailableCategories?: string[];
}

/** Rich trace event for observability */
export interface TraceEvent {
    sessionId?: string;
    type: 'planning' | 'budget' | 'tool_call' | 'tool_result' | 'thinking' | 'system' | 'compression' | 'error' | 'skill' | 'verification' | 'routing';
    name: string;
    input?: any;
    output?: any;
    durationMs?: number;
    startedAt?: number;
    status?: 'running' | 'done' | 'error';
    metadata?: Record<string, any>;
}
