# SessionConfig Reference

`SessionConfig` is the single configuration object passed to `SessionManager`. It controls every aspect of agent behavior — from adapter selection to advanced execution policies.

> **Design principle:** No globals, no environment variable reads inside lemura. Every config value is explicit and passed via constructor. This makes behavior predictable, testable, and auditable.

---

## Full Interface

```typescript
interface SessionConfig {
  // ─── Required ───────────────────────────────────────────────
  adapter: IProviderAdapter;
  model: string;
  maxTokens: number;

  // ─── System Prompt ──────────────────────────────────────────
  systemPrompt?: string;

  // ─── Loop Control ───────────────────────────────────────────
  maxIterations?: number;            // default: 10
  maxSteps?: number;                 // default: 20

  // ─── Extensions ─────────────────────────────────────────────
  tools?: IToolDefinition[];
  skills?: ISkill[];
  ragAdapter?: IRAGAdapter;
  compressionStrategies?: IContextStrategy[];
  media?: MediaConfig;
  media?: MediaConfig;

  // ─── Advanced Execution ─────────────────────────────────────
  enableGoalPlanning?: boolean;
  goalInjectionFrequency?: 'always' | 'every_N_turns' | 'on_compression';
  goalInjectionPosition?: 'system_prompt' | 'pre_turn';
  enableContinuationPlanning?: boolean;
  continuationStrategy?: 'sequential' | 'parallel' | 'conditional';

  // ─── Token Budgets ──────────────────────────────────────────
  toolResponseTokenBudget?: number;  // default: 15% of maxTokens
  ragTokenBudget?: number;           // default: 20% of maxTokens
  skillTokenBudget?: number;         // default: 10% of maxTokens

  // ─── Tool Processing ────────────────────────────────────────
  toolResponseProcessor?: IToolResponseProcessor;
  toolFirewall?: ToolFirewallConfig;

  // ─── Auto-Discovery ─────────────────────────────────────────
  autodiscoverTools?: boolean;       // default: false

  // ─── Observability ──────────────────────────────────────────
  logger?: ILogger;
}
```

---

## Required Fields

### `adapter: IProviderAdapter`
The AI provider connection. Determines which LLM receives requests.

```typescript
// OpenAI
adapter: new OpenAICompatibleAdapter({
  baseUrl: 'https://api.openai.com/v1',
  apiKey: process.env.OPENAI_API_KEY!,
  defaultModel: 'gpt-4o',
})

// Local Ollama (no API key)
adapter: new OpenAICompatibleAdapter({
  baseUrl: 'http://localhost:11434/v1',
  apiKey: 'ollama',
  defaultModel: 'llama3.2',
})
```

### `model: string`
The model identifier sent with each API request. Must match available models for your `adapter.baseUrl`.

```typescript
model: 'gpt-4o'              // OpenAI
model: 'claude-3-5-sonnet'   // Anthropic (via custom adapter)
model: 'llama-3.3-70b-versatile'  // Groq
model: 'llama3.2'            // Ollama local
```

### `maxTokens: number`
The context window size. Used by `ContextManager` to decide when to compress. **Set this to match your actual model's context window:**

| Model | Context window | Recommended `maxTokens` |
|---|---|---|
| GPT-4o | 128k | 120_000 (leave buffer) |
| GPT-4o mini | 128k | 120_000 |
| Claude 3.5 Sonnet | 200k | 190_000 |
| Llama 3.3 70B (Groq) | 128k | 120_000 |
| Mistral 7B | 32k | 30_000 |

---

## Loop Control

### `maxIterations?: number` (default: 10)
Hard limit on full ReAct cycles (one cycle = think → tool → observe). When exceeded, throws `LemuraMaxIterationsError`.

**When to increase:** Complex research tasks with many tool hops require more iterations. Try 15–20 for heavy workflows.

### `maxSteps?: number` (default: 20)
Soft limit on individual tool calls. When reached, lemura injects a "wrap it up" message and removes tool definitions from the payload — forcing a natural conclusion without throwing.

**maxIterations vs maxSteps:**
```
maxIterations = 3, maxSteps = 20:
  Cycle 1: tool call × 5 (5 steps)
  Cycle 2: tool call × 7 (12 steps)
  Cycle 3: tool call × 3 (15 steps) → stops: 3 full cycles reached
  
maxIterations = 10, maxSteps = 6:
  Cycle 1: tool call × 4 (4 steps)
  Cycle 2: tool call × 2 (6 steps) → stops: maxSteps reached, forced conclusion
```

---

## Token Budget Fields

All budget fields are **absolute token counts**, not percentages:

```typescript
const session = new SessionManager({
  adapter,
  model: 'gpt-4o',
  maxTokens: 128_000,

  // Raw token counts
  toolResponseTokenBudget: 19_200,  // ~15% of 128k
  ragTokenBudget:          25_600,  // ~20% of 128k
  skillTokenBudget:        12_800,  // ~10% of 128k
});
```

