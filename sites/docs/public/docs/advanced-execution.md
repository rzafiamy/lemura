# Advanced Runtime Execution

Advanced execution techniques govern **how** the ReAct agent executes, recovers, and concludes. These are distinct from context compression — they're about execution discipline, reliability, and keeping complex multi-step agents on track.

lemura supports five runtime techniques, all configured through `SessionConfig`.

---

## Overview

| Technique | Problem it Solves | Config Key |
|---|---|---|
| **Tool Response Compression** | Huge tool outputs flood the context | `toolResponseProcessor` |
| **maxSteps Enforcement** | Agents loop forever | `maxSteps` |
| **Continuation Planning** | Complex dependent tasks fail midway | `enableContinuationPlanning` |
| **Goal Injection** | Agent forgets its objective after compression | `enableGoalPlanning` |
| **Skill Size Management** | Too many skills blow the token budget | `skillTokenBudget` |

---

## 1. Tool Response Compression

Imagine your agent calls a `read_file` tool and gets back 50,000 tokens of log output. Without tool response compression, that lands directly in context and immediately overflows.

### How It Works

Every tool result passes through `ToolResponseProcessor.evaluate()`:

```typescript
interface ToolResponseEvaluation {
  relevanceScore: number;        // 0–1: how relevant is this to the current goal?
  sizeClass: 'small' | 'medium' | 'large' | 'oversized';
  shouldCompress: boolean;
  suggestedMaxTokens: number;
  answered: boolean;             // did the tool actually answer what was asked?
  answeredPartially: boolean;
  errorDetected: boolean;        // semantic error even if HTTP 200
  suggestedAction: 'continue' | 'retry' | 'retry_with_params' | 'skip' | 'escalate';
}
```

Then applies one of four compression strategies:

| Strategy | When Used |
|---|---|
| **Extractive** | Keep only sentences mentioning current goal entities |
| **Truncative** | Keep first N + last M tokens (for structured data like logs) |
| **Structured** | Keep only fields referenced in the tool's output schema |
| **Summarized** | LLM call: _"Summarize in max N tokens, focusing on [goal keywords]"_ |

### Configuration

```typescript
import { SessionManager, ToolResponseProcessor } from 'lemura';

const processor = new ToolResponseProcessor({
  // size thresholds
  smallMaxTokens: 200,
  mediumMaxTokens: 800,
  largeMaxTokens: 2000,
  // budget: cap total tool responses per iteration
  budgetPercent: 0.15,   // default: 15% of maxTokens
});

const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  toolResponseProcessor: processor,
});
```

### Custom ToolResponseProcessor

```typescript
import type { IToolResponseProcessor, ToolResponseEvaluation } from 'lemura/types';

class MyProcessor implements IToolResponseProcessor {
  evaluate(response: string, tool: string, context: ContextWindow): ToolResponseEvaluation {
    const tokenCount = Math.ceil(response.length / 4);
    const sizeClass =
      tokenCount < 200   ? 'small'    :
      tokenCount < 800   ? 'medium'   :
      tokenCount < 2000  ? 'large'    : 'oversized';

    // Detect if the tool returned an error disguised as success
    const errorDetected = response.includes('Error:') || response.includes('Exception:');

    return {
      relevanceScore: 0.8,   // your scoring logic
      sizeClass,
      shouldCompress: sizeClass === 'large' || sizeClass === 'oversized',
      suggestedMaxTokens: 500,
      answered: !errorDetected,
      answeredPartially: false,
      errorDetected,
      suggestedAction: errorDetected ? 'retry' : 'continue',
    };
  }

  compress(response: string, evaluation: ToolResponseEvaluation): string {
    if (evaluation.sizeClass === 'oversized') {
      // Extract first and last 1000 chars
      return response.slice(0, 1000) + '\n...[truncated]...\n' + response.slice(-1000);
    }
    return response;
  }
}
```

---

## 2. maxSteps Enforcement

### maxIterations vs. maxSteps

| Field | What it counts | On exceeded |
|---|---|---|
| `maxIterations` | Full ReAct cycles | Throws `LemuraMaxIterationsError` |
| `maxSteps` | Individual tool calls | Forces graceful final response |

`maxSteps` is the gentler limit — instead of throwing, it injects a "wrap it up" instruction:

```typescript
// When toolCallCount >= maxSteps, lemura injects:
`You have used ${toolCallCount}/${maxSteps} steps. 
Provide your final response now. Do not call any more tools.
Use the required structure below.`
// Tool definitions are removed from the payload — model CAN'T call tools
```

