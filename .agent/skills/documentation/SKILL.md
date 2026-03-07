---
name: lemura-documentation
description: Writes, reviews, and maintains documentation for the lemura package. Use when writing TSDoc for new exported symbols, creating or updating concept guides and recipes in docs/, updating CHANGELOG.md, writing README sections, adding doc test snippets, or reviewing whether a feature's documentation is complete before merging.
---

# Lemura: Documentation

## When to use this skill

- Writing TSDoc for a new class, interface, method, or config type
- Creating a new concept guide in `docs/guides/`
- Writing a new recipe in `docs/recipes/`
- Updating `CHANGELOG.md` for a new feature, fix, or breaking change
- Adding a doc test snippet to `tests/docs/`
- Reviewing a PR's documentation completeness before approving
- Updating the README after a public API change

## Decision tree: what needs documenting?

```
New exported symbol (class, function, interface)?
  → TSDoc block required — see TSDoc template below

New config field on an existing interface?
  → Inline /** */ comment required on the field

New concept that doesn't exist in docs/guides/ yet?
  → Create a new concept guide

New task a consumer might want to do?
  → Create a recipe in docs/recipes/

Any change to public API?
  → CHANGELOG.md update required

Breaking change?
  → CHANGELOG.md + migration note in docs/guides/getting-started.md

Quick start example now broken or outdated?
  → Update README
```

---

## TSDoc template

Use this structure for every exported class, function, and interface method:

```ts
/**
 * One-sentence summary ending with a period.
 *
 * Optional second paragraph for non-obvious behavior or constraints.
 *
 * @param paramName - What this is and any constraints (type, range, format)
 * @returns What is returned and under what conditions
 * @throws {LemuraContextOverflowError} When compression cannot reduce below target
 *
 * @example
 * const strategy = new SandwichCompressionStrategy({ preserveFirst: 2, preserveLast: 4 });
 * const compressed = await strategy.apply(context);
 */
```

Rules:
- The one-sentence summary appears in IDE tooltips — make it self-contained
- `@example` is mandatory on every class and every non-trivial public method
- `@throws` is mandatory when a `LemuraError` subclass can be thrown
- Config fields use `/** inline single-line comment */` — no block needed
- Do not describe implementation internals — describe observable behavior

Bad TSDoc examples to avoid:
```ts
/** The config. */                          // ❌ explains nothing
/** @param config - config */               // ❌ restates the name
/** Creates a new instance. */             // ❌ obvious from `new`
/** TODO: document this */                 // ❌ never merge this
```

---

## CHANGELOG.md format

Always update under `[Unreleased]`. Use these categories:

```markdown
## [Unreleased]

### Added
- `FeatureName` — one-line description of what it does and why (#PR)

### Changed
- `MethodName` behavior changed from X to Y (#PR)

### Fixed
- `AdapterName` — specific bug that was fixed (#PR)

### Breaking Changes
- `IInterface.method()` signature changed: before → after. Migration: do X instead (#PR)
```

Breaking changes also require `BREAKING CHANGE:` in the git commit footer.

---

## Concept guide structure

```markdown
# [Concept Name]

## What this is
One paragraph — what the concept is and why it exists in lemura.

## How it works
Architecture explanation. Use a type definition or diagram where helpful.

## Configuration
| Field | Type | Default | Description |
|---|---|---|---|
| `fieldName` | `type` | `default` | What it does |

## Examples
### Minimal example
[≤15 line code block]

### Real-world example
[fuller example with context]

## When things go wrong
- **Symptom**: What to check and fix
- **Symptom**: What to check and fix
```

Constraints: max 1500 words. Link to API reference for exhaustive detail. Present tense throughout.

---

## Recipe structure

```markdown
# How to [do one specific thing]

[One-sentence description of the outcome]

## Code

[Complete, runnable TypeScript code block]

## What's happening here

[One paragraph explaining the key lines]

## Variations

- **Variation A**: brief description with code snippet
```

Constraints: max 400 words. Title always starts with "How to".

---

## Doc test requirements

Every code example in a guide or recipe must have a corresponding compilable test:

```
tests/docs/
├── getting-started.test.ts     # mirrors README quick start
├── custom-adapter.test.ts      # mirrors docs/recipes/custom-adapter.md
├── custom-strategy.test.ts
└── ...
```

- File name mirrors the guide/recipe it tests
- Must compile with `strict: true` — no `any`, no `// @ts-ignore`
- Must run with `pnpm test:docs`
- A broken doc test is a failing CI build — same as a broken unit test

---

## Documentation DoD checklist

Before marking any feature complete:

- [ ] TSDoc on every new exported symbol
- [ ] `@example` on every new class and non-trivial method
- [ ] Config fields have inline `/** */` comments
- [ ] `CHANGELOG.md` updated under `[Unreleased]`
- [ ] Concept guide created or updated if new concept introduced
- [ ] Recipe created if new common task is enabled
- [ ] Breaking change migration note added if applicable
- [ ] Doc examples added to `tests/docs/` and passing in CI
- [ ] README updated if quick start or API overview table affected