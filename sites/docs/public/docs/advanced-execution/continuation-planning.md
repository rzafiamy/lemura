# Continuation Planning

Continuation planning lets you define explicit, ordered tool execution plans — ensuring complex multi-step tasks run reliably even across context compressions.

---

## When to Use Continuation Planning

Use it when:
- Tools must run in a specific sequence (output of A feeds input of B)
- Some tools can run in parallel for speed
- A failure in one step should skip downstream dependent steps gracefully

```typescript
const session = new SessionManager({
  adapter,
  model: 'gpt-4o',
  maxTokens: 128_000,
  tools: [fetchDataTool, cleanDataTool, analyzeDataTool, writeReportTool],
  enableContinuationPlanning: true,
  continuationStrategy: 'sequential',  // 'parallel' or 'conditional' also available
});
```

---

## The ContinuationPlan Structure

```typescript
interface ContinuationPlan {
  steps: ContinuationStep[];
  currentStepIndex: number;
  strategy: 'sequential' | 'parallel' | 'conditional';
}

interface ContinuationStep {
  stepId: string;              // unique within the plan
  toolName: string;            // must match a registered tool name
  description: string;         // what this step does (shown to model)
  dependsOn: string[];         // stepIds that must be 'done' before this runs
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  outputKey?: string;          // store result under this key in context.metadata
  inputMapping?: Record<string, string>; // map prior step outputs to this step's params
}
```

---

## Sequential Strategy

Steps run strictly one after another. Each step's output can feed the next:

```typescript
// Example: Data pipeline — fetch → clean → analyze → report
await session.setplan([
  {
    stepId: 'fetch',
    toolName: 'fetch_sales_data',
    description: 'Fetch raw Q4 2025 sales data from the database',
    dependsOn: [],
    outputKey: 'rawData',
  },
  {
    stepId: 'clean',
    toolName: 'clean_data',
    description: 'Remove duplicates and normalize the data',
    dependsOn: ['fetch'],
    inputMapping: {
      data: 'rawData',  // 'rawData' from step 'fetch' → 'data' param of clean_data
    },
    outputKey: 'cleanData',
  },
  {
    stepId: 'analyze',
    toolName: 'run_analysis',
    description: 'Calculate KPIs and identify trends',
    dependsOn: ['clean'],
    inputMapping: { dataset: 'cleanData' },
    outputKey: 'analysis',
  },
  {
    stepId: 'report',
    toolName: 'write_report',
    description: 'Write the final markdown report',
    dependsOn: ['analyze'],
    inputMapping: {
      analysisResults: 'analysis',
      quarter: 'Q4 2025',  // static value
    },
  },
]);
```

### Status display (injected before every iteration)

```
[CONTINUATION PLAN — Step 3/4]
✅ fetch (fetch_sales_data): Done
✅ clean (clean_data): Done
▶  analyze (run_analysis): Running
⏳ report (write_report): Waiting on analyze
```

---

## Parallel Strategy

Steps without dependencies run simultaneously — the model makes multiple tool calls in one iteration:

```typescript
// Example: Three independent data sources fetched simultaneously
await session.setPlan([
  {
    stepId: 'eu-data',
    toolName: 'fetch_market_data',
    description: 'Fetch EU market data',
    dependsOn: [],
    outputKey: 'euData',
  },
  {
    stepId: 'us-data',
    toolName: 'fetch_market_data',
    description: 'Fetch US market data',
    dependsOn: [],
    outputKey: 'usData',
  },
  {
    stepId: 'cn-data',
    toolName: 'fetch_market_data',
    description: 'Fetch China market data',
    dependsOn: [],
    outputKey: 'cnData',
  },
  {
    stepId: 'compile',
    toolName: 'compile_report',
    description: 'Compile all market data into one report',
    dependsOn: ['eu-data', 'us-data', 'cn-data'],  // waits for ALL three
    inputMapping: {
      euData: 'euData',
      usData: 'usData',
      cnData: 'cnData',
    },
  },
]);
```