### Mandatory Final Response Format

All conclusions — natural or forced — MUST use this structure:

```markdown
## Goal Status: ACHIEVED | PARTIALLY_ACHIEVED | FAILED

### What was accomplished
Summary of completed work

### Remaining tasks
- Incomplete item 1
- Incomplete item 2

### Failed steps
- step_name: Error context

### Result
The actual answer or deliverable
```

```typescript
const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  maxIterations: 10,   // hard stop — throws after 10 full ReAct cycles
  maxSteps: 20,        // soft stop — forces conclusion after 20 tool calls
});
```

### Natural Conclusion Detection

The agent ends naturally when:
- `finishReason === 'stop'` from the provider
- Response contains no tool calls
- Response has substantive content

---

## 3. Continuation Planning

For complex workflows where tools must run in a specific order with dependencies:

```typescript
const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  tools: [fetchDataTool, analyzeDataTool, writeReportTool],
  enableContinuationPlanning: true,
  continuationStrategy: 'sequential',  // or 'parallel' or 'conditional'
});
```

### The ContinuationPlan Structure

When planning is enabled, before the first tool call lemura constructs a plan:

```typescript
interface ContinuationPlan {
  steps: ContinuationStep[];
  strategy: 'sequential' | 'parallel' | 'conditional';
}

interface ContinuationStep {
  stepId: string;
  toolName: string;
  description: string;
  dependsOn: string[];           // stepIds required to complete first
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  outputKey?: string;            // store result here
  inputMapping?: Record<string, string>;  // map prior outputs to this step's params
}
```

### Plan Status (injected before every iteration)

```
[CONTINUATION PLAN — Step 2/4]
✅ Step 1 (fetch_market_data): Done
▶  Step 2 (analyze_trends): Running
⏳ Step 3 (generate_chart): Waiting on Step 2
⏳ Step 4 (write_report): Waiting on Steps 2, 3
```

### Dependency Rules

- A step runs only when all `dependsOn` steps are `done`
- If a step `failed`, all steps depending on it become `skipped`
- The plan survives context compression — it's stored in `context.metadata['continuationPlan']` which is never removed

### Strategies Explained

**Sequential:** Steps run strictly one after another. Each step's output maps to the next step's input:

```
step1 → output → step2.input → output → step3.input
```

**Parallel:** Steps with no mutual dependencies run in a single provider call (model decides multiple tool calls at once):

```
step1a ─┬─ wait ─→ step3
step1b ─┘
```

**Conditional:** A step only runs if a prior step's output meets a declared condition:

```
step1 → succeeded? → run step2 : skip step2
```

---

## 4. Goal Injection & Maintenance

The biggest enemy of complex agents is **goal drift** — after 10+ turns and multiple context compressions, the agent forgets what it was originally asked to do.

### How Goal Injection Works

When `enableGoalPlanning: true`, before the first tool call lemura runs a mini-planning step:

```typescript
// Prompt sent internally:
`Given this goal: "${userMessage}"
1. List sub-goals needed (max 5, specific)
2. List success criteria — what does "done" look like? (max 3, binary)
Respond ONLY with JSON: { "subGoals": string[], "successCriteria": string[] }`
```

The result is stored as a `Goal` object and **re-injected before every provider call**:

```
[CURRENT GOAL]
Research and summarize Q4 2025 EV market trends

Success criteria:
- Summary covers at least 3 major markets (EU, US, China)
- Includes specific sales figures with sources
- Length is between 500-1000 words

Sub-goals remaining:
- Find EU market data (pending)
- Compile comparison table (pending)
[/CURRENT GOAL]
```

### Goal Self-Evaluation

Before generating the final response, lemura makes a dedicated provider call:

```typescript
// Internal prompt:
`Have I met all success criteria?
1. Summary covers at least 3 major markets → [YES/NO]
2. Includes specific sales figures with sources → [YES/NO]
3. Length is between 500-1000 words → [YES/NO]`
```

This drives the `Goal Status: ACHIEVED | PARTIALLY_ACHIEVED | FAILED` determination.

### Configuration

```typescript
const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  enableGoalPlanning: true,
  goalInjectionFrequency: 'always',      // re-inject goal every turn
  goalInjectionPosition: 'system_prompt', // or 'pre_turn'
});
```

---

## 5. Skill Size Budget Management

