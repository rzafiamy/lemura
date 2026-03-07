# Error Handling

lemura uses a typed error hierarchy so you can programmatically react to every failure mode. All errors are instances of `LemuraError` and carry an error code you can `switch` on.

---

## The Error Hierarchy

```
LemuraError (base)
├── LemuraAdapterError       — provider API failures
├── LemuraContextOverflowError — context exceeded limits
├── LemuraMaxIterationsError  — agent loop exceeded maxIterations
├── LemuraToolNotFoundError   — tool name not registered
├── LemuraToolValidationError — tool args failed JSON Schema validation
├── LemuraToolTimeoutError    — tool execution exceeded timeout
└── LemuraSkillInjectionError — skill file could not be loaded/parsed
```

Every error has:
- `message: string` — human-readable description
- `code: LemuraErrorCode` — machine-readable, for `switch` statements
- `cause?: unknown` — the original underlying error if wrapped

---

## Catching Errors

```typescript
import {
  LemuraError,
  LemuraMaxIterationsError,
  LemuraContextOverflowError,
  LemuraAdapterError,
  LemuraToolValidationError,
} from 'lemura';

try {
  const result = await session.run(userMessage);
  return result;
} catch (err) {
  if (err instanceof LemuraMaxIterationsError) {
    // Agent hit maxIterations without finishing
    // The last partial response may be in err.lastResponse
    return 'I need more time to complete this task. Please try a simpler request.';

  } else if (err instanceof LemuraContextOverflowError) {
    // All compression strategies couldn't fit the context
    // Action: add MaxTokensCompressionStrategy or increase maxTokens
    session.reset();
    return 'Our conversation has grown too long. Starting fresh.';

  } else if (err instanceof LemuraAdapterError) {
    // Provider API failure
    if (err.metadata?.status === 429) {
      return 'Rate limited — please try again in a moment.';
    }
    if (err.metadata?.status === 401) {
      throw new Error('Invalid API key configured');
    }
    return 'The AI provider is temporarily unavailable.';

  } else if (err instanceof LemuraToolValidationError) {
    // The model called a tool with invalid arguments
    // This is usually a model error — log it and let the loop handle recovery
    console.warn('Tool validation failed:', err.message);
    return 'Something went wrong with tool execution. Please rephrase your request.';

  } else if (err instanceof LemuraError) {
    // Any other lemura error
    console.error(`Lemura error [${err.code}]:`, err.message);
    throw err; // re-throw unexpected errors

  } else {
    // Non-lemura error (network, disk, etc.)
    throw err;
  }
}
```

---

## LemuraAdapterError — Provider Failures

Thrown when the provider API returns an error HTTP status or a network failure occurs.

```typescript
interface LemuraAdapterError extends LemuraError {
  code: 'PROVIDER_ERROR' | 'NETWORK_ERROR' | 'CAPABILITY_NOT_SUPPORTED';
  metadata?: {
    status?: number;     // HTTP status code
    headers?: Record<string, string>;
    body?: unknown;      // raw error body from provider
  };
}
```

### Common status codes

| Status | Meaning | Fix |
|---|---|---|
| `401` | Invalid API key | Check your `apiKey` in adapter config |
| `403` | Permission denied | Your plan may not have access to this model |
| `429` | Rate limited | Increase `retry.maxRetries`, or throttle requests |
| `500` | Provider server error | Transient — retry will handle it |
| `503` | Service unavailable | Provider is down — retry with backoff |

```typescript
} catch (err) {
  if (err instanceof LemuraAdapterError && err.code === 'CAPABILITY_NOT_SUPPORTED') {
    // e.g., called transcribe() on an adapter that doesn't support ASR
    console.error('This adapter does not support audio transcription');
  }
}
```

---

## LemuraContextOverflowError — Context Too Large

Thrown when `ContextManager` has run all compression strategies and the context still exceeds `maxTokens`.

```typescript
// Prevention: use the MaxTokensCompressionStrategy as a safety net
import { MaxTokensCompressionStrategy } from 'lemura/context';

const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  compressionStrategies: [
    new SandwichCompressionStrategy(adapter, { preserveFirst: 2, preserveLast: 4 }),
    // Emergency fallback — aggressively compresses to avoid throwing
    new MaxTokensCompressionStrategy(adapter, {
      threshold: 0.95,
      aggressionFactor: 0.7,
    }),
  ],
});
```

**If it still throws**, options:
1. Use a model with larger context (Claude 3.5 at 200k, GPT-4o at 128k)
2. Set `toolResponseTokenBudget` lower to cap tool outputs
3. Reduce `ragTokenBudget` and lower RAG `topK`
4. Call `session.reset()` and re-summarize the key context manually

---

## LemuraToolTimeoutError — Tool Execution Timeout

Thrown when a tool's `execute()` function takes longer than the configured timeout (default: 30 seconds).

```typescript
// Configure timeout per tool via the ToolRegistry
session.tools.register({
  name: 'slow_database_query',
  description: 'Query a large dataset — may take up to 2 minutes.',
  parameters: { ... },
  timeout: 120_000,   // 2 minutes — override the 30s default
  execute: async (params) => { ... },
});
```

---

## LemuraToolValidationError — Schema Validation Failure

Thrown when the model calls a tool with arguments that don't satisfy the tool's JSON Schema `parameters`.

```typescript
// The error includes which field failed validation
err.message
// → "Tool 'send_email': required field 'recipient' is missing"
// → "Tool 'get_weather': 'units' must be one of ['celsius', 'fahrenheit']"
```

**Common causes:**
- The model passed `null` for a required field → make the field nullable: `{ type: ['string', 'null'] }`
- The model used the wrong enum value → add example values to parameter `description`
- Schema uses `additionalProperties: false` but model adds extra fields → remove that restriction

---

## Error Codes Reference

```typescript
type LemuraErrorCode =
  | 'PROVIDER_ERROR'           // HTTP error from the LLM API
  | 'NETWORK_ERROR'            // Connection/timeout failure
  | 'CAPABILITY_NOT_SUPPORTED' // Called unimplemented adapter method
  | 'CONTEXT_OVERFLOW'         // Context exceeded maxTokens after all strategies
  | 'MAX_ITERATIONS_EXCEEDED'  // ReAct loop hit maxIterations
  | 'TOOL_NOT_FOUND'           // Agent called unregistered tool
  | 'TOOL_VALIDATION_ERROR'    // Tool args failed JSON Schema
  | 'TOOL_TIMEOUT'             // Tool execute() timed out
  | 'SKILL_INJECTION_ERROR'    // Skill file parse failure
  | 'UNKNOWN';                 // Unexpected internal error
```

Use `err.code` in `switch` statements for exhaustive handling:

```typescript
switch (err.code) {
  case 'MAX_ITERATIONS_EXCEEDED':
    metrics.increment('agent.max_iterations');
    break;
  case 'CONTEXT_OVERFLOW':
    metrics.increment('agent.context_overflow');
    break;
  default:
    Sentry.captureException(err);
}
```

---

## Tips & Tricks

> **Tip:** In production, always wrap `session.run()` in a try/catch and log the error code and message to your observability stack. lemura's error codes are designed to be unique identifiers for alerting rules.

> **Tip:** `LemuraMaxIterationsError` doesn't mean the task failed — it means the agent ran out of steps. Consider increasing `maxIterations` for complex tasks, or using `maxSteps` (which forces a graceful conclusion rather than throwing).

> **Tip:** When you catch a `LemuraContextOverflowError`, calling `session.reset()` leaves you with an empty session. If you want to preserve some context (e.g., session metadata), use `session.getContext()` to copy what you need before resetting.
