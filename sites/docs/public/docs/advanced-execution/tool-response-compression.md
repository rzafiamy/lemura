# Tool Response Compression

Large tool outputs are one of the biggest sources of context bloat. lemura's `ToolResponseProcessor` evaluates and compresses tool results before they consume precious context tokens.

---

## The Problem

A single `read_file` tool call on a 500KB log file returns ~125,000 tokens — blowing the context instantly:

```
Context budget:      128,000 tokens
System prompt:        -2,000
Conversation:         -8,000
Tool result:       -125,000  ← BOOM
Remaining:          -7,000   → LemuraContextOverflowError
```

Without tool response compression, your only options are: limit which files can be read, or use a much larger context model. With compression, the tool result becomes 500 relevant tokens.

---

## Enabling Tool Response Compression

```typescript
import { ToolResponseProcessor } from 'lemura';

const session = new SessionManager({
  adapter,
  model: 'gpt-4o',
  maxTokens: 128_000,
  toolResponseProcessor: new ToolResponseProcessor({
    smallMaxTokens:  200,    // verbatim if ≤ 200 tokens
    mediumMaxTokens: 800,    // verbatim if ≤ 800 tokens
    largeMaxTokens:  2000,   // LLM-summarized if ≤ 2000 tokens
    // oversized (> 2000 tokens): extract relevant fragment
    budgetPercent:   0.15,   // all tool responses combined ≤ 15% of maxTokens
  }),
});
```

---

## Classification & Compression Strategies

Every tool result is classified and compressed accordingly:

| Class | Token threshold | Compression |
|---|---|---|
| `small` | < 200 | Injected verbatim |
| `medium` | 200–800 | Injected verbatim, flagged |
| `large` | 800–2000 | LLM call: _"Summarize in 500 tokens, focusing on {goal}"_ |
| `oversized` | > 2000 | Extract: first 1000 + last 500 tokens (truncative) |

### The four compression strategies in detail

**Extractive** — keep sentences mentioning goal entities:
```typescript
// Keeps only sentences containing keywords from the current goal
"Database timeout errors" → filters log to only lines with "timeout", "error", "database"
```

**Truncative** — first N + last M tokens:
```typescript
// Good for logs and structured data where beginning/end are most informative
const truncated = result.slice(0, 4000) + '\n...[TRUNCATED]...\n' + result.slice(-2000);
```

**Structured** — keep only JSON fields referenced in the tool's output schema:
```typescript
// If tool schema says output has { id, status, error }, drop all other fields
const relevant = { id: apiResponse.id, status: apiResponse.status, error: apiResponse.error };
```

**Summarized** — LLM call with goal-focused prompt:
```typescript
const summary = await adapter.complete({
  messages: [{
    role: 'user',
    content: `Summarize in max 500 tokens, focusing on "${goalStatement}":\n\n${result}`,
  }],
  maxTokens: 600,
});
```

---

## The ToolResponseEvaluation

Before compression, the processor evaluates the result:

```typescript
interface ToolResponseEvaluation {
  relevanceScore: number;        // 0–1: how relevant to the current goal?
  sizeClass: 'small' | 'medium' | 'large' | 'oversized';
  shouldCompress: boolean;
  suggestedMaxTokens: number;
  answered: boolean;             // did the tool answer what was asked?
  answeredPartially: boolean;
  errorDetected: boolean;        // error signal even if HTTP 200
  suggestedAction: 'continue' | 'retry' | 'retry_with_params' | 'skip' | 'escalate';
}
```

### `errorDetected` — Important

Some tools return HTTP 200 but contain error text:
```
{"status": 200, "body": "Error: Connection refused to database host"}
```

The `errorDetected` flag catches this:
- Scans for common error patterns (`Error:`, `Exception:`, `FAILED`, `null` in required fields)
- When `true`: result is injected as-is (errors are never dropped — the model needs to see them)
- When `suggestedAction === 'retry'`: the model is prompted to retry the tool

---

## Building a Custom ToolResponseProcessor

