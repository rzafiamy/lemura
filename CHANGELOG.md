# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
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
