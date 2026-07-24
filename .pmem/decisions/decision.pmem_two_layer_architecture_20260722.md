---
id: decision.pmem_two_layer_architecture_20260722
type: decision
title: "pmem v1.0: Two-Layer Architecture (Product + Runtime)"
status: active
tags: [positioning, two-layer, agentic-memory-runtime, sdk, software-preset]
created: "2026-07-22"
updated: "2026-07-22T00:00:00.000Z"
related_to:
  - feature.v1_0_agentic_memory_runtime_20260722
  - decision.project_rag_os_positioning_20260626
  - feature.v0_8_hybrid_recall_engine_20260626
---
# pmem v1.0: Two-Layer Architecture

## Decision

pmem v1.0 采用两层架构，取代此前的 "Project RAG OS" 定位：

```text
上层：开箱即用的项目记忆产品
下层：可嵌入的 Agentic Memory Runtime
```

普通用户和 Agent 框架依旧使用上层；需要深度开发的人才直接调用下层 SDK。

## Product Definition

### 上层（Product）
- CLI 工具（`pmem ask`, `pmem recall`, `pmem sync`, `pmem verify` 等）
- Skills 安装（`pmem install --skills --claude/--codex/--gemini`）
- MCP Server（`pmem mcp`，暴露 pmem_context / pmem_recall / pmem_ask / pmem_observe / pmem_capture / pmem_forget）
- `pmem init` 默认创建 `preset: software`，零配置

### 下层（Runtime）
- `Pmem.open({ root, preset })` — 初始化 Runtime
- Policy Engine — scope 管理、生命周期、权限规则
- Event Store — working memory + episodic capture（SQLite backed）
- Storage Providers — 默认 SQLite + Markdown，接口可替换
- Unified Query Service — CLI/MCP/SDK 三条路径共享同一核心

## Core Principles

1. **CLI 不破坏** — 现有命令继续有效，底层可重构
2. **Markdown 不破坏** — `.pmem/**/*.md` 仍是 canonical，可 Git 管理
3. **SQLite 仍可重建** — `pmem rebuild` 从 Markdown 完全重建
4. **MCP 与 SDK 同语义** — 三者调用同一核心函数
5. **默认配置保持简单** — 复杂能力渐进暴露
6. **项目记忆一等公民** — `software` preset 获得最完整支持

## Integration Depth Matrix

| 使用者 | 接入方式 | 复杂度 |
|--------|----------|--------|
| 普通开发者 | CLI + Skills | 极低 |
| 支持 MCP 的 Agent | MCP | 低 |
| Agent 框架作者 | SDK | 中 |
| 深度基础设施开发者 | Runtime / Provider API | 高 |

## What v1.0 Is NOT

- 不是泛化个人聊天记忆数据库
- 不要求普通用户理解 namespace / event store / scope inheritance
- 不强制用户从 Markdown 迁移到黑箱数据库
- 不为每个 Agent 框架单独维护一套召回和更新逻辑

## Relationship to v0.8

v0.8（Hybrid Recall Engine）是 v1.0 的关键铺垫：
- v0.8 unified query engine → v1.0 Runtime 的 query 层
- v0.8 L0-L3 分层渲染 → `memory.recall()` 的输出格式
- v0.8 explain/reasons → Runtime 召回解释接口

## Consequences

- 所有新能力（event store、policy engine、scope）通过 preset 自动配置，不暴露给终端用户
- CLI / MCP / SDK 共享 `src/core/` 下的统一实现
- `software` preset 继续作为旗舰场景，获得最完整的 Git diff / branch scope / source file 检索支持
- v0.8 → v1.0 迁移必须保证现有测试全部通过、CLI 命令行为一致
