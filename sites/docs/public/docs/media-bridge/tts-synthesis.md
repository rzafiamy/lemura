# TTS (Text-to-Speech)

Convert text into life-like spoken audio. lemura supports both full-response and streaming synthesis.

## Synthesis Request

```typescript
const chunks = await adapter.synthesize({
  text: "Hello, I am lemura, your agentic runtime.",
  voice: "alloy",
  format: "mp3"
});

for await (const chunk of chunks) {
  // Play or stream audio data
  audioBuffer.push(chunk.data);
}
```

## Features

- **Streaming Output**: Low-latency playback while the audio is still generating.
- **Multiple Formats**: Support for `mp3`, `wav`, `pcm`, and `opus`.
- **Voice Customization**: Easily switch between provider-specific voice IDs.
