# Tool Firewall

The **Tool Firewall** is a policy layer that gates every tool call before execution. It gives your app granular control over which tools the agent can use, when, and under what conditions — with support for user-in-the-loop approval flows.

The firewall is **fully wired** into the `SessionManager` ReAct loop as of v1.2.0. It is evaluated on every tool call, including parallel batches.

---

## How It Works

For every tool call the agent requests, the firewall evaluates a list of rules in order. The **first matching rule** wins. If no rule matches, the `defaultDecision` is used.

| Decision | Effect |
|---|---|
| `accept` | Tool executes immediately |
| `deny` | Tool is blocked; the agent receives a blocked error observation |
| `ask` | Your app's `onAsk` callback decides; if no callback, defaults to deny |

---

## Configuration

```typescript
import { SessionManager } from 'lemura';

const session = new SessionManager({
  adapter,
  model: 'gpt-4o-mini',
  maxTokens: 32_000,
  toolFirewall: {
    // Fallback when no rule matches
    defaultDecision: 'ask',

    // Ordered list — first match wins
    rules: [
      // Read-only tools are safe — always allow
      { name: '^read_.*',        decision: 'accept', reason: 'Read-only tools are safe' },

      // Writes need user approval
      { name: '^write_.*',       decision: 'ask',    reason: 'Write operations require approval' },

      // Extremely dangerous — never allow
      { name: '^execute_shell$', arguments: 'rm\\s+-rf', decision: 'deny', reason: 'Dangerous shell pattern blocked' },

      // Block all network calls in offline mode
      { name: '^(fetch|http)_', decision: 'deny',   reason: 'Network tools disabled in offline mode' },
    ],

    // Called when a rule (or the default) results in 'ask'
    onAsk: async (toolName, argsJson) => {
      const args = JSON.parse(argsJson);
      // Show a confirmation dialog in your UI
      const confirmed = await myUi.confirm(
        `Allow the agent to call "${toolName}" with args:\n${JSON.stringify(args, null, 2)}?`
      );
      return confirmed ? 'accept' : 'deny';
    },
  },
});
```

---

## Rule Matching

Each `ToolFirewallRule` has two optional matchers. **Both** must match for the rule to apply:

| Field | Type | Description |
|---|---|---|
| `name` | `string` (regex) | Matched against the tool's `name` property |
| `arguments` | `string` (regex) | Matched against the JSON-serialised arguments string |
| `decision` | `'accept' \| 'deny' \| 'ask'` | Decision to apply when matched |
| `reason` | `string` | Human-readable reason included in the blocked observation |

When a matcher field is omitted, it matches everything. An empty `rules` array means the `defaultDecision` always applies.

---

## The `ask` Flow in Detail

When a tool hits `ask`:

1. lemura calls `onAsk(toolName, argsJson)` if configured.
2. Your handler receives the tool name and the full JSON arguments string.
3. Return `'accept'` to allow, or `'deny'` to block.
4. If no `onAsk` handler is set, `ask` behaves like `deny`.

The agent receives a structured observation telling it the call was blocked:
```
Blocked by tool firewall: Write operations require approval
```
A well-tuned model will explain this to the user and stop retrying.

---

## Parallel Calls & the Firewall

When `parallelToolCalls: true` is enabled, the firewall is still evaluated **sequentially** for each call in a batch (because `onAsk` may involve async user interaction). Only calls that pass the firewall are passed to the parallel executor.

---

## Security Patterns

### Allow nothing by default
```typescript
toolFirewall: {
  defaultDecision: 'deny',
  rules: [
    { name: '^(search_web|get_weather)$', decision: 'accept' },
  ]
}
```

### Require approval for all tools
```typescript
toolFirewall: {
  defaultDecision: 'ask',
  onAsk: async (toolName, argsJson) => myApprovalSystem.prompt(toolName, argsJson),
}
```

### Block dangerous parameter patterns
```typescript
toolFirewall: {
  defaultDecision: 'accept',
  rules: [
    // Block path traversal in any tool
    { arguments: '\\.\\.\\/|\\.\\.\\\\'  , decision: 'deny', reason: 'Path traversal blocked' },
    // Block absolute paths in write tools
    { name: '^write_.*', arguments: '"\\/[a-z]', decision: 'deny', reason: 'Absolute path writes blocked' },
  ]
}
```

---

## When Things Go Wrong

| Symptom | Likely Cause | Fix |
|---|---|---|
| Agent keeps retrying a blocked tool | Model doesn't understand the denial reason | Make `reason` more descriptive |
| `onAsk` never called | Rule matched with `deny` before hitting default | Review rule order — more specific rules go first |
| All tools blocked | `defaultDecision: 'deny'` with no matching rules | Add `accept` rules for your intended tools |
| Firewall never triggered | `toolFirewall` not set in `SessionConfig` | Add the `toolFirewall` key to your config |
