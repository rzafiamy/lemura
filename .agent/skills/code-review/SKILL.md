---
name: lemura-code-review
description: Reviews code changes in the lemura package for correctness, architecture compliance, and quality. Use when reviewing a PR, evaluating generated code, or auditing a new implementation before merging. Checks layer boundaries, immutability, error handling, type safety, test coverage, and API design.
---

# Lemura: Code Review

## When to use this skill

- Reviewing a pull request against the lemura codebase
- Evaluating generated code before accepting it
- Auditing an existing implementation for compliance
- Checking whether a new export is correctly placed and documented

## Review checklist

### Layer boundary violations (hard reject)

- [ ] Does `src/context/` import from `src/agent/`? → **Reject** — wrong direction
- [ ] Does `src/adapters/` import from `src/context/`? → **Reject**
- [ ] Does `src/types/` import from any other `src/` layer? → **Reject** — types must be dep-free
- [ ] Do provider-specific types (e.g. `OpenAI.ChatCompletion`) appear in return values? → **Reject**

### Type safety

- [ ] Is `any` used? → Needs justification comment or rejection
- [ ] Are unguarded array accesses present (`arr[0]` without null check)? → Fix required
- [ ] Are `LemuraError` instances narrowed with `instanceof` before accessing `.code`?
- [ ] Are all `Promise` returns properly awaited? (no floating promises)

### Immutability (context layer only)

- [ ] Does `apply()` return a new `ContextWindow` via spread? → Mutation = hard reject
- [ ] Is `tokenCount` recalculated after compression? → Copying old count = bug
- [ ] Are `systemPrompt` and `scratchpad` preserved unchanged?

### Error handling

- [ ] Raw `throw new Error(...)` used? → Replace with `LemuraError` subclass
- [ ] Provider HTTP errors wrapped in `LemuraAdapterError` with original as `cause`?
- [ ] Is `LemuraErrorCode` value appropriate for the error type?
- [ ] Are tool execution errors caught and returned as observations (not silently swallowed)?

### Test coverage

- [ ] Unit test file exists for every new implementation file?
- [ ] Edge cases covered: empty input, max-token input, provider error mid-stream?
- [ ] Integration tests use `MockProviderAdapter`, not real API calls?
- [ ] Test names are descriptive sentences describing behavior?
- [ ] Tests use `buildContextFixture()` — no raw `ContextWindow` literals?

### API design

- [ ] New config fields are optional with documented defaults?
- [ ] Would a new required field break existing consumers? → Must be optional or major bump
- [ ] New exports added to the correct entry point (stable vs experimental sub-path)?
- [ ] Every exported symbol has TSDoc with `@param`, `@returns`, `@throws`, `@example`?

### Performance

- [ ] Token counting called in a loop unnecessarily? → Should be once per turn, cached
- [ ] Tool definitions re-serialized on every provider call? → Build once, cache
- [ ] Large string operations (compression) done synchronously in hot path? → Should be async

## Green light criteria

A change is ready to merge when:
1. All checklist items pass
2. `pnpm typecheck && pnpm lint && pnpm test --coverage` passes in CI
3. Coverage has not decreased
4. Bundle size check passes
5. `CHANGELOG.md` updated

## Feedback templates

**Layer violation:**
> This import creates a `context/ → agent/` dependency. Move the shared type to `src/types/` so both layers can import from there without coupling.

**Mutation:**
> `apply()` must return a new object. Use: `return { ...context, turns: newTurns, tokenCount: newCount }`.

**Wrong error type:**
> Replace with `throw new LemuraToolNotFoundError(toolName)`. Raw `Error` objects prevent consumers from catching specific error types programmatically.

**Missing test:**
> This implementation needs a unit test for the case where [edge case]. See `tests/unit/context/` for the AAA pattern convention.