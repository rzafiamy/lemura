import { SessionConfig, ContextWindow, IProviderAdapter, ContentBlock, Turn, ILogger } from '../types/index.js';
import { ContextManager } from '../context/ContextManager.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import { SkillInjector } from '../skills/SkillInjector.js';
import { LemuraMaxIterationsError } from '../types/index.js';
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

export class SessionManager {
    private contextManager: ContextManager;
    private toolRegistry: ToolRegistry;
    private skillInjector: SkillInjector;
    private context: ContextWindow;
    private adapter: IProviderAdapter;
    private config: SessionConfig;
    private iterations: number = 0;
    private logger: ILogger;

    constructor(config: SessionConfig) {
        this.config = config;
        this.adapter = config.adapter;
        this.logger = config.logger || new DefaultLogger();
        this.contextManager = new ContextManager();
        this.toolRegistry = new ToolRegistry(config.tools || []);
        this.skillInjector = new SkillInjector(config.skills || []);

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

        this.context = {
            systemPrompt: config.systemPrompt || '',
            scratchpad: '',
            turns: [],
            tokenCount: 0,
            maxTokens: config.maxTokens,
            metadata: {}
        };
    }

    getContext(): ContextWindow {
        return { ...this.context };
    }

    getHistory() {
        return [...this.context.turns];
    }

    async run(userMessage: string | ContentBlock[]): Promise<string> {
        this.logger.info(`Starting new session run`, {
            model: this.config.model,
            message: Array.isArray(userMessage) ? '[Multimodal Content]' : userMessage
        });

        // 1. Prepare context with user's message
        this.context.turns.push({
            role: 'user',
            content: userMessage,
            tokenCount: Array.isArray(userMessage) ? userMessage.length * 50 : this.adapter.estimateTokens(userMessage),
            turnIndex: this.context.turns.length,
            compressed: false
        });

        const maxIts = this.config.maxIterations || 10;
        this.iterations = 0;

        // The ReAct Loop
        while (this.iterations < maxIts) {
            this.iterations++;
            this.logger.debug(`ReAct Iteration ${this.iterations}/${maxIts}`);

            // 2. Prepare context window (compress if needed)
            this.context = await this.contextManager.prepare(this.context);

            // Map context to provider API format
            const messages = this.context.turns.map(t => ({
                role: t.role,
                content: t.content,
                ...(t.role === 'tool' && t.toolResults?.[0] ? { name: t.toolResults[0].toolCallId } : {}),
                ...(t.role === 'assistant' && t.toolCalls ? { toolCalls: t.toolCalls } : {})
            }));

            // In a real implementation we would also inject the system prompt + compressionSummary properly
            let fullSystemPrompt = this.context.systemPrompt || '';
            const injectedSkills = this.skillInjector.buildInjectionBlock('system_prompt');
            if (injectedSkills) {
                fullSystemPrompt += '\n\n' + injectedSkills;
            }
            if (fullSystemPrompt.trim()) {
                messages.unshift({ role: 'system', content: fullSystemPrompt.trim() });
            }

            // 3. Call provider
            this.logger.debug(`Calling provider adapter (${this.adapter.name})...`);
            let response;
            try {
                response = await this.adapter.complete({
                    model: this.config.model,
                    messages: messages,
                    tools: this.toolRegistry.getAll(),
                    maxTokens: 1000 // default gen tokens
                });
            } catch (err: any) {
                const metadata = err.problem ? { problem: err.problem, hints: err.hints } : {};
                this.logger.fatal(`Provider call failed: ${err.message}`, metadata);
                throw err;
            }

            // 4. Parse response
            if (response.finishReason === 'tool_call' && response.toolCalls) {
                this.logger.info(`Assistant requested ${response.toolCalls.length} tool calls`, {
                    tools: response.toolCalls.map(tc => tc.name)
                });
                // Execute tool calls
                const toolResults = [];
                for (const tc of response.toolCalls) {
                    try {
                        const args = JSON.parse(tc.arguments);
                        const executeContext: any = {
                            sessionId: 'default',
                            turnIndex: this.context.turns.length,
                            logger: this.logger,
                            stmRegistry: this.config.stmRegistry,
                            scratchpad: this.context.scratchpad
                        };
                        if (this.config.ragAdapter) {
                            executeContext.ragAdapter = this.config.ragAdapter;
                        }

                        this.logger.debug(`Executing tool: ${tc.name}`, { args: tc.arguments });
                        const result = await this.toolRegistry.execute(tc.name, args, executeContext);
                        this.logger.debug(`Tool ${tc.name} returned successfully`);

                        let finalResult = result;
                        if (typeof result === 'object' && result !== null) {
                            const resObj = result as any;
                            if (resObj.status === 'success' && resObj.newScratchpad !== undefined) {
                                this.context.scratchpad = resObj.newScratchpad;
                                finalResult = resObj.note || 'Scratchpad updated';
                            }
                        }

                        // Enforce maxTokensPerTool
                        let content = JSON.stringify(finalResult);
                        const tokenCount = this.adapter.estimateTokens(content);
                        if (this.config.maxTokensPerTool && tokenCount > this.config.maxTokensPerTool) {
                            content = content.slice(0, this.config.maxTokensPerTool * 4) + '... [TRUNCATED DUE TO TOOL TOKEN LIMIT]';
                        }

                        toolResults.push({ toolCallId: tc.id, content });
                    } catch (e: any) {
                        this.logger.error(`Tool ${tc.name} execution failed: ${e.message}`, {
                            problem: e.problem || `Tool ${tc.name} failed to execute properly.`,
                            hints: e.hints || ['Check the tool parameters and ensure the required services are running.']
                        });
                        toolResults.push({ toolCallId: tc.id, content: `Error: ${e.message}` });
                    }
                }

                // Add assistant turn with tool calls
                const assistantTurn: Turn = {
                    role: 'assistant',
                    content: response.content || '',
                    tokenCount: this.adapter.estimateTokens(response.content || '') + 50, // rough tool estimate
                    turnIndex: this.context.turns.length,
                    compressed: false,
                    toolCalls: response.toolCalls
                };
                this.context.turns.push(assistantTurn);
                if (this.config.onTurn) this.config.onTurn(assistantTurn);

                // Add tool observation turns
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

                // Continue loop
                continue;
            }

            // If stop/final -> return response to caller
            if (response.finishReason === 'stop' || response.finishReason === 'max_tokens' || response.finishReason === 'error') {
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
            hints: ['Increase maxIterations if the task is complex.', 'Check if tools are returning consistent results.']
        });
        throw maxItsErr;
    }
}
