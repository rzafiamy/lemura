# Tool Firewall

The Tool Firewall is a lightweight safety layer that controls whether a tool call is executed. It supports:
- `accept`: execute the tool.
- `deny`: block the tool and return an error to the agent.
- `ask`: delegate the decision to your app via a callback.

## Basic Example

```ts
const session = new SessionManager({
  adapter,
  model: 'gpt-4o-mini',
  maxTokens: 128_000,
  toolFirewall: {
    defaultDecision: 'ask',
    rules: [
      { name: '^read_.*', decision: 'accept', reason: 'Read-only tools are safe' },
      { name: '^write_.*', decision: 'ask', reason: 'Writes require approval' },
      { name: '^execute_shell$', arguments: 'rm\\s+-rf', decision: 'deny', reason: 'Dangerous command' }
    ],
    onAsk: async (toolName, argsJson) => {
      // Ask user in your UI and return 'accept' or 'deny'
      return 'deny';
    }
  }
});
```

## Rule Matching
Each rule can match:
- `name`: regex against the tool name
- `arguments`: regex against the JSON arguments string

Rules are evaluated in order. The first match wins. If no rule matches, `defaultDecision` is used.

## Ask Flow
If a rule results in `ask`, lemura calls `onAsk(toolName, argsJson)`:
- Return `accept` to allow the tool.
- Return `deny` to block it.

If no `onAsk` handler is provided, the call is denied by default.

## Recommended Defaults
- `defaultDecision: 'ask'` for safety.
- Allowlist low-risk tools explicitly.
- Deny patterns you never want executed.
