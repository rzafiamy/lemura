# Media Bridge

Media Bridge is the app-friendly API for audio, vision, and image generation. It wraps the adapter’s multimodal methods into a single class so you can plug it into any app without writing custom glue code.

## Quick Start

```ts
import { MediaBridge, OpenAICompatibleAdapter } from 'lemura';

const adapter = new OpenAICompatibleAdapter({
  baseUrl: 'https://api.openai.com/v1',
  apiKey: process.env.OPENAI_API_KEY || '',
  defaultModel: 'gpt-4o-mini'
});

const media = new MediaBridge(adapter);

await media.transcribe({
  audioBase64: '<base64-audio>',
  mimeType: 'audio/wav',
  model: 'whisper-1'
});

await media.describeImage({
  imageBase64: '<base64-image>',
  model: 'gpt-4o-mini'
});

await media.generateImage({
  prompt: 'A clean desktop app icon, flat, orange',
  dimensions: '1024x1024',
  model: 'dall-e-3'
});
```

## Select Model Per Modality
Each request supports an optional `model` field. This lets you use a different model for each modality in the same app.

```ts
await media.transcribe({ audioBase64, mimeType: 'audio/wav', model: 'whisper-1' });

for await (const chunk of media.synthesize({
  text: 'Hello',
  voiceId: 'alloy',
  format: 'mp3',
  model: 'tts-1'
})) {
  // chunk.audioBase64
}

await media.describeImage({ imageBase64, model: 'gpt-4o-mini' });
await media.generateImage({ prompt: 'Icon', dimensions: '1024x1024', model: 'dall-e-3' });
```

If you want all audio chunks collected before playback:

```ts
const chunks = await media.synthesizeToArray({
  text: 'Hello',
  voiceId: 'alloy',
  format: 'mp3',
  model: 'tts-1'
});
```

## Capability Checks (Vision Support)
You can detect whether the current adapter/model supports vision:

```ts
const info = media.getModelInfo();
if (!info.supportsVision) {
  throw new Error('Vision not supported by this adapter/model.');
}
```

Convenience check:

```ts
if (!media.supportsVision()) {
  throw new Error('Vision not supported by this adapter/model.');
}
```

## In This Section

| Page | What it covers |
|---|---|
| [ASR & Transcription →](/docs/media-bridge/asr-transcription) | Automated speech recognition and transcription patterns |
| [TTS & Synthesis →](/docs/media-bridge/tts-synthesis) | Text-to-speech synthesis and streaming audio |
| [Vision & Description →](/docs/media-bridge/vision-description) | Computer vision, object detection, and scene analysis |
| [Image Generation →](/docs/media-bridge/image-generation) | Generating images from prompts with various styles |
| [Bridge Orchestration →](/docs/media-bridge/bridge-orchestration) | Combining modalities for multi-sensory agent experiences |

## Use as Tools
You can expose media as callable tools for the agent.

```ts
const session = new SessionManager({
  adapter,
  model: 'gpt-4o-mini',
  maxTokens: 100000,
  media: { enableTools: true, toolPrefix: 'media_' }
});
```

This registers:
- `media_transcribe`
- `media_synthesize`
- `media_describe_image`
- `media_generate_image`
