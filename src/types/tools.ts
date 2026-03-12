import { IRAGAdapter } from './rag.js';
import { ILogger } from './logger.js';
import { IProviderAdapter } from './adapters.js';

import { ShortTermMemoryRegistry } from '../context/ShortTermMemoryRegistry.js';

export interface ToolContext {
    sessionId: string;
    turnIndex: number;
    logger: ILogger;
    adapter?: IProviderAdapter;
    ragAdapter?: IRAGAdapter;
    stmRegistry?: ShortTermMemoryRegistry;
    scratchpad?: string;
}

export interface IToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON Schema
    execute(params: unknown, context: ToolContext): Promise<unknown>;
}