```typescript
import type { IToolResponseProcessor, ToolResponseEvaluation } from 'lemura/types';

class SmartLogProcessor implements IToolResponseProcessor {
  evaluate(
    response: string,
    toolName: string,
    context: ContextWindow
  ): ToolResponseEvaluation {
    const tokenCount = Math.ceil(response.length / 4);
    const goal = (context.metadata['goal'] as { statement: string })?.statement ?? '';

    const sizeClass: ToolResponseEvaluation['sizeClass'] =
      tokenCount < 200   ? 'small'    :
      tokenCount < 800   ? 'medium'   :
      tokenCount < 2000  ? 'large'    : 'oversized';

    // Detect common error patterns
    const errorPatterns = ['Error:', 'Exception:', 'FAILED', 'null', 'undefined'];
    const errorDetected = errorPatterns.some(p =>
      response.toLowerCase().includes(p.toLowerCase())
    );

    // Simple relevance scoring: count goal keywords in response
    const goalWords = goal.split(/\s+/).filter(w => w.length > 4);
    const matchCount = goalWords.filter(w =>
      response.toLowerCase().includes(w.toLowerCase())
    ).length;
    const relevanceScore = Math.min(1, matchCount / Math.max(goalWords.length, 1));

    return {
      relevanceScore,
      sizeClass,
      shouldCompress: sizeClass === 'large' || sizeClass === 'oversized',
      suggestedMaxTokens: 500,
      answered: !errorDetected && relevanceScore > 0.2,
      answeredPartially: relevanceScore > 0 && relevanceScore <= 0.2,
      errorDetected,
      suggestedAction: errorDetected ? 'retry' : 'continue',
    };
  }

  compress(response: string, evaluation: ToolResponseEvaluation): string {
    if (evaluation.sizeClass === 'oversized') {
      // Truncative: first 4000 chars + separator + last 2000 chars
      const firstPart = response.slice(0, 4000);
      const lastPart  = response.slice(-2000);
      const skipped   = response.length - 6000;

      return skipped > 0
        ? `${firstPart}\n\n...[${skipped} characters omitted]...\n\n${lastPart}`
        : response;
    }

    if (evaluation.sizeClass === 'large') {
      // For structured data — extract lines matching goal keywords
      const lines = response.split('\n');
      const goalWords = evaluation.relevanceScore < 0.5 ? [] : [];  // your logic here
      // Simple fallback: first and last 20 lines
      const excerpt = [
        ...lines.slice(0, 20),
        `\n... [${lines.length - 40} lines omitted] ...`,
        ...lines.slice(-20),
      ];
      return excerpt.join('\n');
    }

    return response; // small/medium: verbatim
  }
}

// Usage:
const session = new SessionManager({
  adapter,
  model: 'gpt-4o',
  maxTokens: 128_000,
  toolResponseProcessor: new SmartLogProcessor(),
});
```

---

## Budget Management

`budgetPercent` caps the total tokens consumed by all tool responses in one iteration:

```typescript
toolResponseProcessor: new ToolResponseProcessor({
  budgetPercent: 0.15,   // 15% of 128k = 19,200 tokens per iteration
})
```

When cumulative tool responses in one iteration exceed the budget:
1. The newest results are kept verbatim
2. **Oldest results** are compressed first (they're least relevant to current reasoning)
3. If still over budget: most aggressive compression is applied to oldest results

---

## Tips & Tricks

> **Tip:** For tools that commonly return large outputs (file reads, API calls), consider implementing compression at the tool level: return a pre-summarized result rather than the raw output. This gives you more control over what information reaches the model.

> **Tip:** Never set `budgetPercent` above 0.30. Tool responses consuming 30%+ of context leave insufficient room for conversation history and system prompts — you'll hit compression much more frequently.

> **Tip:** Monitor the `tool:result` event's `sizeClass` field in production. If most tool results are classified as `large` or `oversized`, your tools are over-returning data. Either fix the tools to return less, or lower your `budgetPercent` ceiling.
