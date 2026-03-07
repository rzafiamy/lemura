import { ToolCall } from './adapters.js';

export interface ContentBlock {
    type: string;
    text?: string;
    imageUrl?: string;
    [key: string]: unknown;
}

export interface ToolResult {
    toolCallId: string;
    content: string;
}

export interface Turn {
    role: 'user' | 'assistant' | 'tool' | 'system';
    content: string | ContentBlock[];
    tokenCount: number;
    turnIndex: number;
    compressed: boolean;
    toolCalls?: ToolCall[];
    toolResults?: ToolResult[];
}

export interface ContextWindow {
    systemPrompt: string;
    scratchpad: string;
    turns: Turn[];
    tokenCount: number;
    maxTokens: number;
    compressionSummary?: string;
    metadata: Record<string, unknown>;
}

export interface IContextStrategy {
    name: string;
    priority: number;
    shouldApply(ctx: ContextWindow): boolean;
    apply(ctx: ContextWindow): Promise<ContextWindow>;
}
