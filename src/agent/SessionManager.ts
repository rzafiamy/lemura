import {
    SessionConfig,
    ContextWindow,
    IProviderAdapter,
    ContentBlock,
    Turn,
    ILogger,
    IToolDefinition,
    CompletionChunk,
    NormalizedMessage,
    ToolCall
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
import { MediaBridge } from '../media/MediaBridge.js';
import { evaluateToolFirewall } from '../tools/ToolFirewall.js';
import { StepCounter } from './execution/StepCounter.js';
import { FinalResponseFormatter } from './execution/FinalResponseFormatter.js';
import { ToolResponseProcessor } from './execution/ToolResponseProcessor.js';
import { Goal, GoalInjector } from './execution/GoalInjector.js';
import { ContinuationPlanner, ContinuationPlan, ContinuationStep } from './execution/ContinuationPlanner.js';
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
    private context: ContextWindow;
    private adapter: IProviderAdapter;
    private config: SessionConfig;
    private iterations: number = 0;
    private logger: ILogger;
    private media: MediaBridge;

    // Advanced execution state
    private stepCounter: StepCounter;
    private toolResponseProcessor: ToolResponseProcessor;
    private goalInjector: GoalInjector | null = null;
    private continuationPlanner: ContinuationPlanner | null = null;

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
        this.contextManager = new ContextManager();
        this.toolRegistry = new ToolRegistry(config.tools || [], {
            defaultTimeoutMs: config.toolRegistryTimeoutMs ?? 30_000
        });
        this.skillInjector = new SkillInjector(config.skills || []);
        this.media = new MediaBridge(this.adapter);

        // maxSteps guard (default 20)
        this.stepCounter = new StepCounter(config.maxSteps ?? 20);

        // Tool response processor — accept custom instance or build from config
        this.toolResponseProcessor = (config.toolResponseProcessor instanceof ToolResponseProcessor
            ? config.toolResponseProcessor
            : config.toolResponseProcessor
                ? config.toolResponseProcessor as unknown as ToolResponseProcessor
                : new ToolResponseProcessor()) as ToolResponseProcessor;

        for (const strategy of config.compressionStrategies || []) {
            this.contextManager.registerStrategy(strategy);
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
        this.emitTrace('system', 'session_init', {
            config: {
                model: this.config.model,
                maxIterations: this.config.maxIterations,
                maxSteps: this.config.maxSteps,
                parallelToolCalls: this.config.parallelToolCalls,
                enableGoalPlanning: this.config.enableGoalPlanning,
                enableContinuationPlanning: this.config.enableContinuationPlanning
            }
        });
    }

    // -----------------------------------------------------------------------
    // Trace helper
    // -----------------------------------------------------------------------

    private emitTrace(
        type: 'planning' | 'budget' | 'tool_call' | 'tool_result' | 'thinking' | 'system' | 'compression' | 'error',
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

    /** Returns the `MediaBridge` for direct ASR / TTS / Vision / Image-gen calls. */
    getMedia() {
        return this.media;
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
        this.continuationPlanner = new ContinuationPlanner({
            steps,
            currentStepIndex: 0,
            strategy
        });
        // Store plan in metadata so it survives context compression
        this.context.metadata['continuationPlan'] = this.continuationPlanner.getPlan();
        this.logger.debug(`[ContinuationPlanner] Plan set with ${steps.length} steps (strategy: ${strategy})`);
        this.emitTrace('planning', 'plan_set', { stepCount: steps.length, strategy });
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
                maxTokens: this.config.maxCompletionTokens ?? 2_000,
            });

            // Parse JSON from the response (tolerate code fences)
            const raw = response.content.replace(/```json|```/g, '').trim();
            const parsed = JSON.parse(raw) as { subGoals?: string[]; successCriteria?: string[] };

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

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    /** Builds the system prompt, injecting skills and goal if configured. */
    private buildSystemPrompt(userMessage?: string, iteration: number = 0): string {
        let prompt = this.context.systemPrompt || '';

        // Inject goal into system prompt (when position === 'system_prompt')
        if (this.goalInjector && this.config.goalInjectionPosition !== 'pre_turn') {
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

        // Inject continuation plan status block
        if (this.continuationPlanner && this.config.enableContinuationPlanning) {
            const planStatus = this.continuationPlanner.getPlanStatusString();
            prompt += `\n\n${planStatus}`;
        }

        const injectedSkills = this.skillInjector.buildInjectionBlock(
            'system_prompt',
            this.config.skillTokenBudget
        );
        if (injectedSkills) {
            prompt += '\n\n' + injectedSkills;
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
        if (this.goalInjector && this.config.goalInjectionPosition === 'pre_turn') {
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
                const userDecision = await this.config.toolFirewall.onAsk(toolName, argsJson);
                if (userDecision === 'deny') {
                    this.logger.warn(`Tool blocked by firewall (ask → deny): ${toolName}`, { reason: firewall.reason });
                    toolResults.push({ toolCallId, content: `Blocked by tool firewall: ${firewall.reason}` });
                    return false;
                }
                // accept falls through
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
            sessionId: 'default',
            turnIndex: this.context.turns.length,
            logger: this.logger,
            adapter: this.adapter,
            stmRegistry: this.config.stmRegistry,
            scratchpad: this.context.scratchpad
        };
        if (this.config.ragAdapter) {
            executeContext['ragAdapter'] = this.config.ragAdapter;
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
     * When `enableGoalPlanning` is true and no goal has been manually set, a mini-planning
     * LLM call is made before the first iteration to decompose the task into sub-goals.
     *
     * @param userMessage - The user's message (string or multimodal content blocks)
     * @returns The assistant's final response string
     * @throws {LemuraMaxIterationsError} When the loop exceeds `maxIterations`
     */
    async run(userMessage: string | ContentBlock[]): Promise<string> {
        // Ensure MCP servers are connected before first use
        if (this.mcpReady) await this.mcpReady;

        const userMessageStr = Array.isArray(userMessage) ? '[Multimodal Content]' : userMessage;
        this.logger.info(`Starting new session run`, {
            model: this.config.model,
            message: userMessageStr
        });

        // Goal injector: initialise on first run if enableGoalPlanning and no manual goal set
        if (this.config.enableGoalPlanning && !this.goalInjector) {
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

            // Run mini-planning step to decompose the goal
            await this._runMiniPlanningStep(userMessageStr);
        }

        // 1. Prepare context with user's message
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
        const maxCompletionTokens = this.config.maxCompletionTokens ?? 2_000;

        // The ReAct Loop
        while (this.iterations < maxIts) {
            this.iterations++;
            this.logger.debug(`ReAct Iteration ${this.iterations}/${maxIts}`);

            // 2. Prepare context window (compress if needed)
            this.context = await this.contextManager.prepare(this.context);

            // Build messages
            const systemPrompt = this.buildSystemPrompt(userMessageStr, this.iterations);
            let messages = this.buildMessages(systemPrompt, this.iterations);

            // If maxSteps reached — force conclusion
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

            // 3. Call provider
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
                    messages: messages,
                    tools: this.stepCounter.isMaxReached() ? [] : this.toolRegistry.getAll(),
                    maxTokens: maxCompletionTokens
                });
            } catch (err: unknown) {
                const e = err as { problem?: string; hints?: string[]; message?: string };
                const metadata = e.problem ? { problem: e.problem, hints: e.hints ?? [] } : {};
                this.logger.fatal(`Provider call failed: ${e.message ?? String(err)}`, metadata);
                this.emitTrace('error', 'llm_call_failed', { error: e.message ?? String(err) });
                throw err;
            }

            // Update token count
            if (response.usage) {
                this.totalTokens += response.usage.totalTokens;
            }
            this.emitTrace('thinking', 'llm_call', {
                model: this.config.model,
                usage: response.usage,
                totalTokens: this.totalTokens
            }, null, response.content, 'done');

            // 4a. Tool calls
            if (response.finishReason === 'tool_call' && response.toolCalls) {
                this.logger.info(`Assistant requested ${response.toolCalls.length} tool calls`, {
                    tools: response.toolCalls.map(tc => tc.name)
                });

                // Count steps
                this.stepCounter.increment(response.toolCalls.length);

                const toolResults: Array<{ toolCallId: string; content: string }> = [];

                if (this.config.parallelToolCalls) {
                    // --- Parallel execution ---
                    const budget = this.config.toolExecutionBudget;
                    const maxConcurrent = budget?.maxConcurrentCalls ?? response.toolCalls.length;

                    // Process in batches of maxConcurrent
                    for (let i = 0; i < response.toolCalls.length; i += maxConcurrent) {
                        const batch: ToolCall[] = response.toolCalls.slice(i, i + maxConcurrent);

                        // Check firewall for all in batch first (sequential — may require user interaction)
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

                        // Execute allowed calls in parallel
                        const batchResults = await Promise.all(
                            allowed.map(async (tc: ToolCall) => {
                                try {
                                    const content = await this.executeSingleToolCall(tc);
                                    return { toolCallId: tc.id, content };
                                } catch (e: unknown) {
                                    const msg = e instanceof Error ? e.message : String(e);
                                    const isTimeout = e instanceof LemuraToolTimeoutError;
                                    this.logger.error(`Tool ${tc.name} ${isTimeout ? 'timed out' : 'failed'}: ${msg}`);
                                    return { toolCallId: tc.id, content: `Error: ${msg}` };
                                }
                            })
                        );
                        toolResults.push(...batchResults);
                    }
                } else {
                    // --- Sequential execution ---
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
                            toolResults.push({ toolCallId: tc.id, content: `Error: ${msg}` });
                        }
                    }
                }

                // Append assistant turn with tool calls
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

                // Append tool observation turns
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

                // Advance goal turn counter
                if (this.goalInjector) this.goalInjector.incrementTurn();

                continue;
            }

            // 4b. Final / stop response
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
                this.logger.info(`Run completed successfully`);
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
     * Runs the ReAct loop and streams the final assistant response token-by-token.
     *
     * Tool calls within the loop are still executed synchronously (they must complete
     * before streaming the conclusion). Only the final LLM text output is streamed.
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
        // Ensure MCP servers are connected before first use
        if (this.mcpReady) await this.mcpReady;

        const userMessageStr = Array.isArray(userMessage) ? '[Multimodal Content]' : userMessage;
        this.logger.info(`Starting streaming session run`, {
            model: this.config.model,
            message: userMessageStr
        });

        // Goal injector: initialise on first run if enableGoalPlanning and no manual goal set
        if (this.config.enableGoalPlanning && !this.goalInjector) {
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
            tokenCount: Array.isArray(userMessage)
                ? userMessage.length * 50
                : this.adapter.estimateTokens(userMessage),
            turnIndex: this.context.turns.length,
            compressed: false
        });

        const maxIts = this.config.maxIterations || 10;
        this.iterations = 0;
        this.stepCounter = new StepCounter(this.config.maxSteps ?? 20);
        const maxCompletionTokens = this.config.maxCompletionTokens ?? 2_000;

        while (this.iterations < maxIts) {
            this.iterations++;
            this.logger.debug(`[stream] ReAct Iteration ${this.iterations}/${maxIts}`);

            this.context = await this.contextManager.prepare(this.context);
            const systemPrompt = this.buildSystemPrompt(userMessageStr, this.iterations);
            const messages = this.buildMessages(systemPrompt, this.iterations);

            if (this.stepCounter.isMaxReached()) {
                messages.push({
                    role: 'system',
                    content: this.stepCounter.getForcedConclusionPrompt() + '\n\n' + FinalResponseFormatter.getRequiredStructure()
                });
            }

            // Non-final iterations: complete() to check for tool calls first
            let response;
            try {
                response = await this.adapter.complete({
                    model: this.config.model,
                    messages,
                    tools: this.stepCounter.isMaxReached() ? [] : this.toolRegistry.getAll(),
                    maxTokens: maxCompletionTokens
                });
            } catch (err: unknown) {
                this.logger.fatal(`Provider call failed: ${(err as Error).message}`);
                throw err;
            }

            // Handle tool calls (non-streaming, same as run())
            if (response.finishReason === 'tool_call' && response.toolCalls) {
                this.logger.info(`[stream] Tool calls: ${response.toolCalls.map(tc => tc.name).join(', ')}`);
                this.stepCounter.increment(response.toolCalls.length);

                const toolResults: Array<{ toolCallId: string; content: string }> = [];

                for (const tc of response.toolCalls) {
                    const ok = await this.passesFirewall(tc.name, tc.arguments, tc.id, toolResults);
                    if (!ok) continue;
                    try {
                        const content = await this.executeSingleToolCall(tc);
                        toolResults.push({ toolCallId: tc.id, content });
                    } catch (e: unknown) {
                        const msg = e instanceof Error ? e.message : String(e);
                        toolResults.push({ toolCallId: tc.id, content: `Error: ${msg}` });
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
                continue;
            }

            // Final response — stream it
            this.context = await this.contextManager.prepare(this.context);
            const finalSystemPrompt = this.buildSystemPrompt(userMessageStr, this.iterations);
            const finalMessages = this.buildMessages(finalSystemPrompt, this.iterations);

            let accumulated = '';
            let finalFinishReason: CompletionChunk['finishReason'] = undefined;
            let finalTokenCount = 0;

            for await (const chunk of this.adapter.stream({
                model: this.config.model,
                messages: finalMessages,
                maxTokens: maxCompletionTokens,
                stream: true
            })) {
                if (chunk.delta) {
                    accumulated += chunk.delta;
                    finalTokenCount += Math.ceil(chunk.delta.length / 4);
                    yield chunk.delta;
                }
                if (chunk.finished) {
                    finalFinishReason = chunk.finishReason;
                    if (chunk.usage) {
                        this.totalTokens += chunk.usage.totalTokens;
                    }
                    this.emitTrace('thinking', 'llm_stream_finished', {
                        usage: chunk.usage,
                        totalTokens: this.totalTokens,
                        finishReason: chunk.finishReason
                    });
                }
            }

            const finalTurn: Turn = {
                role: 'assistant',
                content: accumulated,
                tokenCount: finalTokenCount,
                turnIndex: this.context.turns.length,
                compressed: false
            };
            this.context.turns.push(finalTurn);
            if (this.config.onTurn) this.config.onTurn(finalTurn);
            this.logger.info(`[stream] Streaming run completed (finishReason: ${finalFinishReason ?? 'stop'})`);
            return;
        }

        const maxItsErr = new LemuraMaxIterationsError(`Exceeded max iterations of ${maxIts}`);
        this.logger.fatal(maxItsErr.message, {
            problem: 'The streaming agent loop exceeded its max iterations.',
            hints: ['Increase maxIterations or reduce task complexity.']
        });
        throw maxItsErr;
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
