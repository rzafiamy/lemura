---
trigger: always_on
---

# lemura — Build & Publishing Rules

## Build Tool

Use **tsup** for all build output. It handles dual CJS/ESM output, declaration files, and tree-shaking correctly with minimal configuration.

---

## Output Structure

After `pnpm build`, the `dist/` directory must contain:

```
dist/
├── index.js          # CJS entry
├── index.mjs         # ESM entry
├── index.d.ts        # TypeScript declarations
├── adapters/
│   ├── index.js
│   ├── index.mjs
│   └── index.d.ts
├── context/
│   ├── index.js
│   ├── index.mjs
│   └── index.d.ts
├── tools/
│   ├── index.js
│   ├── index.mjs
│   └── index.d.ts
├── skills/
│   ├── index.js
│   ├── index.mjs
│   └── index.d.ts
├── rag/
│   ├── index.js
│   ├── index.mjs
│   └── index.d.ts
└── types/
    └── index.d.ts    # types only, no JS output
```

---

## package.json Exports Map

```json
{
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./adapters": {
      "import": "./dist/adapters/index.mjs",
      "require": "./dist/adapters/index.js",
      "types": "./dist/adapters/index.d.ts"
    },
    "./context": {
      "import": "./dist/context/index.mjs",
      "require": "./dist/context/index.js",
      "types": "./dist/context/index.d.ts"
    },
    "./tools": {
      "import": "./dist/tools/index.mjs",
      "require": "./dist/tools/index.js",
      "types": "./dist/tools/index.d.ts"
    },
    "./skills": {
      "import": "./dist/skills/index.mjs",
      "require": "./dist/skills/index.js",
      "types": "./dist/skills/index.d.ts"
    },
    "./rag": {
      "import": "./dist/rag/index.mjs",
      "require": "./dist/rag/index.js",
      "types": "./dist/rag/index.d.ts"
    }
  },
  "main": "./dist/index.js",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "sideEffects": false,
  "files": ["dist", "skills", "LICENSE", "README.md", "CHANGELOG.md"],
  "engines": { "node": ">=18.0.0" }
}
```

---

## Dependencies Policy

| Category | Rule |
|---|---|
| `dependencies` | Absolutely minimal. Each dep is a release risk. |
| `peerDependencies` | Nothing — lemura must work standalone |
| `devDependencies` | Anything needed to build/test |
| `optionalDependencies` | Never — creates unpredictable install behavior |

**Allowed runtime `dependencies`:**
- None currently. The goal is zero runtime dependencies.
- If a dependency becomes unavoidable (e.g. a well-maintained token counter), it must be evaluated for: bundle size impact, maintenance health, license compatibility (MIT/Apache only), and tree-shakability.

---

## Publish Checklist

Run before every `npm publish`:

```bash
# 1. Clean build
pnpm clean && pnpm build

# 2. All tests pass
pnpm test --coverage

# 3. Type check
pnpm typecheck

# 4. Lint
pnpm lint

# 5. Verify package contents
npm pack --dry-run

# 6. Check bundle size
pnpm size

# 7. Verify exports map works
node -e "require('lemura')"
node --input-type=module -e "import 'lemura'"
```

---

## Versioning

- `0.x.y` — initial development phase (API may change in minor versions)
- `1.0.0` — stable release, after all core apps have migrated
- Patch: bug fixes only
- Minor: new features, new strategies, new adapters (no breaking changes)
- Major: any breaking change to `IProviderAdapter`, `IContextStrategy`, `SessionManager` public API

Use `changeset` for version management:
```bash
pnpm changeset          # describe changes
pnpm version            # bump versions
pnpm publish            # publish to npm
```

---

## CI Pipeline (GitHub Actions)

Required jobs:
1. **lint** — ESLint + Prettier check
2. **typecheck** — `tsc --noEmit`
3. **test** — Vitest on Node 18, 20, 22
4. **build** — tsup build, verify dist exists
5. **size** — Bundle size check (fail if main entry > 50kB minified+gzipped)
6. **publish** — triggered on tag push, runs full checklist + `npm publish --provenance`

---

## Bundle Size Budget

| Entry point | Max size (minified + gzipped) |
|---|---|
| `lemura` (main) | 50 kB |
| `lemura/context` | 20 kB |
| `lemura/adapters` | 15 kB |
| `lemura/tools` | 10 kB |
| `lemura/rag` | 8 kB |

Exceeding these limits requires explicit approval and a note in CHANGELOG.md explaining the tradeoff.