# pmem — Product Requirements Document

## 一、产品概述

### 1.1 产品名称

**pmem**（Project Memory for Agents）

备选：GraphMemo / PGM / Agent Project Memory

### 1.2 一句话描述

面向 AI 编码 Agent 的低 token、可溯源、图结构项目记忆协议与 CLI 运行时。

### 1.3 产品定位

pmem 不是知识库，不是文档系统，不是代码扫描器。它是一个**项目记忆运行时**：

```
传统：Agent → 读代码/文档 → 自己总结 → 高 token、不稳定
pmem：Agent → 读 .pmem/index.md → 按需查图谱 → 回写记忆 → 低 token、可溯源
```

### 1.4 核心价值主张

让任何 AI coding agent 进入项目时，以最少 token 获得三件事：
1. **我在哪个项目里？**（项目名、阶段、当前关注点）
2. **当前项目状态是什么？**（模块状态、活跃任务、最近决策）
3. **下一步最应该做什么？为什么？证据在哪？**（next step + 溯源链）

---

## 二、目标用户

### 2.1 主要用户

| 用户 | 场景 | 核心需求 |
|------|------|---------|
| AI Coding Agent（Claude Code、Cursor、Codex 等） | 进入项目开始工作 | 快速恢复上下文，找到相关记忆，知道下一步做什么 |
| 个人开发者 | 自己用 AI 辅助开发 | 让 Agent 记住项目演进过程，避免反复解释 |
| 小型开发团队 | 多人 + 多 Agent 协作 | 共享项目记忆，决策可溯源 |

### 2.2 用户痛点

| 痛点 | pmem 解法 |
|------|----------|
| Agent 每次都要重新理解项目 → token 浪费 | `pmem recall --budget 2000` |
| Agent 容易推翻之前决策 | `decisions/` + `pmem trace` |
| Agent 不知道下一步做什么 | `pmem next` |
| 项目长期演进后记忆丢失 | `.pmem/traces/` + `pmem distill` |
| 不同 Agent 框架接入方式不统一 | `integrations/` + `AGENTS.md` |
| 记忆过时无人发现 | `pmem verify` + freshness detection |

---

## 三、核心协议

### 3.1 记忆存储层级

```
Hot Memory（每次必读）：
  .pmem/index.md + state.md + next.md
  ～1000–2000 tokens

Warm Memory（按需读取）：
  .pmem/modules/ + decisions/ + tasks/
  按任务类型召回

Cold Memory（溯源用）：
  .pmem/traces/ + summaries/
  不默认读取
```

### 3.2 数据模型

**节点类型：** project | module | feature | task | decision | risk | assumption | constraint | trace

**边类型：** depends_on | blocks | implements | constrains | decided_by | derived_from | related_to | supersedes | conflicts_with | next_step_of

**核心原则：** Markdown 记忆卡片是单一真相来源，JSON/SQLite 索引是派生缓存。

### 3.3 记忆卡片格式

每张卡片 = YAML frontmatter（机器可读 metadata）+ Markdown 正文（人类和 Agent 可读）

```md
---
id: module.backtest_sandbox
type: module
schema_version: "0.2"
status: designing
tags: [backtest, agent]
aliases: [回测沙盒]
depends_on: [module.market_data]
related: [decision.agent_tool_boundary]
updated: 2026-05-20
---

# Backtest Sandbox

## One-liner
...
```

---

## 四、功能需求

### 4.1 v0.1 — 核心闭环 ✅

| 需求 | 优先级 | 状态 |
|------|--------|------|
| 项目初始化（`pmem init`） | P0 | ✅ |
| 图索引构建（`pmem rebuild`） | P0 | ✅ |
| 项目回忆（`pmem recall --budget N`） | P0 | ✅ |
| 图引导召回（`pmem ask`） | P0 | ✅ |
| 图谱查询（`pmem related`） | P0 | ✅ |
| 溯源追踪（`pmem trace`） | P0 | ✅ |
| 一致性检查（`pmem verify`） | P0 | ✅ |
| 记忆更新（`pmem update` 四级） | P0 | ✅ |
| 脏标记（`pmem mark-dirty`） | P0 | ✅ |
| 框架适配（`pmem integration`） | P1 | ✅ |

### 4.2 v0.2 — 文件模式可信

