# Observability & Monitoring

lemura emits events throughout the agent lifecycle. Subscribe to them for real-time visibility into compression, tool execution, loop behavior, and token usage.

---

## Events Reference

```typescript
// Subscribe to events with session.on(event, handler):
session.on('compression:start',  handler);
session.on('compression:end',    handler);
session.on('strategy:applied',   handler);
session.on('turn:complete',      handler);
session.on('tool:execute',       handler);
session.on('tool:result',        handler);
session.on('loop:detected',      handler);
session.on('goal:evaluated',     handler);
```

---

## Compression Events

```typescript
session.on('compression:start', ({ tokenCount, maxTokens, strategies }) => {
  console.log(`🗜  Compression triggered at ${tokenCount}/${maxTokens} tokens`);
  console.log(`   Strategies to run: ${strategies.join(', ')}`);
});

session.on('strategy:applied', ({ strategyName, tokensBefore, tokensAfter, turnsRemoved }) => {
  const saved = tokensBefore - tokensAfter;
  const pct   = ((saved / tokensBefore) * 100).toFixed(1);
  console.log(`   [${strategyName}] ${tokensBefore} → ${tokensAfter} tokens (-${saved}, -${pct}%)`);
  if (turnsRemoved > 0) {
    console.log(`   Removed ${turnsRemoved} turns`);
  }
});

session.on('compression:end', ({ tokenCount, maxTokens, strategiesApplied }) => {
  const utilization = ((tokenCount / maxTokens) * 100).toFixed(1);
  console.log(`✅ Compression done: ${tokenCount} tokens (${utilization}% of max)`);
  console.log(`   Applied ${strategiesApplied} strategies`);
});
```

---

## Tool Execution Events

```typescript
session.on('tool:execute', ({ toolName, args, turnIndex }) => {
  console.log(`🔧 Tool call [turn ${turnIndex}]: ${toolName}`);
  console.log('   Args:', JSON.stringify(args, null, 2));
});

session.on('tool:result', ({ toolName, result, tokenCount, sizeClass, elapsed }) => {
  console.log(`✅ Tool result: ${toolName} (${tokenCount} tokens, ${elapsed}ms)`);
  if (sizeClass === 'oversized') {
    console.warn(`   ⚠️ Oversized result — will be compressed before injection`);
  }
});
```

---

## Turn & Loop Events

```typescript
session.on('turn:complete', ({ role, tokenCount, finishReason, usage }) => {
  console.log(`Turn [${role}]: ${tokenCount} tokens, finish: ${finishReason}`);
  if (usage) {
    console.log(`   Input: ${usage.promptTokens} | Output: ${usage.completionTokens}`);
  }
});

session.on('loop:detected', ({ tool, args, strike }) => {
  console.warn(`⚠️ Loop detected! Tool "${tool}" called with same args (strike ${strike}/3)`);
  // At strike 3, the loop automatically halts
});

session.on('goal:evaluated', ({ status, successCriteria, metCount, totalCount }) => {
  console.log(`🎯 Goal self-evaluation: ${status} (${metCount}/${totalCount} criteria met)`);
});
```

---

## Structured Logging Pattern

For production, emit structured events to your observability stack:

```typescript
import pino from 'pino';

const log = pino({ level: 'info' });

// Compression monitoring
session.on('strategy:applied', (data) => {
  log.info({ event: 'compression.strategy_applied', ...data });
});

// Cost tracking
let sessionInputTokens = 0;
let sessionOutputTokens = 0;

session.on('turn:complete', ({ usage }) => {
  if (usage) {
    sessionInputTokens  += usage.promptTokens;
    sessionOutputTokens += usage.completionTokens;
    
    log.info({
      event: 'turn.complete',
      promptTokens:     usage.promptTokens,
      completionTokens: usage.completionTokens,
      sessionInputCost:  (sessionInputTokens  / 1_000_000) * 5,   // $5/M
      sessionOutputCost: (sessionOutputTokens / 1_000_000) * 15,  // $15/M
    });
  }
});

// Tool performance
session.on('tool:result', ({ toolName, elapsed, tokenCount }) => {
  log.info({
    event: 'tool.result',
    toolName,
    latencyMs:   elapsed,
    tokenCount,
  });
  
  // Alert on slow tools
  if (elapsed > 5_000) {
    log.warn({
      event:    'tool.slow',
      toolName,
      latencyMs: elapsed,
    });
  }
});
```

