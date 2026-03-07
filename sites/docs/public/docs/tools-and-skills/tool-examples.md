# Real-World Tool Examples

A collection of complete, production-ready tool implementations for common use cases.

---

## Web Search Tool

```typescript
import type { IToolDefinition } from 'lemura/types';

// Uses Brave Search API (also works with Google Custom Search, Bing, etc.)
const searchWebTool: IToolDefinition = {
  name: 'search_web',
  description: `Search the internet for current, up-to-date information.
Use when you need: recent news, current prices, live data, or any information
that may have changed since your training cutoff. Be specific with your queries.`,
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query. Use specific keywords. Example: "TypeScript 5.0 new features 2024"',
      },
      numResults: {
        type: 'number',
        description: 'Number of results to return. Default: 5. Max: 10.',
        minimum: 1,
        maximum: 10,
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
  execute: async ({ query, numResults = 5 }: { query: string; numResults?: number }, ctx) => {
    ctx.logger.info('search_web', { query, numResults });

    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${numResults}`,
      { headers: { 'X-Subscription-Token': process.env.BRAVE_API_KEY! } }
    );

    if (!response.ok) {
      return `Search failed (${response.status}). Try rephrasing the query.`;
    }

    const data = await response.json() as {
      web: { results: Array<{ title: string; url: string; description: string }> }
    };

    if (!data.web?.results?.length) {
      return 'No results found. Try a different search query.';
    }

    return data.web.results
      .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.description}`)
      .join('\n\n');
  },
};
```

---

## File System Tools

```typescript
import { readFile, writeFile, readdir, stat } from 'fs/promises';
import { join, extname } from 'path';

const readFileTool: IToolDefinition = {
  name: 'read_file',
  description: 'Read the contents of a file. Use when you need to analyze, summarize, or edit a specific file.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute or relative path to the file. Example: "./src/index.ts"',
      },
      maxLines: {
        type: 'number',
        description: 'Maximum lines to read. Default: 200. Increase for large files.',
      },
    },
    required: ['path'],
    additionalProperties: false,
  },
  timeout: 10_000,
  execute: async ({ path, maxLines = 200 }: { path: string; maxLines?: number }, ctx) => {
    try {
      const content = await readFile(path, 'utf8');
      const lines = content.split('\n');
      const truncated = lines.length > maxLines;
      const preview = lines.slice(0, maxLines).join('\n');

      return truncated
        ? `${preview}\n\n[... ${lines.length - maxLines} more lines — request with larger maxLines to see them]`
        : preview;
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') return `File not found: ${path}`;
      if (error.code === 'EACCES') return `Permission denied: ${path}`;
      return `Error reading file: ${String(err)}`;
    }
  },
};

const writeFileTool: IToolDefinition = {
  name: 'write_file',
  description: `Write content to a file. Creates the file if it does not exist, overwrites if it does.
Use ONLY when the user explicitly asks to save, write, or create a file.
Always confirm the file path and content with the user before calling this.`,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path to write to.' },
      content: { type: 'string', description: 'File content to write.' },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },
  execute: async ({ path, content }: { path: string; content: string }) => {
    try {
      await writeFile(path, content, 'utf8');
      const bytes = Buffer.byteLength(content, 'utf8');
      return `File written successfully: ${path} (${bytes} bytes, ${content.split('\n').length} lines)`;
    } catch (err) {
      return `Error writing file: ${String(err)}`;
    }
  },
};
```

---

## Database Query Tool

```typescript
import { Pool } from 'pg';

interface DatabaseToolConfig {
  pool: Pool;
  allowedTables?: string[];   // optional whitelist for security
  maxRows?: number;           // safety limit on query results
}

function createDatabaseQueryTool(config: DatabaseToolConfig): IToolDefinition {
  return {
    name: 'query_database',
    description: `Execute a read-only SQL query against the database.
