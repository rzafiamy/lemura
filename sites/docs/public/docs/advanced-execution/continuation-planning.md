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

// Define the plan before running
session.setPlan([
  { stepId: 'fetch',   toolName: 'fetch_data',   description: 'Fetch data',    dependsOn: [] },
  { stepId: 'analyze', toolName: 'analyze_data', description: 'Analyze data',  dependsOn: ['fetch'] },
  { stepId: 'report',  toolName: 'write_report', description: 'Write report',  dependsOn: ['analyze'] },
]);

const result = await session.run('Run the full data pipeline and produce a report.');
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
  description: string;         // what this step does (shown to the model)
  dependsOn: string[];         // stepIds that must be 'done' before this runs
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  outputKey?: string;          // store result under this key in context.metadata['toolOutputs']
  inputMapping?: Record<string, string>; // map prior step outputKeys to this step's params
  condition?: {
    step: string;              // stepId whose output is inspected
    outputContains: string;    // substring that must be present to allow this step to run
  };
}
```

---

## Setting a Plan — `session.setPlan()`

```typescript
session.setPlan(
  steps,    // ContinuationStep[]
  strategy  // 'sequential' | 'parallel' | 'conditional' (default: 'sequential')
);
```

The plan is stored in `context.metadata['continuationPlan']` and survives context compression. Before each ReAct iteration, the planner injects a status block so the model always knows the plan state.

---

## Sequential Strategy

Steps run strictly one after another. Each step's output can feed the next via `inputMapping`:

```typescript
session.setPlan([
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
      quarter: 'Q4 2025',  // static value (not an outputKey → passed through as-is)
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
⏳ report (write_report): Waiting on Step analyze
```

---

## Parallel Strategy

Steps without dependencies run simultaneously — the model makes multiple tool calls in one iteration:

```typescript
session.setPlan([
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
], 'parallel');
```

Steps `eu-data`, `us-data`, `cn-data` all run in parallel. Only when all three complete does `compile` run.

---

## Conditional Strategy

Steps run only if a condition from a prior step is met:

```typescript
session.setPlan([
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
], 'conditional');
```

When a condition is not met, the step is automatically marked `skipped` and its dependants propagate `skipped` as well.

---

## Dependency Failure Propagation

When a step fails, all steps depending on it (directly or transitively) automatically become `skipped`:

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

The continuation plan is stored in `context.metadata['continuationPlan']` — compression strategies never remove metadata:

```typescript
// Inspect plan state mid-session
const context = session.getContext();
const plan = context.metadata['continuationPlan'] as ContinuationPlan;
console.log('Plan status:');
plan.steps.forEach(step => {
  const icon = { done: '✅', failed: '❌', skipped: '⏩', pending: '⏳', running: '▶' }[step.status];
  console.log(`${icon} ${step.stepId} (${step.toolName}): ${step.status}`);
});

// Inspect step outputs
const outputs = context.metadata['toolOutputs'] as Record<string, string> | undefined;
if (outputs?.['analysis']) {
  console.log('Analysis output:', outputs['analysis']);
}
```

---

## Full Working Example: Research & Report Pipeline

```typescript
import { SessionManager, OpenAICompatibleAdapter, SandwichCompressionStrategy, SummaryInjectionStrategy } from 'lemura';

const adapter = new OpenAICompatibleAdapter({ /* config */ });

const session = new SessionManager({
  adapter,
  model: 'gpt-4o',
  maxTokens: 200_000,
  enableContinuationPlanning: true,
  enableGoalPlanning: true,
  maxSteps: 30,
  parallelToolCalls: false,
  tools: [
    searchWebTool,
    extractFactsTool,
    createChartTool,
    writeMarkdownTool,
  ],
  compressionStrategies: [
    new SummaryInjectionStrategy({ priority: 1 }),
    new SandwichCompressionStrategy(adapter, { priority: 2, preserveFirst: 2, preserveLast: 4 }),
  ],
});

session.setPlan([
  { stepId: 'search',   toolName: 'search_web',      description: 'Search for top 5 languages by job demand', dependsOn: [],        outputKey: 'searchResults' },
  { stepId: 'extract',  toolName: 'extract_facts',   description: 'Extract salary, job counts, growth trend',  dependsOn: ['search'], inputMapping: { data: 'searchResults' }, outputKey: 'facts' },
  { stepId: 'chart',    toolName: 'create_chart',    description: 'Create a comparison chart',                 dependsOn: ['extract'], inputMapping: { dataset: 'facts' },        outputKey: 'chartUrl' },
  { stepId: 'report',   toolName: 'write_markdown',  description: 'Write the 500-word report',                dependsOn: ['extract', 'chart'], inputMapping: { facts: 'facts', chartUrl: 'chartUrl' } },
]);

const report = await session.run(`
  Research the top 5 programming languages by job demand in 2025.
  For each language: find salary data, job posting counts, and YoY growth trend.
  Then create a comparison chart and write a 500-word report.
`);

console.log(report);
```

---

## Tips & Tricks

> **Tip:** `outputKey` values are stored in `context.metadata['toolOutputs']`. Access them during debugging: `session.getContext().metadata['toolOutputs']`. This is useful for inspecting intermediate results when a downstream step fails.

> **Tip:** For the parallel strategy to work effectively, your LLM must support parallel function calls (OpenAI GPT-4o does; some smaller models don't). If the model insists on sequential calls, also set `parallelToolCalls: true` in `SessionConfig`.

> **Tip:** Be deliberate with `dependsOn`. Overly strict dependencies serialize your plan unnecessarily. Steps that don't actually depend on each other should have empty `dependsOn: []` arrays to allow parallel execution.

> **Tip:** The `inputMapping` keys must match the tool's parameter names exactly. If your tool expects a param named `rawData`, the mapping key must be `rawData`, not `raw_data`.
