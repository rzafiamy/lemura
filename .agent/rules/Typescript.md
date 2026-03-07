---
trigger: always_on
---

# lemura — TypeScript & Code Style Rules

## TypeScript Config

- Target: `ES2022`
- Module: `NodeNext` for source, bundled to CJS + ESM via `tsup`
- `strict: true` — no exceptions
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`
- No `any` — use `unknown` and narrow. If a third-party type forces `any`, wrap it in a typed utility and leave a `// TODO: remove when upstream types improve` comment.

---

## Type-First Development

Always define types **before** writing implementation:

1. Write the interface in `src/types/`
2. Write a failing test against the interface
3. Write the implementation
4. Make the test pass

This order ensures the public API is designed for the consumer, not for implementation convenience.

---

## Interface Design Rules

```ts
// ✅ Good — consumer-friendly, composable
interface IContextStrategy {
  apply(context: ContextWindow): Promise<ContextWindow>;
  readonly name: string;
}

// ❌ Bad — leaks implementation, hard to mock
class ContextStrategyBase {
  protected _internalBuffer: Message[] = [];
  apply(context: ContextWindow) { ... }
}
```

- Prefer `interface` over `type` for object shapes that will be implemented
- Use `type` for unions, intersections, and utility types
- All public interfaces live in `src/types/` — never co-locate with implementation
- Config objects must have every field documented with TSDoc `/** */`

---

## Error Handling

All errors thrown by lemura must extend `LemuraError`:

```ts
// src/types/errors.ts
export class LemuraError extends Error {
  constructor(message: string, public readonly code: LemuraErrorCode) {
    super(message);
    this.name = 'LemuraError';
  }
}

export class LemuraContextOverflowError extends LemuraError { ... }
export class LemuraToolNotFoundError extends LemuraError { ... }
export class LemuraAdapterError extends LemuraError { ... }
export class LemuraSkillInjectionError extends LemuraError { ... }
```

- Never `throw new Error(...)` raw inside lemura code
- Always include a `LemuraErrorCode` enum value so consumers can `switch` on error type programmatically
- Wrap all provider API calls in try/catch and re-throw as `LemuraAdapterError` with the original error as `cause`

---

## Async / Streaming Patterns

```ts
// Completion — always Promise
complete(request: CompletionRequest): Promise<CompletionResponse>

// Streaming — always AsyncIterable
stream(request: CompletionRequest): AsyncIterable<CompletionChunk>

// Internal accumulation helper pattern
async function* toStream(response: Promise<CompletionResponse>): AsyncIterable<CompletionChunk> {
  const result = await response;
  yield { delta: result.content, finished: true };
}
```

- Never mix callbacks and Promises inside lemura
- Prefer `for await...of` over `.on('data')` event emitters
- All `AsyncIterable` streams must be exhaustible — ensure cleanup on early break

---

## Module Boundaries (enforced by ESLint)

Layer import rules — lower layers must never import from higher layers:

```
types      ←  no imports from lemura
adapters   ←  imports from types only
context    ←  imports from types only
tools      ←  imports from types only
skills     ←  imports from types only
rag        ←  imports from types only
agent      ←  imports from all layers above
```

If you find yourself needing to break this rule, it's a sign that a type needs to move to `src/types/` or a new shared utility layer needs to be created.

---

## File Organization

- One primary export per file
- Filename matches the primary export name (PascalCase for classes, camelCase for functions)
- Every directory has an `index.ts` barrel that re-exports only the public surface of that layer
- No circular imports — use ESLint `import/no-cycle`

---

## Code Style

- Prettier config: single quotes, 2-space indent, trailing commas (ES5), 100-char line width
- No `console.log` in library code — use the injected `ILogger` interface
- No `Date.now()` or `Math.random()` directly — accept a `clock` / `random` dependency for testability
- Magic numbers must be named constants
- Avoid abbreviations in public API names (`ctx` → `context`, `msg` → `message`, `cfg` → `config`)

---

## TSDoc Requirements

Every exported symbol needs:

```ts
/**
 * Applies sandwich compression to the context window by summarizing
 * the middle section of the conversation history while preserving
 * the first N and last M turns verbatim.
 *
 * @param context - The current context window to compress
 * @returns A new context window with the middle section summarized
 * @throws {LemuraContextOverflowError} If compression cannot reduce tokens below the target
 *
 * @example
 * const strategy = new SandwichCompressionStrategy({ preserveFirst: 2, preserveLast: 4 });
 * const compressed = await strategy.apply(currentContext);
 */
```

Minimum required tags: `@param`, `@returns`, `@throws` (if applicable), `@example`