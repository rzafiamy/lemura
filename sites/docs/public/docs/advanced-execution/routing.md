# Routing — the MetaRouter *(since v1.6.0)*

Routing is lemura's answer to two failure modes that show up the moment an agent handles a mix of real tasks and casual conversation:

1. **Phantom goals on chit-chat.** Forcing *every* message through plan → verify → correct means an innocent "thanks!" gets a hallucinated goal, the verifier grades the reply against that phantom rubric, fails it, and the correction loop flails through tools looking for a task that never existed.
2. **Tool overload.** Exposing all 20 tools on every turn confuses smaller models and wastes tokens on schemas the turn will never use.

The **MetaRouter** runs **once per turn, before the ReAct loop**, and produces a `RouterDecision`:

- a **mode** — `chat` or `task` — where a `chat` verdict suppresses goal planning and verification for that turn, and
- a list of **tool categories** — only tools whose `category` is selected (plus always-available and uncategorized tools) are exposed to the model that turn.

Routing is **off by default**. When disabled, every tool is exposed exactly as before — fully backward-compatible.

---

## Enabling Routing

```typescript
const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  enableRouting: true,                  // turn on the built-in LLMRouter
  routerModel: 'gpt-4o-mini',           // optional: cheap model for classification
  alwaysAvailableCategories: ['scratchpad'],
  tools: [
    { name: 'search_web',  category: 'search',     /* … */ },
    { name: 'write_file',  category: 'files',      /* … */ },
    { name: 'scratchpad_read', category: 'scratchpad', /* … */ },
    { name: 'get_datetime' /* no category → always available */, /* … */ },
  ],
});
```

The `category` field on a tool is an **open string** — lemura does not own a fixed catalog. Group tools however suits your app. Tools left **uncategorized are never filtered out** (treated as always available).

---

## How a Turn Is Routed

```
session.run("search the web for EV market data and save it")
       │
       ▼
  Router.route(message, [
    { name: 'search', tools: ['search_web'] },
    { name: 'files',  tools: ['write_file'] },
  ])
       │
       ▼
  RouterDecision { mode: 'task', categories: ['search', 'files'], reason: 'needs web + file write' }
       │
       ▼
  Exposed tools this turn = (tools in selected categories)
                          + (alwaysAvailableCategories)
                          + (uncategorized tools)
       │
       ▼
  ReAct loop runs with the narrowed tool set
```

A `chat` verdict returns no categories, so only always-available and uncategorized tools are exposed — and goal planning/verification are skipped for the turn.

---

## Configuration

| Field | Type | Default | Purpose |
|---|---|---|---|
| `enableRouting` | `boolean` | `false` | Turn routing on |
| `router` | `IRouterAdapter` | — | Custom router; takes precedence over the built-in one |
| `routerModel` | `string` | `config.model` | Model used by the built-in `LLMRouter` |
| `alwaysAvailableCategories` | `string[]` | `[]` | Categories always exposed regardless of the decision |

---

## The Built-in `LLMRouter`

When `enableRouting` is true and no custom `router` is supplied, lemura uses `LLMRouter`. It is designed to be cheap and safe:

- **Conversational fast-path** — short greetings/acknowledgements (`hi`, `thanks`, `ok`, …) are classified `chat` with **no LLM call**.
- **No categorized tools** — if no tool declares a `category`, routing is a no-op (the router is never consulted; all tools are exposed).
- **Single temperature-0 call** — one deterministic classification call against `routerModel`.
- **Hallucination guard** — any category the model returns that wasn't offered is dropped.
- **Fail-safe** — on any parse/LLM error it returns `{ mode: 'task', categories: <all> }`, so the agent never loses tool access because routing hiccupped.

---

## Bring Your Own Router

Implement `IRouterAdapter` to use rules, embeddings, or your own classifier instead of an LLM call. It can be sync or async:

```typescript
import { IRouterAdapter, RouterDecision, ToolCategoryInfo } from 'lemura';

const keywordRouter: IRouterAdapter = {
  route(message: string, categories: ToolCategoryInfo[]): RouterDecision {
    const m = message.toLowerCase();
    if (/^(hi|hello|thanks|thank you|ok)\b/.test(m.trim())) {
      return { mode: 'chat', categories: [] };
    }
    const picked = categories
      .filter(c => c.tools.some(t => m.includes(t.split('_')[0])))
      .map(c => c.name);
    return { mode: 'task', categories: picked, reason: 'keyword match' };
  },
};

const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  enableRouting: true,
  router: keywordRouter,   // takes precedence over the built-in LLMRouter
  tools: [/* … with category fields … */],
});
```

> **Always fail safe in custom routers.** On any internal error, return `{ mode: 'task', categories: <all category names> }` rather than throwing — lemura guards custom routers too, but the agent is most useful when it keeps full tool access on failure.

---

## Observability

Each routing decision emits a `routing` trace event named `route_decision`:

```typescript
const session = new SessionManager({
  adapter, model: 'gpt-4o', maxTokens: 128_000,
  enableRouting: true,
  tools: [/* … */],
  onTrace: (e) => {
    if (e.type === 'routing') {
      console.log('Route:', e.metadata?.mode, e.metadata?.categories, '—', e.metadata?.reason);
    }
  },
});
```

The selected categories for the turn are also stored in `context.metadata['routedCategories']`.

---

## Tips & Tricks

> **Tip:** Point `routerModel` at a small, fast model (e.g. a `*-mini`). Classification is a simple JSON task — you don't need your reasoning model for it, and it runs on every turn.

> **Tip:** Put your scratchpad/memory tools in a dedicated category and list it in `alwaysAvailableCategories`, so the agent can always read and write working memory no matter how the turn is classified.

> **Tip:** Routing and goal verification compose well. The `chat` verdict suppresses the goal pipeline, which is exactly the guard that prevents spurious "Goal Verification Warning" output on conversational turns.

> **Tip:** Start without categories. Routing only narrows *categorized* tools — you can adopt it incrementally by tagging one group of tools at a time; everything still works while most tools remain uncategorized (always available).
