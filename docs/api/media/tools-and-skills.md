# Tools and Skills

## What this is
Tools are actionable JavaScript functions the agent can invoke via the `ToolRegistry`. Skills are dynamically injected YAML/Markdown prompt enhancements that alter the AI agent's base system prompt, loaded by the `SkillInjector`.

## How it works
When the ReAct loop discovers a tool call in the provider's response, it intercepts it, runs `ToolRegistry.execute(name, args, ...)` and appends the result as an observation back to the model.

Skills use Markdown frontmatter and can be loaded dynamically, injecting specific rule-sets into `system_prompt`, `pre_turn`, or `post_history` layers.

```ts
interface IToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  execute(params: unknown, context: ToolContext): Promise<unknown>;
}

interface ISkill {
  name: string;
  tier: 'nano' | 'micro' | 'standard' | 'extended';
  // ...other fields
}
```

## Configuration

| Field | Type | Default | Description |
|---|---|---|---|
| `tools` | `IToolDefinition[]` | `[]` | List of explicit tools to bind into SessionManager |
| `skills` | `ISkill[]` | `[]` | Explicit skills to load before autodiscovery |
| `skillTokenBudget` | `number` | `0.10 * maxToks`| Determines tier downsizing |

## Examples

### Building a Simple Tool
```ts
export const echoTool = {
  name: 'echo_tool',
  description: 'Echos the back the input',
  parameters: {
    type: 'object',
    properties: { input: { type: 'string' } },
    required: ['input']
  },
  execute: async ({ input }, ctx) => {
    return `Echo: ${input}`;
  }
};
```

## When things go wrong
- **`LemuraToolNotFoundError`:** The agent hallucinated a tool or one wasn't actively passed into the `SessionConfig.tools` array.
- **Model ignores tool:** Improve the JSON schema descriptions so the model realizes exactly when building the tool is useful.
