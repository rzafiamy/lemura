import {
    SessionConfig,
    ContextWindow,
    IProviderAdapter,
    ContentBlock,
    Turn,
    ILogger,
    IToolDefinition,
    NormalizedMessage,
    ToolCall,
    TraceEvent,
    GoalVerifierResult,
    IRouterAdapter,
    RouterDecision,
    ToolCategoryInfo
} from '../types/index.js';
import { ContextManager } from '../context/ContextManager.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import { SkillInjector } from '../skills/SkillInjector.js';
import { LemuraMaxIterationsError, LemuraToolTimeoutError } from '../types/index.js';
import { DefaultLogger } from '../logger/DefaultLogger.js';
import {
    readChunkTool,
    searchChunkTool,
    listChunksTool,
    updateChunkTool,
    readScratchpadTool,
    writeScratchpadTool,
    removeScratchpadTool,
    summarizeSandwichTool
} from '../tools/builtin/short_term_memory.js';
import { createMediaTools } from '../tools/builtin/media.js';
import { createLoadSkillTool, LOAD_SKILL_TOOL_NAME } from '../tools/builtin/load_skill.js';
import { createMemoryTools, MEMORY_TOOL_NAMES } from '../tools/builtin/memory.js';
import { MemoryManager } from '../memory/MemoryManager.js';
import { MemoryInjectionStrategy } from '../memory/MemoryInjectionStrategy.js';
import { MediaBridge } from '../media/MediaBridge.js';
import { evaluateToolFirewall } from '../tools/ToolFirewall.js';
import { StepCounter } from './execution/StepCounter.js';
import { FinalResponseFormatter } from './execution/FinalResponseFormatter.js';
import { ToolResponseProcessor } from './execution/ToolResponseProcessor.js';
import { Goal, GoalInjector } from './execution/GoalInjector.js';
import { ContinuationPlanner, ContinuationPlan, ContinuationStep } from './execution/ContinuationPlanner.js';
import { LLMRouter } from './execution/Router.js';
import { MCPClientRegistry } from '../mcp/MCPClientRegistry.js';

/**
 * Core entry point for lemura agent sessions.
 *
 * `SessionManager` owns the full ReAct loop lifecycle:
 * - Context window management and compression
 * - Skill injection (with optional token budget)
 * - Tool firewall + schema validation + timeout enforcement
 * - Parallel tool execution (opt-in via `parallelToolCalls`)
 * - maxSteps guard → forced graceful conclusion
 * - Tool response compression (via `ToolResponseProcessor`)
 * - Goal injection + mini-planning step (via `enableGoalPlanning`)
 * - Continuation planning with dependency tracking (via `enableContinuationPlanning`)
 * - Streaming output (`stream()`)
 * - Session lifecycle: `reset()`, `close()`
 *
 * @example
 * ```typescript
 * const session = new SessionManager({ adapter, model: 'gpt-4o', maxTokens: 16_000 });
 * const answer = await session.run('What is the capital of France?');
 * ```
 */
export class SessionManager {
    private contextManager: ContextManager;
    private toolRegistry: ToolRegistry;
    private skillInjector: SkillInjector;
    /** True when any registered skill uses `strategy: 'progressive'`. */
    private hasProgressiveSkills: boolean = false;
    private context: ContextWindow;
    private adapter: IProviderAdapter;
    private config: SessionConfig;
    private iterations: number = 0;
    private logger: ILogger;
    private media: MediaBridge;
    private sessionId: string;
    private scratchpadLoaded: boolean = false;
    private pendingScratchpadClear: boolean = false;

    // Advanced execution state
    private stepCounter: StepCounter;
    private toolResponseProcessor: ToolResponseProcessor;
    private goalInjector: GoalInjector | null = null;
    private continuationPlanner: ContinuationPlanner | null = null;
    private router: IRouterAdapter | null = null;
    /** Long-term memory orchestrator — present when `config.memory` is set. @since 1.8.0 */
    private memoryManager: MemoryManager | null = null;
    /**
     * Tool categories selected by the router for the current turn, or `null` when
     * routing is disabled / not yet run. When non-null, only tools whose
     * `category` is in this set (plus always-available + uncategorized tools) are
     * exposed to the model.
     */
    private routedCategories: Set<string> | null = null;
    /** Frozen goal/plan injection text keyed by turn index — used when staticSystemPrompt is on */
    private _turnInjections: Map<number, string> = new Map();

    // MCP
    private mcpRegistry: MCPClientRegistry | null = null;
    /** Resolves when all MCP servers are connected; awaited by run() and stream() */
    private mcpReady: Promise<void> | null = null;

    // Tool execution budget tracking
    private totalToolCallCount: number = 0;
    private perToolCallCount: Map<string, number> = new Map();
    private totalTokens: number = 0;

    constructor(config: SessionConfig) {
        this.config = config;
        this.adapter = config.adapter;
        this.logger = config.logger || new DefaultLogger();
        this.sessionId = config.sessionId || 'default';
        this.contextManager = new ContextManager();
        this.toolRegistry = new ToolRegistry(config.tools || [], {
            defaultTimeoutMs: config.toolRegistryTimeoutMs ?? 30_000
        });
        this.skillInjector = new SkillInjector(config.skills || []);

        // Apply dynamic skill selectors from config
        if (config.activeDynamicSkills && config.activeDynamicSkills.length > 0) {
            for (const name of config.activeDynamicSkills) {
                this.skillInjector.enableSkill(name);
            }
        }
        if (config.activeDynamicTags && config.activeDynamicTags.length > 0) {
            this.skillInjector.enableByTags(config.activeDynamicTags);
        }

        this.media = new MediaBridge(this.adapter);

        // maxSteps guard (default 20)
        this.stepCounter = new StepCounter(config.maxSteps ?? 20);

        // Warn when maxSteps is explicitly set but maxIterations is not —
        // the default maxIterations=10 will stop the loop before maxSteps is reached
        // if the agent averages more than 1 tool call per iteration.
        if (config.maxSteps !== undefined && config.maxIterations === undefined) {
            const defaultMaxIts = 10;
            if (config.maxSteps > defaultMaxIts) {
                this.logger.warn(
                    `[Config] maxSteps=${config.maxSteps} is set but maxIterations is not. ` +
                    `The default maxIterations=${defaultMaxIts} may stop the agent before maxSteps is reached. ` +
                    `Consider setting maxIterations to at least Math.ceil(maxSteps / avgToolCallsPerTurn).`
                );
            }
        }

        // Warn when maxSteps is unreachably large compared to maxIterations
        if (config.maxSteps !== undefined && config.maxIterations !== undefined) {
            if (config.maxSteps > config.maxIterations * 10) {
                this.logger.warn(
                    `[Config] maxSteps (${config.maxSteps}) is much larger than maxIterations (${config.maxIterations}). ` +
                    `The agent will be stopped by maxIterations before maxSteps is ever reached.`
                );
            }
        }

        // Tool response processor — accept custom instance or build from config
        this.toolResponseProcessor = (config.toolResponseProcessor instanceof ToolResponseProcessor
            ? config.toolResponseProcessor
            : config.toolResponseProcessor
                ? config.toolResponseProcessor as unknown as ToolResponseProcessor
                : new ToolResponseProcessor()) as ToolResponseProcessor;

        for (const strategy of config.compressionStrategies || []) {
            this.contextManager.registerStrategy(strategy);
        }

        // Router (MetaRouter) — custom takes precedence over the built-in LLM router.
        if (config.enableRouting) {
            this.router = config.router ?? new LLMRouter({
                adapter: this.adapter,
                model: config.routerModel ?? config.model,
                logger: this.logger,
            });
        }

        // Register STM and Scratchpad tools if registry is provided
        if (config.stmRegistry) {
            this.toolRegistry.register(readChunkTool);
            this.toolRegistry.register(searchChunkTool);
            this.toolRegistry.register(listChunksTool);
            this.toolRegistry.register(updateChunkTool);
            this.toolRegistry.register(readScratchpadTool);
            this.toolRegistry.register(writeScratchpadTool);
            this.toolRegistry.register(removeScratchpadTool);
            this.toolRegistry.register(summarizeSandwichTool);
        }

        if (config.media?.enableTools) {
            const prefix = config.media.toolPrefix || 'media_';
            for (const tool of createMediaTools(prefix)) {
                this.toolRegistry.register(tool);
            }
        }

        // Long-term memory: build the orchestrator, register the budget-aware recall
        // strategy, and register the remember/recall/forget builtin tools. All opt-in —
        // skipped entirely when config.memory is absent (identical to pre-1.8.0).
        if (config.memory) {
            this.memoryManager = new MemoryManager({
                store: config.memory.store,
                ...(config.memory.scorer ? { scorer: config.memory.scorer } : {}),
                adapter: this.adapter,
                model: config.model,
                logger: this.logger,
                ...(config.memory.scope !== undefined ? { scope: config.memory.scope } : {}),
                ...(config.memory.weights ? { weights: config.memory.weights } : {}),
                ...(config.memory.recencyHalfLifeMs !== undefined
                    ? { recencyHalfLifeMs: config.memory.recencyHalfLifeMs }
                    : {}),
                ...(config.memory.recallTopK !== undefined ? { recallTopK: config.memory.recallTopK } : {}),
                ...(config.memory.minScore !== undefined ? { minScore: config.memory.minScore } : {}),
                ...(config.memory.consolidateEvery !== undefined
                    ? { consolidateEvery: config.memory.consolidateEvery }
                    : {}),
                onTrace: (name, metadata) => this.emitTrace('memory', name, metadata),
            });

            this.contextManager.registerStrategy(
                new MemoryInjectionStrategy(this.memoryManager, {
                    priority: config.memory.injectionPriority ?? 2,
                    ...(config.memory.injectionLabel ? { label: config.memory.injectionLabel } : {}),
                    ...(config.memory.recallTokenBudget !== undefined
                        ? { tokenBudget: config.memory.recallTokenBudget }
                        : {}),
                    estimateTokens: (t: string) => this.adapter.estimateTokens(t),
                })
            );

            for (const tool of createMemoryTools()) {
                this.toolRegistry.register(tool);
            }
        }

        // Progressive (model-driven) skills: when present, register the built-in
        // load_skill tool and append the catalog to the system prompt. The host
        // wires nothing — the agent selects skills from the catalog itself.
        this.hasProgressiveSkills = this.skillInjector.getProgressiveSkills().length > 0;
        if (this.hasProgressiveSkills) {
            this.toolRegistry.register(
                createLoadSkillTool(
                    this.skillInjector,
                    config.skillSelection,
                    // Trace the model's selection decision as a first-class skill event.
                    (name) => this.emitTrace('skill', 'skill_enable', { name, source: 'load_skill' })
                )
            );
        }

        this.context = {
            systemPrompt: config.systemPrompt || '',
            scratchpad: '',
            turns: [],
            tokenCount: 0,
            maxTokens: config.maxTokens,
            metadata: {}
        };

        // MCP server setup (non-blocking — tools are registered before first run())
        if (config.mcpServers && config.mcpServers.length > 0) {
            this.mcpRegistry = new MCPClientRegistry(this.logger);
            this.mcpReady = this._initMCP(config.mcpServers);
        }

        // Emit initial system trace
        const activeSkills = this.skillInjector.getActiveSkills();
        this.emitTrace('system', 'session_init', {
            config: {
                model: this.config.model,
                maxIterations: this.config.maxIterations,
                maxSteps: this.config.maxSteps,
                parallelToolCalls: this.config.parallelToolCalls,
                enableGoalPlanning: this.config.enableGoalPlanning,
                enableContinuationPlanning: this.config.enableContinuationPlanning
            },
            skills: {
                total: (config.skills || []).length,
                active: activeSkills.length,
                fixed: activeSkills.filter(s => s.strategy === 'fixed' || s.strategy === undefined).length,
                dynamic: activeSkills.filter(s => s.strategy === 'dynamic').length,
                progressive: this.skillInjector.getProgressiveSkills().length,
            }
        });

        // Emit per-skill load traces for EVERY registered skill (not just active),
        // so progressive/dynamic skills — which start inactive — are visible in the
        // trace stream from session init. `enabled` reflects current activation.
        for (const skill of this.skillInjector.getAll()) {
            this.emitTrace('skill', 'skill_load', {
                name: skill.name,
                version: skill.version,
                strategy: skill.strategy ?? 'fixed',
                inject: skill.inject,
                priority: skill.priority,
                tags: skill.tags ?? [],
                requiredTools: skill.requiredTools ?? [],
                enabled: skill.enabled === true,
            });
        }
    }

