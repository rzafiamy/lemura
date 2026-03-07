import { SessionConfig, ContextWindow, TokenUsage, IProviderAdapter, ContentBlock } from '../types/index.js';
import { ContextManager } from '../context/ContextManager.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import { SkillInjector } from '../skills/SkillInjector.js';
import { LemuraMaxIterationsError } from '../types/index.js';

export class SessionManager {
    private contextManager: ContextManager;
    private toolRegistry: ToolRegistry;
    private skillInjector: SkillInjector;
    private context: ContextWindow;
    private adapter: IProviderAdapter;
    private config: SessionConfig;
    private iterations: number = 0;

    constructor(config: SessionConfig) {
        this.config = config;
        this.adapter = config.adapter;
        this.contextManager = new ContextManager();
        this.toolRegistry = new ToolRegistry(config.tools || []);
        this.skillInjector = new SkillInjector(config.skills || []);

        for (const strategy of config.compressionStrategies || []) {
            this.contextManager.registerStrategy(strategy);
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
            const response = await this.adapter.complete({
                model: this.config.model,
                messages: messages,
                tools: this.toolRegistry.getAll(),
                maxTokens: 1000 // default gen tokens
            });

            // 4. Parse response
            if (response.finishReason === 'tool_call' && response.toolCalls) {
                // Execute tool calls
                const toolResults = [];
                for (const tc of response.toolCalls) {
                    try {
                        const args = JSON.parse(tc.arguments);
                        const executeContext: any = {
                            sessionId: 'default',
                            turnIndex: this.context.turns.length,
                            logger: this.config.logger || console
                        };
                        if (this.config.ragAdapter) {
                            executeContext.ragAdapter = this.config.ragAdapter;
                        }
                        const result = await this.toolRegistry.execute(tc.name, args, executeContext);
                        toolResults.push({ toolCallId: tc.id, content: JSON.stringify(result) });
                    } catch (e: any) {
                        toolResults.push({ toolCallId: tc.id, content: `Error: ${e.message}` });
                    }
                }

                // Add assistant turn with tool calls
                this.context.turns.push({
                    role: 'assistant',
                    content: response.content || '',
                    tokenCount: this.adapter.estimateTokens(response.content || '') + 50, // rough tool estimate
                    turnIndex: this.context.turns.length,
                    compressed: false,
                    toolCalls: response.toolCalls
                });

                // Add tool observation turns
                for (const res of toolResults) {
                    this.context.turns.push({
                        role: 'tool',
                        content: res.content,
                        tokenCount: this.adapter.estimateTokens(res.content),
                        turnIndex: this.context.turns.length,
                        compressed: false,
                        toolResults: [res]
                    });
                }

                // Continue loop
                continue;
            }

            // If stop/final -> return response to caller
            if (response.finishReason === 'stop' || response.finishReason === 'max_tokens') {
                this.context.turns.push({
                    role: 'assistant',
                    content: response.content,
                    tokenCount: response.usage.completionTokens,
                    turnIndex: this.context.turns.length,
                    compressed: false
                });
                return response.content;
            }
        }

        throw new LemuraMaxIterationsError(`Exceeded max iterations of ${maxIts}`);
    }
}
