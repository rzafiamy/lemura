# Security & Observability

Production AI agents require two things that raw LLM APIs don't provide: **safety guardrails** that control what the agent can actually do, and **deep observability** into what it's doing at every step. Lemura addresses both through the Tool Firewall and a multi-layered event system.

The Tool Firewall sits between the ReAct loop's tool-dispatch logic and your tool implementations. Every tool call — including parallel batches — passes through it before execution. This gives your application full control over agent behavior without modifying the LLM prompt. The observability system emits structured events at every significant lifecycle point: before and after compression, at each tool call, at each turn, and whenever the loop behaves unexpectedly. Together they make autonomous agents safe to run in production.

---

## Safety & Governance

### `toolFirewall?: ToolFirewallConfig`

The Tool Firewall is the most critical security setting for production agents. It defines which tools can execute automatically and which require human approval or are blocked outright.

```typescript
import { SessionManager } from 'lemura';

const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  toolFirewall: {
    // Fallback when no rule matches
    defaultDecision: 'ask',

    // Ordered rule list — first match wins
    rules: [
      // Read-only tools are always safe
      { name: '^read_.*', decision: 'accept', reason: 'Read-only operations are safe' },

      // Writes need user confirmation
      { name: '^write_.*', decision: 'ask', reason: 'Write operations require approval' },

      // Block path traversal in any tool call
      { arguments: '\\.\\.\\/|\\.\\.\\\\'  , decision: 'deny', reason: 'Path traversal blocked' },

      // Never allow destructive shell patterns
      { name: '^run_command$', arguments: 'rm\\s+-rf', decision: 'deny', reason: 'Dangerous shell command' },
    ],

    // Called when a tool hits 'ask' — your UI handles approval
    onAsk: async (toolName, argsJson) => {
      const args = JSON.parse(argsJson);
      const confirmed = await myUI.confirm(
        `Allow agent to call "${toolName}"?\n${JSON.stringify(args, null, 2)}`
      );
      return confirmed ? 'accept' : 'deny';
    },
  },
});
```

**Firewall decisions:**

| Decision | What happens |
|---|---|
| `accept` | Tool executes immediately |
| `deny` | Blocked; agent receives an error observation with the `reason` text |
| `ask` | `onAsk` callback decides; if no callback is set, behaves like `deny` |

**Rule matching:** Each rule has two optional matchers. **Both** must match for the rule to fire. A rule with only `name` matches any tool whose name matches the regex. A rule with only `arguments` matches any tool call whose serialized JSON args match the regex.

```typescript
// Match by name only
{ name: '^delete_', decision: 'deny' }

// Match by argument pattern only (any tool, any name)
{ arguments: '"admin"', decision: 'ask', reason: 'Admin-scope operations require approval' }

// Match by both (most specific)
{ name: '^send_email$', arguments: '"bcc"', decision: 'ask', reason: 'BCC emails require approval' }
```

> **Security Patterns:** See [Tool Firewall →](/docs/tools-and-skills/tool-firewall) for the full guide including allow-nothing-by-default, circuit breakers, and parallel call behavior.

---

## Observability

### `logger?: ILogger`

Inject your application's logger to receive structured trace output from the entire ReAct loop. Lemura uses a four-level interface compatible with any logging library.

```typescript
interface ILogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string,  context?: Record<string, unknown>): void;
  warn(message: string,  context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}
```

**Adapting common loggers:**

```typescript
import pino from 'pino';

const pinoLogger = pino({ level: 'info' });

const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  logger: {
    debug: (msg, ctx) => pinoLogger.debug(ctx ?? {}, msg),
    info:  (msg, ctx) => pinoLogger.info(ctx  ?? {}, msg),
    warn:  (msg, ctx) => pinoLogger.warn(ctx  ?? {}, msg),
    error: (msg, ctx) => pinoLogger.error(ctx ?? {}, msg),
  },
});
```

```typescript
// Winston integration
import winston from 'winston';

const log = winston.createLogger({ level: 'info', transports: [new winston.transports.Console()] });

logger: {
  debug: (msg, ctx) => log.debug(msg, ctx),
  info:  (msg, ctx) => log.info(msg, ctx),
  warn:  (msg, ctx) => log.warn(msg, ctx),
  error: (msg, ctx) => log.error(msg, ctx),
},
```

---

### `onTrace?: (event: TraceEvent) => void`

Fine-grained trace callback invoked for every significant internal event. Unlike `logger`, `onTrace` receives **structured typed events** — not just strings — making it ideal for building observability dashboards, storing audit trails, or sending data to APM tools.

```typescript
const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  onTrace: (event) => {
    // Every event has a 'type' discriminant
    switch (event.type) {
      case 'tool:execute':
        console.log(`→ Tool: ${event.toolName}`, event.args);
        break;
      case 'tool:result':
        console.log(`← Result: ${event.toolName} (${event.elapsed}ms, ${event.tokenCount} tokens)`);
        break;
      case 'compression:applied':
        console.log(`🗜 Compression: ${event.strategy} saved ${event.tokensSaved} tokens`);
        break;
      case 'turn:complete':
        console.log(`Turn ${event.turnIndex}: ${event.finishReason}`);
        break;
    }
  },
});
```

**All trace event types:**

