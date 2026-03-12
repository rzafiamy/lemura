# Image Generation

Generate pixel-perfect images from natural language descriptions using DALL-E 3, Midjourney, or Stable Diffusion via lemura adapters.

## Generate Image

```typescript
const response = await adapter.generateImage({
  prompt: "A futuristic city with flying lemurs",
  size: "1024x1024",
  style: "vivid"
});

console.log(response.url);
console.log(response.revisedPrompt);
```

## Features

- **Prompt Polishing**: Many providers automatically refine your prompt for better results.
- **Multiple Sizes**: Generate square, portrait, or landscape images.
- **Quality Presets**: Choose between standard and HD quality levels.
