# How to create a Custom Provider Adapter

To use a proprietary LLM API that doesn't follow OpenAI signatures, or for extensive custom logic, implement `IProviderAdapter`.

```ts
import { IProviderAdapter, CompletionRequest, CompletionResponse, CompletionChunk, LemuraAdapterError } from 'lemura/adapters';

export class MyFastAdapter implements IProviderAdapter {
  readonly name = 'my_fast_adapter';
  readonly version = '1.0.0';

  constructor(private apiKey: string) {}

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const res = await fetch('https://api.myfastai.com/generate', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompts: request.messages })
    });

    if (!res.ok) {
      throw new LemuraAdapterError('Fast AI failed', 'API_ERR');
    }

    const data = await res.json();
    return {
      content: data.output_text,
      finishReason: 'stop',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }

  // Other required methods...
  async *stream(request: CompletionRequest): AsyncIterable<CompletionChunk> {
    yield { delta: 'Not implemented', finished: true, finishReason: 'error' };
  }
  estimateTokens(text: string) { return text.length / 4; }
  getModelInfo() { return { supportsVision: false, supportsTools: false, contextWindow: 8000 }; }
  async healthCheck() { return true; }
  
  // Multimodal placeholders
  async transcribe(req: any): Promise<any> { throw new LemuraAdapterError('No ASR', 'ERR'); }
  async *synthesize(req: any): AsyncIterable<any> { throw new LemuraAdapterError('No TTS', 'ERR'); }
  async describeImage(req: any): Promise<any> { throw new LemuraAdapterError('No Vision', 'ERR'); }
  async generateImage(req: any): Promise<any> { throw new LemuraAdapterError('No ImgGen', 'ERR'); }
}
```

### What's happening here
The constructor accepts required configs (like your API key). 
The `complete` method reformats Lemura's `CompletionRequest` into the external API's expected format, performs the HTTP call, catches and re-throws errors as `LemuraAdapterError`, and maps the response into a `CompletionResponse`. Unimplemented capabilities throw a `LemuraAdapterError` matching `CAPABILITY_NOT_SUPPORTED`.
