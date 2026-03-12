import {
    IProviderAdapter,
    TranscriptionRequest,
    TranscriptionResponse,
    SynthesisRequest,
    AudioChunk,
    VisionRequest,
    VisionResponse,
    ImageGenRequest,
    ImageGenResponse
} from '../types/index.js';

/**
 * MediaBridge provides a single, app-friendly entry point for audio/vision/image features.
 */
export class MediaBridge {
    private adapter: IProviderAdapter;

    constructor(adapter: IProviderAdapter) {
        this.adapter = adapter;
    }

    transcribe(request: TranscriptionRequest): Promise<TranscriptionResponse> {
        return this.adapter.transcribe(request);
    }

    synthesize(request: SynthesisRequest): AsyncIterable<AudioChunk> {
        return this.adapter.synthesize(request);
    }

    async synthesizeToArray(request: SynthesisRequest): Promise<AudioChunk[]> {
        const chunks: AudioChunk[] = [];
        for await (const chunk of this.adapter.synthesize(request)) {
            chunks.push(chunk);
        }
        return chunks;
    }

    describeImage(request: VisionRequest): Promise<VisionResponse> {
        return this.adapter.describeImage(request);
    }

    generateImage(request: ImageGenRequest): Promise<ImageGenResponse> {
        return this.adapter.generateImage(request);
    }

    getModelInfo() {
        return this.adapter.getModelInfo();
    }

    supportsVision(): boolean {
        return this.adapter.getModelInfo().supportsVision;
    }
}