| 需求 | 优先级 | 说明 |
|------|--------|------|
| 交互式冷启动（`pmem init --guided`） | P0 | 问 3 个必填字段，生成可用初始记忆 |
| 保守项目扫描 + candidates | P0 | 扫描不自动确认，候选进入 `candidates/` |
| `memory_incomplete` 降级模式 | P0 | 空 pmem 时明确告知 Agent 记忆不完整 |
| schema 版本管理 | P0 | manifest + 每张卡片带 `schema_version` |
| 迁移命令（`pmem migrate`） | P0 | dry-run + 执行 + 自动备份 |
| 版本兼容检查（`pmem verify` 增强） | P0 | CLI vs 项目 schema 版本对比 |
| atomic write | P0 | .tmp → fsync → rename，防止半写损坏 |
| 简单 file lock | P0 | `.pmem/.lock`，超时 3s，默认 abort |
| `memory_status` 追踪 | P1 | completeness + initialized_mode 字段 |
| card_policy 校验 | P1 | ID 命名规范 + 大小阈值 + verify 警告 |
| trace → card 蒸馏（`pmem distill` 初版） | P1 | 建议模式，需确认，不自动写 |
| 卡片拆分建议（`pmem distill --suggest-splits`） | P1 | 检测过大卡片，建议拆分 |
| 声明式初始化（`pmem init --from`） | P2 | 可延后 |
| section-level merge（`pmem update --merge`） | P2 | 可延后 |
| 完整乐观锁 + card_hashes.json | 不做 | 留给 v0.3 SQLite |

### 4.3 v0.3 — SQLite 运行时

| 需求 | 优先级 | 说明 |
|------|--------|------|
| SQLite 数据库（`.pmem/pmem.db`） | P0 | 存 cards、edges、aliases、tags、tasks、traces、sessions、dirty_flags、update_log |
| SQL-backed recall / ask / related | P0 | 替代 JSON 遍历 |
| transaction-based update | P0 | 原子写入卡片 + 索引 |
| 乐观锁（SQLite 层） | P0 | 替代 card_hashes.json |
| incremental rebuild | P1 | 只重建变更部分 |
| `pmem serve` 原型 | P1 | HTTP API |
| semantic search / embeddings | P2 | 可选 |

### 4.4 v0.4 — Agent 集成 & 自动化

| 需求 | 优先级 | 说明 |
|------|--------|------|
| Claude Code hooks 模板 | P0 | PostToolUse / Stop hooks |
| Cursor rules 完整版 | P0 | `.cursor/rules/pmem.mdc` |
| Codex / OpenClaw 适配 | P1 | AGENTS.md / skill 模板 |
| `pmem update --auto --mode=suggest` 增强 | P0 | 智能变更检测 |
| session tracking | P1 | Agent 会话起止 + 操作摘要 |
| distill 工作流优化 | P1 | 定期自动建议蒸馏 |
| stale memory detection | P1 | 基于 source_files 变更 |

### 4.5 v0.5 — 可上线 Beta

| 需求 | 优先级 | 说明 |
|------|--------|------|
| `npm install -g pmem` 一键安装 | P0 | |
| SQLite 默认开启 | P0 | 新项目默认 SQLite，文件模式兼容 |
| 完整体验的 `pmem init --guided` | P0 | 引导 → 首个项目跑通 |
| 完整使用文档 | P0 | 使用指南 + CLI 参考 + 集成教程 |
| demo 项目 | P0 | 开箱即用示例 |
| `pmem backup` / `pmem restore` | P1 | |
| 可选遥测 | P2 | opt-in |

---

## 五、技术架构

### 5.1 技术栈

| 层次 | v0.1–v0.2 | v0.3+ |
|------|-----------|-------|
| 语言 | TypeScript (strict) | TypeScript (strict) |
| CLI 框架 | Commander | Commander |
| 主数据存储 | Markdown + YAML frontmatter（文件系统） | 同左 |
| 索引存储 | JSON files | SQLite |
| 运行环境 | Node.js ≥18 | Node.js ≥18 |

### 5.2 项目记忆目录结构

```
.pmem/
  manifest.yml                 # 配置中心
  index.md / state.md / next.md  # Hot Memory
  modules/ / features/ / decisions/ / tasks/ / traces/ / risks/  # 记忆卡片
  candidates/                  # 冷启动扫描候选（v0.2+）
  indexes/                     # 派生索引（v0.2 JSON → v0.3 SQLite）
  skills/                      # Agent 操作手册
  integrations/                # 框架适配模板
  backups/ / migrations/       # 迁移基础设施（v0.2+）
  pmem.db                      # SQLite 数据库（v0.3+）
```

### 5.3 CLI 命令全集

