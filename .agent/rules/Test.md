---
trigger: always_on
---

# lemura — Testing Rules

## Test Framework

- **Vitest** — chosen for ESM compatibility, fast watch mode, and built-in coverage
- **@vitest/coverage-v8** for coverage reports
- No Jest — Vitest API is compatible but ESM support is superior

---

## Test File Location & Naming

```
src/context/SandwichCompressionStrategy.ts
tests/unit/context/SandwichCompressionStrategy.test.ts

src/agent/ReActAgent.ts
tests/integration/agent/ReActAgent.test.ts
```

Rules:
- Unit tests mirror `src/` directory structure under `tests/unit/`
- Integration tests live under `tests/integration/`
- Test filenames match the module they test, suffixed with `.test.ts`
- Fixture files live in `tests/fixtures/` — never inline large data in test files

---

## Coverage Targets

| Layer | Branch Coverage |
|---|---|
| `src/types/` | N/A (types only) |
| `src/adapters/` | ≥ 90% |
| `src/context/` | ≥ 95% (compression logic is critical) |
| `src/tools/` | ≥ 90% |
| `src/skills/` | ≥ 85% |
| `src/rag/` | ≥ 85% |
| `src/agent/` | ≥ 90% |

---

## Unit Test Rules

Each unit test file must:

1. **Test one module in isolation.** All dependencies are mocked or stubbed.
2. **Never make real HTTP calls.** Use `vi.mock()` or pass mock adapters.
3. **Test the interface, not the implementation.** If you're asserting on private fields, refactor the code instead.
4. **Use descriptive test names** that read as sentences:

```ts
// ✅ Good
it('returns the original context unchanged when token count is below threshold')
it('throws LemuraContextOverflowError when compression cannot reduce below target')

// ❌ Bad
it('works')
it('test compression')
```

5. **Follow AAA structure** (Arrange, Act, Assert) with blank lines separating sections:

```ts
it('summarizes middle turns when context exceeds max tokens', async () => {
  // Arrange
  const strategy = new SandwichCompressionStrategy({ preserveFirst: 2, preserveLast: 2 });
  const context = buildContextFixture({ turns: 20, tokensPerTurn: 100 });

  // Act
  const result = await strategy.apply(context);

  // Assert
  expect(result.turns.length).toBeLessThan(context.turns.length);
  expect(result.turns[0]).toEqual(context.turns[0]);
});
```

---

## Integration Test Rules

Integration tests wire real implementations together but still mock the provider HTTP layer.

Required integration tests:
- **ReAct loop full cycle** — tool call → observation → final answer, with a scripted mock provider
- **Context overflow mid-conversation** — verify the correct compression strategy fires and conversation continues
- **Tool autodiscovery** — verify tools declared in package manifests are registered correctly
- **Skill injection** — verify skills are injected at correct position in system prompt
- **RAG round-trip** — ingest → query → injection into context, with a mock RAG adapter

---

## Mock Provider Pattern

Always use a scripted mock provider for integration tests:

```ts
// tests/fixtures/MockProviderAdapter.ts
// Accepts a script: array of responses to return in sequence
// Throws if the script is exhausted (test wrote too few expected turns)
// Records all requests made (inspect with .calls)
```

This pattern catches infinite loops in the ReAct loop during testing.

---

## Fixture Files

Required fixtures in `tests/fixtures/`:

| File | Purpose |
|---|---|
| `conversations/short.json` | 5-turn conversation, ~500 tokens |
| `conversations/medium.json` | 20-turn conversation, ~4k tokens |
| `conversations/long.json` | 60-turn conversation, ~14k tokens |
| `conversations/overflow.json` | Conversation that exceeds max context |
| `tools/simple-tool-manifest.json` | Single tool with no dependencies |
| `tools/multi-tool-manifest.json` | 5 tools including one with nested params |
| `skills/basic-skill.md` | Minimal valid skill document |
| `rag/sample-documents.json` | 10 short documents for ingest testing |

---

## What NOT to Test

- Private implementation details — test observable behavior only
- Third-party library internals
- TypeScript type correctness — that's the compiler's job
- Formatting or whitespace in generated strings (brittle)

---

## Running Tests

```bash
# All tests
pnpm test

# Watch mode
pnpm test --watch

# Coverage
pnpm test --coverage

# Single file
pnpm test tests/unit/context/SandwichCompressionStrategy.test.ts
```