    // -----------------------------------------------------------------------
    // Trace helper
    // -----------------------------------------------------------------------

    private emitTrace(
        type: TraceEvent['type'],
        name: string,
        metadata?: Record<string, any>,
        input?: any,
        output?: any,
        status: 'running' | 'done' | 'error' = 'done'
    ) {
        if (this.config.onTrace) {
            this.config.onTrace({
                type,
                name,
                metadata: metadata || {},
                input,
                output,
                status,
                startedAt: Date.now()
            });
        }
    }

    private async ensureScratchpadLoaded(): Promise<void> {
        if (!this.config.scratchpadAdapter) return;
        if (this.pendingScratchpadClear) {
            await this.config.scratchpadAdapter.clear(this.sessionId);
            this.context.scratchpad = '';
            this.pendingScratchpadClear = false;
            this.scratchpadLoaded = true;
            return;
        }
        if (this.scratchpadLoaded) return;
        const stored = await this.config.scratchpadAdapter.read(this.sessionId);
        this.context.scratchpad = stored ?? '';
        this.scratchpadLoaded = true;
    }

    // -----------------------------------------------------------------------
    // Public accessors
    // -----------------------------------------------------------------------

    /** Returns a shallow copy of the current context window. */
    getContext(): ContextWindow {
        return { ...this.context };
    }

    /** Returns the current conversation history. */
    getHistory() {
        return [...this.context.turns];
    }

    /**
     * Populates the session context with a pre-existing conversation history.
     *
     * Turns are assigned sequential `turnIndex` values starting from 0 and the
     * context `tokenCount` is recalculated automatically. Call this immediately
     * after construction and before the first `run()` / `stream()`.
     *
     * @param history - Raw history entries (role + content, optional toolCalls/toolResults).
     *
     * @example
     * ```typescript
     * const session = new SessionManager(config);
     * session.loadHistory(savedMessages);
     * const answer = await session.run('Continue where we left off.');
     * ```
     */
    loadHistory(history: Array<{
        role: Turn['role'];
        content: Turn['content'];
        toolCalls?: Turn['toolCalls'];
        toolResults?: Turn['toolResults'];
    }>): void {
        this.context.turns = history.map((m, i) => ({
            role: m.role,
            content: m.content ?? '',
            tokenCount: this.adapter.estimateTokens(
                typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
            ),
            turnIndex: i,
            compressed: false,
            ...(m.toolCalls ? { toolCalls: m.toolCalls } : {}),
            ...(m.toolResults ? { toolResults: m.toolResults } : {}),
        }));
        this.context.tokenCount =
            this.context.turns.reduce((sum, t) => sum + t.tokenCount, 0) +
            this.adapter.estimateTokens(this.context.systemPrompt || '');
        this.emitTrace('system', 'history_loaded', { turnCount: this.context.turns.length });
    }

    /** Returns the `MediaBridge` for direct ASR / TTS / Vision / Image-gen calls. */
    getMedia() {
        return this.media;
    }

    /**
     * Returns the `ToolRegistry` for runtime tool management.
     *
     * Use this to register or unregister tools after session construction:
     *
     * ```typescript
     * // Add a tool after the user authenticates
     * session.tools.register(paymentTool);
     *
     * // Remove a tool when no longer needed
     * session.tools.unregister('send_payment');
     *
     * // Inspect what's registered
     * const active = session.tools.getAll();
     * console.log(active.map(t => t.name));
     * ```
     *
     * @since 1.4.0
     */
    get tools(): ToolRegistry {
        return this.toolRegistry;
    }

    /**
     * Returns the `SkillInjector` for runtime skill management.
     *
     * Use this to enable or disable dynamic skills after session construction:
     *
     * ```typescript
     * session.skills.enableSkill('code-review');
     * session.skills.enableByTags(['debugging']);
     * session.skills.disableSkill('verbose-mode');
     * const requiredTools = session.skills.getRequiredTools();
     * ```
     *
     * @since 1.4.0
     */
    get skills(): SkillInjector {
        return this.skillInjector;
    }

    // -----------------------------------------------------------------------
    // Continuation planning API
    // -----------------------------------------------------------------------

    /**
     * Sets an explicit multi-step continuation plan that will be tracked and
     * injected as a status block before each ReAct iteration.
     *
     * Dependency tracking, condition evaluation, `outputKey` storage, and
     * `inputMapping` resolution are all handled automatically by the planner.
     *
     * @param steps    - The ordered list of continuation steps.
     * @param strategy - Execution strategy ('sequential' | 'parallel' | 'conditional'). Default: 'sequential'.
     *
     * @example
     * ```typescript
     * await session.setPlan([
     *   { stepId: 'fetch', toolName: 'fetch_data', description: 'Get data', dependsOn: [], outputKey: 'rawData' },
     *   { stepId: 'analyze', toolName: 'analyze', description: 'Analyze', dependsOn: ['fetch'], inputMapping: { data: 'rawData' } },
     * ]);
     * const result = await session.run('Run the data pipeline.');
     * ```
     */
    setPlan(
        steps: ContinuationStep[],
        strategy: ContinuationPlan['strategy'] = 'sequential'
    ): void {
        this.continuationPlanner = new ContinuationPlanner(
            { steps, currentStepIndex: 0, strategy },
            {
                onStepFailed: (stepId, reason) => this.emitTrace('planning', 'step_failed', { stepId, reason }),
                onStepSkipped: (stepId, reason) => this.emitTrace('planning', 'step_skipped', { stepId, reason }),
            }
        );
        // Store plan in metadata so it survives context compression
        this.context.metadata['continuationPlan'] = this.continuationPlanner.getPlan();
        this.logger.debug(`[ContinuationPlanner] Plan set with ${steps.length} steps (strategy: ${strategy})`);
        this.emitTrace('planning', 'plan_set', { stepCount: steps.length, strategy });
    }

    // -----------------------------------------------------------------------
    // Plan inspection API
    // -----------------------------------------------------------------------

    /**
     * Returns a snapshot of the current continuation plan, or `null` if no plan
     * has been set via `setPlan()`.
     *
     * Use this after `run()` to inspect which steps completed, failed, or were skipped.
     *
     * @since 1.4.4
     *
     * @example
     * ```typescript
     * await session.run('Run the pipeline');
     * const plan = session.getPlan();
     * const failed = plan?.steps.filter(s => s.status === 'failed');
     * ```
     */
    getPlan(): import('./execution/ContinuationPlanner.js').ContinuationPlan | null {
        return this.continuationPlanner ? this.continuationPlanner.getPlan() : null;
    }

    // -----------------------------------------------------------------------
    // Goal planning API
    // -----------------------------------------------------------------------

