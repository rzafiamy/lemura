# Streaming & Multimodal

Beyond text completion, lemura's adapter interface covers real-time streaming, audio (ASR + TTS), vision, and image generation.

---

## Streaming Text

`stream()` returns an `AsyncIterable<CompletionChunk>` — consume it with `for await...of`:

```typescript
const session = new SessionManager({ adapter, model: 'gpt-4o', maxTokens: 128_000 });

// Via SessionManager (handles the full ReAct loop, streaming final response)
for await (const chunk of session.stream("Explain quantum entanglement")) {
  process.stdout.write(chunk.delta);
  if (chunk.finished) break;
}
```

### CompletionChunk type

```typescript
interface CompletionChunk {
  delta: string;                                        // New token(s) in this chunk
  toolCallDelta?: Partial<ToolCall>;                    // Partial tool call (if streaming tool use)
  finished: boolean;                                    // True on the last chunk
  finishReason?: 'stop' | 'tool_call' | 'max_tokens' | 'error';
}
```

### Streaming with tool calls

When the model calls a tool mid-stream, the chunks carry partial tool call data:

```typescript
let currentToolCall: Partial<ToolCall> | null = null;

for await (const chunk of session.stream(message)) {
  if (chunk.delta) {
    // Regular text delta — display to user
    process.stdout.write(chunk.delta);
  }

  if (chunk.toolCallDelta) {
    // Tool call data is arriving incrementally
    currentToolCall = { ...currentToolCall, ...chunk.toolCallDelta };
  }

  if (chunk.finished) {
    console.log(`\nFinished: ${chunk.finishReason}`);
    break;
  }
}
```

> **Tip:** For most use cases, using `session.stream()` is simpler than `adapter.stream()` directly. `session.stream()` handles the full ReAct loop including tool execution — `adapter.stream()` is a single raw LLM call.

---

## ASR — Audio Transcription

Convert speech to text using `adapter.transcribe()`:

```typescript
interface TranscriptionRequest {
  audio: Blob | ArrayBuffer; // Audio data
  mimeType: string;          // 'audio/webm', 'audio/mp4', 'audio/wav'
  languageHint?: string;     // BCP-47 code e.g. 'en', 'fr', 'ja'
  prompt?: string;           // Context hint to improve accuracy
}

interface TranscriptionResponse {
  transcript: string;        // The transcribed text
  confidence: number;        // 0–1 confidence score
  detectedLanguage: string;  // BCP-47 code of detected language
  words?: Array<{            // Optional word-level timestamps
    word: string;
    start: number;           // seconds from start
    end: number;
  }>;
}
```

```typescript
// Example: transcribe a browser audio recording
const mediaRecorder = new MediaRecorder(stream);
const chunks: Blob[] = [];
mediaRecorder.ondataavailable = e => chunks.push(e.data);
mediaRecorder.onstop = async () => {
  const audioBlob = new Blob(chunks, { type: 'audio/webm' });

  const result = await adapter.transcribe({
    audio: audioBlob,
    mimeType: 'audio/webm',
    languageHint: 'en',
  });

  console.log(`Transcript: ${result.transcript}`);
  console.log(`Confidence: ${(result.confidence * 100).toFixed(1)}%`);

  // Feed the transcript into the agent
  const response = await session.run(result.transcript);
  speakResponse(response);
};
```

> **Note:** Not all adapters support ASR. If `transcribe()` is called on an adapter without ASR support, it throws `LemuraAdapterError` with code `CAPABILITY_NOT_SUPPORTED`. Use `adapter.getModelInfo().capabilities` to check.

---

## TTS — Text-to-Speech Synthesis

`synthesize()` always returns an `AsyncIterable<AudioChunk>` — even for providers that return all audio at once (the adapter wraps single responses in a single-chunk iterable):

```typescript
interface SynthesisRequest {
  text: string;
  voiceId: string;           // Provider-specific voice ID
  format: 'mp3' | 'wav' | 'pcm';  // Output audio format
  speed?: number;            // 0.5–2.0, default: 1.0
}

interface AudioChunk {
  data: Uint8Array;          // Raw audio bytes
  finished: boolean;
}
```

