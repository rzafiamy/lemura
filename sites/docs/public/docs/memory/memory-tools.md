# Memory Tools

Lemura ships built-in tools for both STM and scratchpad. These tools are registered when you provide `stmRegistry` in `SessionConfig`.

---

## STM Tools

- `read_chunk` - Read a slice of an STM reference
- `search_chunk` - Keyword search within an STM reference
- `list_chunks` - Inspect chunk boundaries and indices
- `update_chunk` - Append or replace content in STM
- `summarize_sandwich` - Create a layered summary for a large STM ref

## Scratchpad Tools

- `read_scratchpad` - Read the current scratchpad contents
- `write_scratchpad` - Append or replace scratchpad content
- `remove_scratchpad` - Clear the scratchpad

---

## When To Use Tools

- Use `read_chunk` or `search_chunk` when the agent needs a precise slice of a large document.
- Use `write_scratchpad` to store intermediate reasoning or a plan between tool calls.
- Use `remove_scratchpad` when you want a clean reasoning slate for the next step.
