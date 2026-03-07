# Finish Reason Normalization

`finishReason` is the single most important concept in adapter development. This page explains why normalization matters and shows the complete mapping for every major provider.

---

## Why Normalization Matters

Every provider returns a different string when generation stops. Without normalization:

```typescript
// Without lemura — you'd write this for each provider:
if (response.finish_reason === 'stop' ||          // OpenAI
    response.stop_reason === 'end_turn' ||         // Anthropic
    response.finish_reason === 'COMPLETE' ||        // Cohere
    response.finish_reason === 'stop' ||            // Groq
    response.stop_sequence === '<|eot_id|>') {      // some local models
  handleCompletion();
}

// With lemura — always the same:
if (response.finishReason === 'stop') {
  handleCompletion();
}
```

lemura maps every provider-specific stop reason to exactly **four normalized values**.

---

## The Four Normalized Values

```typescript
type FinishReason = 'stop' | 'tool_call' | 'max_tokens' | 'error';
```

| Value | Meaning | What to do |
|---|---|---|
| `'stop'` | Model finished naturally | This is a final answer |
| `'tool_call'` | Model wants to call a tool | Execute the tool, continue the loop |
| `'max_tokens'` | Response was cut off at the token limit | Response is incomplete — warn user or increase `maxTokens` |
| `'error'` | Provider returned unknown/error stop reason | Log `rawResponse`, treat as failure |

---

## Provider Mapping Tables

### OpenAI & Compatible (Groq, Together, Ollama, LM Studio)

| Provider value | lemura value |
|---|---|
| `"stop"` | `"stop"` |
| `"tool_calls"` | `"tool_call"` |
| `"function_call"` | `"tool_call"` |
| `"length"` | `"max_tokens"` |
| `"content_filter"` | `"error"` |
| `null` | `"stop"` (treat as complete) |
| *(anything else)* | `"error"` |

```typescript
private normalizeFinishReason(reason: string | null): CompletionResponse['finishReason'] {
  switch (reason) {
    case 'stop':         return 'stop';
    case 'tool_calls':   return 'tool_call';
    case 'function_call': return 'tool_call';
    case 'length':       return 'max_tokens';
    case null:           return 'stop';  // null = natural completion in some providers
    default:             return 'error';
  }
}
```

### Anthropic

| Provider value | lemura value |
|---|---|
| `"end_turn"` | `"stop"` |
| `"tool_use"` | `"tool_call"` |
| `"max_tokens"` | `"max_tokens"` |
| `"stop_sequence"` | `"stop"` |
| *(anything else)* | `"error"` |

```typescript
private normalizeFinishReason(reason: string): CompletionResponse['finishReason'] {
  switch (reason) {
    case 'end_turn':      return 'stop';
    case 'tool_use':      return 'tool_call';
    case 'max_tokens':    return 'max_tokens';
    case 'stop_sequence': return 'stop';
    default:              return 'error';
  }
}
```

### Cohere

| Provider value | lemura value |
|---|---|
| `"COMPLETE"` | `"stop"` |
| `"TOOL"` | `"tool_call"` |
| `"MAX_TOKENS"` | `"max_tokens"` |
| `"ERROR"` | `"error"` |
| `"ERROR_LIMIT"` | `"max_tokens"` |
| *(anything else)* | `"error"` |

### Google Gemini

| Provider value | lemura value |
|---|---|
| `"STOP"` | `"stop"` |
| `"TOOL_CODE"` | `"tool_call"` (Gemini uses "Code Execution") |
| `"MAX_TOKENS"` | `"max_tokens"` |
| `"SAFETY"` | `"error"` |
| `"RECITATION"` | `"error"` |
| `"OTHER"` | `"error"` |

---

## Handling `error` Finish Reason

When `finishReason === 'error'`, always check `rawResponse`:

```typescript
const response = await adapter.complete(request);

if (response.finishReason === 'error') {
  console.error('Unexpected stop reason. Raw response:', response.rawResponse);
  // rawResponse contains the original provider payload — inspect it
  // for the actual stop_reason string to add to your normalization switch
}
```

This is the recommended debugging workflow when you encounter an unknown finish reason:
1. Log `rawResponse`
2. Find the raw stop reason field
3. Add it to your `normalizeFinishReason()` switch
4. Submit it as a PR if the provider is public

---

## The ReAct Loop Dependency

`finishReason` determines what lemura does after each provider call:

```typescript
// Inside ReActAgent (simplified)
const response = await adapter.complete(request);

switch (response.finishReason) {
  case 'stop':
    // Check for tool calls (some providers include both)
    if (response.toolCalls?.length) {
      return executeToolsAndContinue(response.toolCalls);
    }
    // Natural completion
    return response.content;

  case 'tool_call':
    // Execute tool calls
    return executeToolsAndContinue(response.toolCalls!);

  case 'max_tokens':
    // Response was truncated — log warning
    logger.warn('Response truncated at max_tokens', { model: request.model });
    return response.content; // partial response

  case 'error':
    throw new LemuraAdapterError(
      'Provider returned error finish reason',
      'PROVIDER_ERROR',
      { rawResponse: response.rawResponse }
    );
}
```

---

## Tips & Tricks

> **Tip:** Some providers include tool calls in the response even when `finish_reason` is `"stop"`. Always check `response.toolCalls?.length > 0` regardless of `finishReason` — a `tool_call` finishReason without tool calls, or a `stop` finishReason *with* tool calls, are both valid (if unusual) states.

> **Tip:** Write exhaustive tests for your `normalizeFinishReason()` function — one test per provider value, including the `default` case. This is the most likely place for subtle bugs that cause agents to hang or miss tool calls.

> **Tip:** If a provider updates their API and introduces a new stop reason, your adapter will return `'error'` for it. Watch for unexpected `finishReason: 'error'` values in production — they often signal a provider API update you need to handle.
