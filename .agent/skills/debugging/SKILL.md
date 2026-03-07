---
name: lemura-debugging
description: Diagnoses and fixes bugs in the lemura package. Use when the agent loop misbehaves, context compression fires incorrectly, tools are not found or not executing, skills are not injected, adapters return wrong types, or TypeScript compilation fails after an upgrade.
---

# Lemura: Debugging

## When to use this skill

- Agent loop hits `maxIterations` or never terminates
- Context compression fires too early, too late, or not at all
- A tool is registered but the model can't call it / it doesn't execute
- Skills are missing from the system prompt
- Adapter returns unexpected `finishReason` or wrong content shape
- Types don't compile after a lemura version upgrade

## Step 0 — Enable debug logging

Pass a console logger at `debug` level to `SessionConfig.logger`. Key events to look for:

| Log prefix | Meaning |
|---|---|
| `[lemura:context] strategy applied` | Strategy name, tokens before/after |
| `[lemura:agent] iteration N` | Loop progress counter |
| `[lemura:agent] tool call` | Tool name and params |
| `[lemura:agent] tool result` | Result and token count |
| `[lemura:adapter] request` | Full normalized request sent to provider |
| `[lemura:adapter] response` | Full normalized response received |

## Symptom → diagnosis tree

### Agent loop never stops / hits maxIterations

1. Check if the same tool is called with identical args twice in a row → infinite loop
2. Check `finishReason` in adapter logs — is it `'tool_call'` when it should be `'stop'`? Adapter normalization bug.
3. Check if the tool result is being appended as a `role: 'tool'` turn — if not, the model never sees the observation
4. Check if the tool's return value is being serialized to a string — object returns without `JSON.stringify` cause the model to retry
5. Verify `maxIterations` is set in `SessionConfig` (default is 10)

### Context compression fires unexpectedly

1. Print `context.tokenCount` vs `context.maxTokens` before each strategy's `shouldApply()`
2. Check if system prompt and scratchpad are being included in the token count (they should be)
3. Check strategy priority order — is a heavy strategy firing before a lighter one?
4. Check `shouldApply()` threshold condition — is it `>=` or `>` the limit?

### Tool not found / not executing

1. Call `session.tools.list()` — verify the tool name appears exactly as expected
2. Check the name the model is using matches exactly (case-sensitive, snake_case)
3. If using autodiscovery: check `SessionConfig.autodiscoverTools === true`
4. Run JSON Schema validation manually against the params the model sent
5. Check for a swallowed `LemuraToolValidationError` in logs

### Skill not injected / wrong position

1. Call `session.skills.list()` — verify skill name appears
2. Check frontmatter `inject` field: must be `system_prompt`, `pre_turn`, or `post_history`
3. Inspect the raw messages array sent to the provider — look for skill content
4. Check priority: lower number = injected first; conflicting priorities cause overwrite

### Adapter wrong types

1. Check `rawResponse` field in `CompletionResponse` — what did the provider actually send?
2. Run the adapter contract test suite to find normalization failures
3. Check if the provider recently changed their API (new field names, new finish reason strings)
4. Verify `finishReason` is mapped using the normalization table in `lemura-new-adapter` skill

### Types don't compile after upgrade

1. Check `CHANGELOG.md` for `BREAKING CHANGE:` entries
2. Most common: new required field on `IProviderAdapter` → add the method throwing `CAPABILITY_NOT_SUPPORTED`
3. Most common: new required field on `ContextWindow` → update anywhere a `ContextWindow` literal is constructed
4. Run `pnpm typecheck` and fix errors in order — type errors cascade

## Reproducing bugs correctly

**Always write a failing test before fixing.** Steps:

1. Extract the failing conversation/state as a fixture in `tests/fixtures/`
2. Write a failing integration test using `MockProviderAdapter` with a scripted response sequence
3. Confirm the test fails with the bug present
4. Fix the bug
5. Confirm the test now passes
6. Keep the test — it's a permanent regression guard

No bug fix without a test. This is non-negotiable.