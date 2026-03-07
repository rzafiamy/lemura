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
    baseUrl?: string;
    apiKey?: string;
    defaultModel?: string;
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

    constructor(config: OpenAICompatibleAdapterConfig = {}) {
        this.baseUrl = (
            config.baseUrl ??
            process.env.LEMURA_BASE_URL ??
            process.env.OPENAI_BASE_URL ??
            'https://api.openai.com/v1'
        ).replace(/\/$/, '');

        this.apiKey = config.apiKey ?? process.env.LEMURA_API_KEY ?? process.env.OPENAI_API_KEY ?? '';
        this.defaultModel = config.defaultModel ?? process.env.LEMURA_MODEL ?? process.env.OPENAI_MODEL ?? 'gpt-3.5-turbo';

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

                const headers: Record<string, string> = {
                    'Authorization': `Bearer ${this.apiKey}`,
                    ...this.defaultHeaders,
                };

                if (init.headers) {
                    Object.assign(headers, init.headers);
                }

                // Don't set Content-Type if it's 'unset' (for FormData)
                if (headers['Content-Type'] === 'unset') {
                    delete headers['Content-Type'];
                } else if (!headers['Content-Type']) {
                    headers['Content-Type'] = 'application/json';
                }

                const response = await fetch(url, {
                    ...init,
                    signal: controller.signal,
                    headers,
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
                let problem = 'The server replied with an error during the API call.';
                let hints = ['Check the API documentation for the provider you are using.'];

                if (response.status === 401) {
                    problem = 'Authentication failed. The API key is invalid or missing.';
                    hints = [
                        'Ensure your API key is correctly configured in the adapter or environment variables.',
                        'Check if the API key has expired or been revoked.'
                    ];
                } else if (response.status === 404) {
                    problem = 'The requested resource or model was not found.';
                    hints = [
                        'Verify that the baseUrl is correct (e.g., https://api.openai.com/v1).',
                        'Check if the model name is correct and available for your account.',
                        'Ensure you are not appending extra paths to the baseUrl.'
                    ];
                } else if (response.status === 429) {
                    problem = 'Rate limit exceeded.';
                    hints = [
                        'Wait a few seconds before retrying.',
                        'Check your usage limits and billing status on the provider dashboard.'
                    ];
                }

                throw new LemuraAdapterError(
                    `HTTP ${response.status}: ${errorText}`,
                    'HTTP_ERROR',
                    { status: response.status, body: errorText },
                    problem,
                    hints
                );
            } catch (err) {
                if (err instanceof LemuraAdapterError) throw err;

                if (attempts < this.retryConfig.maxRetries) {
                    attempts++;
                    const delay = this.retryConfig.baseDelayMs * Math.pow(2, attempts - 1);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }

                throw new LemuraAdapterError(
                    `Network request failed: ${err instanceof Error ? err.message : String(err)}`,
                    'NETWORK_ERROR',
                    err,
                    'A network error occurred while connecting to the provider.',
                    [
                        'Check your internet connection.',
                        'Verify that the baseUrl is reachable from your network.',
                        'Check for proxy or firewall settings that might block the request.'
                    ]
                );
            }
        }
        throw new LemuraAdapterError(
            'Max retries exceeded',
            'MAX_RETRIES',
            undefined,
            'The request failed after multiple retry attempts.',
            ['Check if the provider service is down or experiencing high load.']
        );
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

    async transcribe(request: TranscriptionRequest): Promise<TranscriptionResponse> {
        const binaryString = atob(request.audioBase64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: request.mimeType });
        const formData = new FormData();
        formData.append('file', blob, 'audio.webm');
        formData.append('model', 'whisper-1');
        if (request.language) formData.append('language', request.language);

        const response = await this.fetchWithRetry(`${this.baseUrl}/audio/transcriptions`, {
            method: 'POST',
            body: formData,
            headers: {
                'Content-Type': 'unset'
            }
        });

        const data = await response.json();
        return {
            transcript: data.text,
            confidence: 1.0, // OpenAI doesn't return confidence in standard response
            language: data.language || request.language || 'en'
        };
    }

    async *synthesize(request: SynthesisRequest): AsyncIterable<AudioChunk> {
        const response = await this.fetchWithRetry(`${this.baseUrl}/audio/speech`, {
            method: 'POST',
            body: JSON.stringify({
                model: 'tts-1',
                input: request.text,
                voice: request.voiceId || 'alloy',
                response_format: request.format || 'mp3'
            })
        });

        if (!response.body) throw new LemuraAdapterError('No response body for TTS', 'STREAM_ERROR');

        const reader = response.body.getReader();
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value) {
                    const binary = new TextDecoder('latin1').decode(value);
                    yield { audioBase64: btoa(binary) };
                }
            }
        } finally {
            reader.releaseLock();
        }
    }

    async describeImage(request: VisionRequest): Promise<VisionResponse> {
        const payload = {
            model: this.defaultModel,
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: request.prompt || 'Describe this image' },
                        {
                            type: 'image_url',
                            image_url: {
                                url: `data:image/jpeg;base64,${request.imageBase64}`
                            }
                        }
                    ]
                }
            ]
        };

        const response = await this.fetchWithRetry(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        return {
            description: data.choices[0].message.content,
            objects: [] // OpenAI doesn't return structured objects in standard vision call
        };
    }

    async generateImage(request: ImageGenRequest): Promise<ImageGenResponse> {
        const response = await this.fetchWithRetry(`${this.baseUrl}/images/generations`, {
            method: 'POST',
            body: JSON.stringify({
                prompt: request.prompt,
                model: 'dall-e-3',
                n: 1,
                size: request.dimensions || '1024x1024'
            })
        });

        const data = await response.json();
        return {
            imageUrl: data.data[0].url,
            revisedPrompt: data.data[0].revised_prompt
        };
    }
}
