# Installation

Getting lemura running takes under two minutes. This page covers every installation scenario — from a greenfield TypeScript project to an existing Node.js app and edge runtimes.

---

## Prerequisites

| Requirement | Minimum version | Notes |
|---|---|---|
| **Node.js** | ≥ 18.0.0 | Uses native `fetch`, `AsyncIterable`, `structuredClone` |
| **TypeScript** | ≥ 5.0 | Strict mode strongly recommended |
| **Package manager** | npm, pnpm, yarn, bun | All supported |

> **Why Node 18?** lemura uses `fetch` natively (no `node-fetch` polyfill), `structuredClone` for immutable context operations, and `AsyncIterable` for streaming — all stable since Node 18.

---

## Package Installation

### npm
```bash
npm install lemura
```

### pnpm (recommended)
```bash
pnpm add lemura
```

### yarn
```bash
yarn add lemura
```

### bun
```bash
bun add lemura
```

lemura has **zero runtime dependencies**. The only things installed are lemura itself and its TypeScript type definitions.

---

## TypeScript Project Setup

If you're starting fresh, here's a minimal `tsconfig.json` that works with lemura:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

> **Why `strict: true`?** lemura's types use `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`. Without strict mode, you lose type safety on optional config fields and array access.

---

## Verifying the Installation

Create a minimal smoke-test file:

```typescript
// src/smoke-test.ts
import { SessionManager, OpenAICompatibleAdapter } from 'lemura';

// If this compiles without errors, you're good
const adapter = new OpenAICompatibleAdapter({
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'test',
  defaultModel: 'gpt-4o',
});

console.log('lemura installed correctly. Adapter name:', adapter.name);
```

Run it:
```bash
npx tsx src/smoke-test.ts
# → lemura installed correctly. Adapter name: openai-compatible
```

---

## Environment Variables

lemura itself **never reads environment variables** — all config flows via constructor arguments. This is intentional: it makes configuration explicit and testable.

The pattern for API keys:

```typescript
// ✅ Recommended: explicit injection
const adapter = new OpenAICompatibleAdapter({
  apiKey: process.env.OPENAI_API_KEY!,
  // ...
});

// ✅ Also fine: configuration object
const config = {
  openai: { apiKey: process.env.OPENAI_API_KEY! },
  groq:   { apiKey: process.env.GROQ_API_KEY! },
};
```

Use a `.env` file with a loader like `dotenv`:

```bash
npm install dotenv
```

```typescript
// at the top of your entry point
import 'dotenv/config';
```

```
# .env
OPENAI_API_KEY=sk-...
GROQ_API_KEY=gsk_...
```

---

## ESM vs. CommonJS

lemura ships dual CJS/ESM output. Both work without configuration:

```typescript
// ESM (recommended)
import { SessionManager } from 'lemura';

// CommonJS
const { SessionManager } = require('lemura');
```

For sub-path imports:

```typescript
// ESM
import { SandwichCompressionStrategy } from 'lemura/context';

// CommonJS
const { SandwichCompressionStrategy } = require('lemura/context');
```

---

## Edge Runtime Compatibility

lemura runs on:

| Runtime | Status | Notes |
|---|---|---|
| **Node.js ≥ 18** | ✅ Full support | Primary target |
| **Cloudflare Workers** | ✅ Supported | Uses native fetch, no Node APIs |
| **Deno** | ✅ Via npm compat | `import npm:lemura` |
| **Bun** | ✅ Supported | Native fetch + async iterables |
| **Browser (bundled)** | ✅ Supported | Vite, Webpack, esbuild all work |

For Cloudflare Workers, ensure your bundler target is `esnext` since Workers don't have Node.js built-ins.

---

## Available Sub-Path Exports

lemura exposes modular entry points so you only bundle what you use:

| Import | Contents | Use when |
|---|---|---|
| `lemura` | `SessionManager`, adapter, all main exports | Starting point for most apps |
| `lemura/context` | All compression strategies | When you only need context management |
| `lemura/adapters` | `OpenAICompatibleAdapter` + base types | When writing a custom adapter |
| `lemura/tools` | `ToolRegistry`, tool interfaces | When building tool packages |
| `lemura/skills` | `SkillInjector`, skill types | When building skill packages |
| `lemura/rag` | `IRAGAdapter`, `InMemoryRAGAdapter` | When implementing a RAG connector |

---

## Tips & Tricks

> **Tip:** Install `tsx` globally for fast TypeScript execution without a build step during development:
> ```bash
> npm install -g tsx
> tsx src/my-agent.ts
> ```

> **Tip:** If you're using Vitest for testing, you don't need any extra configuration — lemura is fully ESM-compatible and works with `vitest`'s default config.

> **Tip:** When deploying to a containerized environment, lock your Node version to prevent surprises:
> ```dockerfile
> FROM node:20-alpine
> ```
