# Skills System

Skills are Markdown-formatted instructions injected into the system prompt. They define *how* your agent thinks, reasons, and presents itself — independently of what it can do (tools).

---

## What Skills Are For

| Without skills | With skills |
|---|---|
| Agent behaves like a raw LLM chatbot | Agent has a specialized persona and rules |
| Inconsistent formatting | Always responds in your preferred format |
| Forgets to cite sources | Always includes citations |
| Changes behavior unpredictably | Rules are stable across compressions |

Skills solve the "prompt drift" problem — as the conversation grows and compresses, injected skills are always re-added to the system prompt, so the agent never "forgets" its core rules.

---

## Skill File Format

```markdown
---
name: code-review-expert
version: 1.0.0
description: Expert code reviewer focused on security, performance, and correctness
inject: system_prompt
priority: 10
strategy: fixed

nano: |
  You are a strict code reviewer. Always check security issues first.

micro: |
  Code review expert. Always: (1) check for security issues first, (2) flag performance problems, (3) suggest missing tests. Structure output as P0/P1/P2.
---

You are an expert software engineer specializing in code review.

## Review Approach

**Security-first (P0 — block merge):**
- SQL injection, XSS, CSRF vulnerabilities
- Hardcoded secrets, API keys, passwords
...
```

---

## Frontmatter Fields

| Field | Required | Default | Description |
|---|---|---|---|
| `name` | ✅ | — | Unique identifier, kebab-case |
| `version` | ✅ | — | Semantic version string |
| `description` | ✅ | — | One line describing the skill |
| `inject` | ✅ | — | `system_prompt`, `pre_turn`, or `post_history` |
| `priority` | ✅ | — | Lower number = higher priority |
| `strategy` | ❌ | `fixed` | `fixed` (always active) or `dynamic` (opt-in) |
| `tier` | ❌ | `standard` | `nano`, `micro`, `standard`, `extended` |
| `nano` | ❌ | — | ≤100 token single-sentence fallback |
| `micro` | ❌ | — | ≤300 token abbreviated version |
| `requiredTools` | ❌ | — | Tool names this skill depends on (YAML list) |
| `tags` | ❌ | — | Arbitrary tags for dynamic selection (YAML list) |

---

## Loading Strategies: Fixed vs Dynamic

Skills support two loading strategies that control when they are injected.

### `strategy: fixed` (default)

Always active. Injected on every ReAct iteration. All skills without a `strategy` field default to `fixed` — **fully backward compatible**.

```typescript
const session = new SessionManager({
  adapter,
  model: 'gpt-4o',
  maxTokens: 128_000,
  skills: [
    {
      name: 'safety-rules',
      version: '1.0.0',
      description: 'Absolute safety constraints',
      inject: 'system_prompt',
      priority: 1,
      strategy: 'fixed',   // always on — same as omitting strategy entirely
      nano: 'Never generate harmful, illegal, or NSFW content.',
      standard: 'ABSOLUTE RULES:\n1. Never generate harmful content.\n2. Never claim to be human.',
    },
  ],
});
```

### `strategy: dynamic`

Part of an opt-in pool. A dynamic skill is **inactive by default** (`enabled: false`) and must be explicitly activated before it is injected. This lets you register a library of specialist skills at session construction and then enable only the ones relevant to the current task.

```typescript
const session = new SessionManager({
  adapter,
  model: 'gpt-4o',
  maxTokens: 128_000,
  skills: [
    {
      name: 'code-review',
      strategy: 'dynamic',
      tags: ['engineering', 'review'],
      requiredTools: ['read_file', 'list_directory'],
      inject: 'system_prompt',
      priority: 10,
      version: '1.0.0',
      description: 'Expert code reviewer',
      standard: 'You are an expert code reviewer...',
    },
    {
      name: 'data-analyst',
      strategy: 'dynamic',
      tags: ['data'],
      inject: 'system_prompt',
      priority: 10,
      version: '1.0.0',
      description: 'Data analysis expert',
      standard: 'You are a data analysis expert...',
    },
  ],
  // Enable specific dynamic skills at construction time:
  activeDynamicSkills: ['code-review'],
  // Or enable by tag:
  // activeDynamicTags: ['engineering'],
});
```

### Runtime enable/disable

The `session.skills` accessor exposes the `SkillInjector` for runtime control:

```typescript
// Enable a dynamic skill by name
session.skills.enableSkill('data-analyst');

// Disable a dynamic skill
session.skills.disableSkill('code-review');

// Enable all dynamic skills tagged 'debugging'
session.skills.enableByTags(['debugging']);

// Disable all dynamic skills tagged 'verbose'
session.skills.disableByTags(['verbose']);

// List currently active skills (fixed + enabled dynamic)
const active = session.skills.getActiveSkills();
console.log(active.map(s => s.name));

// Get all tools required by active skills
const needed = session.skills.getRequiredTools();
console.log('Tools needed:', needed);
// → ['read_file', 'list_directory']
```

### Tool-Skill linking via `requiredTools`

A skill can declare which tools it relies on via `requiredTools`. This is informational — lemura does not auto-register or auto-restrict tools based on it — but it lets the host application build tool arrays dynamically:

```typescript
const session = new SessionManager({ adapter, model, maxTokens, skills });
session.skills.enableSkill('code-review');

// Build the minimal tool set needed by active skills
const allTools = [readFileTool, listDirTool, webSearchTool, shellTool];
const needed = new Set(session.skills.getRequiredTools());
const tools = allTools.filter(t => needed.has(t.name));

// Re-run with the filtered tool set
const session2 = new SessionManager({ adapter, model, maxTokens, tools, skills });
```