```typescript
// Stream TTS to an output file
import { createWriteStream } from 'fs';

const writeStream = createWriteStream('output.mp3');

for await (const chunk of adapter.synthesize({
  text: "Hello! I'm your AI assistant powered by lemura.",
  voiceId: 'alloy',          // OpenAI TTS voice
  format: 'mp3',
})) {
  writeStream.write(Buffer.from(chunk.data));
  if (chunk.finished) break;
}

writeStream.end();
console.log('Audio saved to output.mp3');
```

### Browser playback via Web Audio API

```typescript
// Collect all chunks, then play
const audioChunks: Uint8Array[] = [];

for await (const chunk of adapter.synthesize({
  text: response,
  voiceId: 'nova',
  format: 'mp3',
})) {
  audioChunks.push(chunk.data);
  if (chunk.finished) break;
}

const audioBlob = new Blob(audioChunks, { type: 'audio/mpeg' });
const audioUrl = URL.createObjectURL(audioBlob);
const audio = new Audio(audioUrl);
audio.play();
```

---

## Vision — Image Understanding

Describe or analyze images with `describeImage()`:

```typescript
interface VisionRequest {
  imageUrl?: string;     // Public URL of the image
  imageBase64?: string;  // Base64-encoded image data
  mimeType?: string;     // e.g. 'image/png', 'image/jpeg'
  prompt?: string;       // Specific question about the image
}

interface VisionResponse {
  description: string;   // Natural language description
  objects?: string[];    // Detected objects (if supported)
  text?: string;         // OCR'd text from image (if applicable)
}
```

```typescript
// Analyze a chart image
const result = await adapter.describeImage({
  imageUrl: 'https://example.com/sales-chart-q4.png',
  prompt: 'What trend does this chart show? Are sales increasing or decreasing?',
});

console.log(result.description);
// → "The chart shows a consistent upward trend in quarterly sales from Q1 to Q4 2024,
//    with a notable acceleration in Q3. Growth appears to be approximately 15% quarter-over-quarter."
```

```typescript
// For local images, use base64
import { readFileSync } from 'fs';

const imageData = readFileSync('./screenshot.png');
const base64 = imageData.toString('base64');

const result = await adapter.describeImage({
  imageBase64: base64,
  mimeType: 'image/png',
  prompt: 'Describe any errors or issues visible in this screenshot.',
});
```

---

## Image Generation

```typescript
interface ImageGenRequest {
  prompt: string;        // Generation prompt
  width?: number;        // Pixel width (e.g. 1024)
  height?: number;       // Pixel height (e.g. 1024)
  style?: string;        // Style hint (e.g. 'photorealistic', 'illustration')
  quality?: 'standard' | 'hd';
}

interface ImageGenResponse {
  url?: string;          // Public URL to generated image
  base64?: string;       // Base64-encoded image data
  revisedPrompt?: string; // Some providers rewrite your prompt — this is what they used
}
```

```typescript
const result = await adapter.generateImage({
  prompt: 'A futuristic city skyline at dusk, highly detailed, cinematic lighting',
  width: 1024,
  height: 1024,
  quality: 'hd',
});

console.log('Generated image URL:', result.url);
if (result.revisedPrompt) {
  console.log('OpenAI revised it to:', result.revisedPrompt);
}
```

---

## Tips & Tricks

> **Tip:** For voice applications combining ASR + TTS, create a simple pipeline helper:
> ```typescript
> async function voiceTurn(audioBlob: Blob): Promise<Blob[]> {
>   const { transcript } = await adapter.transcribe({ audio: audioBlob, mimeType: 'audio/webm' });
>   const response = await session.run(transcript);
>   const audioChunks: Uint8Array[] = [];
>   for await (const chunk of adapter.synthesize({ text: response, voiceId: 'nova', format: 'mp3' })) {
>     audioChunks.push(chunk.data);
>   }
>   return audioChunks;
> }
> ```

> **Tip:** Vision requests count against your token limit — a 1024×1024 image typically costs ~1,700 tokens. Account for this in your `maxTokens` planning when building vision-heavy agents.

> **Tip:** When streaming TTS to a browser, use a `MediaSource` API buffer for truly continuous playback instead of waiting for all chunks to arrive, especially important for long synthesized responses.
