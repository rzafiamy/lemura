import {
    IProviderAdapter,
    CompletionRequest,
    CompletionResponse,
    CompletionChunk,
    TranscriptionRequest,
    TranscriptionResponse,
    SynthesisRequest,
    AudioChunk,
    VisionRequest,
    VisionResponse,
    ImageGenRequest,
    ImageGenResponse,
    ModelInfo,
    LemuraAdapterError,
} from '../types/index.js';

export interface RetryConfig {
    maxRetries: number;
    baseDelayMs: number;
}

export interface OpenAICompatibleAdapterConfig {
    baseUrl: string;
    apiKey: string;
    defaultModel: string;
    defaultHeaders?: Record<string, string>;
    timeout?: number;
    retry?: RetryConfig;
}

/**
 * Reference implementation of an OpenAI-compatible provider adapter.
 */
export class OpenAICompatibleAdapter implements IProviderAdapter {
    readonly name = 'openai_compatible';
    readonly version = '1.0.0';

    private baseUrl: string;
    private apiKey: string;
    private defaultModel: string;
    private defaultHeaders: Record<string, string>;
    private timeoutMs: number;
    private retryConfig: RetryConfig;

    constructor(config: OpenAICompatibleAdapterConfig) {
        this.baseUrl = config.baseUrl.replace(/\/$/, '');
        this.apiKey = config.apiKey;
        this.defaultModel = config.defaultModel;
        this.defaultHeaders = config.defaultHeaders || {};
        this.timeoutMs = config.timeout || 30000;
        this.retryConfig = config.retry || { maxRetries: 2, baseDelayMs: 1000 };
    }

    private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
        let attempts = 0;
        while (attempts <= this.retryConfig.maxRetries) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

                const response = await fetch(url, {
                    ...init,
                    signal: controller.signal,
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json',
                        ...this.defaultHeaders,
                        ...init.headers,
                    },
                });

                clearTimeout(timeoutId);

                if (response.ok) return response;

                // Retry on 429 and 503
                if ((response.status === 429 || response.status === 503) && attempts < this.retryConfig.maxRetries) {
                    attempts++;
                    const delay = this.retryConfig.baseDelayMs * Math.pow(2, attempts - 1);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }

                const errorText = await response.text().catch(() => '');
                throw new LemuraAdapterError(`HTTP ${response.status}: ${errorText}`, 'HTTP_ERROR', { status: response.status });
            } catch (err) {
                if (err instanceof LemuraAdapterError) throw err;

                if (attempts < this.retryConfig.maxRetries) {
                    attempts++;
                    const delay = this.retryConfig.baseDelayMs * Math.pow(2, attempts - 1);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
                throw new LemuraAdapterError(`Network request failed: ${err instanceof Error ? err.message : String(err)}`, 'NETWORK_ERROR', err);
            }
        }
        throw new LemuraAdapterError('Max retries exceeded', 'MAX_RETRIES');
    }

    private mapFinishReason(reason: string | null): CompletionResponse['finishReason'] {
        if (!reason) return 'stop';
        const r = reason.toLowerCase();
        if (r === 'tool_calls' || r === 'tool_call') return 'tool_call';
        if (r === 'length' || r === 'max_tokens') return 'max_tokens';
        if (r === 'content_filter' || r === 'error') return 'error';
        return 'stop';
    }

    private buildPayload(request: CompletionRequest): unknown {
        const payload: Record<string, unknown> = {
            model: request.model || this.defaultModel,
            messages: request.messages,
        };
        if (request.maxTokens !== undefined) payload.max_tokens = request.maxTokens;
        if (request.temperature !== undefined) payload.temperature = request.temperature;
        if (request.stopSequences?.length) payload.stop = request.stopSequences;
        if (request.stream) payload.stream = true;

        if (request.tools && request.tools.length > 0) {
            payload.tools = request.tools.map(t => ({
                type: 'function',
                function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.parameters,
                }
            }));
        }

        return payload;
    }

    async complete(request: CompletionRequest): Promise<CompletionResponse> {
        const payload = this.buildPayload(request);

        const response = await this.fetchWithRetry(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        const choice = data.choices?.[0];
        if (!choice) {
            throw new LemuraAdapterError('Invalid response format: missing choices', 'INVALID_RESPONSE', data);
        }

        const message = choice.message;
        let toolCalls;

        if (message.tool_calls && message.tool_calls.length > 0) {
            toolCalls = message.tool_calls.map((tc: any) => ({
                id: tc.id,
                name: tc.function.name,
                arguments: tc.function.arguments,
            }));
        }

        return {
            content: message.content || '',
            toolCalls,
            finishReason: this.mapFinishReason(choice.finish_reason),
            usage: {
                promptTokens: data.usage?.prompt_tokens || 0,
                completionTokens: data.usage?.completion_tokens || 0,
                totalTokens: data.usage?.total_tokens || 0,
            },
            rawResponse: data
        };
    }

    async *stream(request: CompletionRequest): AsyncIterable<CompletionChunk> {
        const payload = this.buildPayload({ ...request, stream: true });

        const response = await this.fetchWithRetry(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        if (!response.body) {
            throw new LemuraAdapterError('Response body is null', 'STREAM_ERROR');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed === 'data: [DONE]') continue;
                    if (trimmed.startsWith('data: ')) {
                        const jsonStr = trimmed.slice(6);
                        let data;
                        try {
                            data = JSON.parse(jsonStr);
                        } catch (err) {
                            continue;
                        }

                        const choice = data.choices?.[0];
                        if (!choice) continue;

                        const delta = choice.delta?.content || '';
                        const toolCallBlock = choice.delta?.tool_calls?.[0];
                        let toolCallDelta;

                        if (toolCallBlock) {
                            toolCallDelta = {
                                id: toolCallBlock.id,
                                name: toolCallBlock.function?.name,
                                arguments: toolCallBlock.function?.arguments,
                            };
                        }

                        const isFinished = choice.finish_reason !== null && choice.finish_reason !== undefined;

                        yield {
                            delta,
                            finished: isFinished,
                            ...(toolCallDelta && { toolCallDelta }),
                            ...(isFinished && { finishReason: this.mapFinishReason(choice.finish_reason) })
                        };
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
    }

    estimateTokens(text: string): number {
        return Math.ceil(text.length / 4);
    }

    getModelInfo(): ModelInfo {
        return {
            supportsVision: true,
            supportsTools: true,
            contextWindow: 128000
        };
    }

    async healthCheck(): Promise<boolean> {
        try {
            const resp = await this.fetchWithRetry(`${this.baseUrl}/models`, { method: 'GET' });
            return resp.ok;
        } catch {
            return false;
        }
    }

    // Unsupported methods throw standard error
    async transcribe(request: TranscriptionRequest): Promise<TranscriptionResponse> {
        throw new LemuraAdapterError('ASR not supported by this adapter implementation directly without FormData mapping.', 'CAPABILITY_NOT_SUPPORTED');
    }

    async *synthesize(request: SynthesisRequest): AsyncIterable<AudioChunk> {
        throw new LemuraAdapterError('TTS not supported by this implementation directly', 'CAPABILITY_NOT_SUPPORTED');
    }

    async describeImage(request: VisionRequest): Promise<VisionResponse> {
        throw new LemuraAdapterError('Vision not implemented yet', 'CAPABILITY_NOT_SUPPORTED');
    }

    async generateImage(request: ImageGenRequest): Promise<ImageGenResponse> {
        throw new LemuraAdapterError('Image generation not implemented yet', 'CAPABILITY_NOT_SUPPORTED');
    }
}