> **Tip:** Budget fields are additive — make sure they don't collectively exceed `maxTokens - (your expected conversation size)`. A good starting rule: tools + RAG + skills ≤ 50% of `maxTokens`.

---

## Media Bridge Configuration

Enable built-in media tools (ASR, TTS, vision, image gen) so the agent can call them directly:

```ts
const session = new SessionManager({
  adapter,
  model: 'gpt-4o-mini',
  maxTokens: 128_000,
  media: {
    enableTools: true,
    toolPrefix: 'media_'
  }
});
```

You can still use `MediaBridge` directly in your app without enabling tools.

`MediaConfig` shape:

```ts
type MediaConfig = {
  enableTools?: boolean;
  toolPrefix?: string;
};
```

---

## Tool Firewall

The firewall controls whether a tool call is executed. It supports `accept`, `deny`, and `ask` decisions based on regex rules.

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

Behavior:
- `accept`: tool executes normally.
- `deny`: tool is blocked and the agent receives an error response.
- `ask`: delegates to `onAsk`. If no handler is provided, the tool is blocked.

`ToolFirewallConfig` shape:

```ts
type ToolDecision = 'accept' | 'deny' | 'ask';

type ToolFirewallRule = {
  name?: string;        // regex on tool name
  arguments?: string;   // regex on JSON args string
  decision: ToolDecision;
  reason?: string;
};

type ToolFirewallConfig = {
  defaultDecision?: ToolDecision;
  rules?: ToolFirewallRule[];
  onAsk?: (toolName: string, argsJson: string) => Promise<'accept' | 'deny'> | 'accept' | 'deny';
};
```

---

## Observability: The ILogger Interface

Inject a structured logger to capture all lemura internals:

```typescript
interface ILogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

// Minimal console logger:
const logger: ILogger = {
  debug: (msg, ctx) => console.debug(`[lemura:debug] ${msg}`, ctx ?? ''),
  info:  (msg, ctx) => console.info (`[lemura:info ] ${msg}`, ctx ?? ''),
  warn:  (msg, ctx) => console.warn (`[lemura:warn ] ${msg}`, ctx ?? ''),
  error: (msg, ctx) => console.error(`[lemura:error] ${msg}`, ctx ?? ''),
};

// Pino integration:
import pino from 'pino';
const pinoLogger = pino({ level: 'debug' });
const logger: ILogger = {
  debug: (msg, ctx) => pinoLogger.debug(ctx, msg),
  info:  (msg, ctx) => pinoLogger.info(ctx, msg),
  warn:  (msg, ctx) => pinoLogger.warn(ctx, msg),
  error: (msg, ctx) => pinoLogger.error(ctx, msg),
};
```

---

## Configuration Presets

### Minimal (development / prototyping)
```typescript
const session = new SessionManager({
  adapter,
  model: 'gpt-4o',
  maxTokens: 128_000,
});
```

### Production (customer-facing chatbot)
```typescript
const session = new SessionManager({
  adapter,
  model: 'gpt-4o',
  maxTokens: 128_000,
  systemPrompt: 'You are a helpful support agent for Acme Corp.',
  maxIterations: 5,       // keep it snappy
  maxSteps: 10,
  tools: [lookupOrderTool, createTicketTool],
  ragAdapter: pineconeAdapter,
  compressionStrategies: [
    new SandwichCompressionStrategy(adapter, { preserveFirst: 3, preserveLast: 6 }),
  ],
  logger: productionLogger,
});
```

### Heavy Research Agent
```typescript
const session = new SessionManager({
  adapter,
  model: 'gpt-4o',
  maxTokens: 200_000,
  maxIterations: 20,
  maxSteps: 50,
  enableGoalPlanning: true,
  enableContinuationPlanning: true,
  continuationStrategy: 'sequential',
  compressionStrategies: [
    new SummaryInjectionStrategy({ priority: 1 }),
    new SandwichCompressionStrategy(adapter, { priority: 2, preserveFirst: 2, preserveLast: 4 }),
    new MaxTokensCompressionStrategy(adapter, { priority: 3, threshold: 0.92 }),
  ],
  toolResponseTokenBudget: 30_000,
  logger: researchLogger,
});
```

---

## Tips & Tricks

> **Tip:** Set `maxIterations` conservatively in production. A runaway agent calling tools 50 times is expensive. Start at 5–8 and increase if tasks legitimately need more steps.

> **Tip:** `systemPrompt` vs `skills` — use `systemPrompt` for absolute rules that never change ("Always respond in English"), and skills for capabilities that might vary or compose ("You are a code review expert").

> **Tip:** When you have both `ragAdapter` and `compressionStrategies`, compression always runs *before* RAG injection. RAG results are fresh per-turn and don't need to be in the compressed history.
