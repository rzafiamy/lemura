# Guide & Recipe Templates

Ready-to-fill templates. Copy, replace placeholders, delete this header.

---

## Concept Guide Template

File: `docs/guides/[concept-name].md`

```markdown
# [Concept Name]

## What this is

[One paragraph. What the concept is, why it exists in lemura, and what problem it solves
for the consumer. No implementation details here.]

## How it works

[Architecture explanation. Include a type definition block or ASCII diagram if it helps.
Show the key interface or type — consumers need to see the shape, not the internals.]

\`\`\`ts
// Key type or interface that defines the concept
interface IMyThing {
  name: string;
  apply(input: MyInput): Promise<MyOutput>;
}
\`\`\`

## Configuration

| Field | Type | Default | Description |
|---|---|---|---|
| `fieldA` | `string` | — | Required. What it does. |
| `fieldB` | `number` | `10` | Optional. What it controls. |

## Examples

### Minimal example

\`\`\`ts
import { MyThing } from 'lemura';

const thing = new MyThing({ fieldA: 'value' });
const result = await thing.apply(input);
\`\`\`

### Real-world example

\`\`\`ts
// More complete example with context showing a realistic use case
import { SessionManager, MyThing } from 'lemura';
import { MyAdapter } from './my-adapter';

const session = new SessionManager({
  adapter: new MyAdapter({ apiKey: process.env.API_KEY }),
  myThing: new MyThing({ fieldA: 'value', fieldB: 20 }),
});

const response = await session.run('Do the thing');
\`\`\`

## When things go wrong

- **`LemuraXxxError` is thrown**: [What causes it and how to fix it]
- **[Symptom]**: [What to check] — [how to resolve]
- **[Symptom]**: [What to check] — [how to resolve]

## See also

- [Related concept](./related-concept.md)
- [API reference](../api/classes/MyThing.md)
```

---

## Recipe Template

File: `docs/recipes/how-to-[do-thing].md`

```markdown
# How to [do one specific thing]

[One sentence: what this recipe achieves and when you'd need it.]

## Code

\`\`\`ts
import { SessionManager, MyStrategy } from 'lemura';
import { MyAdapter } from './adapters/my-adapter';

// Complete, runnable example
const session = new SessionManager({
  adapter: new MyAdapter({ apiKey: process.env.API_KEY! }),
  model: 'gpt-4o',
  maxTokens: 8000,
  compressionStrategies: [
    new MyStrategy({ optionA: true }),
  ],
});

const result = await session.run('Your task here');
console.log(result);
\`\`\`

## What's happening here

[One paragraph explaining the key lines. Why `MyStrategy` is configured this way,
what `optionA` does, why these specific values were chosen.]

## Variations

- **Without X**: Remove `optionA: true` if you don't need [behavior]. This reduces
  token usage but may [tradeoff].
- **With streaming**: Replace `session.run()` with `session.stream()` and iterate
  with `for await (const chunk of stream)`.
```

---

## CHANGELOG entry examples

### Feature addition
```markdown
### Added
- `GoalInjectionStrategy` — re-injects the session goal into context after each
  compression event, preventing goal drift in long-running agents (#67)
```

### Bug fix
```markdown
### Fixed
- `OpenAICompatibleAdapter` — `finishReason` was incorrectly mapped to `'error'`
  for Groq streaming responses that use `'stop'` (#71)
```

### Breaking change
```markdown
### Breaking Changes
- `IProviderAdapter.complete()` now returns `CompletionResponse` instead of `string`.
  Migration: access the text content via `response.content` (#75)
```