---

## Injection Positions

### `system_prompt` (most common)
Injected once before the first user message. Best for:
- Persona definition
- Permanent rules that should always be active
- Response format requirements

```markdown
---
inject: system_prompt
priority: 5
---
Always respond in formal British English. Use "whilst", "accordingly", and "endeavour".
Never use contractions (don't, can't, won't).
```

### `pre_turn`
Injected as a synthetic system message before each user turn. Best for:
- Dynamic context that changes each turn
- Turn-specific reminders
- Date/time injection

```markdown
---
inject: pre_turn
priority: 20
---
Current date: {{DATE}}. Customer tier: {{CUSTOMER_TIER}}.
```

### `post_history`
Injected after all conversation history, just before the provider call. Best for:
- Final-moment reminders
- "Don't forget" instructions
- Format enforcement

```markdown
---
inject: post_history
priority: 50
---
Before responding, check: Is my answer complete? Does it address all parts of the question?
```

---

## Loading Skills

### Option 1: Inline object (explicit fields — recommended)

```typescript
const session = new SessionManager({
  adapter,
  model: 'gpt-4o',
  maxTokens: 128_000,
  skills: [
    {
      name: 'customer-persona',
      version: '1.0.0',
      description: 'Friendly customer support agent',
      inject: 'system_prompt',
      priority: 5,
      strategy: 'fixed',
      nano: 'You are a helpful, friendly customer support agent for Acme Corp.',
      standard: `You are a helpful, empathetic customer support agent for Acme Corporation.

Your style:
- Always acknowledge the customer's frustration before solving the problem
- Use the customer's name when you know it
- End every response with a follow-up question`,
    },
  ],
});
```

### Option 2: From file (markdown body as `content`)

When you have a skill markdown file, read the body (without frontmatter) and pass it as `content`:

```typescript
import { readFileSync } from 'fs';

// The skill file's body (after the --- frontmatter block)
const body = extractMarkdownBody(readFileSync('./skills/code-review.md', 'utf8'));

const session = new SessionManager({
  adapter,
  model: 'gpt-4o',
  maxTokens: 128_000,
  skills: [
    {
      name: 'code-review',
      version: '1.0.0',
      description: 'Code review expert',
      inject: 'system_prompt',
      priority: 10,
      content: body,   // used as standard-level content
    },
  ],
});
```

### Option 3: Conditional / permission-based

Only register skills based on context:

```typescript
const skills: ISkill[] = [safetySkill]; // always fixed

if (user.plan === 'pro') {
  skills.push({ ...deepResearchSkill, strategy: 'dynamic', enabled: true });
}

if (user.role === 'engineer') {
  skills.push({ ...codeReviewSkill, strategy: 'dynamic', enabled: true });
}

const session = new SessionManager({ adapter, model, maxTokens, skills });
```

---

## Multiple Skills — Priority & Composition

Skills are concatenated in priority order (lowest number = first). For skills at the same injection position:

```typescript
skills: [
  // Priority 1 — injected first, highest authority
  {
    name: 'safety-rules',
    priority: 1,
    inject: 'system_prompt',
    strategy: 'fixed',
    nano: 'Never generate harmful, illegal, or NSFW content.',
    standard: 'ABSOLUTE RULES:\n1. Never generate harmful content.',
  },

  // Priority 10 — injected second
  {
    name: 'researcher-persona',
    priority: 10,
    inject: 'system_prompt',
    strategy: 'fixed',
    standard: 'You are a thorough research assistant...',
  },
]
```

The final system prompt becomes:
```
[Base systemPrompt]
[safety-rules skill content]
[researcher-persona skill content]
```

---

## Skill Tiers for Budget Management

When you have many skills, they compete for `skillTokenBudget`. Skills are automatically downsized:

```
Tier        Max tokens    Content
────────────────────────────────────
extended    ≤ 2000        Full content + examples (never auto-injected)
standard    ≤ 800         Full markdown body
micro       ≤ 300         frontmatter micro: field
nano        ≤ 100         frontmatter nano: field
(skipped)   0             Budget exhausted — only skills with priority < 5 escape this
```

**Always write the `nano` field first.** If you can't express the skill's core behavior in one sentence, the skill isn't focused enough.

---

## Observability — Skill Traces

When `onTrace` is configured, every active skill emits a `skill / skill_load` trace at session construction:

```typescript
const session = new SessionManager({
  adapter, model, maxTokens, skills,
  onTrace: (event) => {
    if (event.type === 'skill' && event.name === 'skill_load') {
      console.log(`Skill loaded: ${event.metadata.name} (${event.metadata.strategy})`);
      console.log(`  Required tools: ${event.metadata.requiredTools.join(', ')}`);
    }
  },
});
```

The `system / session_init` trace also includes a skills summary:
```json
{
  "type": "system",
  "name": "session_init",
  "metadata": {
    "skills": { "total": 4, "active": 3, "fixed": 2, "dynamic": 1 }
  }
}
```

---

## Tips & Tricks

> **Tip:** Skills with `priority < 5` are **never downgraded or skipped**, regardless of token budget. Use this for safety-critical rules that must always be present.

> **Tip:** Skills are re-injected after every context compression event. This is the entire point — don't put rules in the regular conversation history if you want them to survive compression. Put them in skills.

> **Tip:** Use `dynamic` skills for specialist modes (e.g. "code-review mode", "data-analysis mode") that your UI activates via `session.skills.enableByTags(['mode-tag'])`.

> **Tip:** Combine `requiredTools` with `session.skills.getRequiredTools()` to build minimal, context-aware tool sets — expose only the tools the active skill set actually needs.
