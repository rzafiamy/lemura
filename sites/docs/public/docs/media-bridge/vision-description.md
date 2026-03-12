# Computer Vision

Describe images and detect objects using state-of-the-art vision models like GPT-4o or Claude 3.5 Sonnet.

## Describe Image

```typescript
const response = await adapter.describeImage({
  image: "https://example.com/scene.jpg",
  prompt: "What is happening in this image?"
});

console.log(response.description);
console.log(response.objects); // Detected objects array
```

## Features

- **Multi-image context**: Process multiple images in a single turn.
- **Base64 & URL**: Support for both web-hosted images and local buffers.
- **Detailed Metadata**: Extract structured data from visual scenes.
