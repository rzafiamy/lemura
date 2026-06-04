# Defining Tools

Tools are async functions the agent can call during reasoning. A well-defined tool is the difference between an agent that uses it correctly every time and one that calls it with wrong arguments or ignores it entirely.

---

## The IToolDefinition Interface

```typescript
interface IToolDefinition {
  name: string;                   // snake_case, unique within the session
  description: string;            // what the model reads to decide when to call it
  parameters: JSONSchema;         // validates inputs before execute() is called
  timeoutMs?: number;             // per-tool execution timeout in ms (since v1.5.1; falls back to toolRegistryTimeoutMs)
  category?: string;              // optional group used by the router (since v1.6.0)
  execute(
    params: unknown,
    context: ToolContext
  ): Promise<unknown>;
}
```

> **`category` (since v1.6.0):** an open string used by the [MetaRouter](/docs/advanced-execution/routing) to narrow which tools are exposed per turn. Only meaningful when `enableRouting` is set; uncategorized tools are always exposed.

---

## The `name` Field

Use `snake_case`. The name is how the model refers to the tool in its reasoning:

```typescript
// ✅ Good tool names
'search_web'
'read_file'
'send_email'
'query_database'
'create_github_issue'

// ❌ Bad tool names
'SearchWeb'        // camelCase — inconsistent with convention
'search'           // too vague
'search-web'       // hyphens cause JSON issues in some providers
'tool1'            // meaningless
```

---

## The `description` Field — Critical

The description is the model's *only* guide for deciding when to call a tool. A bad description means the model won't call it (even when it should) or will call it inappropriately.

```typescript
// ✅ Excellent descriptions
description: 'Search the internet for current information about a topic. Use when you need up-to-date facts, news, prices, or any information that might not be in your training data.'

description: 'Read the contents of a file on the local filesystem. Use when the user asks you to analyze, summarize, or modify a specific file, or when you need to see code before editing it.'

description: 'Send an email to one or more recipients. Use ONLY when the user explicitly asks you to send or compose an email. Never use this to notify about task completion unless asked.'

// ❌ Bad descriptions
description: 'Searches'                  // no context for when to use
description: 'Search tool'              // still meaningless
description: 'Does web search things'   // vague
```

### Description writing formula

```
[Action in imperative form]. Use when [specific trigger condition].
[Optional: constraints or warnings about when NOT to use].
```

```typescript
// Formula applied:
description: `
  Query the company database for order information.
  Use when the user asks about order status, history, or details.
  Always look up an order before discussing it or processing refunds.
  Do NOT use for general product questions — those are in the knowledge base.
`.trim()
```

---

## The `parameters` JSON Schema

The parameters schema does two things:
1. **Documents** the tool's inputs for the model
2. **Validates** args before `execute()` is called — invalid args throw `LemuraToolValidationError`

```typescript
parameters: {
  type: 'object',
  properties: {
    // Each property needs a clear description
    query: {
      type: 'string',
      description: 'The search query. Use specific keywords. Max 200 characters.',
    },
    numResults: {
      type: 'number',
      description: 'Number of results to return. Default: 5. Max: 20.',
      minimum: 1,
      maximum: 20,
    },
    dateRange: {
      type: 'string',
      enum: ['day', 'week', 'month', 'year', 'all'],
      description: 'Filter results by date range. Use "all" for no filter.',
    },
    includeImages: {
      type: 'boolean',
      description: 'Whether to include image results. Default: false.',
    },
  },
  required: ['query'],  // only list truly required fields
  additionalProperties: false,  // ← prevents model from inventing parameters
}
```

### Nested objects and arrays

```typescript
parameters: {
  type: 'object',
  properties: {
    recipients: {
      type: 'array',
      description: 'List of email addresses to send to.',
      items: {
        type: 'string',
        format: 'email',
      },
      minItems: 1,
    },
    attachments: {
      type: 'array',
      description: 'File paths to attach (optional).',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          name: { type: 'string', description: 'Display name for the attachment.' },
        },
        required: ['path'],
      },
    },
  },
  required: ['recipients'],
}
```

---

## The `execute` Function

```typescript
execute: async (params: unknown, ctx: ToolContext): Promise<unknown> => {
  // params is typed as unknown — validate/cast it yourself
  const { query, numResults = 5 } = params as { query: string; numResults?: number };

  ctx.logger.debug('search_web called', { query, numResults, turn: ctx.turnIndex });

  try {
    const results = await searchAPI.search(query, { limit: numResults });
    return results.map(r => `${r.title}\n${r.url}\n${r.snippet}`).join('\n\n');
  } catch (err) {
    // Don't throw — return an error string so the agent can react
    return `Search failed: ${String(err)}. Try a different query or approach.`;
  }
}
```

### Key conventions for `execute()`:

1. **Return strings or JSON-serializable objects** — lemura converts them to strings via `JSON.stringify`
2. **Handle errors gracefully** — returning an error string lets the agent adapt; throwing causes `LemuraToolTimeoutError`
3. **Use `ctx.logger`** — not `console.log`
4. **Be idempotent when possible** — the agent may retry with the same args

---

## Complete Tool Example

```typescript
const createGitHubIssueTool: IToolDefinition = {
  name: 'create_github_issue',
  description: `Create a new GitHub issue in the repository.
Use when the user asks to create, file, or log an issue or bug report.
Always confirm the title and description with the user before calling this tool.`,
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Issue title. Concise and descriptive. Max 100 characters.',
        maxLength: 100,
      },
      body: {
        type: 'string',
        description: 'Issue body in Markdown. Include: problem description, steps to reproduce, expected vs actual behavior.',
      },
      labels: {
        type: 'array',
        description: 'Labels to apply. Available: "bug", "feature", "documentation", "enhancement".',
        items: {
          type: 'string',
          enum: ['bug', 'feature', 'documentation', 'enhancement'],
        },
      },
      priority: {
        type: 'string',
        enum: ['low', 'medium', 'high', 'critical'],
        description: 'Issue priority. Default: "medium".',
      },
    },
    required: ['title', 'body'],
    additionalProperties: false,
  },
  timeout: 15_000,  // 15s — GitHub API should be fast
  execute: async (params, ctx) => {
    const { title, body, labels = [], priority = 'medium' } = params as {
      title: string;
      body: string;
      labels?: string[];
      priority?: string;
    };

    ctx.logger.info('Creating GitHub issue', { title, labels, priority });

    const response = await fetch('https://api.github.com/repos/my-org/my-repo/issues', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title, body, labels }),
    });

    if (!response.ok) {
      return `Failed to create issue: ${response.status} ${response.statusText}`;
    }

    const issue = await response.json() as { number: number; html_url: string };
    return `Issue #${issue.number} created successfully: ${issue.html_url}`;
  },
};
```

---

## Tips & Tricks

> **Tip:** Write tool descriptions in the imperative: "Search the web", "Read the file", "Send the email". The model parses these more reliably than "This tool searches the web" or "Used for web searching".

> **Tip:** Include example trigger phrases in descriptions: *"Use when the user asks about 'what's the weather', 'is it raining', or 'temperature in [city]'"*. This dramatically improves tool selection accuracy for similar tools.

> **Tip:** For tools with side effects (sending emails, creating issues, deleting files), add a clear warning: *"Only call this AFTER the user has explicitly confirmed the action."* This prevents the agent from taking irreversible actions prematurely.
