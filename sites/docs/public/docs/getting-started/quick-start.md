# Quick Start Guide

Build and run your first agent in under 5 minutes.

---

## What You'll Build

A conversational agent that:
- Accepts multi-turn messages
- Can call a custom tool (`get_weather`)
- Streams responses in real-time
- Handles errors gracefully

---

## Step 1: Install lemura

```bash
npm install lemura
```

---

## Step 2: Create the Adapter

The adapter connects lemura to your AI provider. We'll use OpenAI:

```typescript
// src/agent.ts
import { SessionManager, OpenAICompatibleAdapter } from 'lemura';

const adapter = new OpenAICompatibleAdapter({
  baseUrl: 'https://api.openai.com/v1',
  apiKey: process.env.OPENAI_API_KEY!,
  defaultModel: 'gpt-4o',
});
```

> **Using a different provider?** Just change `baseUrl`. See [Provider Adapters](/docs/adapters) for Groq, Anthropic, Ollama, and more.

---

## Step 3: Define a Tool

Tools are async functions the agent can call during reasoning. Define the `name`, `description`, and `parameters` clearly — the model reads these to decide when to call the tool:

```typescript
const weatherTool = {
  name: 'get_weather',
  // Imperative sentence — specifically says WHEN to call it
  description: 'Get current weather for a city. Call this when the user asks about weather conditions.',
  parameters: {
    type: 'object',
    properties: {
      city: {
        type: 'string',
        description: 'City name, e.g. "London" or "New York"',
      },
      units: {
        type: 'string',
        enum: ['celsius', 'fahrenheit'],
        description: 'Temperature unit. Defaults to "celsius".',
      },
    },
    required: ['city'],
  },
  execute: async ({ city, units = 'celsius' }: { city: string; units?: string }) => {
    // Replace with a real weather API call
    const temp = units === 'celsius' ? '18°C' : '64°F';
    return `Current weather in ${city}: ${temp}, partly cloudy. Humidity: 65%.`;
  },
};
```

---

## Step 4: Create the Session

```typescript
const session = new SessionManager({
  adapter,
  model: 'gpt-4o',
  maxTokens: 128_000,
  tools: [weatherTool],
  systemPrompt: 'You are a helpful assistant. Always use tools when you have them available.',
});
```

---

## Step 5: Run It

### Single-turn (await the full response)

```typescript
const answer = await session.run("What's the weather in Tokyo?");
console.log(answer);
// → "The current weather in Tokyo is 18°C and partly cloudy, with humidity at 65%."
```

**What happens internally:**
1. Model receives the user message + tool definition
2. Model decides to call `get_weather({ city: "Tokyo" })`
3. lemura validates the args and calls `execute()`
4. Tool result is injected as an observation turn
5. Model produces a final natural language response

---

## Step 6: Streaming Responses

For a better user experience, stream the response as it generates:

```typescript
process.stdout.write("Agent: ");

for await (const chunk of session.stream("What's the weather in Paris?")) {
  process.stdout.write(chunk.delta);  // print each token as it arrives
  if (chunk.finished) break;
}

console.log(); // newline at end
```

---

## Step 7: Multi-Turn Conversations

`session.run()` automatically maintains history across calls:

```typescript
await session.run("My name is Alex.");
const response = await session.run("What's my name?");
console.log(response);
// → "Your name is Alex."

// Start fresh when needed
session.reset();
```

---

## Complete Working Example

```typescript
import 'dotenv/config';
import { SessionManager, OpenAICompatibleAdapter } from 'lemura';

const adapter = new OpenAICompatibleAdapter({
  baseUrl: 'https://api.openai.com/v1',
  apiKey: process.env.OPENAI_API_KEY!,
  defaultModel: 'gpt-4o',
});

const weatherTool = {
  name: 'get_weather',
  description: 'Get current weather for a city. Call when the user asks about weather.',
  parameters: {
    type: 'object',
    properties: {
      city: { type: 'string', description: 'City name' },
    },
    required: ['city'],
  },
  execute: async ({ city }: { city: string }) => {
    return `Weather in ${city}: 18°C, partly cloudy.`;
  },
};

const session = new SessionManager({
  adapter,
  model: 'gpt-4o',
  maxTokens: 128_000,
  tools: [weatherTool],
});

// Interactive loop
const readline = await import('readline');
const rl = readline.createInterface({ input: process.stdin });

console.log('Agent ready. Type your message (Ctrl+C to exit):\n');

for await (const line of rl) {
  process.stdout.write('Agent: ');
  for await (const chunk of session.stream(line)) {
    process.stdout.write(chunk.delta);
    if (chunk.finished) break;
  }
  console.log('\n');
}
```

Run with:
```bash
npx tsx src/agent.ts
```

---

## Next Steps

| Goal | Guide |
|---|---|
| Use Groq, Ollama, or a local model | [Provider Adapters →](/docs/adapters) |
| Handle long conversations | [Context Management →](/docs/context-management) |
| Add more tools | [Tools & Skills →](/docs/tools-and-skills) |
| Connect a knowledge base | [RAG Integration →](/docs/rag-integration) |
| Build complex workflows | [Advanced Runtime →](/docs/advanced-execution) |
