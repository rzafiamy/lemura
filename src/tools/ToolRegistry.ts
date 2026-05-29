import {
    IToolDefinition,
    LemuraToolNotFoundError,
    LemuraToolValidationError,
    LemuraToolTimeoutError,
    ToolContext
} from '../types/index.js';
import { validateJsonSchema } from './SchemaValidator.js';

/** Options for ToolRegistry behaviour. */
export interface ToolRegistryOptions {
    /**
     * Default timeout in milliseconds for each tool execution.
     * Individual tools may override this (see `IToolDefinition.timeoutMs`).
     * @default 30000
     */
    defaultTimeoutMs?: number;
}

/**
 * Manages registered tools and their execution lifecycle.
 *
 * Features:
 * - Registers tools by name (snake_case)
 * - Validates params against the tool's JSON Schema before execution (standalone, no Ajv)
 * - Enforces per-call timeout via `defaultTimeoutMs` / per-tool timeout
 * - Throws typed `LemuraError` subclasses for all failure modes
 *
 * @example
 * const registry = new ToolRegistry([myTool], { defaultTimeoutMs: 15_000 });
 * const result = await registry.execute('my_tool', params, context);
 */
export class ToolRegistry {
    private tools: Map<string, IToolDefinition> = new Map();
    private defaultTimeoutMs: number;

    constructor(initialTools: IToolDefinition[] = [], options: ToolRegistryOptions = {}) {
        this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
        for (const tool of initialTools) {
            this.register(tool);
        }
    }

    /**
     * Registers a tool. Throws if a tool with the same name is already registered.
     *
     * @param tool - The tool definition to register
     * @throws {LemuraError} If `tool.name` is already taken
     */
    register(tool: IToolDefinition): void {
        if (this.tools.has(tool.name)) {
            throw new LemuraToolNotFoundError(`Tool '${tool.name}' is already registered. Use a unique name.`);
        }
        this.tools.set(tool.name, tool);
    }

    /**
     * Removes a registered tool by name.
     *
     * @param name - The tool name to unregister
     */
    unregister(name: string): boolean {
        return this.tools.delete(name);
    }

    /**
     * Returns the tool definition for `name`, or `undefined` if not found.
     *
     * @param name - Tool name to look up
     */
    get(name: string): IToolDefinition | undefined {
        return this.tools.get(name);
    }

    /**
     * Returns all registered tool definitions.
     */
    getAll(): IToolDefinition[] {
        return Array.from(this.tools.values());
    }

    /**
     * Executes a single tool call with schema validation and timeout enforcement.
     *
     * @param name - The tool name to execute
     * @param params - The raw parameter object (validated against the tool's JSON Schema)
     * @param context - Execution context (session, logger, adapters)
     * @returns The tool's result
     * @throws {LemuraToolNotFoundError} If the tool is not registered
     * @throws {LemuraToolValidationError} If params fail JSON Schema validation
     * @throws {LemuraToolTimeoutError} If execution exceeds the configured timeout
     */
    async execute(name: string, params: unknown, context: ToolContext): Promise<unknown> {
        const tool = this.tools.get(name);
        if (!tool) {
            throw new LemuraToolNotFoundError(`Tool '${name}' not found in registry.`);
        }

        // --- JSON Schema validation (standalone, no external lib) ---
        if (tool.parameters && typeof tool.parameters === 'object') {
            const schemaErrors = validateJsonSchema(params, tool.parameters as Record<string, unknown>);
            if (schemaErrors.length > 0) {
                const msg = schemaErrors.map(e => (e.path ? `[${e.path}] ${e.message}` : e.message)).join('; ');
                throw new LemuraToolValidationError(
                    `Tool '${name}' parameter validation failed: ${msg}`
                );
            }
        }

        // --- Timeout enforcement ---
        const timeoutMs: number = tool.timeoutMs ?? this.defaultTimeoutMs;

        const startMs = Date.now();
        const executionPromise = tool.execute(params, context);

        const timeoutPromise = new Promise<never>((_, reject) => {
            const id = setTimeout(() => {
                clearTimeout(id);
                reject(new LemuraToolTimeoutError(
                    `Tool '${name}' timed out after ${timeoutMs}ms`
                ));
            }, timeoutMs);
        });

        try {
            const result = await Promise.race([executionPromise, timeoutPromise]);
            context.logger.debug(`Tool '${name}' completed in ${Date.now() - startMs}ms`);
            return result;
        } catch (err: unknown) {
            const elapsedMs = Date.now() - startMs;
            if (err instanceof LemuraToolTimeoutError) {
                context.logger.error(`Tool '${name}' timed out after ${elapsedMs}ms (limit: ${timeoutMs}ms)`, {
                    problem: `Tool '${name}' did not respond within its timeout.`,
                    hints: [
                        `Increase the tool's timeoutMs (currently ${timeoutMs}ms) or optimise its implementation.`,
                        `Check whether the external service the tool depends on is healthy.`
                    ]
                });
                throw err;
            }
            if (err instanceof LemuraToolValidationError) {
                throw err;
            }
            const message = err instanceof Error ? err.message : String(err);
            context.logger.error(`Tool '${name}' failed after ${elapsedMs}ms: ${message}`);
            throw new LemuraToolValidationError(
                `Tool '${name}' execution failed: ${message}`
            );
        }
    }

    /**
     * Executes multiple tool calls in parallel.
     * All calls are issued simultaneously; results are returned in the same order as `calls`.
     * Individual errors are captured per-call without aborting the others.
     *
     * @param calls - Array of `{ name, params }` objects
     * @param context - Shared execution context
     * @returns Array of `{ toolCallId, result?, error? }` in input order
     *
     * @example
     * const results = await registry.executeParallel(
     *   [{ name: 'search_web', params: { query: 'foo' } }],
     *   context
     * );
     */
    async executeParallel(
        calls: Array<{ id: string; name: string; params: unknown }>,
        context: ToolContext
    ): Promise<Array<{ id: string; result?: unknown; error?: Error }>> {
        return Promise.all(
            calls.map(async call => {
                try {
                    const result = await this.execute(call.name, call.params, context);
                    return { id: call.id, result };
                } catch (err: unknown) {
                    return { id: call.id, error: err instanceof Error ? err : new Error(String(err)) };
                }
            })
        );
    }
}
