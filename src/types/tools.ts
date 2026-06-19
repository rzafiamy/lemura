import { IRAGAdapter } from './rag.js';
import { ILogger } from './logger.js';
import { IProviderAdapter } from './adapters.js';
import { IScratchpadAdapter } from './storage.js';

import { ShortTermMemoryRegistry } from '../context/ShortTermMemoryRegistry.js';
import type { MemoryManager } from '../memory/MemoryManager.js';

export interface ToolContext {
    sessionId: string;
    turnIndex: number;
    logger: ILogger;
    adapter?: IProviderAdapter;
    ragAdapter?: IRAGAdapter;
    stmRegistry?: ShortTermMemoryRegistry;
    scratchpad?: string;
    scratchpadAdapter?: IScratchpadAdapter;
    /** Long-term memory orchestrator. Present when `SessionConfig.memory` is set. @since 1.8.0 */
    memory?: MemoryManager;
}

export interface IToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON Schema
    /** Per-call timeout in milliseconds. Falls back to ToolRegistry.defaultTimeoutMs when omitted. */
    timeoutMs?: number;
    /**
     * Optional category used by the router (see `SessionConfig.enableRouting`) to
     * narrow which tools are exposed to the model on a given turn. Open string —
     * lemura does not own a fixed catalog. Tools left uncategorized are never
     * filtered out (treated as always available).
     *
     * @since 1.6.0
     */
    category?: string;
    execute(params: unknown, context: ToolContext): Promise<unknown>;
}
