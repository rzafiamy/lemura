import { LemuraAdapterError } from './errors.js';
import { IToolDefinition } from './tools.js';
import { ContentBlock } from './context.js';

/** Represents a single message in the provider format */
export interface NormalizedMessage {
    /** The role of the message sender */
    role: 'system' | 'user' | 'assistant' | 'tool';
    /** The text or multimodal content of the message */
    content: string | ContentBlock[];
    /** Name of the tool, required if role is 'tool' */
    name?: string;
    /** Tool calls made by the assistant, present if role is 'assistant' */
    toolCalls?: ToolCall[];
}

/** A request strictly normalized for the provider */
export interface CompletionRequest {
    /** Model ID to use */
    model: string;
    /** The array of messages to send to the provider */
    messages: NormalizedMessage[];
    /** Optional array of tool definitions */
    tools?: IToolDefinition[];
    /** Maximum number of tokens to generate */
    maxTokens?: number;
    /** Generation temperature */
    temperature?: number;
    /** Optional array of sequences that will stop generation */
    stopSequences?: string[];
    /** Whether to stream the response back */
    stream?: boolean;
}

/** Tracking of model token usage */
export interface TokenUsage {
    /** Tokens in the prompt */
    promptTokens: number;
    /** Tokens in the completion */
    completionTokens: number;
    /** Total tokens used */
    totalTokens: number;
}

/** Structure of a tool call requested by the model */
export interface ToolCall {
    /** Unique ID for the tool call */
    id: string;
    /** Name of the tool to be invoked */
    name: string;
    /** JSON string of arguments to pass to the tool */
    arguments: string;
}

/** Standard response from a non-streaming completion */
export interface CompletionResponse {
    /** The text content generated */
    content: string;
    /** Optional tool calls requested */
    toolCalls?: ToolCall[];
    /** The reason generation stopped */
    finishReason: 'stop' | 'tool_call' | 'max_tokens' | 'error';
    /** Token usage statistics */
    usage: TokenUsage;
    /** The unparsed provider response for debugging */
    rawResponse?: unknown;
}

/** Structure of a yielded chunk during a streaming completion */
export interface CompletionChunk {
    /** The newly generated text delta */
    delta: string;
    /** Partial tool call delta if generating a tool call */
    toolCallDelta?: Partial<ToolCall>;
    /** True if this is the final chunk */
    finished: boolean;
    /** The reason generation stopped, typically present only on the final chunk */
    finishReason?: CompletionResponse['finishReason'];
    /** Optional token usage stats, typically only present on the final chunk */
    usage?: TokenUsage;
}

/* Multimodal Interfaces - Partial specs matching the rules */

export interface TranscriptionRequest {
    audioBase64: string;
    mimeType: string;
    language?: string;
    model?: string;
}

export interface TranscriptionResponse {
    transcript: string;
    confidence: number;
    language: string;
}

export interface SynthesisRequest {
    text: string;
    voiceId: string;
    format: 'mp3' | 'wav' | 'pcm';
    model?: string;
}

export interface AudioChunk {
    audioBase64: string;
}

export interface VisionRequest {
    imageBase64: string;
    prompt?: string;
    model?: string;
}

export interface VisionResponse {
    description: string;
    objects: string[];
}

export interface ImageGenRequest {
    prompt: string;
    dimensions: string;
    model?: string;
}

export interface ImageGenResponse {
    imageUrl: string;
    revisedPrompt?: string;
}

/** Basic info about the model's capabilities */
export interface ModelInfo {
    /** Does it support vision? */
    supportsVision: boolean;
    /** Does it support tools? */
    supportsTools: boolean;
    /** Maximum context window size */
    contextWindow: number;
}

/**
 * Interface that all provider adapters must implement.
 *
 * @example
 * class MyAdapter implements IProviderAdapter {
 *   readonly name = 'custom';
 *   readonly version = '1.0.0';
 *   async complete(request) { ... }
 *   ...
 * }
 */
export interface IProviderAdapter {
    /** The name of the adapter implementation */
    readonly name: string;
    /** The version of the adapter implementation */
    readonly version: string;

    /**
     * Generates a single completion response.
     *
     * @param request - Normalized completion request parameters
     * @returns A promise resolving to the normalized completion response
     * @throws {LemuraAdapterError} When the API fails or capabilities are missing
     */
    complete(request: CompletionRequest): Promise<CompletionResponse>;

    /**
     * Streams a completion response back in chunks.
     *
     * @param request - Normalized completion request parameters
     * @returns An async iterable yielding completion chunks
     * @throws {LemuraAdapterError} When the API fails
     */
    stream(request: CompletionRequest): AsyncIterable<CompletionChunk>;

    // Multimodal optional methods
    transcribe(request: TranscriptionRequest): Promise<TranscriptionResponse>;
    synthesize(request: SynthesisRequest): AsyncIterable<AudioChunk>;
    describeImage(request: VisionRequest): Promise<VisionResponse>;
    generateImage(request: ImageGenRequest): Promise<ImageGenResponse>;

    /**
     * Estimates token count for standard text.
     *
     * @param text - The string to measure
     * @returns The estimated number of tokens
     */
    estimateTokens(text: string): number;

    /**
     * Gets details about the underlying model's capabilities.
     *
     * @returns An object describing model features
     */
    getModelInfo(): ModelInfo;

    /**
     * Verify whether the adapter is healthy and reachable.
     *
     * @returns A promise resolving to true if healthy, false otherwise
     */
    healthCheck(): Promise<boolean>;
}
