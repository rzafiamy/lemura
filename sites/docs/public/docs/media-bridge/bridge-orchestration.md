# Media Orchestration

The real power of Media Bridge lies in combining modalities to create interactive experiences.

## Example: Voice-to-UI

1. **ASR**: Transcribe the user's voice command.
2. **LLM**: Determine the intent.
3. **Vision**: Analyze the current screen state.
4. **TTS**: Respond to the user with voice.

## Implementation Pattern

```typescript
// Chain modality calls within your agent tools
export const analyzeScene = {
  name: 'analyze_scene',
  execute: async ({ audio }) => {
    const text = await adapter.transcribe({ audio });
    const vision = await adapter.describeImage({ image: currentScreen });
    
    return `User said: ${text}. I see: ${vision.description}`;
  }
}
```
