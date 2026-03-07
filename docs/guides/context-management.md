# Context Management

## What this is
Context window management is lemura's core differentiator. It handles the ever-growing conversation history by predictably shrinking it before the token limit is reached, ensuring the agent can continue working indefinitely without overflowing the context budget.

## How it works
The `ContextManager` orchestrates a stack of strategies applied in order when the context needs compression. Each strategy is independent and composable. Before each provider call, the `ContextManager.prepare()` method evaluates the total tokens and applies strategies if the threshold safely demands it.

```ts
interface IContextStrategy {
  name: string;
  priority: number;
  shouldApply(ctx: ContextWindow): boolean;
  apply(ctx: ContextWindow): Promise<ContextWindow>;
}
```

## Configuration

| Field | Type | Default | Description |
|---|---|---|---|
| `compressionStrategies` | `IContextStrategy[]` | `[]` | Array of strategies registered to run. Lower priority numbers run earlier. |

## Examples

### Using Built-In Compressors
```ts
import { SessionManager, SandwichCompressionStrategy } from 'lemura';

const sandwich = new SandwichCompressionStrategy(adapter, {
  preserveFirst: 2,
  preserveLast: 4,
  triggerThreshold: 0.8
});

const session = new SessionManager({
  adapter,
  model: 'gpt-4o',
  maxTokens: 100000,
  compressionStrategies: [sandwich]
});
```

## When things go wrong
- **Context keeps growing despite compression:** Ensure you aren't continually appending oversized tool responses untouched. Use `ToolResponseProcessor` along with Context strategies.
- **Lost History Elements:** Verify `preserveFirst` is large enough to save initial system prompts and instructions if using sandwich compression.
