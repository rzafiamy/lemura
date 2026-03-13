# Memory

Lemura has multiple memory surfaces, each with a different purpose. The most common confusion is between the scratchpad (working memory) and STM (Short Term Memory). This section puts them side by side and shows when to use each.

---

## The Memory Layers

| Layer | Purpose | Sent to provider | Size | Persistence | Typical use |
|---|---|---|---|---|---|
| Turn history | Conversation context | Yes | Limited by context window | Stored in `turns` | User and assistant messages |
| Scratchpad | Working memory for reasoning | No | Not in prompt budget | Stored per session (optional adapter) | Intermediate reasoning, tool planning |
| STM (Short Term Memory) | Large assets and blobs | Referenced via `[STM:uuid]` | External storage | Stored via adapter | Large text, files, images, tool results |
| Compression summary | Condensed history | Yes | Small | Stored in `ContextWindow` | Keep long sessions alive |

---

## Quick Guidance

- Use the scratchpad for short-lived reasoning or notes the model should not see in the prompt.
- Use STM when content is too large for the context window or when you want stable references to big assets.
- If the model must remember something across turns, put it in turn history or STM, not only in the scratchpad.

---

## Persistence and Storage

- Scratchpad persistence is optional. Provide a `scratchpadAdapter` to store it outside memory.
- STM always uses a storage adapter (`IStorageAdapter`) and returns a stable reference like `[STM:uuid]`.

See the pages below for details and examples.
