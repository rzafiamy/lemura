---
name: lemura-new-feature
description: Implements a new feature in the lemura npm package. Use when adding any new capability — a new export, a new config option, a new built-in tool, or a new public method. Guides the agent through type-first design, correct layer placement, testing, and export registration.
---

# Lemura: Implementing a New Feature

## When to use this skill

- Adding any new class, function, or interface to lemura
- Adding a new config option to `SessionConfig` or `AgentConfig`
- Adding a new built-in tool
- Adding a new entry point sub-path export
- Any work that touches `src/index.ts` or a layer barrel `index.ts`

## Decision tree: which layer?

```
Is it only types/interfaces with no runtime code?
  → src/types/

Is it a new AI provider integration?
  → src/adapters/   (see lemura-new-adapter skill)

Is it a new context compression strategy?
  → src/context/    (see lemura-new-strategy skill)

Is it a new tool available to the agent?
  → src/tools/

Is it a new skill injection behavior?
  → src/skills/

Is it a new RAG integration?
  → src/rag/

Is it a change to the agent loop or session lifecycle?
  → src/agent/

Does it cross multiple layers?
  → Define shared types in src/types/ first, then implement in each layer
```

## Step-by-step

### Step 1 — Define the type contract first

Before writing any implementation, open `src/types/` and define:
- All new interfaces (prefix with `I`, e.g. `IMyFeature`)
- All new config shapes (suffix with `Config`, e.g. `MyFeatureConfig`)
- Any new error codes in `LemuraErrorCode` enum
- Any new error classes extending `LemuraError`

Document every field with TSDoc `/** */`. Commit types alone: `feat(types): add IMyFeature`.

### Step 2 — Write failing tests first

In `tests/unit/<layer>/MyFeature.test.ts`:
1. Import only the interface (implementation does not exist yet)
2. Write a mock implementation satisfying the interface
3. Write all test cases using the AAA pattern (Arrange / Act / Assert)
4. Run — tests should compile but assertions fail

### Step 3 — Implement

1. Create the implementation file in the correct layer
2. Follow the layer's rules (see context-management, adapters rules for specifics)
3. Run tests — all should now pass
4. If tests reveal the interface needs adjustment, update types first

### Step 4 — Register exports

1. Add to the layer's `index.ts` barrel
2. If stable public API → also add to `src/index.ts`
3. If experimental → add to sub-path export only (`lemura/context`, `lemura/tools`, etc.)

### Step 5 — Document

Every exported symbol needs TSDoc with `@param`, `@returns`, `@throws` (if applicable), `@example`.

### Step 6 — Verify

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

All four must pass before the feature is done.

## Hard rules

- Never use `any` — use `unknown` and narrow
- Never `throw new Error(...)` — use a `LemuraError` subclass
- Never read `process.env` inside the package — accept config objects
- Never import from a higher layer (context must not import from agent)
- Never mutate a `ContextWindow` object — always return a new one via spread