| Event type | When it fires | Key fields |
|---|---|---|
| `turn:start` | Before each provider call | `turnIndex`, `tokenCount` |
| `turn:complete` | After each provider response | `finishReason`, `usage`, `tokenCount` |
| `tool:execute` | Before each tool call (post-firewall) | `toolName`, `args`, `turnIndex` |
| `tool:result` | After tool returns | `toolName`, `result`, `elapsed`, `tokenCount`, `sizeClass` |
| `tool:blocked` | When firewall blocks a tool | `toolName`, `args`, `decision`, `reason` |
| `compression:start` | Before running strategies | `tokenCount`, `maxTokens`, `strategies` |
| `compression:applied` | After each strategy runs | `strategy`, `tokensBefore`, `tokensAfter`, `tokensSaved` |
| `compression:end` | After all strategies applied | `tokenCount`, `strategiesApplied` |
| `loop:detected` | Duplicate tool call detected | `toolName`, `args`, `strike` |
| `plan:step:done` | Continuation step completed | `stepId`, `output` |
| `plan:step:failed` | Continuation step failed | `stepId`, `error` |
| `goal:evaluated` | Goal self-evaluation ran | `status`, `metCriteria`, `totalCriteria` |

---

## Structured Logging for Production

Combine `logger` and `onTrace` for full observability in production:

```typescript
import pino from 'pino';
import { Registry, Counter, Histogram, Gauge } from 'prom-client';

const log = pino({ level: 'info' });
const registry = new Registry();

// Prometheus metrics
const toolLatency = new Histogram({
  name: 'lemura_tool_latency_seconds',
  help: 'Tool execution latency',
  labelNames: ['tool_name'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
  registers: [registry],
});

const compressionCounter = new Counter({
  name: 'lemura_compressions_total',
  help: 'Number of compression events per strategy',
  labelNames: ['strategy'],
  registers: [registry],
});

const tokenGauge = new Gauge({
  name: 'lemura_context_utilization',
  help: 'Context window utilization (0-1)',
  registers: [registry],
});

const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  sessionId: `session_${Date.now()}`,

  logger: {
    info:  (msg, ctx) => log.info({ ...ctx, sessionId }, msg),
    warn:  (msg, ctx) => log.warn({ ...ctx, sessionId }, msg),
    error: (msg, ctx) => log.error({ ...ctx, sessionId }, msg),
    debug: (msg, ctx) => log.debug({ ...ctx, sessionId }, msg),
  },

  onTrace: (event) => {
    // Always include sessionId for correlation
    const base = { sessionId, eventType: event.type };

    if (event.type === 'tool:result') {
      toolLatency.labels(event.toolName).observe(event.elapsed / 1_000);
      log.info({ ...base, toolName: event.toolName, elapsed: event.elapsed, tokens: event.tokenCount }, 'tool result');

      if (event.sizeClass === 'oversized') {
        log.warn({ ...base, toolName: event.toolName }, 'oversized tool result — compression applied');
      }
    }

    if (event.type === 'compression:applied') {
      compressionCounter.labels(event.strategy).inc();
      log.info({ ...base, strategy: event.strategy, saved: event.tokensSaved }, 'compression');
    }

    if (event.type === 'turn:complete' && event.usage) {
      tokenGauge.set(event.tokenCount / 128_000);
      log.info({ ...base, usage: event.usage, finishReason: event.finishReason }, 'turn complete');
    }

    if (event.type === 'loop:detected') {
      log.warn({ ...base, toolName: event.toolName, strike: event.strike }, 'loop detected');
    }

    if (event.type === 'tool:blocked') {
      log.warn({ ...base, toolName: event.toolName, reason: event.reason }, 'tool blocked by firewall');
    }
  },
});

// Expose Prometheus metrics
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', registry.contentType);
  res.send(await registry.metrics());
});
```

---

## Security Presets

### Safe-by-default (deny everything, allow specific tools)

```typescript
toolFirewall: {
  defaultDecision: 'deny',
  rules: [
    { name: '^(search_web|get_weather|read_file)$', decision: 'accept' },
    { name: '^create_ticket$', decision: 'ask' },
  ],
}
```

### Human-in-the-loop for all tools

```typescript
toolFirewall: {
  defaultDecision: 'ask',
  onAsk: async (toolName, argsJson) => {
    // Route to your approval system (Slack message, email, admin UI)
    return approvalSystem.requestApproval({ toolName, args: JSON.parse(argsJson) });
  },
}
```

### Audit-only (log without blocking)

```typescript
toolFirewall: {
  defaultDecision: 'accept',
  rules: [],
  onAsk: async (toolName, argsJson) => {
    // Just audit — never block
    auditLog.write({ toolName, args: argsJson, timestamp: Date.now() });
    return 'accept';
  },
}
```

---

## Tips & Tricks

> **Tip:** Always set a `logger` in production — the default logger writes to `console.log`. Structured logs in your observability stack make debugging incidents 10× faster than console output.

> **Tip:** Subscribe to `loop:detected` trace events and send an alert. It's a reliable signal that a tool is misbehaving — returning the same result regardless of input — and warrants investigation before the session hits `maxIterations`.

> **Tip:** Include `sessionId` in every trace event payload. In distributed systems (multiple agent workers), you need to correlate tool calls, compressions, and LLM calls back to a specific user session. Without it, debugging production issues is nearly impossible.

> **Tip:** When using the Tool Firewall in a UI-facing agent, implement `onAsk` with a timeout. If the user doesn't respond within 30 seconds, return `'deny'` to prevent the agent from stalling indefinitely.
