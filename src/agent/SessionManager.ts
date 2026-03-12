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
import { GoalInjector } from './execution/GoalInjector.js';

/**
 * Core entry point for lemura agent sessions.
 *
 * `SessionManager` owns the full ReAct loop lifecycle:
 * - Context window management and compression
 * - Skill injection
 * - Tool firewall + schema validation + timeout enforcement
 * - Parallel tool execution (opt-in via `parallelToolCalls`)
 * - maxSteps guard → forced graceful conclusion
 * - Tool response compression (via `toolResponseProcessor`)
 * - Goal injection (via `enableGoalPlanning`)
 * - Streaming output (`stream()`)
 *
 * @example
 * const session = new SessionManager({ adapter, model: 'gpt-4o', maxTokens: 16_000 });
 * const answer = await session.run('What is the capital of France?');
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

    // Tool execution budget tracking
    private totalToolCallCount: number = 0;
    private perToolCallCount: Map<string, number> = new Map();

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

        // Tool response processor
        this.toolResponseProcessor = (config.toolResponseProcessor as unknown as ToolResponseProcessor) ??
            new ToolResponseProcessor();

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

        // Goal injector (wired when enableGoalPlanning is true)
        // The goal is initialised on the first run() call once we know the user message.
        this.goalInjector = null;

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

    /**
     * Returns a shallow copy of the current context window.
     */
    getContext(): ContextWindow {
        return { ...this.context };
    }

    /**
     * Returns the current conversation history.
     */
    getHistory() {
        return [...this.context.turns];
    }

    /**
     * Returns the `MediaBridge` for direct ASR / TTS / Vision / Image-gen calls.
     */
    getMedia() {
        return this.media;
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    /** Builds the system prompt, injecting skills and goal if configured. */
    private buildSystemPrompt(userMessage?: string): string {
        let prompt = this.context.systemPrompt || '';

        // Inject goal (enableGoalPlanning)
        if (this.config.enableGoalPlanning && userMessage) {
            if (!this.goalInjector) {
                this.goalInjector = new GoalInjector({
                    id: 'main',
                    statement: typeof userMessage === 'string' ? userMessage : '[multimodal]',
                    decomposition: [],
                    successCriteria: ['The user request is fully answered'],
                    injectionFrequency: this.config.goalInjectionFrequency ?? 'always',
                    injectionPosition: this.config.goalInjectionPosition ?? 'system_prompt'
                });
                this.logger.debug('Goal injector initialised');
                const goal = this.goalInjector.getGoal();
                this.emitTrace('planning', 'goal_init', {
                    statement: goal.statement,
                    criteria: goal.successCriteria
                });
            }
            if (this.config.goalInjectionPosition !== 'pre_turn') {
                prompt = this.goalInjector.injectInto(prompt);
            }
        }

        const injectedSkills = this.skillInjector.buildInjectionBlock('system_prompt');
        if (injectedSkills) {
            prompt += '\n\n' + injectedSkills;
        }

        return prompt.trim();
    }

    /** Builds the messages array for the provider from the current context */
    private buildMessages(systemPrompt: string): NormalizedMessage[] {
        const messages: NormalizedMessage[] = this.context.turns.map(t => ({
            role: t.role,
            content: t.content,
            ...(t.role === 'tool' && t.toolResults?.[0] ? { name: t.toolResults[0].toolCallId } : {}),
            ...(t.role === 'assistant' && t.toolCalls ? { toolCalls: t.toolCalls } : {})
        })) as NormalizedMessage[];

        if (systemPrompt) {
            messages.unshift({ role: 'system', content: systemPrompt });
        }

        // pre_turn goal injection
        if (this.goalInjector && this.config.goalInjectionPosition === 'pre_turn') {
            const goalBlock = this.goalInjector.injectInto('');
            messages.push({ role: 'system', content: goalBlock });
        }

        return messages;
    }

    /** Checks the tool execution budget and throws descriptively if exceeded */
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
                this.emitTrace('budget', 'tool_limit_exceeded', { toolName, limit: budget.maxCallsPerTool[toolName] });
                throw err;
            }
        }
        this.emitTrace('budget', 'check_passed', { toolName, totalCalls: this.totalToolCallCount });
    }

    /** Records a tool call in budget counters */
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
     */
    private async executeSingleToolCall(
        tc: { id: string; name: string; arguments: string }
    ): Promise<string> {
        // Budget check
        this.checkExecutionBudget(tc.name);

        const args = JSON.parse(tc.arguments);
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

        this.logger.debug(`Executing tool: ${tc.name}`, { args: tc.arguments });
        const result = await this.toolRegistry.execute(tc.name, args, executeContext as never);
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

        // Tool response compression (if configured)
        const toolDef: IToolDefinition = this.toolRegistry.get(tc.name) || {
            name: tc.name,
            description: '',
            parameters: {},
            execute: async () => undefined
        };
        const evaluation = this.toolResponseProcessor.evaluate(content, toolDef, this.context);
        if (evaluation.shouldCompress && !evaluation.errorDetected) {
            content = this.toolResponseProcessor.compress(content, evaluation);
        }

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
        const userMessageStr = Array.isArray(userMessage) ? '[Multimodal Content]' : userMessage;
        this.logger.info(`Starting new session run`, {
            model: this.config.model,
            message: userMessageStr
        });

        // Goal injector is set up on first run with the actual user message
        const systemPrompt = this.buildSystemPrompt(userMessageStr);

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

        // The ReAct Loop
        while (this.iterations < maxIts) {
            this.iterations++;
            this.logger.debug(`ReAct Iteration ${this.iterations}/${maxIts}`);

            // 2. Prepare context window (compress if needed)
            this.context = await this.contextManager.prepare(this.context);

            // Build messages
            let messages = this.buildMessages(systemPrompt);

            // If maxSteps reached — force conclusion
            if (this.stepCounter.isMaxReached()) {
                this.logger.warn(`maxSteps (${this.config.maxSteps ?? 20}) reached — forcing final response`);
                messages.push({
                    role: 'system',
                    content: this.stepCounter.getForcedConclusionPrompt() + '\n\n' + FinalResponseFormatter.getRequiredStructure()
                });
                this.emitTrace('planning', 'max_steps_reached', { maxSteps: this.config.maxSteps });
            }

            // 3. Call provider
            this.logger.debug(`Calling provider adapter (${this.adapter.name})...`);
            let response;
            try {
                response = await this.adapter.complete({
                    model: this.config.model,
                    messages: messages,
                    tools: this.stepCounter.isMaxReached() ? [] : this.toolRegistry.getAll(),
                    maxTokens: 1000
                });
            } catch (err: unknown) {
                const e = err as { problem?: string; hints?: string[]; message?: string };
                const metadata = e.problem ? { problem: e.problem, hints: e.hints ?? [] } : {};
                this.logger.fatal(`Provider call failed: ${e.message ?? String(err)}`, metadata);
                throw err;
            }

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

                        this.emitTrace('planning', 'parallel_execution', { batchSize: allowed.length });

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
                    // --- Sequential execution (original behaviour) ---
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
                    tokenCount: response.usage.completionTokens,
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
     * for await (const token of session.stream('Tell me a story')) {
     *   process.stdout.write(token);
     * }
     */
    async *stream(userMessage: string | ContentBlock[]): AsyncIterable<string> {
        const userMessageStr = Array.isArray(userMessage) ? '[Multimodal Content]' : userMessage;
        this.logger.info(`Starting streaming session run`, {
            model: this.config.model,
            message: userMessageStr
        });

        const systemPrompt = this.buildSystemPrompt(userMessageStr);

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

        while (this.iterations < maxIts) {
            this.iterations++;
            this.logger.debug(`[stream] ReAct Iteration ${this.iterations}/${maxIts}`);

            this.context = await this.contextManager.prepare(this.context);
            const messages = this.buildMessages(systemPrompt);

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
                    maxTokens: 1000
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

                continue;
            }

            // Final response — stream it
            this.context = await this.contextManager.prepare(this.context);
            const finalMessages = this.buildMessages(systemPrompt);

            let accumulated = '';
            let finalFinishReason: CompletionChunk['finishReason'] = undefined;
            let finalTokenCount = 0;

            for await (const chunk of this.adapter.stream({
                model: this.config.model,
                messages: finalMessages,
                maxTokens: 1000,
                stream: true
            })) {
                if (chunk.delta) {
                    accumulated += chunk.delta;
                    finalTokenCount += Math.ceil(chunk.delta.length / 4);
                    yield chunk.delta;
                }
                if (chunk.finished) {
                    finalFinishReason = chunk.finishReason;
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
     * and resets tool execution budgets. The adapter, config, and tools are retained.
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
        this.perToolCallCount.clear();
        this.stepCounter = new StepCounter(this.config.maxSteps ?? 20);
        this.goalInjector = null;
        this.logger.debug('Session reset');
    }
}
