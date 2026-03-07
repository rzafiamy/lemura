# Retry & Rate Limits

Production AI applications inevitably hit rate limits and transient errors. lemura handles this automatically with exponential backoff — here's how it works and how to configure it.

---

## Default Behavior

`OpenAICompatibleAdapter` automatically retries on:
- **`429 Too Many Requests`** — rate limit hit
- **`503 Service Unavailable`** — provider temporarily down

Default retry config:
```
Attempt 1 (immediate)
Attempt 2 (after 500ms)
Attempt 3 (after 1,000ms)
Attempt 4 (after 2,000ms)  ← maxRetries: 3 = 4 total attempts
```

---

## Configuring Retry

```typescript
const adapter = new OpenAICompatibleAdapter({
  baseUrl: 'https://api.openai.com/v1',
  apiKey: process.env.OPENAI_API_KEY!,
  defaultModel: 'gpt-4o',
  retry: {
    maxRetries: 5,          // 5 retries = 6 total attempts
    baseDelayMs: 1_000,     // first retry after 1s, then 2s, 4s, 8s, 16s
  },
});
```

### Retry math
```
delay = baseDelayMs × 2^attempt

With baseDelayMs = 1000:
  Attempt 1: immediate
  Attempt 2: 1,000ms
  Attempt 3: 2,000ms
  Attempt 4: 4,000ms
  Attempt 5: 8,000ms
  Attempt 6: 16,000ms  ← total wait: ~31s
```

---

## Implementing Retry in Custom Adapters

For custom adapters, use the same exponential backoff pattern:

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  config: { maxRetries: number; baseDelayMs: number }
): Promise<T> {
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRetryable =
        err instanceof LemuraAdapterError &&
        [429, 503].includes(err.metadata?.status as number);

      const isLastAttempt = attempt === config.maxRetries;

      if (!isRetryable || isLastAttempt) throw err;

      const delayMs = config.baseDelayMs * 2 ** attempt;
      console.warn(`Retrying in ${delayMs}ms (attempt ${attempt + 1}/${config.maxRetries})...`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  throw new LemuraAdapterError('All retry attempts failed', 'PROVIDER_ERROR');
}

// Usage in your custom adapter:
async complete(request: CompletionRequest): Promise<CompletionResponse> {
  return withRetry(
    () => this.fetchCompletion(request),
    { maxRetries: 3, baseDelayMs: 500 }
  );
}
```

---

## Respecting `Retry-After` Headers

Many providers return a `Retry-After` header with the exact wait time. Honor it:

```typescript
async function fetchWithRetryAfter(url: string, options: RequestInit): Promise<Response> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(url, options);

    if (response.status === 429) {
      // Check for Retry-After header (seconds or HTTP date)
      const retryAfter = response.headers.get('Retry-After');
      let waitMs = 1_000; // default

      if (retryAfter) {
        const retryAfterSeconds = parseInt(retryAfter, 10);
        if (!isNaN(retryAfterSeconds)) {
          waitMs = retryAfterSeconds * 1_000;
        } else {
          // Could be an HTTP date
          const retryDate = new Date(retryAfter).getTime();
          waitMs = Math.max(0, retryDate - Date.now());
        }
      }

      console.warn(`Rate limited. Waiting ${waitMs}ms before retry.`);
      await new Promise(r => setTimeout(r, waitMs));
      continue;
    }

    return response;
  }

  throw new LemuraAdapterError('Rate limit retries exhausted', 'PROVIDER_ERROR', { status: 429 });
}
```

---

## Request Queuing (High-Concurrency Apps)

For applications making many concurrent requests, implement a rate-limit queue:

```typescript
class RateLimitedAdapter implements IProviderAdapter {
  private readonly adapter: IProviderAdapter;
  private queue: Array<() => void> = [];
  private inFlight = 0;
  private readonly maxConcurrent: number;

  constructor(adapter: IProviderAdapter, maxConcurrent = 5) {
    this.adapter = adapter;
    this.maxConcurrent = maxConcurrent;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    await this.acquireSlot();
    try {
      return await this.adapter.complete(request);
    } finally {
      this.releaseSlot();
    }
  }

  private acquireSlot(): Promise<void> {
    if (this.inFlight < this.maxConcurrent) {
      this.inFlight++;
      return Promise.resolve();
    }

    return new Promise(resolve => {
      this.queue.push(() => { this.inFlight++; resolve(); });
    });
  }

  private releaseSlot() {
    this.inFlight--;
    const next = this.queue.shift();
    if (next) next();
  }

  // Delegate all other methods
  get name() { return this.adapter.name; }
  get version() { return this.adapter.version; }
  stream = this.adapter.stream.bind(this.adapter);
  estimateTokens = this.adapter.estimateTokens.bind(this.adapter);
  getModelInfo = this.adapter.getModelInfo.bind(this.adapter);
  healthCheck = this.adapter.healthCheck.bind(this.adapter);
}

// Usage
const rateLimited = new RateLimitedAdapter(
  new OpenAICompatibleAdapter({ ... }),
  5  // max 5 concurrent requests
);
```

---

## Per-Model Rate Limits (OpenAI Reference)

OpenAI rate limits vary by tier. As a general reference (Tier 1):

| Model | RPM | TPM |
|---|---|---|
| GPT-4o | 500 | 30,000 |
| GPT-4o mini | 500 | 200,000 |
| GPT-3.5-turbo | 3,500 | 90,000 |

> RPM = Requests Per Minute, TPM = Tokens Per Minute. Limits increase with usage tiers.

---

## Circuit Breaker Pattern

For mission-critical apps, use a circuit breaker to stop retrying when the provider is clearly down:

```typescript
class CircuitBreakerAdapter implements IProviderAdapter {
  private failures = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private openedAt?: number;

  constructor(
    private adapter: IProviderAdapter,
    private threshold = 5,    // fail opens after 5 failures
    private resetMs = 60_000  // try again after 60s
  ) {}

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    if (this.state === 'open') {
      const elapsed = Date.now() - (this.openedAt ?? 0);
      if (elapsed < this.resetMs) {
        throw new LemuraAdapterError(
          'Circuit breaker open — provider is down',
          'PROVIDER_ERROR',
          { status: 503 }
        );
      }
      this.state = 'half-open';
    }

    try {
      const result = await this.adapter.complete(request);
      this.failures = 0;
      this.state = 'closed';
      return result;
    } catch (err) {
      this.failures++;
      if (this.failures >= this.threshold) {
        this.state = 'open';
        this.openedAt = Date.now();
        console.error(`Circuit breaker opened after ${this.failures} failures`);
      }
      throw err;
    }
  }
}
```

---

## Tips & Tricks

> **Tip:** In serverless environments (Lambda, Cloud Functions), you can't rely on in-memory queues surviving across invocations. Use an external queue (SQS, Pub/Sub) for true rate limiting across instances.

> **Tip:** Add jitter to your retry delays to prevent the "thundering herd" problem where all instances retry simultaneously after a 429:
> ```typescript
> const jitter = Math.random() * 500;  // 0–500ms random jitter
> const delay = baseDelayMs * 2 ** attempt + jitter;
> ```

> **Tip:** Log retry attempts to your observability stack. A spike in `retry_attempt` metrics often predicts an upcoming incident long before users notice degraded service.
