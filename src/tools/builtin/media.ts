import { IToolDefinition, ToolContext } from '../../types/index.js';
import { LemuraAdapterError } from '../../types/errors.js';

const defaultPrefix = 'media_';

function requireAdapter(context: ToolContext) {
    if (!context.adapter) {
        throw new LemuraAdapterError('Provider adapter is missing from tool context', 'ADAPTER_MISSING');
    }
    return context.adapter;
}

export function createMediaTools(prefix: string = defaultPrefix): IToolDefinition[] {
    const p = prefix || defaultPrefix;

    const transcribeTool: IToolDefinition = {
        name: `${p}transcribe`,
        description: 'Transcribe audio from base64 into text.',
        parameters: {
            type: 'object',
            properties: {
                audioBase64: { type: 'string', description: 'Base64-encoded audio payload.' },
                mimeType: { type: 'string', description: 'Audio MIME type like audio/wav or audio/mpeg.' },
                language: { type: 'string', description: 'Optional language hint like en, fr.' },
                model: { type: 'string', description: 'Optional model override for ASR.' }
            },
            required: ['audioBase64', 'mimeType']
        },
        async execute(params: any, context: ToolContext) {
            const adapter = requireAdapter(context);
            const result = await adapter.transcribe({
                audioBase64: params.audioBase64,
                mimeType: params.mimeType,
                language: params.language,
                model: params.model
            });
            return result;
        }
    };

    const synthesizeTool: IToolDefinition = {
        name: `${p}synthesize`,
        description: 'Synthesize text to speech and return audio chunks (base64).',
        parameters: {
            type: 'object',
            properties: {
                text: { type: 'string', description: 'Text to synthesize.' },
                voiceId: { type: 'string', description: 'Voice identifier.' },
                format: { type: 'string', enum: ['mp3', 'wav', 'pcm'] },
                model: { type: 'string', description: 'Optional model override for TTS.' }
            },
            required: ['text', 'voiceId', 'format']
        },
        async execute(params: any, context: ToolContext) {
            const adapter = requireAdapter(context);
            const chunks = [] as { audioBase64: string }[];
            for await (const chunk of adapter.synthesize({
                text: params.text,
                voiceId: params.voiceId,
                format: params.format,
                model: params.model
            })) {
                chunks.push(chunk);
            }
            return { chunks };
        }
    };

    const visionTool: IToolDefinition = {
        name: `${p}describe_image`,
        description: 'Describe an image from base64 and optional prompt.',
        parameters: {
            type: 'object',
            properties: {
                imageBase64: { type: 'string', description: 'Base64-encoded image payload.' },
                prompt: { type: 'string', description: 'Optional instruction or focus for description.' },
                model: { type: 'string', description: 'Optional model override for vision.' }
            },
            required: ['imageBase64']
        },
        async execute(params: any, context: ToolContext) {
            const adapter = requireAdapter(context);
            const result = await adapter.describeImage({
                imageBase64: params.imageBase64,
                prompt: params.prompt,
                model: params.model
            });
            return result;
        }
    };

    const imageGenTool: IToolDefinition = {
        name: `${p}generate_image`,
        description: 'Generate an image from a prompt.',
        parameters: {
            type: 'object',
            properties: {
                prompt: { type: 'string', description: 'Text prompt for the image.' },
                dimensions: { type: 'string', description: 'Image size like 1024x1024.' },
                model: { type: 'string', description: 'Optional model override for image generation.' }
            },
            required: ['prompt', 'dimensions']
        },
        async execute(params: any, context: ToolContext) {
            const adapter = requireAdapter(context);
            const result = await adapter.generateImage({
                prompt: params.prompt,
                dimensions: params.dimensions,
                model: params.model
            });
            return result;
        }
    };

    return [transcribeTool, synthesizeTool, visionTool, imageGenTool];
}