Steps `eu-data`, `us-data`, `cn-data` all run in parallel. Only when all three complete does `compile` run.

---

## Conditional Strategy

Steps run only if a condition from a prior step is met:

```typescript
await session.setPlan([
  {
    stepId: 'check',
    toolName: 'check_data_quality',
    description: 'Check if data quality is sufficient for analysis',
    dependsOn: [],
    outputKey: 'qualityReport',
  },
  {
    stepId: 'analyze',  // only runs if quality is PASS
    toolName: 'run_analysis',
    description: 'Run analysis (conditional on quality pass)',
    dependsOn: ['check'],
    condition: { step: 'check', outputContains: '"status":"PASS"' },
    outputKey: 'analysis',
  },
  {
    stepId: 'clean',  // only runs if quality is FAIL
    toolName: 'clean_data',
    description: 'Clean data (conditional on quality fail)',
    dependsOn: ['check'],
    condition: { step: 'check', outputContains: '"status":"FAIL"' },
    outputKey: 'cleanedData',
  },
]);
```

---

## Dependency Failure Propagation

When a step fails, all steps depending on it automatically become `skipped`:

```
Step 1 (fetch_data): FAILED — "Database connection timeout"
  → Step 2 (clean_data):   SKIPPED (depends on step 1)
  → Step 3 (analyze_data): SKIPPED (depends on step 2)
  → Step 4 (write_report): SKIPPED (depends on step 3)

Final response:
## Goal Status: FAILED

### Failed steps
- fetch_data: Database connection timeout (connection refused on port 5432)

### Remaining tasks
- clean_data (skipped — upstream failure)
- analyze_data (skipped — upstream failure)
- write_report (skipped — upstream failure)
```

---

## Plan Resilience

The continuation plan is stored in `context.metadata['continuationPlan']` — compression strategies never remove it:

```typescript
// Even after context compression, the plan survives:
const context = session.getContext();
const plan = context.metadata['continuationPlan'] as ContinuationPlan;
console.log('Plan status:');
plan.steps.forEach(step => {
  const icon = { done: '✅', failed: '❌', skipped: '⏩', pending: '⏳', running: '▶' }[step.status];
  console.log(`${icon} ${step.stepId} (${step.toolName}): ${step.status}`);
});
```

---

## Full Working Example: Research & Report Pipeline

```typescript
import { SessionManager, OpenAICompatibleAdapter } from 'lemura';

const adapter = new OpenAICompatibleAdapter({ ... });

const session = new SessionManager({
  adapter,
  model: 'gpt-4o',
  maxTokens: 200_000,
  enableContinuationPlanning: true,
  continuationStrategy: 'sequential',
  enableGoalPlanning: true,
  maxSteps: 30,
  tools: [
    searchWebTool,
    extractFactsTool,
    createChartTool,
    writeMarkdownTool,
  ],
  compressionStrategies: [
    new SandwichCompressionStrategy(adapter, { preserveFirst: 2, preserveLast: 4 }),
  ],
});

const report = await session.run(`
  Research the top 5 programming languages by job demand in 2025.
  For each language:
  1. Find salary data
  2. Find job posting counts
  3. Find growth trend (YoY)
  Then create a comparison chart and write a 500-word report.
`);

console.log(report);
```

---

## Tips & Tricks

> **Tip:** `outputKey` values are stored in `context.metadata['toolOutputs']`. Access them during debugging: `session.getContext().metadata['toolOutputs']`. This is useful for inspecting intermediate results when a downstream step fails.

> **Tip:** For the parallel strategy to work effectively, your LLM must support parallel function calls (OpenAI GPT-4o does, some smaller models don't). If the model insists on sequential calls, it may not support parallel tool invocation — fall back to `'sequential'`.

> **Tip:** Be deliberate with `dependsOn`. Overly strict dependencies serialize your plan unnecessarily. Steps that don't actually depend on each other should run in parallel to minimize total wall-clock time.