```
pmem init [--guided] [--from <file>]
pmem recall [--budget <tokens>]
pmem next
pmem ask <query>
pmem related <id>
pmem trace <id>
pmem update [--auto|--confirm|--force]
pmem mark-dirty [--reason <reason>]
pmem rebuild
pmem verify [--fix] [--report]
pmem distill [--suggest-splits]
pmem migrate [--dry-run] [--to <version>] [--backup]
pmem integration [list|install|verify] [<framework>]
pmem lock status
pmem backup
pmem restore
pmem serve                 # v0.3+
```

---

## 六、关键设计原则

1. **Markdown 是主数据，索引是缓存。** 索引随时可重建。
2. **召回必须可解释。** `pmem ask` 输出必须标注匹配路径（exact / alias / graph / fallback）。
3. **更新分级，不无脑写。** mark-dirty → auto → confirm → force。
4. **版本可迁移。** schema_version 从 v0.2 开始强制执行。
5. **文件不写坏。** atomic write 从 v0.2 开始强制执行。
6. **AGENTS.md 是入口，skills/ 是流程，integrations/ 是适配器。**
7. **模块粒度以概念/责任边界为主，代码目录为辅。**

---

## 七、成功指标

### v0.2 完成标准

- [ ] `pmem init --guided` 能在 3 个问答内让 Agent 获得可用的初始上下文
- [ ] v0.1 项目能通过 `pmem migrate --to 0.2` 完成迁移
- [ ] `pmem verify` 能检测 schema_version 不匹配和 card_policy 违规
- [ ] 并发写入时不会损坏文件（lock abort + atomic write）
- [ ] distill 能正确建议将 trace 蒸馏到已有 card

### v0.5 完成标准

- [ ] 新用户能在 2 分钟内完成 `npm install -g pmem` + `pmem init --guided`
- [ ] 已有 v0.1/v0.2 项目能平滑迁移至 v0.5
- [ ] Claude Code / Cursor 用户能通过 integration 模板一键接入
- [ ] Agent 首次进入项目时 token 消耗 ≤ 2000（recall --budget 2000）
- [ ] `pmem ask` 召回命中率 ≥ 70%（在 50+ 张卡片的项目中）

---

## 八、竞争与差异化

| 方案 | 问题 |
|------|------|
| 让 Agent 读 README / docs | token 大、不稳定 |
| 让 Agent 读代码 | 无上下文，容易误解 |
| 通用知识库 | 不是为 Agent 设计的，token 不可控 |
| Cursor Rules / CLAUDE.md | 只有静态指令，无图记忆、无溯源、不更新 |
| **pmem** | **图记忆 + token 预算 + 溯源 + 可更新 + 跨 Agent** |

核心差异：pmem 不是"更好的文档"，而是"Agent 的项目记忆运行时"。

---

## 九、风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 记忆过时 | Agent 基于旧事实做错决策 | freshness TTL + source_files 变更检测 + verify |
| 记忆噪音 | traces 过多，淹没信号 | trace 写入门槛 + distill 压缩 |
| 维护成本高 | 用户不更新记忆卡 | guided init + distill 建议 + mark-dirty 提醒 |
| Agent 不主动用 pmem | 工具被闲置 | AGENTS.md + hooks + integration 模板降低接入成本 |
| 跨版本迁移出错 | 用户项目记忆损坏 | dry-run + 自动备份 + 官方迁移规则内置 |
| SQLite 锁定用户 | 无法再编辑 .md 文件 | Markdown 永久保留为 canonical 主数据 |

---

## 十、未决事项

以下问题待后续版本讨论和决策：

### 技术

- [ ] v0.3 SQLite schema 详细设计（表结构、索引策略、迁移脚本）
- [ ] `pmem serve` 选择 MCP Server 还是 REST API，还是两者都做？
- [ ] embeddings 选型（本地模型 vs API？哪种最适合代码项目语义？）
- [ ] graph 分片策略——按模块？按类型？混合？
- [ ] incremental rebuild 的实现策略

### 产品

- [ ] 多项目 / monorepo / workspace 支持方案
- [ ] 记忆共享与多人协作机制
- [ ] 记忆权限模型（谁能读/写哪些卡片）
- [ ] npm 包发布策略（何时第一次 publish？scope？）
- [ ] 是否需要 VS Code / JetBrains 插件？
- [ ] telemetry 的范围、隐私策略、opt-in 机制

### 业务

- [ ] 开源协议（MIT？Apache 2.0？）
- [ ] 社区治理模型
- [ ] 文档站点与教程
- [ ] 是否需要一个"pmem registry"让团队共享记忆模板？
