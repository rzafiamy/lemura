# ASR (Automated Speech Recognition)

LEmura provides a normalized interface for transcribing audio into text using various providers like OpenAI Whisper, Deepgram, or local models.

## Transcription Request

```typescript
const response = await adapter.transcribe({
  audio: audioBlob,
  model: 'whisper-1',
  language: 'en'
});

console.log(response.text);
```

## Key Features

- **Multi-language support**: Detect and transcribe over 50 languages.
- **Confidence scores**: Get word-level or segment-level confidence.
- **Timestamping**: Optional timestamps for subtitles and alignment.