When many skills are registered, they compete for the `skillTokenBudget`. lemura automatically downsizes skills to fit:

### Tier System

| Tier | Max tokens | Content |
|---|---|---|
| `extended` | ≤ 2000 | Full content + examples (lazy-loaded only) |
| `standard` | ≤ 800 | Full skill content |
| `micro` | ≤ 300 | Top 3–5 rules from frontmatter |
| `nano` | ≤ 100 | Single sentence from frontmatter |

### Budget Algorithm

```
1. Sort skills by priority (lowest number = highest priority)
2. Try to fit each skill at 'standard' tier
3. Budget too small for 'standard'? → downgrade to 'micro'
4. Budget too small for 'micro'? → downgrade to 'nano'
5. Budget too small for 'nano'? → skip (log warning)
6. Skills with priority < 5 are NEVER skipped
```

### Writing Trim-Friendly Skills

Always write the `nano` fallback first:

```yaml
---
name: security-reviewer
priority: 3           # priority < 5 — never skipped
nano: |
  Always check for SQL injection, XSS, and exposed secrets before approving any code.
micro: |
  Security reviewer. Check all code for: SQL injection, XSS, CSRF, secrets in code, and unsafe deserialization. Flag P0 before merge.
---

Full skill content here... (standard tier)
```

### Lazy Loading Examples

Extended skill content lives in `examples/` subdirectory — it's **never auto-injected**. The agent reads it with `view` during execution when needed:

```
skills/
├── security-reviewer.md          # standard tier — auto-injected
└── security-reviewer/
    └── examples/
        ├── sql-injection.md      # extended examples — lazy loaded
        └── xss-patterns.md
```

---

## Complete Advanced Configuration Example

A fully configured heavy-duty research agent:

```typescript
import {
  SessionManager,
  ToolResponseProcessor,
  SandwichCompressionStrategy,
  MaxTokensCompressionStrategy,
  SummaryInjectionStrategy,
} from 'lemura';

const session = new SessionManager({
  adapter,
  model: 'gpt-4o',
  maxTokens: 200_000,

  // Step limits
  maxIterations: 15,
  maxSteps: 40,

  // Goal planning
  enableGoalPlanning: true,
  goalInjectionFrequency: 'always',

  // Tool sequencing
  enableContinuationPlanning: true,
  continuationStrategy: 'sequential',

  // Tool response management
  toolResponseProcessor: new ToolResponseProcessor({
    budgetPercent: 0.15,
  }),

  // Context compression stack
  compressionStrategies: [
    new SummaryInjectionStrategy({ priority: 1 }),
    new SandwichCompressionStrategy(adapter, {
      priority: 2,
      preserveFirst: 2,
      preserveLast: 4,
      triggerThreshold: 0.75,
    }),
    new MaxTokensCompressionStrategy(adapter, {
      priority: 3,
      threshold: 0.92,
    }),
  ],

  // Skill budget
  skillTokenBudget: 20_000,

  // Observability
  logger: myStructuredLogger,
});

// Subscribe to execution events
session.on('compression:start', ({ tokenCount }) =>
  console.log(`Compressing at ${tokenCount} tokens`));
session.on('strategy:applied', ({ strategyName, tokensAfter }) =>
  console.log(`${strategyName} → ${tokensAfter} tokens`));
session.on('loop:detected', ({ tool, args }) =>
  console.warn(`Loop detected: ${tool} called with same args twice`));
```

---

## When Things Go Wrong

**Agent loops infinitely**
`maxIterations` will halt it, but to fix the root cause: check if the tool is actually completing its task (not returning empty results), and whether the system prompt or goal provides clear stopping criteria.

**Loop detected (same tool, same args)**
The tool result isn't advancing the state. Either the tool implementation is buggy (returns the same thing regardless of input), or the system prompt needs clearer direction about what to do after the tool result.

**Final response uses wrong format**
The mandatory final response format relies on the model following instructions. If a small/fast model doesn't comply, add the format explicitly to your system prompt or increase `maxTokens` so the agent isn't rushed.

**Continuation plan skips critical steps**
If a step fails and dependents are skipped, check `session.getHistory()` — the failed step's error is in the history. The most common cause is a tool error that wasn't handled gracefully.

**Goal drift despite enableGoalPlanning: true**
Check `goalInjectionFrequency: 'always'`. If set to `'on_compression'` and compression hasn't triggered yet, the goal isn't being re-injected. Change to `'always'` for critical agents.
