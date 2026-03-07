# TSDoc Examples Reference

Real examples from the lemura codebase. Use as reference when writing new TSDoc.

---

## Class with config

```ts
/**
 * Compresses the context window by summarizing the middle turns while
 * preserving a fixed number of turns at the head and tail verbatim.
 *
 * The preserved head typically contains initial instructions and user intent.
 * The preserved tail contains the most recent turns for conversational coherence.
 * Everything in between is summarized into a single `compressionSummary` string.
 *
 * @example
 * const strategy = new SandwichCompressionStrategy({
 *   preserveFirst: 2,
 *   preserveLast: 4,
 * });
 * const compressed = await strategy.apply(context);
 */
export class SandwichCompressionStrategy implements IContextStrategy {
  readonly name = 'sandwich-compression';
  readonly priority = 10;

  constructor(private readonly config: SandwichCompressionConfig) {}
}

/**
 * Configuration for {@link SandwichCompressionStrategy}.
 */
export interface SandwichCompressionConfig {
  /** Number of turns at the start of history to preserve verbatim. Minimum: 1. */
  preserveFirst: number;
  /** Number of turns at the end of history to preserve verbatim. Minimum: 1. */
  preserveLast: number;
  /** Optional model override for the summarization call. Defaults to session model. */
  summaryModel?: string;
}
```

---

## Method with throws

```ts
/**
 * Prepares the context window for a provider call by applying all registered
 * compression strategies in priority order until the token count is within budget.
 *
 * @param context - The current context window to prepare
 * @returns A new context window with token count below `maxTokens * safetyMargin`
 * @throws {LemuraContextOverflowError} When all strategies have been applied and
 *   the token count still exceeds the budget. Inspect `error.context` for the
 *   state at time of failure.
 *
 * @example
 * const prepared = await contextManager.prepare(currentContext);
 * // prepared.tokenCount < prepared.maxTokens
 */
async prepare(context: ContextWindow): Promise<ContextWindow>
```

---

## Interface

```ts
/**
 * Adapter interface that normalizes any AI provider's API into lemura's
 * internal types. Implement this interface to add support for a new provider.
 *
 * All methods that the provider does not support must throw
 * {@link LemuraAdapterError} with code `CAPABILITY_NOT_SUPPORTED` rather
 * than being omitted from the implementation.
 *
 * @example
 * class MyProviderAdapter implements IProviderAdapter {
 *   readonly name = 'my-provider';
 *   readonly version = '1.0.0';
 *
 *   async complete(request: CompletionRequest): Promise<CompletionResponse> {
 *     // translate request → provider format
 *     // translate response → CompletionResponse
 *   }
 * }
 */
export interface IProviderAdapter {
  /** Unique identifier for this adapter, e.g. `'openai'`, `'groq'`. */
  readonly name: string;

  /** Semantic version of this adapter implementation. */
  readonly version: string;

  /**
   * Sends a completion request and returns the full response.
   * For streaming, use {@link stream} instead.
   */
  complete(request: CompletionRequest): Promise<CompletionResponse>;

  /**
   * Sends a completion request and returns an async stream of chunks.
   * The final chunk always has `finished: true` and a `finishReason`.
   */
  stream(request: CompletionRequest): AsyncIterable<CompletionChunk>;
}
```

---

## Error class

```ts
/**
 * Thrown when all registered compression strategies have been applied and the
 * context window token count still exceeds the configured `maxTokens` limit.
 *
 * @example
 * try {
 *   await session.run(userMessage);
 * } catch (err) {
 *   if (err instanceof LemuraContextOverflowError) {
 *     console.error('Context too large:', err.context.tokenCount);
 *   }
 * }
 */
export class LemuraContextOverflowError extends LemuraError {
  constructor(
    /** The context window state at the time compression failed. */
    public readonly context: ContextWindow,
  ) {
    super(
      `Context overflow: ${context.tokenCount} tokens exceeds limit of ${context.maxTokens}`,
      LemuraErrorCode.CONTEXT_OVERFLOW,
    );
  }
}
```

---

## Simple utility function

```ts
/**
 * Estimates the number of tokens in a string using a character-count heuristic.
 * Use provider-specific tokenizers when accuracy is critical.
 *
 * @param text - The string to estimate
 * @returns Estimated token count (always a positive integer)
 *
 * @example
 * const count = estimateTokens('Hello, world!'); // → 4
 */
export function estimateTokens(text: string): number
```