# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Structured logging system with colors and severity levels (FATAL, ERROR, WARN, INFO, DEBUG).
- Integrated logging into `SessionManager` and `OpenAICompatibleAdapter`.
- Added `problem` and `hints` to `LemuraError` for better end-user feedback.
- Dedicated `ILogger` interface and `DefaultLogger` implementation.
- Short Term Memory (STM) system for persistent memory across session boundaries
- Scratchpad tools for managing agent's internal reasoning state
- `ShortTermMemoryRegistry` for memory item lifecycle management
- `summarize_sandwich` tool for context compression using sandwich strategy

### Changed
- `SessionManager` — Core ReAct runtime integration entry point, now integrated with logging.
- `OpenAICompatibleAdapter` — Reference adapter for OpenAI, now integrated with logging.

### Added (Core)
- `OpenAICompatibleAdapter` — Reference adapter for OpenAI and standard API-compatible providers.
- `ContextManager` — Core context logic coordinating multiple string reduction behaviors.
- `SandwichCompressionStrategy` — Strategy for preserving recency and foundation context.
- `HistoryCompressionStrategy` — Strategy for compressing history via summarization.
- `SessionManager` — Core ReAct runtime integration entry point.
- `ToolRegistry` — Standardized tooling implementation.
- `SkillInjector` — Advanced dynamic system prompting mechanism.
- `ToolResponseProcessor` — Evaluates and handles heavy responses.
- `ContinuationPlanner` — Multi-step sequential tool handling abstraction.
- `InMemoryRAGAdapter` — Minimal in-memory document ingestion/query layer.
