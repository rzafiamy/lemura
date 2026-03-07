# Skills System

Skills are Markdown files injected into the system prompt. They define *how* your agent thinks, reasons, and presents itself — independently of what it can do (tools).

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
- Unsafe deserialization, path traversal
- Improper error handling that leaks internal state

**Performance (P1 — fix in this PR or file ticket):**
- O(n²) or worse algorithms where O(n log n) exists
- N+1 database queries
- Missing database indexes for filtered/sorted columns
- Unnecessary synchronous file I/O or blocking operations

**Maintainability (P2 — optional):**
- Functions longer than 50 lines (suggest refactor)
- Missing test coverage for new code paths
- Naming that doesn't match domain terminology

## Output Format

Always structure your review as:

```
## Code Review

### 🔴 P0 — Security (must fix before merge)
* [Issue]: [Location] — [Explanation] — [Fix]

### 🟡 P1 — Performance
* [Issue]: [Location] — [Explanation]

### 🔵 P2 — Style & Maintainability
* [Issue]: [Location] — [Suggestion]

### ✅ Summary
[One paragraph overall assessment]
```
```

---

## Frontmatter Fields

| Field | Required | Description |
|---|---|---|
| `name` | ✅ | Unique identifier, kebab-case |
| `version` | ✅ | Semantic version string |
| `description` | ✅ | One line describing the skill |
| `inject` | ✅ | `system_prompt`, `pre_turn`, or `post_history` |
| `priority` | ✅ | Lower number = higher priority |
| `tier` | ❌ | `nano`, `micro`, `standard`, `extended` |
| `nano` | ❌ | ≤100 token single-sentence fallback |
| `micro` | ❌ | ≤300 token abbreviated version |

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

### Option 1: From file (most common)

```typescript
import { readFileSync } from 'fs';

const session = new SessionManager({
  adapter,
  model: 'gpt-4o',
  maxTokens: 128_000,
  skills: [
    { content: readFileSync('./skills/code-review-expert.md', 'utf8') },
    { content: readFileSync('./skills/security-first.md', 'utf8') },
  ],
});
```

### Option 2: Inline (for simple/dynamic skills)

```typescript
const session = new SessionManager({
  adapter,
  model: 'gpt-4o',
  maxTokens: 128_000,
  skills: [{
    content: `---
name: customer-persona
version: 1.0.0
inject: system_prompt
priority: 5
nano: You are a helpful, friendly customer support agent for Acme Corp.
---

You are a helpful, empathetic customer support agent for Acme Corporation.

Your style:
- Always acknowledge the customer's frustration before solving the problem
- Use the customer's name when you know it
- End every response with a follow-up question or offer to help further
- Never say "unfortunately" — instead say "I understand [concern] and here's what I can do..."
`,
  }],
});
```

### Option 3: Auto-discovery from node_modules

```json
// In your tool package's package.json
{
  "name": "my-lemura-tools",
  "lemura": {
    "tools": ["./dist/tools/index.js"],
    "skills": ["./skills/my-skill.md"]  // ← auto-discovered
  }
}
```

```typescript
const session = new SessionManager({
  adapter,
  model: 'gpt-4o',
  maxTokens: 128_000,
  autodiscoverTools: true,  // also discovers skills
});
```

---

## Multiple Skills — Priority & Composition

Skills are concatenated in priority order (lowest number = first). For skills at the same injection position:

```typescript
skills: [
  // Priority 1 — injected first, highest authority
  { content: `---
name: safety-rules
priority: 1
inject: system_prompt
nano: Never generate harmful, illegal, or NSFW content.
---
ABSOLUTE RULES:
1. Never generate harmful, illegal, or NSFW content.
2. Always decline requests for personal information of real people.
3. Never claim to be a human.
` },

  // Priority 10 — injected second
  { content: `---
name: researcher-persona
priority: 10
inject: system_prompt
---
You are a thorough research assistant...
` },
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

## Tips & Tricks

> **Tip:** Skills with `priority < 5` are **never downgraded or skipped**, regardless of token budget. Use this for safety-critical rules that must always be present.

> **Tip:** Test skill composition by calling `session.tools.register` with a fake `skill_list` tool and then asking "what skills are active?" This reveals what the model actually sees in the system prompt.

> **Tip:** Skills are re-injected after every context compression event. This is the entire point — don't put rules in the regular conversation history if you want them to survive compression. Put them in skills.
