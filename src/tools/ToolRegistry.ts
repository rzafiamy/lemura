import { IToolDefinition, LemuraToolNotFoundError, LemuraToolValidationError, ToolContext } from '../types/index.js';

/**
 * Manages registered tools and their execution
 */
export class ToolRegistry {
    private tools: Map<string, IToolDefinition> = new Map();

    constructor(initialTools: IToolDefinition[] = []) {
        for (const tool of initialTools) {
            this.register(tool);
        }
    }

    register(tool: IToolDefinition): void {
        if (this.tools.has(tool.name)) {
            throw new Error(`Tool ${tool.name} is already registered.`);
        }
        this.tools.set(tool.name, tool);
    }

    get(name: string): IToolDefinition | undefined {
        return this.tools.get(name);
    }

    getAll(): IToolDefinition[] {
        return Array.from(this.tools.values());
    }

    async execute(name: string, params: unknown, context: ToolContext): Promise<unknown> {
        const tool = this.tools.get(name);
        if (!tool) {
            throw new LemuraToolNotFoundError(`Tool '${name}' not found.`);
        }

        try {
            // Basic JSON schema validation logic goes here
            // Real implementation would use Ajv or similar to validate `params` against `tool.parameters`
            const result = await tool.execute(params, context);
            return result;
        } catch (err: any) {
            if (err instanceof LemuraToolValidationError) {
                throw err;
            }
            throw new Error(`Tool execution failed for '${name}': ${err.message}`);
        }
    }
}
