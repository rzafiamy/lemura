import { IRAGAdapter } from './rag.js';

export interface ILogger {
    debug(message: string, ...args: unknown[]): void;
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
}

export interface ToolContext {
    sessionId: string;
    turnIndex: number;
    logger: ILogger;
    ragAdapter?: IRAGAdapter;
}

export interface IToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON Schema
    execute(params: unknown, context: ToolContext): Promise<unknown>;
}
