# Building an npm Package for Your Agentic AI Framework

## Phase 1 — Audit & Inventory Before You Write a Line

Before designing the package, map everything you already have across your apps:

1. **Catalog every capability** — List each feature (ReAct loop, ASR, TTS, vision, image gen, text, RAG ingest, RAG query, RLM scratchpad, sandwich compression, history compression, max-token compression, tools autodiscovery, skills injection) as a discrete unit.
2. **Find the common core** — Identify what is truly shared vs. what is app-specific configuration. The shared parts become the package; the configuration stays in the consuming app.
3. **Identify coupling points** — Where does your ReAct loop touch the API layer? Where does context compression touch the history? These seams define your internal module boundaries.
4. **Document your data contracts** — What shape is a "message"? A "tool"? A "skill"? A "RAG result"? These become your TypeScript interfaces or JSDoc schemas.

---

## Phase 2 — Design Principles to Commit To

These decisions shape everything downstream:

- **Provider-agnostic by default.** Your package should not hardcode OpenAI, Anthropic, or any other provider. Callers pass in an adapter or a compliant client. This is the most important architectural choice.
- **Bring Your Own HTTP client.** Don't bundle `axios` or `node-fetch` as hard dependencies. Accept a fetch-compatible interface.
- **Zero magic.** Every behavior should be explicitly opted into. No global singletons, no hidden state.
- **Composable over monolithic.** Consumers should be able to use just the ReAct loop, or just the compression utilities, without pulling in the full runtime. Structure as a family of cooperating modules, not one god-object.
- **Async-first, streaming-ready.** Every I/O surface should return Promises and support async iterators for streaming responses.
- **Framework-agnostic.** Your package should work in Node.js, Deno (via npm compat), Cloudflare Workers, and browser-side bundlers without modification.

---

## Phase 3 — Package Architecture

Organize the package into **four conceptual layers**:

### Layer 1 — Core Primitives (no dependencies)
This layer has zero imports from outside the package. It contains:
- **Type definitions / interfaces** — `Message`, `Tool`, `Skill`, `AgentConfig`, `ContextWindow`, `RAGResult`, `Turn`
- **Pure utility functions** — token counting helpers, message serialization, role normalization
- **Error classes** — `ContextOverflowError`, `ToolNotFoundError`, `SkillInjectionError`

### Layer 2 — Provider Adapters
A thin abstraction layer that normalizes different API providers:
- **Base adapter interface** — defines `complete()`, `stream()`, `embed()`, `transcribe()`, `synthesize()`, `generateImage()`, `describeImage()`
- **Reference adapter** — a minimal implementation against the OpenAI-compatible API format that serves as the canonical example
- **Adapter factory** — a utility to build custom adapters from config, so consumers don't need to subclass

### Layer 3 — Context Management Engine
This is the heart of your differentiation. Each technique becomes a standalone, testable strategy object:
- **ContextManager** — the orchestrator that holds current window state
- **ScratchpadStrategy** (RLM scratchpad) — manages working memory separate from conversation history
- **SandwichCompressionStrategy** — wraps old turns with compression markers
- **HistoryCompressionStrategy** — summarizes rolling windows of history
- **MaxTokensCompressionStrategy** — triggered compression when approaching limits
- **Strategy interface** — all strategies implement the same `apply(context): context` signature so they are interchangeable and stackable

### Layer 4 — Agent Runtime
Wires everything together:
- **ReActAgent** — the main loop: think → act → observe → repeat
- **ToolRegistry** — autodiscovery, registration, and invocation of tools
- **SkillInjector** — loads and injects skills into the system prompt or context at runtime
- **RAGConnector** — normalized interface for ingest and query, accepts a user-supplied adapter
- **SessionManager** — ties together a ContextManager + ReActAgent + ToolRegistry for a single conversation

---

## Phase 4 — The Public API Surface (What Consumers See)

Design from the consumer's perspective first. A consuming app should be able to do something conceptually like:

1. Instantiate a provider adapter with their credentials
2. Create an agent config (model, tools, skills, compression strategy stack)
3. Create a session
4. Call `session.run(userMessage)` and get back a response or an async stream
5. Inspect or manipulate `session.context` if needed

The key insight: **consumers configure, they don't construct internals.** They should never need to instantiate a `SandwichCompressionStrategy` directly unless they want custom behavior. A config object like `{ compression: ['sandwich', 'history'] }` should be enough.

---

## Phase 5 — Module Entry Points & Exports

Structure your `package.json` exports map to support tree-shaking and selective imports:

