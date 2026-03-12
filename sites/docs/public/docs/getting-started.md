# Getting Started with lemura

> **lemura** is a provider-agnostic npm package that bundles a full agentic AI runtime — ReAct loop, multi-provider adapters, pluggable context compression, tool orchestration, skill injection, and RAG integration — all in one composable package with zero vendor lock-in.

![Getting Started — ReAct Loop Overview](/images/getting-started-diagram.png)

---

## Meet Makix

> 🌿 **Makix Context** 🚀: Throughout these docs, every feature is illustrated by building **Makix**, a powerful assistant. Note that all examples use INfodev's OpenAI-compatible API running **Qwen 3.5 4B** with a 16K context window.

---

## In This Section

| Page | What it covers |
|---|---|
| [Installation →](/docs/getting-started/installation) | `npm install lemura`, Node.js requirements, environment setup |
| [Quick Start →](/docs/getting-started/quick-start) | Build and run your first Makix agent in 5 minutes |
| [Core Concepts →](/docs/getting-started/core-concepts) | ReAct loop, SessionManager, how all the pieces fit together |
| [SessionConfig Reference →](/docs/session-config) | Every configuration option explained |
| [Error Handling →](/docs/getting-started/error-handling) | Typed error classes, recovery strategies |

---

## How the ReAct Loop Works

lemura runs a **ReAct (Reason + Act)** loop — the industry-standard architecture for tool-using agents:

```
User Message
     │
     ▼
┌──────────────────────────────────────┐
│          SessionManager.run()        │
│                                      │
│  1. Inject skills into system prompt │
│  2. Compress context if needed       │
│  3. Call provider → get response     │
│  4a. If tool_call → execute tool     │
│      → append observation → goto 2  │
│  4b. If stop → return final answer   │
└──────────────────────────────────────┘
```

---

## Building Makix — Chapter by Chapter

Each doc section adds a new capability to Makix:

| Chapter | What you'll add | Section |
|---|---|---|
| **Adapters** | Connect INfodev/Qwen 3.5 4B, switch providers in one line | [Provider Adapters →](/docs/adapters) |
| **Context Management** | Keep Makix working after weeks of daily use (16K budget) | [Context Management →](/docs/context-management) |
| **Tools & Skills** | Add weather, search, calendar, messaging + personality | [Tools & Skills →](/docs/tools-and-skills) |
| **Media Bridge** | Add ASR, TTS, vision, and image generation | [Media Bridge →](/docs/media-bridge) |
| **Tool Firewall** | Gate tool calls with ask/accept/deny rules | [Tool Firewall →](/docs/tools-and-skills/tool-firewall) |
| **RAG Integration** | Give Makix access to your personal notes | [RAG Integration →](/docs/rag-integration) |
| **Advanced Runtime** | Let Makix plan and execute complex multi-step tasks | [Advanced Runtime →](/docs/advanced-execution) |