    /**
     * Manually sets the agent's goal, bypassing the automatic mini-planning LLM call.
     *
     * Use this when you already know the goal structure upfront.
     *
     * @example
     * ```typescript
     * await session.setGoal({
     *   statement: 'Audit the authentication module',
     *   decomposition: ['Read src/auth/', 'Identify SQL injection risks', 'Write report'],
     *   successCriteria: ['Report covers all audit areas', 'Each finding has a severity rating'],
     * });
     * const result = await session.run('Begin the security audit.');
     * ```
     */
    setGoal(goal: Omit<Goal, 'id' | 'injectionFrequency' | 'injectionPosition'>): void {
        this.goalInjector = new GoalInjector({
            id: 'manual',
            statement: goal.statement,
            decomposition: goal.decomposition ?? [],
            successCriteria: goal.successCriteria ?? [],
            injectionFrequency: this.config.goalInjectionFrequency ?? 'always',
            injectionPosition: this.config.goalInjectionPosition ?? 'system_prompt',
            completedSubGoals: goal.completedSubGoals ?? [],
        });
        // Store in context metadata so it persists across compression
        this.context.metadata['goal'] = this.goalInjector.getGoal();
        this.logger.debug('[GoalInjector] Goal set manually');
        this.emitTrace('planning', 'goal_set_manual', {
            statement: goal.statement,
            subGoals: goal.decomposition?.length ?? 0
        });
    }

    // -----------------------------------------------------------------------
    // MCP initialisation
    // -----------------------------------------------------------------------

    /**
     * Connects all configured MCP servers and registers their bridged tools.
     * Called from the constructor as a fire-and-start async task; `run()` and
     * `stream()` await `this.mcpReady` before executing.
     */
    private async _initMCP(
        mcpServers: NonNullable<import('../types/agent.js').SessionConfig['mcpServers']>
    ): Promise<void> {
        if (!this.mcpRegistry) return;

        this.emitTrace('system', 'mcp_init_start', { serverCount: mcpServers.length });
        this.logger.info(`[MCP] Connecting to ${mcpServers.length} server(s)...`);

        for (const serverConfig of mcpServers) {
            try {
                await this.mcpRegistry.register(serverConfig.name, serverConfig);
                this.emitTrace('system', 'mcp_server_connected', { server: serverConfig.name });
            } catch (err: unknown) {
                const msg = (err as Error).message ?? String(err);
                this.logger.error(`[MCP] Failed to connect '${serverConfig.name}': ${msg}`);
                this.emitTrace('error', 'mcp_server_failed', { server: serverConfig.name, error: msg });
                // Non-fatal: continue connecting remaining servers
            }
        }

        // Discover and register bridged tools into the shared ToolRegistry
        const bridgedTools = await this.mcpRegistry.discoverTools();
        for (const tool of bridgedTools) {
            try {
                this.toolRegistry.register(tool);
            } catch {
                // Already registered (name collision with native tool) — skip
                this.logger.warn(`[MCP] Tool '${tool.name}' conflicts with an existing tool — skipping`);
            }
        }

        this.logger.info(`[MCP] ${bridgedTools.length} MCP tool(s) registered`);
        this.emitTrace('system', 'mcp_init_done', {
            servers: this.mcpRegistry.getRegisteredServers(),
            toolCount: bridgedTools.length
        });
    }

    // -----------------------------------------------------------------------
    // Routing (MetaRouter) — runs once per turn before the ReAct loop
    // -----------------------------------------------------------------------

    /** Groups registered tools into {@link ToolCategoryInfo} by their `category`. */
    private buildToolCategories(): ToolCategoryInfo[] {
        const byCategory = new Map<string, string[]>();
        for (const tool of this.toolRegistry.getAll()) {
            if (!tool.category) continue; // uncategorized → always available, not routed
            const list = byCategory.get(tool.category) ?? [];
            list.push(tool.name);
            byCategory.set(tool.category, list);
        }
        return Array.from(byCategory.entries()).map(([name, tools]) => ({ name, tools }));
    }

    /**
     * Runs the router for the current turn (when enabled) and stores the selected
     * categories in `this.routedCategories`. Returns the decision so the loop can
     * suppress goal planning/verification on a `chat` verdict. Fail-safe: on a
     * null/failed decision, routing is disabled for the turn (all tools exposed).
     */
    private async _runRoutingStep(userMessage: string): Promise<RouterDecision | null> {
        if (!this.router) {
            this.routedCategories = null;
            return null;
        }
        const categories = this.buildToolCategories();
        if (categories.length === 0) {
            this.routedCategories = null;
            return null;
        }
        try {
            const decision = await this.router.route(userMessage, categories);
            const always = this.config.alwaysAvailableCategories ?? [];
            this.routedCategories = new Set([...decision.categories, ...always]);
            this.context.metadata['routedCategories'] = Array.from(this.routedCategories);
            this.emitTrace('routing', 'route_decision', {
                mode: decision.mode,
                categories: decision.categories,
                reason: decision.reason,
            });
            this.logger.debug(`[Router] mode=${decision.mode} categories=[${decision.categories.join(', ')}]`);
            return decision;
        } catch (err: unknown) {
            // Should not happen (LLMRouter fails safe internally) but guard custom routers.
            this.logger.warn(`[Router] Routing step failed, exposing all tools: ${(err as Error).message ?? String(err)}`);
            this.routedCategories = null;
            return null;
        }
    }

    /**
     * Returns the tools to expose this turn, filtered by the router decision.
     * Always exposes uncategorized tools and tools in always-available /
     * routed-in categories. When routing is off (`routedCategories === null`),
     * returns every tool — identical to pre-routing behavior.
     */
    private getActiveTools(): IToolDefinition[] {
        const all = this.toolRegistry.getAll();
        if (this.routedCategories === null) return all;
        return all.filter(t => !t.category || this.routedCategories!.has(t.category));
    }

    // -----------------------------------------------------------------------
    // Goal mini-planning step (one extra LLM call, gated by enableGoalPlanning)
    // -----------------------------------------------------------------------

