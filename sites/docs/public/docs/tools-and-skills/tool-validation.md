# Tool Validation & Timeouts

Every tool call goes through validation before `execute()` is invoked. Understanding this pipeline helps you write more reliable tools and debug validation failures quickly.

---

## The Tool Execution Pipeline

```
Model output:  { tool_call: { name: "search_web", args: { query: "..." } } }
                         ↓
1. ToolRegistry.find("search_web")  → not found? → LemuraToolNotFoundError
                         ↓
2. Validate args against parameters JSON Schema
                 → invalid? → LemuraToolValidationError (model gets error obs.)
                         ↓
3. Start execution timeout timer (default: 30,000ms)
                         ↓
4. Call execute(validatedArgs, ctx)
        → timeout? → LemuraToolTimeoutError
        → uncaught throw? → wrapped error observation
                         ↓
5. Serialize result to string (JSON.stringify if object)
                         ↓
6. Compress if needed (ToolResponseProcessor)
                         ↓
7. Inject as role: "tool" turn in context
                         ↓
8. Continue ReAct loop
```

---

## JSON Schema Validation in Depth

lemura validates tool arguments against the `parameters` JSON Schema before calling `execute()`. This means you can write `execute()` assuming the args are already valid.

### Validation rules that actually matter

```typescript
parameters: {
  type: 'object',
  properties: {
    // Type coercion: "5" string won't pass for type: 'number'
    count: {
      type: 'number',
      minimum: 1,
      maximum: 100,
    },

    // Enums: model must pass exactly one of these values
    format: {
      type: 'string',
      enum: ['json', 'csv', 'markdown'],
    },

    // Optional with default: no 'required' entry, document the default
    verbose: {
      type: 'boolean',
      description: 'Include detailed output. Default: false.',
    },

    // Nullable fields: use union type
    filter: {
      type: ['string', 'null'],
      description: 'Filter string, or null to return all results.',
    },
  },
  required: ['count'],  // only what's truly required
  additionalProperties: false,  // strict: reject unknown fields
}
```

### Common validation failures

| Error | Cause | Fix |
|---|---|---|
| Required field missing | Model omitted a required param | Make the field optional with a default, or add more description |
| Wrong type | Model passed `"5"` instead of `5` | Add type coercion in `execute()`, or describe expected type clearly |
| Enum mismatch | Model used `"JSON"` instead of `"json"` | Use lowercase enums consistently |
| Additional properties | Model added an extra field | Remove `additionalProperties: false` if you don't need strict mode |

---

## Configuring Timeouts

The default timeout is **30 seconds**. Override it per-tool:

```typescript
// Slow database query — needs more time
const heavyQueryTool: IToolDefinition = {
  name: 'run_analytics_query',
  description: 'Run a complex analytics query. May take up to 2 minutes.',
  parameters: { ... },
  timeout: 120_000,  // 2 minutes
  execute: async (params) => { ... },
};

// Simple utility — should be instant
const dateTimeTool: IToolDefinition = {
  name: 'get_current_time',
  description: 'Get the current date and time.',
  parameters: { type: 'object', properties: {} },
  timeout: 1_000,   // 1 second — if this takes longer, something is wrong
  execute: async () => new Date().toISOString(),
};
```

---

## Handling Validation Errors Gracefully

When validation fails, lemura injects the error as an observation turn so the model can recover:

```
[tool error]
LemuraToolValidationError: Tool 'send_email' validation failed.
  - 'recipient': required field missing
  - 'subject': must be a string, got null
```

A good model will see this error and re-call the tool with corrected arguments. A bad model may loop. Protect against loops with `maxIterations`.

To help the model recover, write descriptive parameter descriptions:

```typescript
// Before — minimal schema
recipient: { type: 'string' }

// After — descriptive schema with example
recipient: {
  type: 'string',
  description: 'Recipient email address, e.g. "alice@example.com". Must be a valid email format.',
  format: 'email',
}
```

---

## Implementing Timeout-Safe Tools

Long-running operations should support cancellation:

```typescript
const longRunningSearchTool: IToolDefinition = {
  name: 'deep_search',
  description: 'Perform a deep multi-source search. May take 30–60 seconds.',
  parameters: { ... },
  timeout: 60_000,
  execute: async (params, ctx) => {
    const controller = new AbortController();

    // Auto-cancel if we're close to timeout
    const cancelTimer = setTimeout(() => {
      controller.abort();
      ctx.logger.warn('deep_search: approaching timeout, cancelling');
    }, 55_000);  // 5s before timeout

    try {
      const results = await deepSearch(params.query, {
        signal: controller.signal,  // pass AbortSignal to your HTTP calls
      });
      return formatResults(results);
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        return 'Search timed out after 55 seconds. Here are partial results from sources that responded.';
      }
      return `Search failed: ${String(err)}`;
    } finally {
      clearTimeout(cancelTimer);
    }
  },
};
```

---

## The ToolResponseProcessor — Compressing Large Results

Tool responses that are too large are automatically compressed before being injected into context. Configure the thresholds:

```typescript
import { ToolResponseProcessor } from 'lemura';

const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  toolResponseProcessor: new ToolResponseProcessor({
    smallMaxTokens: 200,    // verbatim if ≤ 200 tokens
    mediumMaxTokens: 800,   // verbatim if ≤ 800 tokens (flagged)
    largeMaxTokens: 2000,   // summarized if ≤ 2000 tokens
    // oversized: > 2000 → extract relevant fragment only
    budgetPercent: 0.15,    // all tool responses combined ≤ 15% of maxTokens
  }),
});
```

Tool results classified as `large` or `oversized` go through compression:

| Classification | Size | Compression |
|---|---|---|
| `small` | < 200 tokens | Verbatim |
| `medium` | 200–800 tokens | Verbatim, flagged for future |
| `large` | 800–2000 tokens | Summarized via LLM |
| `oversized` | > 2000 tokens | Extract relevant fragment |

---

## Tips & Tricks

> **Tip:** Never call `process.exit()` or throw synchronously in `execute()`. Always return a string error message. The agent gracefully handles error strings — it cannot handle a crashed process.

> **Tip:** For tools that stream data (e.g., reading a large file), process it in chunks and return only a relevant excerpt rather than the full content. This prevents tool responses from bloating the context.

> **Tip:** Add a `ctx.logger.debug()` call at the start of every `execute()` with the key params. This is invaluable for debugging in production: `ctx.logger.debug('search_web called', { query: params.query, sessionId: ctx.sessionId })`.