---

## Building a Debug Dashboard

A minimal real-time terminal dashboard for development:

```typescript
function createDebugDashboard(session: SessionManager) {
  let stats = {
    turns:           0,
    toolCalls:       0,
    compressions:    0,
    tokensPeak:      0,
    totalInputTokens: 0,
  };

  session.on('turn:complete', ({ tokenCount, usage }) => {
    stats.turns++;
    stats.tokensPeak = Math.max(stats.tokensPeak, tokenCount);
    if (usage) stats.totalInputTokens += usage.promptTokens;
    
    printDashboard(stats, session.getContext());
  });

  session.on('tool:execute', () => stats.toolCalls++);
  session.on('compression:end', () => stats.compressions++);
}

function printDashboard(stats: typeof stats, context: ContextWindow) {
  const utilization = (context.tokenCount / context.maxTokens * 100).toFixed(1);
  const bar = '█'.repeat(Math.floor(Number(utilization) / 5)) +
              '░'.repeat(20 - Math.floor(Number(utilization) / 5));

  console.clear();
  console.log('═══════════════════════ lemura debug ═══════════════════════');
  console.log(`Context:     [${bar}] ${utilization}%`);
  console.log(`Tokens:      ${context.tokenCount.toLocaleString()} / ${context.maxTokens.toLocaleString()}`);
  console.log(`Turns:       ${stats.turns}  │  Tool calls: ${stats.toolCalls}  │  Compressions: ${stats.compressions}`);
  console.log(`Peak tokens: ${stats.tokensPeak.toLocaleString()}  │  Total input: ${stats.totalInputTokens.toLocaleString()}`);
  console.log('═════════════════════════════════════════════════════════════');
}
```

---

## Prometheus Metrics

For production metrics, expose a Prometheus endpoint:

```typescript
import { Registry, Counter, Histogram, Gauge } from 'prom-client';

const registry = new Registry();

const compressionCounter = new Counter({
  name: 'lemura_compressions_total',
  help: 'Number of compression events',
  labelNames: ['strategy'],
  registers: [registry],
});

const tokenGauge = new Gauge({
  name: 'lemura_context_tokens',
  help: 'Current token count in context window',
  labelNames: ['session_id'],
  registers: [registry],
});

const toolLatency = new Histogram({
  name: 'lemura_tool_latency_seconds',
  help: 'Tool execution latency',
  labelNames: ['tool_name'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
  registers: [registry],
});

// Wire events
session.on('strategy:applied', ({ strategyName }) => {
  compressionCounter.labels(strategyName).inc();
});

session.on('turn:complete', ({ tokenCount }) => {
  tokenGauge.labels('session-1').set(tokenCount);
});

session.on('tool:result', ({ toolName, elapsed }) => {
  toolLatency.labels(toolName).observe(elapsed / 1_000);
});

// Expose metrics endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', registry.contentType);
  res.send(await registry.metrics());
});
```

---

## Tips & Tricks

> **Tip:** Subscribe to `'loop:detected'` in production and send an alert. It's a reliable signal that a tool is misbehaving — returning the same result regardless of input, or the agent is stuck in a reasoning loop.

> **Tip:** Track `tokensPeak` across sessions (the maximum context size reached before compression). If it's consistently near `maxTokens`, your compression thresholds are too late — lower `triggerThreshold` to compress earlier.

> **Tip:** For distributed systems, include a `sessionId` in every event payload so you can correlate events across microservices:
> ```typescript
> session.on('turn:complete', (data) => {
>   log.info({ event: 'turn.complete', sessionId: mySessionId, ...data });
> });
> ```