    /**
     * Runs a dedicated planning prompt against the LLM to decompose the user's
     * message into sub-goals and success criteria. Called once at the start of
     * the first `run()` when `enableGoalPlanning` is true and no goal has been
     * manually set via `setGoal()`.
     */
    private async _runMiniPlanningStep(userMessage: string): Promise<void> {
        const planningPrompt = `Given this goal: "${userMessage}"

1. List the sub-goals needed to achieve this (max 5, be specific)
2. List success criteria — what does "done" look like? (max 3, binary, measurable)

Respond ONLY with valid JSON (no markdown, no explanations):
{ "subGoals": string[], "successCriteria": string[] }`;

        try {
            const response = await this.adapter.complete({
                model: this.config.model,
                messages: [{ role: 'user', content: planningPrompt }],
                maxTokens: this.config.maxCompletionTokens ?? 4_000,
            });

            // Parse JSON — strip code fences first, then fall back to regex extraction
            // in case the model wraps the object in prose
            const stripped = response.content.replace(/```json|```/g, '').trim();
            const jsonMatch = stripped.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error(`No JSON object found in mini-planning response: "${stripped.slice(0, 200)}"`);
            }
            const parsed = JSON.parse(jsonMatch[0]) as { subGoals?: string[]; successCriteria?: string[] };

            if (this.goalInjector && Array.isArray(parsed.subGoals)) {
                this.goalInjector.updateDecomposition(
                    parsed.subGoals,
                    Array.isArray(parsed.successCriteria) ? parsed.successCriteria : undefined
                );
                this.context.metadata['goal'] = this.goalInjector.getGoal();
                this.emitTrace('planning', 'mini_plan_done', {
                    subGoals: parsed.subGoals,
                    successCriteria: parsed.successCriteria
                });
                this.logger.debug(`[GoalInjector] Mini-plan: ${parsed.subGoals.length} sub-goals`);
            }
        } catch (err: unknown) {
            // Non-fatal: continue without decomposition
            this.logger.warn(`[GoalInjector] Mini-planning step failed: ${(err as Error).message ?? String(err)}`);
        }
    }

    /**
     * Reconciles sub-goal completion against the recent conversation so the
     * re-injected goal block reflects real progress (anti-drift). Runs only when
     * `goalProgressReconciliation` is enabled, and is a no-op when there are no
     * pending sub-goals. One small, non-fatal LLM call; failures are swallowed.
     *
     * @since 1.5.4
     */
    private async _reconcileSubGoals(): Promise<void> {
        if (!this.config.goalProgressReconciliation) return;
        if (!this.goalInjector) return;

        const goal = this.goalInjector.getGoal();
        const completed = new Set(goal.completedSubGoals ?? []);
        const pending = (goal.decomposition ?? []).filter(sg => !completed.has(sg));
        if (pending.length === 0) return;

        const recentTurns = this.context.turns.slice(-6).map(t => {
            const text = typeof t.content === 'string' ? t.content : JSON.stringify(t.content);
            return `[${t.role}]: ${text.slice(0, 400)}`;
        }).join('\n\n');
        const pendingList = pending.map((sg, i) => `${i + 1}. ${sg}`).join('\n');

        try {
            const response = await this.adapter.complete({
                model: this.config.model,
                temperature: 0,
                maxTokens: 256,
                messages: [
                    {
                        role: 'system',
                        content: 'You track sub-goal progress. Given pending sub-goals and the recent conversation, return ONLY the 1-based indices of sub-goals that are now fully completed. Respond with valid JSON only, no prose: {"completed": number[]}'
                    },
                    {
                        role: 'user',
                        content: `Pending sub-goals:\n${pendingList}\n\nRecent conversation:\n${recentTurns}\n\nWhich pending sub-goals are now fully completed?`
                    }
                ]
            });
            const match = response.content.match(/\{[\s\S]*\}/);
            if (!match) return;
            const parsed = JSON.parse(match[0]) as { completed?: number[] };
            if (!Array.isArray(parsed.completed)) return;
            for (const idx of parsed.completed) {
                const sg = pending[idx - 1];
                if (sg) {
                    this.goalInjector.markSubGoalDone(sg);
                    this.emitTrace('planning', 'subgoal_done', { subGoal: sg });
                }
            }
            this.context.metadata['goal'] = this.goalInjector.getGoal();
        } catch (err: unknown) {
            this.logger.warn(`[GoalInjector] Sub-goal reconciliation failed (non-fatal): ${(err as Error).message ?? String(err)}`);
        }
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    /** Builds the system prompt, injecting skills and goal if configured. */
    private buildSystemPrompt(userMessage?: string, iteration: number = 0): string {
        let prompt = this.context.systemPrompt || '';

        // Progressive-skill catalog — a stable name+description list the model reads
        // to decide which skills to pull in via load_skill. Appended near the top so
        // it stays in the cacheable prefix (it never varies between iterations).
        if (this.hasProgressiveSkills) {
            const catalog = this.skillInjector.buildCatalog(
                this.config.skillSelection?.catalogHeader
            );
            if (catalog) prompt += '\n\n' + catalog;
        }

        // When staticSystemPrompt is enabled the system prompt must never vary between
        // iterations — this keeps the KV-cache prefix 100% stable and avoids costly
        // re-computation on every turn. Continuation plan status is therefore injected
        // into the *last user message* by buildMessages instead.
        const isStatic = this.config.staticSystemPrompt === true;

        // Inject goal into system prompt (when position === 'system_prompt')
        if (!isStatic && this.goalInjector && this.config.goalInjectionPosition !== 'pre_turn') {
            const shouldInject = this.goalInjector.shouldInjectThisTurn(
                iteration,
                false,
                this.config.goalInjectionN ?? 3
            );
            if (shouldInject) {
                prompt = this.goalInjector.injectInto(prompt);
                this.emitTrace('planning', 'goal_injected', {
                    position: 'system_prompt',
                    iteration
                });
            }
        }

        // Inject continuation plan status block (skipped when staticSystemPrompt is on)
        if (!isStatic && this.continuationPlanner && this.config.enableContinuationPlanning) {
            const planStatus = this.continuationPlanner.getPlanStatusString();
            prompt += `\n\n${planStatus}`;
        }

        const injectedSkills = this.skillInjector.buildInjectionBlock(
            'system_prompt',
            this.config.skillTokenBudget
        );
        if (injectedSkills) {
            prompt += '\n\n' + injectedSkills;
            const poolInjected = this.skillInjector
                .getSkillsForInjection('system_prompt')
                .filter(s => s.strategy === 'dynamic' || s.strategy === 'progressive')
                .map(s => s.name);
            if (poolInjected.length > 0) {
                this.emitTrace('skill', 'skill_inject', { skills: poolInjected, position: 'system_prompt' });
            }
        }

        return prompt.trim();
    }

    /** Builds the messages array for the provider from the current context. */
    private buildMessages(systemPrompt: string, iteration: number = 0): NormalizedMessage[] {
        const messages: NormalizedMessage[] = this.context.turns.map(t => ({
            role: t.role,
            content: t.content,
            ...(t.role === 'tool' && t.toolResults?.[0] ? { name: t.toolResults[0].toolCallId } : {}),
            ...(t.role === 'assistant' && t.toolCalls ? { toolCalls: t.toolCalls } : {})
        })) as NormalizedMessage[];

        if (systemPrompt) {
            messages.unshift({ role: 'system', content: systemPrompt });
        }

        // pre_turn goal injection — injects as a system message just before the last user turn
        if (!this.config.staticSystemPrompt && this.goalInjector && this.config.goalInjectionPosition === 'pre_turn') {
            const shouldInject = this.goalInjector.shouldInjectThisTurn(
                iteration,
                false,
                this.config.goalInjectionN ?? 3
            );
            if (shouldInject) {
                const goalBlock = this.goalInjector.getFormattedBlock();
                messages.push({ role: 'system', content: goalBlock });
                this.emitTrace('planning', 'goal_injected', { position: 'pre_turn', iteration });
            }
        }

        // KV-cache frozen turn injections — only active when staticSystemPrompt is on.
        // Dynamic content (goal state, continuation plan) is appended exclusively to the
        // *latest* user/tool message so older turns are never mutated between iterations,
        // keeping their token prefix identical and allowing the provider to reuse cached KV.
        if (this.config.staticSystemPrompt) {
            const totalTurns = this.context.turns.length;
            for (let i = 0; i < totalTurns; i++) {
                const msgIndex = i + 1; // messages[0] is the system prompt
                if (msgIndex >= messages.length) continue;
                const msg = messages[msgIndex]!;
                if (msg.role !== 'user' && msg.role !== 'tool') continue;

                let injectionBlock: string;

                if (i === totalTurns - 1) {
                    // Latest turn — generate fresh dynamic content
                    const blocks: string[] = [];
                    if (this.goalInjector) {
                        const shouldInject = this.goalInjector.shouldInjectThisTurn(
                            iteration, false, this.config.goalInjectionN ?? 3
                        );
                        if (shouldInject) blocks.push(this.goalInjector.getFormattedBlock());
                    }
                    if (this.continuationPlanner && this.config.enableContinuationPlanning) {
                        blocks.push(this.continuationPlanner.getPlanStatusString());
                    }
                    injectionBlock = blocks.length > 0
                        ? `\n\n<lemura:agent-state>\n${blocks.join('\n\n')}\n</lemura:agent-state>`
                        : '';
                    this._turnInjections.set(i, injectionBlock);
                    if (injectionBlock) {
                        this.emitTrace('planning', 'goal_injected', { position: 'frozen_turn', turnIndex: i, iteration });
                    }
                } else {
                    // Past turn — replay the frozen block so token prefix never changes
                    injectionBlock = this._turnInjections.get(i) ?? '';
                }

                if (!injectionBlock) continue;

                // Shallow-copy the message to avoid mutating context turns
                if (Array.isArray(msg.content)) {
                    messages[msgIndex] = {
                        ...msg,
                        content: msg.content.map(item =>
                            (item as { type?: string; text?: string }).type === 'text'
                                ? { ...(item as object), text: (item as { text: string }).text + injectionBlock }
                                : item
                        )
                    } as NormalizedMessage;
                } else {
                    messages[msgIndex] = { ...msg, content: ((msg.content as string) ?? '') + injectionBlock } as NormalizedMessage;
                }
            }
        }

        return messages;
    }

    /** Checks the tool execution budget and throws descriptively if exceeded. */
    private checkExecutionBudget(toolName: string): void {
        const budget = this.config.toolExecutionBudget;
        if (!budget) return;

        if (budget.maxCallsPerSession !== undefined && this.totalToolCallCount >= budget.maxCallsPerSession) {
            const err = new LemuraMaxIterationsError(
                `Tool execution budget exceeded: session limit of ${budget.maxCallsPerSession} tool calls reached`
            );
            this.logger.warn(err.message);
            throw err;
        }

        if (budget.maxCallsPerTool?.[toolName] !== undefined) {
            const current = this.perToolCallCount.get(toolName) ?? 0;
            if (current >= (budget.maxCallsPerTool[toolName] ?? Infinity)) {
                const err = new LemuraMaxIterationsError(
                    `Tool execution budget exceeded: '${toolName}' has reached its per-tool limit of ${budget.maxCallsPerTool[toolName]}`
                );
                this.logger.warn(err.message);
                this.emitTrace('budget', 'tool_limit_exceeded', {
                    toolName,
                    limit: budget.maxCallsPerTool[toolName],
                    totalTokens: this.totalTokens
                });
                throw err;
            }
        }

        this.emitTrace('budget', 'check_passed', {
            toolName,
            totalCalls: this.totalToolCallCount,
            totalTokens: this.totalTokens,
            tokenBudgetRemaining: this.config.maxTokens - this.totalTokens
        });
    }

    /** Records a tool call in budget counters. */
    private recordToolCall(toolName: string): void {
        this.totalToolCallCount++;
        this.perToolCallCount.set(toolName, (this.perToolCallCount.get(toolName) ?? 0) + 1);
    }

    // -----------------------------------------------------------------------
    // Blob detection helpers
    // -----------------------------------------------------------------------

    private isProbablyBase64(value: string): boolean {
        const v = value.trim();
        if (v.startsWith('data:') && v.includes(';base64,')) return true;
        if (v.length < 4096) return false;
        if (/[^A-Za-z0-9+/=]/.test(v)) return false;
        return true;
    }

    private isBinaryLike(value: unknown): boolean {
        if (!value) return false;
        if (typeof ArrayBuffer !== 'undefined') {
            if (value instanceof ArrayBuffer) return true;
            if (ArrayBuffer.isView(value)) return true;
        }
        if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return true;
        return false;
    }

    private async storeBlob(content: any, metadata: Record<string, unknown>): Promise<string | null> {
        if (!this.config.stmRegistry) return null;
        return this.config.stmRegistry.register(content, 'blob', metadata);
    }

    private async scrubBlobFields(
        value: any,
        toolName: string,
        depth: number = 0
    ): Promise<{ value: any; changed: boolean }> {
        if (!value || typeof value !== 'object') return { value, changed: false };
        if (depth > 2) return { value, changed: false };

        if (Array.isArray(value)) {
            let changed = false;
            const out = [];
            for (const item of value) {
                const res = await this.scrubBlobFields(item, toolName, depth + 1);
                out.push(res.value);
                if (res.changed) changed = true;
            }
            return { value: out, changed };
        }

        const obj: Record<string, any> = { ...value };
        let changed = false;
        for (const [key, v] of Object.entries(obj)) {
            if (typeof v === 'string' && this.isProbablyBase64(v)) {
                const ref = await this.storeBlob(v, {
                    toolName,
                    key,
                    encoding: v.startsWith('data:') ? 'data_url' : 'base64'
                });
                if (ref) {
                    obj[key] = ref;
                    obj[`${key}Note`] = 'Stored in STM';
                    changed = true;
                }
                continue;
            }

            if (this.isBinaryLike(v)) {
                const ref = await this.storeBlob(v, { toolName, key });
                if (ref) {
                    obj[key] = ref;
                    obj[`${key}Note`] = 'Stored in STM';
                    changed = true;
                }
                continue;
            }

            if (typeof v === 'object' && v !== null) {
                const nested = await this.scrubBlobFields(v, toolName, depth + 1);
                obj[key] = nested.value;
                if (nested.changed) changed = true;
            }
        }

        return { value: obj, changed };
    }

    /**
     * Processes a firewall decision for a tool call.
     * Returns true to proceed, false to block.
     */
    private async passesFirewall(
        toolName: string,
        argsJson: string,
        toolCallId: string,
        toolResults: Array<{ toolCallId: string; content: string }>
    ): Promise<boolean> {
        // The built-in load_skill tool is a trusted control-plane tool — it only
        // toggles which progressive skill content is injected and has no external
        // side effects, so it bypasses the firewall (like other Lemura builtins).
        if (toolName === LOAD_SKILL_TOOL_NAME && this.hasProgressiveSkills) {
            return true;
        }

        // The built-in memory tools (remember/recall) are trusted control-plane tools:
        // they only mutate the local memory store, no external side effects. `forget`
        // (a delete) is intentionally NOT auto-trusted, so a configured firewall can
        // still gate destructive removals.
        if (
            this.memoryManager &&
            (toolName === MEMORY_TOOL_NAMES[0] || toolName === MEMORY_TOOL_NAMES[1])
        ) {
            return true;
        }

        const firewall = evaluateToolFirewall(
            this.config.toolFirewall,
            toolName,
            argsJson,
            this.logger
        );

        if (firewall.decision === 'deny') {
            this.logger.warn(`Tool blocked by firewall: ${toolName}`, { reason: firewall.reason });
            toolResults.push({ toolCallId, content: `Blocked by tool firewall: ${firewall.reason}` });
            return false;
        }

        if (firewall.decision === 'ask') {
            if (this.config.toolFirewall?.onAsk) {
                // Fail-safe: only an explicit accept signal ('accept' or true) allows
                // execution. Any other value — 'deny', false, undefined, void, or a
                // thrown error — blocks the tool. This guarantees a user's "deny"/Stop
                // can never fall through to executing the tool anyway.
                let accepted = false;
                try {
                    const userDecision = await this.config.toolFirewall.onAsk(toolName, argsJson);
                    accepted = userDecision === 'accept' || userDecision === true;
                } catch (e: unknown) {
                    this.logger.warn(`Tool firewall onAsk handler threw — treating as deny: ${toolName}`, {
                        error: e instanceof Error ? e.message : String(e)
                    });
                    accepted = false;
                }
                if (!accepted) {
                    this.logger.warn(`Tool blocked by firewall (ask → deny): ${toolName}`, { reason: firewall.reason });
                    toolResults.push({ toolCallId, content: `Blocked by tool firewall: ${firewall.reason}` });
                    return false;
                }
                // accepted falls through
            } else {
                this.logger.warn(`Tool blocked by firewall (ask without handler): ${toolName}`, { reason: firewall.reason });
                toolResults.push({ toolCallId, content: `Blocked by tool firewall: ${firewall.reason}` });
                return false;
            }
        }

        return true;
    }

    /**
     * Executes a single parsed tool call and returns the serialised result string.
     * Also handles continuation plan tracking (step status + output storage).
     */
    private async executeSingleToolCall(
        tc: { id: string; name: string; arguments: string }
    ): Promise<string> {
        // Budget check
        this.checkExecutionBudget(tc.name);

        let args: Record<string, unknown> = JSON.parse(tc.arguments);

        // Continuation planner: resolve inputMapping if a matching step exists
        if (this.continuationPlanner) {
            const plan = this.continuationPlanner.getPlan();
            const matchingStep = plan.steps.find(
                s => s.toolName === tc.name && s.status === 'pending'
            );
            if (matchingStep) {
                this.continuationPlanner.markStepRunning(matchingStep.stepId);
                args = this.continuationPlanner.resolveInputs(matchingStep, args);
            }
        }

        const executeContext: Record<string, unknown> = {
            sessionId: this.sessionId,
            turnIndex: this.context.turns.length,
            logger: this.logger,
            adapter: this.adapter,
            stmRegistry: this.config.stmRegistry,
            scratchpad: this.context.scratchpad,
            scratchpadAdapter: this.config.scratchpadAdapter
        };
        if (this.config.ragAdapter) {
            executeContext['ragAdapter'] = this.config.ragAdapter;
        }
        if (this.memoryManager) {
            executeContext['memory'] = this.memoryManager;
        }

        this.logger.debug(`Executing tool: ${tc.name}`, { args: JSON.stringify(args) });
        this.emitTrace('tool_call', tc.name, { id: tc.id }, JSON.stringify(args), null, 'running');

        let result: unknown;
        let executionError: Error | null = null;

        try {
            result = await this.toolRegistry.execute(tc.name, args, executeContext as never);
        } catch (err: unknown) {
            executionError = err as Error;
            // Mark continuation step as failed
            if (this.continuationPlanner) {
                const plan = this.continuationPlanner.getPlan();
                const runningStep = plan.steps.find(
                    s => s.toolName === tc.name && s.status === 'running'
                );
                if (runningStep) {
                    this.continuationPlanner.markStepFailed(runningStep.stepId);
                    this.context.metadata['continuationPlan'] = this.continuationPlanner.getPlan();
                }
            }
            throw executionError;
        }

        this.recordToolCall(tc.name);
        this.logger.debug(`Tool ${tc.name} returned successfully`);

        // Scratchpad update
        let finalResult = result;
        if (typeof result === 'object' && result !== null) {
            const resObj = result as Record<string, unknown>;
            if (resObj['status'] === 'success' && resObj['newScratchpad'] !== undefined) {
                this.context.scratchpad = resObj['newScratchpad'] as string;
                finalResult = resObj['note'] || 'Scratchpad updated';
                this.emitTrace('planning', 'scratchpad_update', { note: resObj['note'] });
            }
        }

        // Blob/binary guard: stash in STM and return refs
        if (this.config.stmRegistry) {
            if (typeof finalResult === 'string' && this.isProbablyBase64(finalResult)) {
                const ref = await this.storeBlob(finalResult, { toolName: tc.name, encoding: 'base64' });
                if (ref) {
                    finalResult = { blobRef: ref, note: 'Binary content stored in STM' };
                }
            } else if (this.isBinaryLike(finalResult)) {
                const ref = await this.storeBlob(finalResult, { toolName: tc.name });
                if (ref) {
                    finalResult = { blobRef: ref, note: 'Binary content stored in STM' };
                }
            } else if (typeof finalResult === 'object' && finalResult !== null) {
                const scrubbed = await this.scrubBlobFields(finalResult, tc.name);
                if (scrubbed.changed) finalResult = scrubbed.value;
            }
        }

        // Serialise + token cap
        let content = JSON.stringify(finalResult);
        const tokenCount = this.adapter.estimateTokens(content);
        if (this.config.maxTokensPerTool && tokenCount > this.config.maxTokensPerTool) {
            content = content.slice(0, this.config.maxTokensPerTool * 4) + '... [TRUNCATED DUE TO TOOL TOKEN LIMIT]';
        }

        // Tool response compression
        const toolDef: IToolDefinition = this.toolRegistry.get(tc.name) || {
            name: tc.name,
            description: '',
            parameters: {},
            execute: async () => undefined
        };
        const evaluation = this.toolResponseProcessor.evaluate(content, toolDef, this.context);
        if (evaluation.shouldCompress && !evaluation.errorDetected) {
            content = this.toolResponseProcessor.compress(content, evaluation);
            this.emitTrace('compression', tc.name, { originalSize: evaluation.sizeClass }, null, content);
        }

        // Continuation planner: mark step done, store output
        if (this.continuationPlanner) {
            const plan = this.continuationPlanner.getPlan();
            const runningStep = plan.steps.find(
                s => s.toolName === tc.name && s.status === 'running'
            );
            if (runningStep) {
                // Run semantic verifier if provided
                if (runningStep.verify) {
                    const maxRetries = runningStep.verify.maxRetries ?? 0;
                    const retryCount = this.continuationPlanner.getRetryCount(runningStep.stepId);
                    let verdict: import('./execution/ContinuationPlanner.js').StepVerifierResult;
                    try {
                        verdict = await runningStep.verify.check(content, args);
                    } catch (verifyErr: unknown) {
                        verdict = { status: 'fail', reason: `Verifier threw: ${(verifyErr as Error).message}` };
                    }

                    if (verdict.status === 'fail' || (verdict.status === 'retry' && retryCount >= maxRetries)) {
                        this.continuationPlanner.markStepFailed(runningStep.stepId);
                        this.context.metadata['continuationPlan'] = this.continuationPlanner.getPlan();
                        this.emitTrace('planning', 'step_failed', {
                            stepId: runningStep.stepId,
                            reason: verdict.reason ?? 'verifier returned fail',
                            retryCount
                        });
                        return content;
                    }

                    if (verdict.status === 'retry') {
                        this.continuationPlanner.markStepPending(runningStep.stepId);
                        this.context.metadata['continuationPlan'] = this.continuationPlanner.getPlan();
                        this.emitTrace('planning', 'step_retry', {
                            stepId: runningStep.stepId,
                            reason: verdict.reason,
                            retryCount: this.continuationPlanner.getRetryCount(runningStep.stepId)
                        });
                        return content;
                    }
                    // verdict === 'pass' — fall through to markStepDone
                }

                this.continuationPlanner.markStepDone(runningStep.stepId, content);
                // Store in context.metadata['toolOutputs']
                if (runningStep.outputKey) {
                    const outputs = (this.context.metadata['toolOutputs'] as Record<string, string>) ?? {};
                    outputs[runningStep.outputKey] = content;
                    this.context.metadata['toolOutputs'] = outputs;
                }
                this.context.metadata['continuationPlan'] = this.continuationPlanner.getPlan();
                this.emitTrace('planning', 'step_done', {
                    stepId: runningStep.stepId,
                    outputKey: runningStep.outputKey
                });
            }
        }

        if (evaluation.suggestedAction === 'continue' && this.config.enableContinuationPlanning) {
            this.emitTrace('planning', 'continuation_detected', {
                toolName: tc.name,
                action: evaluation.suggestedAction
            });
        }

        this.emitTrace('tool_result', tc.name, { id: tc.id }, JSON.stringify(args), content, 'done');
        return content;
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    /**
     * Runs the full ReAct loop for a user message and returns the final assistant response.
     *
     * @param userMessage - The user's message (string or multimodal content blocks)
     * @returns The assistant's final response string
     * @throws {LemuraMaxIterationsError} When the loop exceeds `maxIterations`
     */
    async run(userMessage: string | ContentBlock[]): Promise<string> {
        if (this.mcpReady) await this.mcpReady;
        await this.ensureScratchpadLoaded();
        this._resetProgressiveSkillsForTurn();
        const result = await this._executeLoop(userMessage, { label: 'run' });
        await this._maybeReflect();
        return result;
    }

    /**
     * Autonomous long-term-memory write. When `config.memory.autoReflect` is on,
     * extracts durable facts from the conversation after the turn settles (one cheap
     * LLM call). Best-effort: failures are swallowed so they never break `run()`.
     *
     * @since 1.8.0
     */
    private async _maybeReflect(): Promise<void> {
        if (!this.memoryManager || !this.config.memory?.autoReflect) return;
        try {
            await this.memoryManager.reflect(this.context.turns);
        } catch (err: unknown) {
            this.logger.warn('Memory auto-reflect failed', { error: (err as Error)?.message });
        }
    }

    /**
     * Resets progressive skills at the start of a turn when
     * `skillSelection.persistence` is `'per_turn'` (the default), so each user
     * message re-decides which skills to load from the catalog. No-op when
     * persistence is `'session'` or there are no progressive skills.
     */
    private _resetProgressiveSkillsForTurn(): void {
        if (!this.hasProgressiveSkills) return;
        const persistence = this.config.skillSelection?.persistence ?? 'per_turn';
        if (persistence !== 'per_turn') return;

        // Capture which skills were active so the reset is observable in the trace
        // stream; emit only when something was actually cleared.
        const cleared = this.skillInjector
            .getProgressiveSkills()
            .filter(s => s.enabled === true)
            .map(s => s.name);
        this.skillInjector.resetProgressiveSkills();
        if (cleared.length > 0) {
            this.emitTrace('skill', 'skill_reset', { skills: cleared, reason: 'per_turn' });
        }
    }

    /**
     * Runs the ReAct loop and streams the final assistant response token-by-token.
     *
     * All tool calls, goal verification, and corrections complete before any token
     * is yielded — the stream delivers only the clean final response.
     *
     * @param userMessage - The user's message (string or multimodal content blocks)
     * @returns An `AsyncIterable<string>` of delta tokens from the final response
     *
     * @example
     * ```typescript
     * for await (const token of session.stream('Tell me a story')) {
     *   process.stdout.write(token);
     * }
     * ```
     */
    async *stream(userMessage: string | ContentBlock[]): AsyncIterable<string> {
        if (this.mcpReady) await this.mcpReady;
        await this.ensureScratchpadLoaded();
        this._resetProgressiveSkillsForTurn();

        const userMessageStr = Array.isArray(userMessage) ? '[Multimodal Content]' : userMessage;
        this.logger.info(`Starting streaming session run`, { model: this.config.model, message: userMessageStr });

        // Routing — runs first so a `chat` verdict can suppress goal planning/verification.
        const routeDecision = await this._runRoutingStep(userMessageStr);
        const isChatTurn = routeDecision?.mode === 'chat';

        // Goal injector init (skipped on a conversational turn)
        if (this.config.enableGoalPlanning && !this.goalInjector && !isChatTurn) {
            this.goalInjector = new GoalInjector({
                id: 'auto',
                statement: typeof userMessage === 'string' ? userMessage : '[multimodal]',
                decomposition: [],
                successCriteria: ['The user request is fully answered'],
                injectionFrequency: this.config.goalInjectionFrequency ?? 'always',
                injectionPosition: this.config.goalInjectionPosition ?? 'system_prompt',
            });
            this.context.metadata['goal'] = this.goalInjector.getGoal();
            await this._runMiniPlanningStep(userMessageStr);
        }

        this.context.turns.push({
            role: 'user',
            content: userMessage,
            tokenCount: Array.isArray(userMessage) ? userMessage.length * 50 : this.adapter.estimateTokens(userMessage),
            turnIndex: this.context.turns.length,
            compressed: false
        });

        const maxIts = this.config.maxIterations || 10;
        this.iterations = 0;
        this.stepCounter = new StepCounter(this.config.maxSteps ?? 20);
        const maxCompletionTokens = this.config.maxCompletionTokens ?? 4_000;
        // Budget for goal-verifier corrections. Each correction re-enters the ReAct
        // loop with full tool access so the model can actually *act* on what is
        // missing (read a file, write output, …) rather than merely re-phrase text.
        let correctionsRemaining = this.config.maxGoalCorrections ?? 1;

        while (this.iterations < maxIts) {
            this.iterations++;
            this.logger.debug(`[stream] ReAct Iteration ${this.iterations}/${maxIts}`);

            this.context.tokenCount =
                this.context.turns.reduce((sum, t) => sum + t.tokenCount, 0) +
                this.adapter.estimateTokens(this.context.systemPrompt || '');
            this.context = await this.contextManager.prepare(this.context);
            const systemPrompt = this.buildSystemPrompt(userMessageStr, this.iterations);
            const messages = this.buildMessages(systemPrompt, this.iterations);

            if (this.stepCounter.isMaxReached()) {
                messages.push({
                    role: 'system',
                    content: this.stepCounter.getForcedConclusionPrompt() + '\n\n' + FinalResponseFormatter.getRequiredStructure()
                });
            }

            // Use complete() for tool-call detection on non-final iterations
            let response;
            try {
                response = await this.adapter.complete({
                    model: this.config.model,
                    messages,
                    tools: this.stepCounter.isMaxReached() ? [] : this.getActiveTools(),
                    maxTokens: maxCompletionTokens
                });
            } catch (err: unknown) {
                this.logger.fatal(`Provider call failed: ${(err as Error).message}`);
                throw err;
            }

            // Tool calls — execute silently, no yielding
            if (response.finishReason === 'tool_call' && response.toolCalls) {
                this.logger.info(`[stream] Tool calls: ${response.toolCalls.map(tc => tc.name).join(', ')}`);
                this.stepCounter.increment(response.toolCalls.length);

                const toolResults: Array<{ toolCallId: string; content: string }> = [];
                for (const tc of response.toolCalls) {
                    const ok = await this.passesFirewall(tc.name, tc.arguments, tc.id, toolResults);
                    if (!ok) continue;
                    try {
                        toolResults.push({ toolCallId: tc.id, content: await this.executeSingleToolCall(tc) });
                    } catch (e: unknown) {
                        toolResults.push({ toolCallId: tc.id, content: `Error: ${e instanceof Error ? e.message : String(e)}` });
                    }
                }

                const assistantTurn: Turn = {
                    role: 'assistant', content: response.content || '',
                    tokenCount: this.adapter.estimateTokens(response.content || '') + 50,
                    turnIndex: this.context.turns.length, compressed: false, toolCalls: response.toolCalls
                };
                this.context.turns.push(assistantTurn);
                if (this.config.onTurn) this.config.onTurn(assistantTurn);

                for (const res of toolResults) {
                    const toolTurn: Turn = {
                        role: 'tool', content: res.content,
                        tokenCount: this.adapter.estimateTokens(res.content),
                        turnIndex: this.context.turns.length, compressed: false, toolResults: [res]
                    };
                    this.context.turns.push(toolTurn);
                    if (this.config.onTurn) this.config.onTurn(toolTurn);
                }

                if (this.goalInjector) this.goalInjector.incrementTurn();
                // Reconcile sub-goal progress every N tool rounds (anti-drift; opt-in).
                if (this.config.goalProgressReconciliation &&
                    this.iterations % (this.config.goalInjectionN ?? 3) === 0) {
                    await this._reconcileSubGoals();
                }
                continue;
            }

            // Final response — re-prepare context then stream it
            this.context.tokenCount =
                this.context.turns.reduce((sum, t) => sum + t.tokenCount, 0) +
                this.adapter.estimateTokens(this.context.systemPrompt || '');
            this.context = await this.contextManager.prepare(this.context);
            const finalSystemPrompt = this.buildSystemPrompt(userMessageStr, this.iterations);
            const finalMessages = this.buildMessages(finalSystemPrompt, this.iterations);

            // Buffer the final response instead of yielding live. Goal verification
            // runs *before* anything reaches the caller, so a rejected attempt is
            // silently discarded and corrected — the stream only ever delivers the
            // single approved answer. (Yielding live here would surface the rejected
            // attempt followed by the corrected one as a duplicated response.)
            let accumulated = '';
            let finalTokenCount = 0;
            let finalFinishReason: string | undefined;

            for await (const chunk of this.adapter.stream({
                model: this.config.model, messages: finalMessages,
                maxTokens: maxCompletionTokens, stream: true
            })) {
                if (chunk.delta) {
                    accumulated += chunk.delta;
                    finalTokenCount += Math.ceil(chunk.delta.length / 4);
                }
                if (chunk.finished) {
                    finalFinishReason = chunk.finishReason;
                    if (chunk.usage) this.totalTokens += chunk.usage.totalTokens;
                    this.emitTrace('thinking', 'llm_stream_finished', {
                        usage: chunk.usage, totalTokens: this.totalTokens, finishReason: chunk.finishReason
                    });
                }
            }

            const finalTurn: Turn = {
                role: 'assistant', content: accumulated,
                tokenCount: finalTokenCount,
                turnIndex: this.context.turns.length, compressed: false
            };
            this.context.turns.push(finalTurn);
            if (this.config.onTurn) this.config.onTurn(finalTurn);

            // Goal verification — runs on the buffered (not-yet-yielded) response.
            // If the goal is incomplete and correction budget remains, we re-enter
            // the ReAct loop with a corrective user turn. The buffered attempt is
            // never yielded, so the caller sees only the corrected final answer.
            if (finalFinishReason === 'stop') {
                const verdict = await this._verifyGoal(this.context.turns);
                // Only re-enter the loop if there is still iteration budget — otherwise
                // the corrective turn would trip the maxIterations guard and throw,
                // turning a soft "incomplete" into a hard error.
                if (verdict && !verdict.achieved && verdict.missing && correctionsRemaining > 0 && this.iterations < maxIts) {
                    correctionsRemaining--;
                    this.logger.info(`[GoalVerifier] Incomplete — re-entering loop with tools to correct: "${verdict.missing}" (${correctionsRemaining} correction(s) left)`);
                    this.emitTrace('verification', 'goal_correction_start', {
                        missing: verdict.missing,
                        reason: verdict.reason,
                        correctionsRemaining
                    });
                    const directive = `[Goal verification found the previous response incomplete. Continue working — use tools as needed — to address what is still missing, then provide the complete final answer.]\n\nStill missing: ${verdict.missing}`;
                    this.context.turns.push({
                        role: 'user',
                        content: directive,
                        tokenCount: this.adapter.estimateTokens(directive),
                        turnIndex: this.context.turns.length,
                        compressed: false
                    });
                    if (this.goalInjector) this.goalInjector.incrementTurn();
                    continue;
                }

                // Budget exhausted (or no actionable "missing"): append a visible warning
                // to the approved answer before it is streamed out below.
                if (verdict && !verdict.achieved) {
                    this.logger.warn(`[GoalVerifier] Goal still unmet after corrections: ${verdict.reason}`);
                    this.emitTrace('verification', 'goal_verification_result', {
                        achieved: false, reason: verdict.reason, missing: verdict.missing
                    }, null, null, 'error');
                    const warningBlock = `\n\n---\n\n⚠️ **Goal Verification Warning**\n* **Status:** Success criteria not fully met.\n* **Reason:** ${verdict.reason ?? 'Unknown'}\n* **Missing:** ${verdict.missing ?? 'Not specified'}\n\n`;
                    accumulated += warningBlock;
                    finalTurn.content = accumulated;
                }
            }

            // Verification settled — stream the single approved answer to the caller.
            if (accumulated) yield accumulated;

            this.logger.info(`[stream] Streaming run completed`);
            return;
        }

        throw new LemuraMaxIterationsError(`Exceeded max iterations of ${maxIts}`);
    }

    /**
     * Core ReAct execution loop shared by `run()` and `stream()`.
     *
     * Uses `adapter.complete()` exclusively — no streaming occurs here.
     * Goal verification and silent corrections run inside this method,
     * fully isolated from the caller's delivery path.
     *
     * @returns The final assistant response string
     * @throws {LemuraMaxIterationsError} When the loop exceeds `maxIterations`
     */
    private async _executeLoop(
        userMessage: string | ContentBlock[],
        opts: { label: string }
    ): Promise<string> {
        const userMessageStr = Array.isArray(userMessage) ? '[Multimodal Content]' : userMessage;
        this.logger.info(`Starting new session run`, {
            model: this.config.model,
            message: userMessageStr
        });

        // Routing — runs first so a `chat` verdict can suppress goal planning/verification.
        const routeDecision = await this._runRoutingStep(userMessageStr);
        const isChatTurn = routeDecision?.mode === 'chat';

        // Goal injector: initialise on first run if enableGoalPlanning and no manual goal set
        if (this.config.enableGoalPlanning && !this.goalInjector && !isChatTurn) {
            this.goalInjector = new GoalInjector({
                id: 'auto',
                statement: typeof userMessage === 'string' ? userMessage : '[multimodal]',
                decomposition: [],
                successCriteria: ['The user request is fully answered'],
                injectionFrequency: this.config.goalInjectionFrequency ?? 'always',
                injectionPosition: this.config.goalInjectionPosition ?? 'system_prompt',
            });
            this.context.metadata['goal'] = this.goalInjector.getGoal();
            this.logger.debug('Goal injector initialised (auto)');
            this.emitTrace('planning', 'goal_init', {
                statement: this.goalInjector.getGoal().statement,
                criteria: this.goalInjector.getGoal().successCriteria
            });
            await this._runMiniPlanningStep(userMessageStr);
        }

        // Push user turn
        this.context.turns.push({
            role: 'user',
            content: userMessage,
            tokenCount: Array.isArray(userMessage)
                ? userMessage.length * 50
                : this.adapter.estimateTokens(userMessage),
            turnIndex: this.context.turns.length,
            compressed: false
        });

        const maxIts = this.config.maxIterations || 10;
        this.iterations = 0;
        this.stepCounter = new StepCounter(this.config.maxSteps ?? 20);
        const maxCompletionTokens = this.config.maxCompletionTokens ?? 4_000;
        // Budget for goal-verifier corrections. Each correction re-enters the loop
        // with full tool access (see stream() for rationale).
        let correctionsRemaining = this.config.maxGoalCorrections ?? 1;

        while (this.iterations < maxIts) {
            this.iterations++;
            this.logger.debug(`[${opts.label}] ReAct Iteration ${this.iterations}/${maxIts}`);

            // Sync token count and compress if needed
            this.context.tokenCount =
                this.context.turns.reduce((sum, t) => sum + t.tokenCount, 0) +
                this.adapter.estimateTokens(this.context.systemPrompt || '');
            this.context = await this.contextManager.prepare(this.context);

            const systemPrompt = this.buildSystemPrompt(userMessageStr, this.iterations);
            const messages = this.buildMessages(systemPrompt, this.iterations);

            // maxSteps guard — inject forced-conclusion prompt
            if (this.stepCounter.isMaxReached()) {
                this.logger.warn(`maxSteps (${this.config.maxSteps ?? 20}) reached — forcing final response`);
                messages.push({
                    role: 'system',
                    content: this.stepCounter.getForcedConclusionPrompt() + '\n\n' + FinalResponseFormatter.getRequiredStructure()
                });
                this.emitTrace('planning', 'max_steps_reached', {
                    maxSteps: this.config.maxSteps,
                    currentSteps: this.stepCounter.count
                });
            }

            // Call provider
            this.logger.debug(`Calling provider adapter (${this.adapter.name})...`);
            this.emitTrace('thinking', 'llm_call', {
                model: this.config.model,
                iteration: this.iterations,
                totalTokens: this.totalTokens
            }, null, null, 'running');

            let response;
            try {
                response = await this.adapter.complete({
                    model: this.config.model,
                    messages,
                    tools: this.stepCounter.isMaxReached() ? [] : this.getActiveTools(),
                    maxTokens: maxCompletionTokens
                });
            } catch (err: unknown) {
                const e = err as { problem?: string; hints?: string[]; message?: string };
                const metadata = e.problem ? { problem: e.problem, hints: e.hints ?? [] } : {};
                this.logger.fatal(`Provider call failed: ${e.message ?? String(err)}`, metadata);
                this.emitTrace('error', 'llm_call_failed', { error: e.message ?? String(err) });
                throw err;
            }

            if (response.usage) this.totalTokens += response.usage.totalTokens;
            this.emitTrace('thinking', 'llm_call', {
                model: this.config.model,
                usage: response.usage,
                totalTokens: this.totalTokens
            }, null, response.content, 'done');

            // Tool calls
            if (response.finishReason === 'tool_call' && response.toolCalls) {
                this.logger.info(`Assistant requested ${response.toolCalls.length} tool calls`, {
                    tools: response.toolCalls.map(tc => tc.name)
                });
                this.stepCounter.increment(response.toolCalls.length);

                const toolResults: Array<{ toolCallId: string; content: string }> = [];

                if (this.config.parallelToolCalls) {
                    const budget = this.config.toolExecutionBudget;
                    const maxConcurrent = budget?.maxConcurrentCalls ?? response.toolCalls.length;

                    for (let i = 0; i < response.toolCalls.length; i += maxConcurrent) {
                        const batch: ToolCall[] = response.toolCalls.slice(i, i + maxConcurrent);

                        const allowed: ToolCall[] = [];
                        for (const tc of batch) {
                            const ok = await this.passesFirewall(tc.name, tc.arguments, tc.id, toolResults);
                            if (ok) allowed.push(tc);
                            else this.emitTrace('budget', 'firewall_blocked', { toolName: tc.name });
                        }

                        this.emitTrace('planning', 'parallel_execution', {
                            batchSize: allowed.length,
                            totalInResponse: response.toolCalls.length
                        });

                        const batchResults = await Promise.all(
                            allowed.map(async (tc: ToolCall) => {
                                try {
                                    const content = await this.executeSingleToolCall(tc);
                                    return { toolCallId: tc.id, content };
                                } catch (e: unknown) {
                                    const msg = e instanceof Error ? e.message : String(e);
                                    const isTimeout = e instanceof LemuraToolTimeoutError;
                                    this.logger.error(`Tool ${tc.name} ${isTimeout ? 'timed out' : 'failed'}: ${msg}`);
                                    this.emitTrace('error', isTimeout ? 'tool_timeout' : 'tool_error', {
                                        toolName: tc.name, id: tc.id, error: msg,
                                        timeoutMs: isTimeout ? (this.config.toolRegistryTimeoutMs ?? 30_000) : undefined
                                    }, null, null, 'error');
                                    return { toolCallId: tc.id, content: `Error: ${msg}` };
                                }
                            })
                        );
                        toolResults.push(...batchResults);
                    }
                } else {
                    for (const tc of response.toolCalls) {
                        const ok = await this.passesFirewall(tc.name, tc.arguments, tc.id, toolResults);
                        if (!ok) continue;

                        try {
                            const content = await this.executeSingleToolCall(tc);
                            toolResults.push({ toolCallId: tc.id, content });
                        } catch (e: unknown) {
                            const msg = e instanceof Error ? e.message : String(e);
                            const isTimeout = e instanceof LemuraToolTimeoutError;
                            this.logger.error(`Tool ${tc.name} ${isTimeout ? 'timed out' : 'failed'}: ${msg}`, {
                                problem: `Tool ${tc.name} ${isTimeout ? 'timed out' : 'failed to execute'}.`,
                                hints: isTimeout
                                    ? ['Increase toolRegistryTimeoutMs or optimise the tool implementation.']
                                    : ['Check the tool parameters and ensure required services are running.']
                            });
                            this.emitTrace('error', isTimeout ? 'tool_timeout' : 'tool_error', {
                                toolName: tc.name, id: tc.id, error: msg,
                                timeoutMs: isTimeout ? (this.config.toolRegistryTimeoutMs ?? 30_000) : undefined
                            }, null, null, 'error');
                            toolResults.push({ toolCallId: tc.id, content: `Error: ${msg}` });
                        }
                    }
                }

                const assistantTurn: Turn = {
                    role: 'assistant',
                    content: response.content || '',
                    tokenCount: this.adapter.estimateTokens(response.content || '') + 50,
                    turnIndex: this.context.turns.length,
                    compressed: false,
                    toolCalls: response.toolCalls
                };
                this.context.turns.push(assistantTurn);
                if (this.config.onTurn) this.config.onTurn(assistantTurn);

                for (const res of toolResults) {
                    const toolTurn: Turn = {
                        role: 'tool',
                        content: res.content,
                        tokenCount: this.adapter.estimateTokens(res.content),
                        turnIndex: this.context.turns.length,
                        compressed: false,
                        toolResults: [res]
                    };
                    this.context.turns.push(toolTurn);
                    if (this.config.onTurn) this.config.onTurn(toolTurn);
                }

                if (this.goalInjector) this.goalInjector.incrementTurn();
                // Reconcile sub-goal progress every N tool rounds (anti-drift; opt-in).
                if (this.config.goalProgressReconciliation &&
                    this.iterations % (this.config.goalInjectionN ?? 3) === 0) {
                    await this._reconcileSubGoals();
                }
                continue;
            }

            // Final / stop response
            if (
                response.finishReason === 'stop' ||
                response.finishReason === 'max_tokens' ||
                response.finishReason === 'error'
            ) {
                const finalTurn: Turn = {
                    role: 'assistant',
                    content: response.content,
                    tokenCount: response.usage?.completionTokens ?? this.adapter.estimateTokens(response.content),
                    turnIndex: this.context.turns.length,
                    compressed: false
                };
                this.context.turns.push(finalTurn);
                if (this.config.onTurn) this.config.onTurn(finalTurn);

                // Goal verification. If incomplete and budget remains, re-enter the
                // loop with a corrective user turn so the model can act (with tools)
                // on what is missing — rather than a tool-less one-shot rewrite.
                if (response.finishReason === 'stop') {
                    const verdict = await this._verifyGoal(this.context.turns);
                    // Only re-enter if iteration budget remains, else the corrective
                    // turn would trip the maxIterations guard and throw.
                    if (verdict && !verdict.achieved && verdict.missing && correctionsRemaining > 0 && this.iterations < maxIts) {
                        correctionsRemaining--;
                        this.logger.info(`[GoalVerifier] Incomplete — re-entering loop with tools to correct: "${verdict.missing}" (${correctionsRemaining} correction(s) left)`);
                        this.emitTrace('verification', 'goal_correction_start', {
                            missing: verdict.missing,
                            reason: verdict.reason,
                            correctionsRemaining
                        });
                        const directive = `[Goal verification found the previous response incomplete. Continue working — use tools as needed — to address what is still missing, then provide the complete final answer.]\n\nStill missing: ${verdict.missing}`;
                        this.context.turns.push({
                            role: 'user',
                            content: directive,
                            tokenCount: this.adapter.estimateTokens(directive),
                            turnIndex: this.context.turns.length,
                            compressed: false
                        });
                        if (this.goalInjector) this.goalInjector.incrementTurn();
                        continue;
                    }

                    // Budget exhausted (or no actionable "missing"): append a warning.
                    if (verdict && !verdict.achieved) {
                        this.logger.warn(`[GoalVerifier] Goal still unmet after corrections: ${verdict.reason}`);
                        this.emitTrace('verification', 'goal_verification_result', {
                            achieved: false, reason: verdict.reason, missing: verdict.missing
                        }, null, null, 'error');
                        const warningBlock = `\n\n---\n\n⚠️ **Goal Verification Warning**\n* **Status:** Success criteria not fully met.\n* **Reason:** ${verdict.reason ?? 'Unknown'}\n* **Missing:** ${verdict.missing ?? 'Not specified'}\n\n`;
                        const lastTurn = [...this.context.turns].reverse().find(t => t.role === 'assistant');
                        if (lastTurn) lastTurn.content = (lastTurn.content as string) + warningBlock;
                        this.logger.info(`[${opts.label}] Run completed with goal warning`);
                        return (lastTurn?.content as string) ?? response.content;
                    }
                }

                this.logger.info(`[${opts.label}] Run completed successfully`);
                return response.content;
            }
        }

        const maxItsErr = new LemuraMaxIterationsError(`Exceeded max iterations of ${maxIts}`);
        this.logger.fatal(maxItsErr.message, {
            problem: 'The agent entered an infinite loop or took too many steps to resolve the task.',
            hints: [
                'Increase maxIterations if the task is complex.',
                'Check if tools are returning consistent results.'
            ]
        });
        throw maxItsErr;
    }

    /**
     * Verifies whether the goal was achieved after a `stop` finish.
     *
     * Priority:
     * 1. `config.goalVerifier` callback (Option A — user-supplied)
     * 2. Built-in LLM check against `successCriteria` (Option C — fallback)
     *
     * Returns `null` when verification is skipped (no goal, planning disabled, etc.).
     *
     * @since 1.5.0
     */
    private async _verifyGoal(turns: Turn[]): Promise<GoalVerifierResult | null> {
        if (!this.config.enableGoalPlanning || !this.goalInjector) return null;
        if (this.config.enableGoalVerification === false) return null;

        const goal = this.goalInjector.getGoal();
        if (!goal.statement) return null;

        this.emitTrace('verification', 'goal_verification_start', { goalStatement: goal.statement });

        try {
            // Option A — user-supplied verifier takes priority
            if (this.config.goalVerifier) {
                const result = await this.config.goalVerifier(goal, turns);
                this.emitTrace('verification', 'goal_verification_result', {
                    achieved: result.achieved,
                    reason: result.reason,
                    missing: result.missing,
                    source: 'custom'
                });
                return result;
            }

            // Option C — built-in LLM check only when successCriteria contains
            // real user-defined criteria (not the generic auto-populated fallback)
            const GENERIC_CRITERION = 'The user request is fully answered';
            const meaningfulCriteria = goal.successCriteria?.filter(c => c !== GENERIC_CRITERION) ?? [];
            if (meaningfulCriteria.length > 0) {
                const recentTurns = turns.slice(-6).map(t => {
                    const text = typeof t.content === 'string'
                        ? t.content
                        : JSON.stringify(t.content);
                    return `[${t.role}]: ${text.slice(0, 400)}`;
                }).join('\n\n');

                const criteriaList = meaningfulCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n');

                const response = await this.adapter.complete({
                    model: this.config.model,
                    temperature: 0,
                    maxTokens: 256,
                    messages: [
                        {
                            role: 'system',
                            content: 'You are a strict goal-completion verifier. Respond ONLY with a valid JSON object — no markdown, no prose:\n{"achieved": true|false, "reason": "<short explanation>", "missing": "<what is still needed, or empty string>"}'
                        },
                        {
                            role: 'user',
                            content: `Goal: ${goal.statement}\n\nSuccess criteria:\n${criteriaList}\n\nRecent conversation:\n${recentTurns}\n\nWere ALL success criteria met?`
                        }
                    ]
                });

                let verdict: GoalVerifierResult | null = null;
                try {
                    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        const parsed = JSON.parse(jsonMatch[0]) as { achieved?: unknown; reason?: unknown; missing?: unknown };
                        verdict = {
                            achieved: parsed.achieved === true,
                            ...(typeof parsed.reason === 'string' && { reason: parsed.reason }),
                            ...(typeof parsed.missing === 'string' && { missing: parsed.missing })
                        };
                    }
                } catch {
                    this.logger.warn('[GoalVerifier] Failed to parse built-in verifier response — skipping');
                }

                if (verdict) {
                    this.emitTrace('verification', 'goal_verification_result', {
                        achieved: verdict.achieved,
                        reason: verdict.reason,
                        missing: verdict.missing,
                        source: 'built_in'
                    });
                    return verdict;
                }
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.warn(`[GoalVerifier] Verification step failed (non-fatal): ${msg}`);
        }

        return null;
    }

    /**
     * Resets the session: clears conversation history, resets iteration counters,
     * tool execution budget tallies, and goal/plan state.
     * The adapter, config, compression strategies, and tools are retained.
     */
    reset(): void {
        this.context = {
            systemPrompt: this.config.systemPrompt || '',
            scratchpad: '',
            turns: [],
            tokenCount: 0,
            maxTokens: this.config.maxTokens,
            metadata: {}
        };
        this.iterations = 0;
        this.totalToolCallCount = 0;
        this.totalTokens = 0;
        this.perToolCallCount.clear();
        this.stepCounter = new StepCounter(this.config.maxSteps ?? 20);
        this.goalInjector = null;
        this.continuationPlanner = null;
        this.scratchpadLoaded = false;
        this.pendingScratchpadClear = !!this.config.scratchpadAdapter;
        this.logger.debug('Session reset');
    }

    /**
     * Closes the session and disconnects all MCP servers.
     *
     * Call this when you are done with the session to ensure child processes are
     * terminated and HTTP connections are released.
     *
     * @example
     * ```typescript
     * const session = new SessionManager({ ..., mcpServers: [...] });
     * try {
     *   await session.run('Hello');
     * } finally {
     *   await session.close();
     * }
     * ```
     */
    async close(): Promise<void> {
        if (this.mcpRegistry) {
            await this.mcpRegistry.disconnectAll();
            this.emitTrace('system', 'mcp_disconnected', {});
            this.logger.debug('All MCP servers disconnected');
        }
    }
}
