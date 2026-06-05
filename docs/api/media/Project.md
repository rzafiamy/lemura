---
trigger: always_on
---

# lemura — Project Rules

## What is lemura?

`lemura` is a provider-agnostic npm package that encapsulates a full agentic AI runtime.  
It bundles:
- A **ReAct agent loop** (Reason → Act → Observe → repeat)
- **OpenAI-compatible API adapters** for text, ASR, TTS, vision, and image generation
- A **RAG connector interface** (ingest + query)
- A **context window management engine** with pluggable compression strategies
- **Tools autodiscovery** and a **ToolRegistry**
- **Skills injection** into agent system prompts

> Package name on npm: `lemura`  
> GitHub org convention: `lemura-ai/lemura`

---

## Non-Negotiable Architectural Rules

1. **Provider-agnostic.** Never import or hardcode any specific AI provider SDK (openai, anthropic, cohere, etc.) inside the core package. All provider interaction happens through the `IProviderAdapter` interface.
2. **Zero magic / no globals.** No module-level singletons, no process.env reads inside the package. All config flows in via constructor arguments.
3. **Composable layers.** Each layer (primitives, adapters, context, runtime) must be importable independently. A consumer using only compression utilities must not bundle the ReAct runtime.
4. **Async-first.** Every I/O surface returns `Promise<T>` or `AsyncIterable<T>`. No synchronous blocking calls.
5. **Streaming-ready.** `complete()` and `stream()` are separate methods on `IProviderAdapter`. The agent loop must handle both.
6. **Framework-agnostic.** Code must run in Node.js ≥ 18, Deno (via npm compat), Cloudflare Workers, and modern browser bundlers without polyfills.
7. **No side effects at import time.** Every exported module must be `"sideEffects": false` safe.

---

## Repository Layout

```
lemura/
├── src/
│   ├── types/          # Layer 1 — interfaces, enums, error classes (no deps)
│   ├── adapters/       # Layer 2 — IProviderAdapter + reference OpenAI adapter
│   ├── context/        # Layer 3 — ContextManager + all compression strategies
│   ├── tools/          # ToolRegistry, autodiscovery, base tool interface
│   ├── skills/         # SkillInjector, skill manifest loader
│   ├── rag/            # IRAGAdapter interface + connector
│   ├── agent/          # ReActAgent, SessionManager
│   └── index.ts        # Barrel — stable public API only
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/       # Sanitized conversation histories at various token lengths
├── skills/             # Bundled built-in skills (markdown files)
├── .cursor/rules/      # Agent rules (this folder)
├── tsconfig.json
├── tsup.config.ts      # Dual CJS + ESM build
└── package.json
```

---

## Naming Conventions

| Concept | Pattern | Example |
|---|---|---|
| Interfaces | `I` prefix | `IProviderAdapter`, `IContextStrategy` |
| Abstract base classes | `Base` prefix | `BaseCompressionStrategy` |
| Error classes | `Lemura` prefix | `LemuraContextOverflowError` |
| Config types | `Config` suffix | `AgentConfig`, `SessionConfig` |
| Strategy implementations | descriptive noun | `SandwichCompressionStrategy` |
| Public exports | PascalCase classes, camelCase functions | — |

---

## Versioning & Stability Tiers

- **Stable API** (follows semver strictly): everything exported from `lemura` root entry point
- **Experimental API** (may change in minor versions): exports from `lemura/context`, `lemura/tools`, `lemura/skills`, `lemura/rag`
- **Internal** (no stability guarantee): anything under `src/internal/` or prefixed with `_`

Current target: `0.x` until all four core apps have migrated to the package.

---

## Commit Convention

Use [Conventional Commits](https://www.conventionalcommits.org):

```
feat(context): add MaxTokensCompressionStrategy
fix(adapter): normalize finish_reason across providers
docs(rag): document IRAGAdapter interface
test(agent): add ReAct loop integration fixture
chore(build): switch to tsup dual output
```

Breaking changes must include `BREAKING CHANGE:` in the commit footer.

---

## Definition of Done (per feature)

- [ ] TypeScript types defined in `src/types/`
- [ ] Implementation in correct layer
- [ ] Unit tests with >90% branch coverage
- [ ] Integration test if it crosses layer boundaries
- [ ] TSDoc comments on every exported symbol
- [ ] Entry in CHANGELOG.md
- [ ] Export added to correct entry point (root or sub-path)