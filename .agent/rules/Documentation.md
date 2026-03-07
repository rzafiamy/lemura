---
trigger: always_on
---

# lemura — Documentation Rules

## Philosophy

Documentation is a first-class deliverable, not an afterthought.
Every public symbol, every architectural decision, and every consumer-facing
behavior must be documented before a feature is considered done.

lemura has four audiences, each needing different content:
- **Consumer developers** — integrating lemura into their app
- **Contributor developers** — adding features or adapters to lemura itself
- **AI coding agents** — using skills and rules to work on the codebase
- **End users** — indirectly, through the apps built on lemura

---

## Documentation Layers

### Layer 1 — Inline TSDoc (lives in source code)

Every exported symbol requires TSDoc. Minimum tags:

```ts
/**
 * One-sentence summary ending with a period.
 *
 * Optional longer explanation for non-obvious behavior.
 *
 * @param paramName - What this parameter is and any constraints
 * @returns What is returned and under what conditions
 * @throws {LemuraContextOverflowError} When and why this is thrown
 *
 * @example
 * // Minimal working example — copy-pasteable
 * const strategy = new SandwichCompressionStrategy({ preserveFirst: 2, preserveLast: 4 });
 * const compressed = await strategy.apply(context);
 */
```

Rules:
- The one-sentence summary must stand alone — it appears in IDE tooltips and generated API docs
- `@example` is mandatory on every class and every public method with non-obvious usage
- `@throws` is mandatory whenever a `LemuraError` subclass can be thrown
- Config interface fields use `/** inline comment */` on each field — no block TSDoc needed
- Internal (`_` prefixed) symbols get a single `/** @internal */` tag only

### Layer 2 — API Reference (auto-generated)

Generated from TSDoc via `typedoc`. Run with `pnpm docs:api`.

Rules:
- Never manually edit generated files — fix the source TSDoc instead
- All sub-path exports (`lemura/context`, `lemura/adapters`, etc.) must appear as separate modules in the output
- Every interface must show all fields with their types and descriptions
- Generated docs are published to `/docs/api/` and linked from the README

### Layer 3 — Concept Guides (hand-written, lives in `/docs/`)

```
docs/
├── guides/
│   ├── getting-started.md
│   ├── context-management.md
│   ├── adapters.md
│   ├── tools-and-skills.md
│   ├── rag-integration.md
│   └── advanced-execution.md
├── recipes/
│   ├── custom-adapter.md
│   ├── custom-strategy.md
│   ├── sequential-tools.md
│   ├── goal-planning.md
│   └── app-migration.md
├── api/                        # auto-generated — do not edit
└── CHANGELOG.md
```

**Guides** explain concepts and architecture. They answer "how does this work and why."
**Recipes** are short, task-oriented, copy-pasteable. They answer "how do I do X."

### Layer 4 — CHANGELOG.md

Every PR must update `CHANGELOG.md` under the `[Unreleased]` section using this format:

```markdown
## [Unreleased]

### Added
- `SandwichCompressionStrategy` — preserves head and tail turns verbatim (#42)

### Changed
- `SessionConfig.maxSteps` default raised from 10 to 20 (#45)

### Fixed
- `finishReason` normalization for Groq streaming responses (#48)

### Breaking Changes
- `IProviderAdapter.complete()` now returns `CompletionResponse` instead of `string` (#50)
```

Categories: `Added`, `Changed`, `Fixed`, `Deprecated`, `Removed`, `Breaking Changes`.
Breaking changes MUST also appear in the commit footer as `BREAKING CHANGE:`.

---

## README Structure (mandatory sections in order)

1. **Tagline** — one sentence: what lemura is
2. **Install** — `npm install lemura`, one code block
3. **Quick start** — minimal working example, ≤ 20 lines of code
4. **Core concepts** — 5–7 bullet links to concept guides
5. **API overview** — table of main exports with one-line descriptions
6. **Provider adapters** — table of available adapters + link to writing a custom one
7. **Contributing** — link to CONTRIBUTING.md
8. **License**

Rules:
- No walls of text in the README — link to guides for depth
- Quick start must be copy-pasteable and runnable with zero modification beyond adding an API key
- README is updated whenever the quick start example would break

---

## Concept Guide Writing Rules

Structure every guide with:
```
# Title

## What this is
One paragraph — what the concept is and why it exists in lemura.

## How it works
Architecture explanation with a diagram or type definition where helpful.

## Configuration
Config fields table: field | type | default | description

## Examples
At least one minimal example and one real-world example.

## When things go wrong
Top 3 failure modes and how to fix them.
```

Rules:
- Maximum 1500 words per guide — link to API reference for exhaustive detail
- Every code block must be TypeScript with correct types (no `any`, no `// @ts-ignore`)
- Code blocks must be tested — add them to `tests/docs/` as compilable snippets
- Use present tense: "The strategy applies..." not "The strategy will apply..."

---

## Recipe Writing Rules

Recipes are short by design:
- Title: "How to [do one specific thing]"
- Maximum 400 words
- One code block showing the complete solution
- One "What's happening here" paragraph explaining key lines
- Optional: "Variations" section with 2–3 alternatives

---

## Doc Tests

Code examples in guides and recipes must compile and run.
All doc examples live in `tests/docs/` as `.ts` files:

```
tests/docs/
├── getting-started.test.ts
├── custom-adapter.test.ts
├── custom-strategy.test.ts
└── ...
```

Run with `pnpm test:docs`. These run in CI. A broken doc example is a failing test.

---

## Definition of Done — Documentation

A feature is not done until:
- [ ] TSDoc on every new exported symbol (summary, `@param`, `@returns`, `@throws`, `@example`)
- [ ] Config interface fields have inline `/** */` comments
- [ ] `CHANGELOG.md` updated under `[Unreleased]`
- [ ] If new concept introduced: concept guide created or updated in `docs/guides/`
- [ ] If common task enabled: recipe created in `docs/recipes/`
- [ ] If breaking change: migration note added to `docs/guides/getting-started.md`
- [ ] Doc examples added to `tests/docs/` and passing
- [ ] README updated if the quick start or API overview table is affected

---

## Anti-patterns

- ❌ `/** TODO: document this */` — never merge undocumented exports
- ❌ Describing implementation details in TSDoc — document behavior, not internals
- ❌ Copying parameter names without explanation: `@param config - config` is useless
- ❌ Stale examples — if you change a method signature, update every `@example` that uses it
- ❌ Explaining the obvious: `/** The name. */` on a field called `name` adds no value
- ❌ Guides longer than 1500 words — split into two guides or move detail to API reference