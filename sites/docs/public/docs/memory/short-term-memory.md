# Short Term Memory (STM)

STM is Lemura's large-object memory. It stores big content outside the prompt and replaces it with a short reference like `[STM:uuid]` so your context window stays small.

---

## What STM Is For

Use STM when you need to keep large content around without stuffing it into the prompt:

- Long documents and transcripts
- Large tool results (HTML, JSON, logs)
- Files or binary blobs
- Multi-step analysis where you only need slices of the data

---

## How STM Works

1. You register content with the `ShortTermMemoryRegistry`.
2. It returns a reference string like `[STM:uuid]`.
3. Tools can read, search, or update the content using that reference.

---

## Basic Setup

```typescript
import { ShortTermMemoryRegistry, InMemoryStorageAdapter } from 'lemura/context';

const stmRegistry = new ShortTermMemoryRegistry({
  storage: new InMemoryStorageAdapter(),
  maxTextTokens: 100_000,
});

const ref = await stmRegistry.register(
  longText,
  'text',
  { source: 'report.pdf' }
);
// ref looks like: [STM:uuid]
```

Pass the registry into your session config so the built-in STM tools are available:

```typescript
const session = new SessionManager({
  adapter,
  model: 'gpt-4o',
  maxTokens: 16_000,
  stmRegistry,
});
```

---

## Reference Format

All STM references follow this pattern:

```
[STM:uuid]
```

The `uuid` is the storage key. Tools use it to fetch the content on demand.

---

## Storage Adapters

STM storage is pluggable. Implement `IStorageAdapter` to use a database, object store, or custom backend.

See `InMemoryStorageAdapter` for a minimal example.
