# Security & Observability

Ensure your agent is safe to use in production and its actions are fully transparent.

## Safety & Governance

### `toolFirewall: ToolFirewallConfig`
The most critical security setting for autonomous agents. It defines which tools can run automatically and which require manual human approval.

```typescript
toolFirewall: {
  defaultDecision: 'ask', // Require approval by default
  rules: [
    { name: '^read_.*', decision: 'accept' }, // Auto-accept safe reads
    { name: 'execute_shell', decision: 'deny' } // Block dangerous tools
  ],
  onAsk: async (name, args) => {
    // Show a dialog in your UI
    return 'accept';
  }
}
```

---

## Observability

### `logger: ILogger`
Inject your application's logger to capture detailed traces of the ReAct loop, context compression events, and adapter performance.

```typescript
// Integration with any logging library (Winston, Pino, Console)
logger: {
  info: (msg, ctx) => myAppLogger.info({ context: ctx }, msg),
  error: (msg, ctx) => myAppLogger.error({ context: ctx }, msg),
  // ...
}
```

### `toolResponseProcessor` (Observability aspect)
Can be used to log or filter specifically what data tools are returning before the agent sees it, providing an additional layer of auditability.
