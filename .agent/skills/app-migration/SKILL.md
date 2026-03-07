---
name: lemura-app-migration
description: Migrates an existing agentic AI app to consume the lemura package. Use when an app currently has its own ReAct loop, context compression, tool dispatcher, or system prompt builder and needs to replace those with lemura. Follows a phased approach that keeps the app functional throughout.
---

# Lemura: App Migration

## When to use this skill

- Migrating an existing app's agent loop to `SessionManager`
- Replacing homegrown context compression with lemura strategies
- Replacing an in-app tool dispatcher with `ToolRegistry`
- Replacing a system prompt builder with `SkillInjector`
- Replacing an in-app RAG client usage with `IRAGAdapter`

## Core principle

**Never refactor the app and migrate to lemura simultaneously.** One at a time:

1. Wrap existing code behind lemura interfaces (thin pass-through)
2. Replace internal implementations with lemura's one capability at a time
3. Delete the now-redundant internal code

The app must stay functional and testable at every phase boundary.

## Phase 1 — Install and map

```bash
npm install lemura
```

Inventory the app's existing code and map each piece to a lemura concept:

| App code | lemura concept |
|---|---|
| API call wrapper | `IProviderAdapter` |
| Context / history manager | `ContextManager` + strategies |
| Tool definitions + dispatch | `ToolRegistry` + `IToolDefinition` |
| System prompt builder | `SkillInjector` + skill files |
| RAG client | `IRAGAdapter` |
| Agent loop | `ReActAgent` / `SessionManager` |

## Phase 2 — Wrap the provider client

Write a thin `IProviderAdapter` around the app's existing HTTP client. Do NOT replace the HTTP client — just translate:

- Map the app's request format to `CompletionRequest`
- Map the app's response format to `CompletionResponse`
- Normalize `finishReason` to lemura's four values

Run the adapter contract tests. Fix until all pass. Commit.

## Phase 3 — Replace context management (one strategy at a time)

Safest migration order:

1. Replace sandwich compression → `SandwichCompressionStrategy`
2. Replace history compression → `HistoryCompressionStrategy`
3. Replace max-tokens handler → `MaxTokensCompressionStrategy`
4. Replace scratchpad logic → `ScratchpadStrategy`

For each:
1. Add the lemura strategy to `SessionConfig.compressionStrategies`
2. Disable the app's internal implementation of that strategy (comment out, do not delete yet)
3. Run app's existing test suite — behavior should be identical
4. If tests pass: delete the internal implementation
5. Commit before moving to the next strategy

## Phase 4 — Replace tool dispatcher

1. Convert each existing tool to an `IToolDefinition` object with a JSON Schema
2. Register all tools in `SessionConfig.tools`
3. Remove the app's internal `switch`/`if-else` tool dispatch
4. Run tests verifying tool calls still work end-to-end

Migrate tools in functional groups (e.g., all search tools, then all write tools) — not all at once.

## Phase 5 — Replace system prompt builder

1. Extract each skill/persona from the system prompt builder into `.agent/skills/<name>/SKILL.md`
2. Pass skills array to `SessionConfig.skills`
3. Log and compare the assembled system prompt before and after — they should match
4. Delete the system prompt builder function

## Phase 6 — Wire the RAG adapter

1. Write `IRAGAdapter` wrapper around the app's existing RAG client
2. Pass to `SessionConfig.ragAdapter`
3. Remove any manual RAG tool implementations (replaced by lemura's `rag_query` / `rag_ingest`)

## Phase 7 — Switch to SessionManager

Once phases 2–6 are complete:

1. Replace the app's main agent loop with `SessionManager.run()` or `.stream()`
2. Remove the app's internal loop, history accumulator, and turn management
3. The `SessionManager` now owns conversation state

## Validation checklist

- [ ] All existing integration tests pass without modification
- [ ] No internal context management, tool dispatch, or agent loop code remains
- [ ] Streaming behavior preserved if the app supported it
- [ ] App error handling correctly catches `LemuraError` subclasses
- [ ] Bundle size has not significantly increased

## Rollback at any phase

Because each phase is isolated, rollback is always: disable the lemura config for that phase, re-enable the internal implementation. No catastrophic rollbacks. Commit after each phase completes so rollback points are clean.