Use for: getting data counts, finding records, aggregating statistics.
Only SELECT queries are allowed. Never use for INSERT/UPDATE/DELETE.`,
    parameters: {
      type: 'object',
      properties: {
        sql: {
          type: 'string',
          description: 'SQL SELECT query. Example: "SELECT * FROM orders WHERE status = \'pending\' LIMIT 10"',
        },
        params: {
          type: 'array',
          description: 'Query parameters for parameterized queries, e.g. ["pending", 10]',
          items: { type: ['string', 'number', 'boolean', 'null'] },
        },
      },
      required: ['sql'],
      additionalProperties: false,
    },
    timeout: 30_000,
    execute: async ({ sql, params = [] }: { sql: string; params?: unknown[] }, ctx) => {
      // Security: only allow SELECT
      const normalized = sql.trim().toUpperCase();
      if (!normalized.startsWith('SELECT')) {
        return 'Error: Only SELECT queries are allowed.';
      }

      // Security: validate allowed tables
      if (config.allowedTables) {
        const usedTables = extractTableNames(sql);
        const disallowed = usedTables.filter(t => !config.allowedTables!.includes(t));
        if (disallowed.length > 0) {
          return `Error: Queries on tables [${disallowed.join(', ')}] are not allowed.`;
        }
      }

      ctx.logger.info('query_database', { sql: sql.slice(0, 100) });

      try {
        const result = await config.pool.query(sql, params as unknown[]);
        const rows = result.rows.slice(0, config.maxRows ?? 50);
        const truncated = result.rows.length > (config.maxRows ?? 50);

        if (rows.length === 0) return 'Query returned no results.';

        // Format as readable table
        const columns = Object.keys(rows[0] ?? {});
        const header = columns.join(' | ');
        const separator = columns.map(c => '─'.repeat(c.length)).join('─┼─');
        const body = rows.map(row =>
          columns.map(c => String(row[c] ?? 'NULL').padEnd(c.length)).join(' | ')
        );

        return [
          header, separator, ...body,
          truncated ? `\n... ${result.rows.length - rows.length} more rows (add LIMIT to see specific rows)` : '',
        ].filter(Boolean).join('\n');
      } catch (err) {
        return `Query error: ${(err as Error).message}`;
      }
    },
  };
}
```

---

## HTTP API Tool

```typescript
const fetchJsonTool: IToolDefinition = {
  name: 'fetch_json',
  description: `Make an HTTP GET or POST request to a JSON API.
Use for: calling external services, fetching data from APIs, checking webhooks.
Only use URLs that have been explicitly mentioned or are clearly relevant.`,
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The full URL to request. Must start with https://',
      },
      method: {
        type: 'string',
        enum: ['GET', 'POST'],
        description: 'HTTP method. Default: GET',
      },
      body: {
        type: 'object',
        description: 'Request body for POST requests (will be JSON-encoded).',
      },
      headers: {
        type: 'object',
        description: 'Additional request headers as key-value pairs.',
        additionalProperties: { type: 'string' },
      },
    },
    required: ['url'],
    additionalProperties: false,
  },
  timeout: 15_000,
  execute: async ({
    url,
    method = 'GET',
    body,
    headers = {},
  }: {
    url: string;
    method?: string;
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
  }, ctx) => {
    // Security: only allow https
    if (!url.startsWith('https://')) {
      return 'Error: Only HTTPS URLs are allowed.';
    }

    ctx.logger.info('fetch_json', { url, method });

    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(12_000),
      });

      const text = await response.text();

      // Try to parse as JSON for nicer formatting
      try {
        const json = JSON.parse(text);
        const formatted = JSON.stringify(json, null, 2);
        // Limit response size
        return formatted.slice(0, 5000) + (formatted.length > 5000 ? '\n...[truncated]' : '');
      } catch {
        return text.slice(0, 3000);
      }
    } catch (err) {
      if ((err as Error).name === 'TimeoutError') return 'Request timed out after 12 seconds.';
      return `Request failed: ${String(err)}`;
    }
  },
};
```

---

## Shell Command Tool (development only)

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ⚠️ DANGER: Only use in sandboxed development environments!
const runCommandTool: IToolDefinition = {
  name: 'run_command',
  description: `Run a shell command and return its output.
Use for: running tests, executing scripts, checking system state.
⚠️ Only use in safe development environments — this can execute any command.`,
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Shell command to execute. Example: "pnpm test", "ls -la ./src"',
      },
      cwd: {
        type: 'string',
        description: 'Working directory. Default: current directory.',
      },
    },
    required: ['command'],
    additionalProperties: false,
  },
  timeout: 60_000,
  execute: async ({ command, cwd }: { command: string; cwd?: string }, ctx) => {
    ctx.logger.warn('run_command executing', { command }); // Always log commands

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout: 55_000, // 5s before our outer timeout
        maxBuffer: 1024 * 1024, // 1MB output limit
      });

      const output = [
        stdout && `STDOUT:\n${stdout.trim()}`,
        stderr && `STDERR:\n${stderr.trim()}`,
      ].filter(Boolean).join('\n\n');

      return output || 'Command completed with no output.';
    } catch (err) {
      const error = err as { code?: number; stdout?: string; stderr?: string; message: string };
      return [
        `Exit code: ${error.code ?? 'unknown'}`,
        error.stdout && `STDOUT:\n${error.stdout.trim()}`,
        error.stderr && `STDERR:\n${error.stderr.trim()}`,
        `Error: ${error.message}`,
      ].filter(Boolean).join('\n\n');
    }
  },
};
```

---

## Tips & Tricks

> **Tip:** Always limit output size in `execute()`. Returning 100,000 characters from a log file will flood the context. Prefer structured excerpts over raw dumps.

> **Tip:** Add `session_id` and `turn_index` from `ctx` to any external service calls for distributed tracing. When something goes wrong, you'll know exactly which agent turn triggered the API call.

> **Tip:** For tools that could have side effects, log *before* the action (not after). If the action triggers an exception, the log still appears and you know what was attempted.