- **Main entry** — exports the full runtime (ReActAgent, SessionManager, etc.)
- **`/adapters`** — exports just the adapter interfaces and reference implementation
- **`/context`** — exports just the context management strategies (useful for apps building their own agent loop)
- **`/tools`** — exports ToolRegistry and autodiscovery utilities in isolation
- **`/types`** — exports only TypeScript types, zero runtime cost

This means a consumer who only wants your compression utilities doesn't bundle the ReAct runtime.

---

## Phase 6 — Configuration Strategy

Use a layered config system with clear precedence:

1. **Package defaults** — sensible baselines baked into the package
2. **Agent-level config** — passed when creating an agent instance
3. **Session-level overrides** — passed when starting a session
4. **Runtime overrides** — passed per-turn for dynamic behavior

Never use environment variables directly inside the package. Accept config objects. Let the consuming app decide how to source secrets.

---

## Phase 7 — Testing Strategy

Before publishing, you need three test layers:

- **Unit tests** — each compression strategy, tool registry, skill injector, and adapter in complete isolation with mocked dependencies
- **Integration tests** — the full ReAct loop with a mock provider that returns scripted responses, verifying that tool calls, observations, and context compression work end-to-end
- **Contract tests** — for each adapter you ship, a test suite that validates the adapter correctly maps provider responses to your internal types. New community-contributed adapters should pass this same suite.

Use a fixture library of real (sanitized) conversation histories at various token lengths to test compression strategies against realistic data.

---

## Phase 8 — Versioning & Stability Contract

Divide your exports into two tiers before v1.0:

- **Stable API** — `SessionManager`, `ReActAgent`, all config interfaces, adapter interfaces. These follow semver strictly.
- **Experimental API** — Individual strategies, internal registries, anything prefixed with `_` or exported from `/internal`. These can change in minor versions. Document this distinction explicitly.

Use [Conventional Commits](https://www.conventionalcommits.org) from day one so your changelog and version bumps are automated.

---

## Phase 9 — Documentation Architecture

Good npm packages live or die by docs. Structure them as:

1. **README** — 5-minute getting started, the single most common use case end-to-end
2. **Concept guide** — explains ReAct, context window management, and how your strategies work (this is where you explain RLM scratchpad, sandwich compression, etc. conceptually)
3. **API reference** — auto-generated from TSDoc/JSDoc comments on every exported symbol
4. **Recipes** — short, copy-pasteable examples for each major use case (custom tool, custom skill, custom adapter, RAG integration, streaming)
5. **Migration guide** — maintained from the beginning even before there's anything to migrate from

---

## Phase 10 — Publishing & Distribution Checklist

Before publishing to npm:

- [ ] Dual CJS + ESM output (use a bundler like `tsup` or `rollup` to emit both)
- [ ] TypeScript declaration files (`.d.ts`) published alongside JS
- [ ] `package.json` `exports` map covering all entry points
- [ ] `engines` field specifying minimum Node.js version
- [ ] `sideEffects: false` to enable tree-shaking
- [ ] `files` array in `package.json` to exclude test fixtures, source maps in dev, and build scripts from the published tarball
- [ ] Provenance attestation via `npm publish --provenance` for supply chain trust
- [ ] A `CHANGELOG.md` generated from conventional commits

---

## Phase 11 — Governance & Extensibility for the Future

Design for community extension from the start:

- **Adapter registry pattern** — document how third parties can publish an `agent-sdk-adapter-anthropic` or `agent-sdk-adapter-cohere` package that slots into your system
- **Strategy plugin interface** — same for compression strategies; anyone can publish a custom one
- **Tool autodiscovery protocol** — define a manifest format (e.g., a JSON schema in `package.json` under a custom key) so npm packages can declare themselves as tools
- **Skills registry** — define a convention for skill packages so skills can be discovered and injected automatically

---

## Summary: The Right Order of Operations

1. Audit your existing apps → extract shared contracts
2. Define all TypeScript interfaces (no implementation yet)
3. Build Layer 1 primitives with full test coverage
4. Build the provider adapter interface + one reference implementation
5. Port context management strategies one by one, each with tests
6. Build the ReAct runtime against the abstracted adapter
7. Wire it all together in `SessionManager`
8. Extract your existing apps to consume the package as their first real integration test
9. Publish `0.x` to npm, iterate
10. Stabilize to `1.0` once the API has been battle-tested across all your apps

The most critical discipline throughout: **resist the urge to solve everything at once.** Get the adapter interface and the ReAct loop right first. Compression strategies and tool autodiscovery can be layered on incrementally.