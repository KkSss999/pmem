---
id: feature.v1_0_agentic_memory_runtime_20260722
type: feature
title: "v1.0 Agentic Memory Runtime"
status: completed
tags: [v1.0, agentic-memory-runtime, two-layer, sdk, mcp, software-preset, released]
created: "2026-07-22"
updated: "2026-07-22T11:30:00.000Z"
last_verified: "2026-08-03T08:33:45.574Z"
source_files:
  - .pmem/manifest.yml
  - src/runtime/index.ts
  - src/sdk/index.ts
  - src/mcp/server.ts
depends_on:
  - decision.pmem_two_layer_architecture_20260722
related_to:
  - feature.v0_8_hybrid_recall_engine_20260626
  - decision.pmem_rt_v1_thin_mcp_adapter_20260606
  - feature.v1_1_system_memory_release_20260722
classification: plan
trust_label: user_confirmed
sensitivity: internal
---

# v1.0 Agentic Memory Runtime

## Goal

将 pmem 拆分为两层架构：

- **上层**：开箱即用的项目记忆产品（CLI + Skills + MCP），普通用户和 Agent 框架依旧使用
- **下层**：可嵌入的 Agentic Memory Runtime（SDK / Runtime API），供深度开发者和 Agent 框架作者直接调用

关键约束：**v1.0 必须保证它仍然比现在更方便地作为各类 Agent 框架的项目记忆使用。**

## Two-Layer Architecture

```
上层（Product）: CLI + Skills + MCP
  → pmem init / pmem ask / pmem recall / pmem sync / pmem verify
  → 零配置，software preset 开箱即用
  → 普通开发者 + Agent 框架的直接入口

下层（Runtime）: SDK / Runtime API
  → Pmem.open({ root, preset }) → memory.ask() / memory.observe() / memory.recall()
  → Policy engine, scope management, event store, storage providers
  → Agent 框架作者和深度基础设施开发者的编程入口
```

## Capabilities

### Runtime Core
- `Pmem.open()` — 初始化 Runtime，加载 preset 配置
- `memory.context()` — 恢复项目上下文（task-aware）
- `memory.ask()` — 结构化查询（统一 CLI/MCP/SDK）
- `memory.recall()` — 分层召回（L0-L3）
- `memory.observe()` — 观察变更，自动决定 scope 和 trace
- `memory.capture()` — 捕获记忆（去重、确认、蒸馏）
- `memory.forget()` — 安全移除记忆
- `memory.endSession()` — 结束会话，自动生成 trace

### Preset System
- `software` — 官方旗舰预设（Git diff 感知、branch scope、source file 检索）
- `research` — 研究项目预设
- `novel` — 小说创作预设
- 自定义 preset 机制

### Integration Depths
1. **零代码**：Skills / Rules（pmem install --skills）
2. **标准协议**：MCP（pmem mcp）
3. **深度嵌入**：SDK（Pmem.open()）

## Acceptance

| # | Criteria | Status |
|---|----------|--------|
| 1 | 现有 CLI 命令全部保留，行为一致 | ✅ |
| 2 | `.pmem/**/*.md` 仍是可读、可编辑、可 Git 管理的 canonical 数据 | ✅ |
| 3 | SQLite 仍是运行时状态，`pmem rebuild` 可完全从 Markdown 重建 | ✅ |
| 4 | CLI / MCP / SDK 三者调用同一核心函数 | ✅ |
| 5 | `pmem init` 默认创建 software preset，零配置 | ✅ |
| 6 | 新 Runtime 能力不暴露给终端用户 | ✅ |
| 7 | 所有现有测试通过（310/310），E2E 全绿，CI 全绿 | ✅ |
| 8 | SDK 类型完整导出（AskResult, RecallResult, CaptureResult, 等） | ✅ |
| 9 | MCP 工具 schema 加固（additionalProperties: false, 路径校验） | ✅ |
| 10 | 独立 SQLite 实例 + 多实例隔离验证 | ✅ |
| 11 | cross-CWD Runtime root 隔离验证 | ✅ |
| 12 | branch-aware working events 验证 | ✅ |

## Release

- **PR**: [#15](https://github.com/KkSss999/pmem/pull/15) — merged 2026-07-22T11:30 UTC
- **Post-merge fixes**: commit `a439d2d` — SDK type exports, MCP security hardening, CLI robustness
- **Next**: v1.1 System Memory release (see [[feature.v1_1_system_memory_release_20260722]])
