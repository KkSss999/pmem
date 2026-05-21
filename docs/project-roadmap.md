# pmem Project Roadmap

## 产品定位

> **面向 AI Agent 的图结构项目记忆运行时。**
>
> 一个 CLI 工具 + 文件协议 + 图索引系统，让任意 AI coding agent 以极少 token 恢复项目上下文、查找相关记忆、溯源决策依据、规划下一步、回写记忆。

简称：`pmem`（Project Memory for Agents）
CLI：`pmem`

---

## 各版本主题

| 版本 | 主题 | 一句话 |
|------|------|--------|
| v0.1 | 能用 | 10 个命令跑通核心闭环（init → recall → ask → update → verify） |
| v0.2 | 文件模式可信 | 防损坏——冷启动不空、并发不丢、卡片不乱、版本可迁 |
| v0.3 | SQLite 运行时 | 强一致——查询/索引/状态迁入 SQLite，Markdown 仍为主数据 |
| v0.4 | Agent 集成 & 自动化 | 多框架适配、session 追踪、distill 工作流优化 |
| v0.5 | Productization Beta | README、npm package、E2E、错误 UX、发布清单，上线 npm Beta |
| v0.6 | Agent-native Workflow Polish | 非交互 init、友好错误、空结果引导、Claude Code slash commands |

---

## v0.1 — 能用 ✅ 已完成

**目标：** 跑通核心闭环，证明"文件模式 + 图索引 + CLI"可行。

**已实现：**

| 命令 | 功能 |
|------|------|
| `pmem init` | 生成 .pmem/ 骨架 + manifest.yml + AGENTS.md |
| `pmem rebuild` | .md frontmatter → indexes/graph.json |
| `pmem recall --budget N` | 三层 token 预算输出 |
| `pmem ask <query>` | 精确匹配 → 图邻居 → BM25 兜底 |
| `pmem related <id>` | 图邻居查询 |
| `pmem trace <id>` | 溯源 + 卡片内容 |
| `pmem verify --fix` | index 一致性检查 |
| `pmem update` | 四级更新（mark-dirty / auto / confirm / force） |
| `pmem mark-dirty` | 脏状态标记 |
| `pmem integration` | list / install / verify |

**技术栈：** TypeScript + Commander + 文件系统 + frontmatter + JSON graph

**已知限制：**
- 无并发保护
- init 只生成空骨架
- 无卡片粒度约束
- 无版本迁移能力
- YAML 解析器为最小实现

---

## v0.2 — 文件模式可信（防损坏）

**主题：** 让 pmem 在纯文件模式下变得**可初始化、可维护、可迁移**，为 v0.3 SQLite 做铺垫。

**不做：** 复杂乐观锁、hash-based merge、card_hashes.json、锁队列。这些留给 v0.3 SQLite。

### P0 — 必须完成

| 功能 | 说明 |
|------|------|
| `pmem init --guided` | 交互式冷启动，问 3 个必填（项目描述、阶段、下一步） |
| `pmem init` 增强 | 保守扫描 → `candidates/` → 标记 `memory_incomplete` |
| `pmem migrate --dry-run` | 预览迁移变更 |
| `pmem migrate --to 0.2` | 执行迁移（带自动备份到 `backups/`） |
| `pmem rebuild` 增强 | 支持 v0.2 manifest 新字段 |
| `pmem verify` 增强 | 检查 schema_version、card_policy 违规 |
| `pmem mark-dirty` 增强 | 更新 `memory_status.dirty` |
| atomic write | 所有写入：.tmp → fsync → rename |
| 简单 file lock | `.pmem/.lock`，超时 3s，默认 abort |
| manifest schema_version | `pmem.schema_version: "0.2"`，每张卡片也带 |

### P1 — 强烈建议

| 功能 | 说明 |
|------|------|
| `pmem distill` 初版 | trace → card 蒸馏建议（需确认，不自动写） |
| `pmem distill --suggest-splits` | 建议拆分过大卡片 |
| card_policy 校验 | ID 命名规范 + 大小阈值 + verify 警告 |
| memory_status | `completeness` 和 `initialized_mode` 追踪 |
| integration 模板更新 | Claude Code / Cursor / Codex 适配 |

### P2 — 可延后到 v0.3

| 功能 | 说明 |
|------|------|
| 完整乐观锁 / card_hashes.json | 由 SQLite transaction 替代 |
| `update --merge` | section-level merge |
| `pmem init --from <file>` | 声明式初始化 |
| graph 分片存储 | JSON → 多文件索引 |
| `pmem split --interactive` | 交互式拆分卡片 |

### v0.2 并发策略

```yml
concurrency:
  mode: file-basic
  atomic_write: true
  lock:
    enabled: true
    path: ".pmem/.lock"
    timeout: "3s"
    stale_after: "60s"
    on_timeout: "abort"
  optimistic_lock:
    enabled: false
    note: "Deferred to SQLite runtime in v0.3"
```

v0.2 并发目标：**文件不写坏、索引可重建、冲突时 abort 不覆盖。**

### v0.2 新增目录

```
.pmem/
+  candidates/          # 冷启动扫描候选项
+  risks/               # 风险卡片
+  backups/             # 迁移前自动备份
+  migrations/          # 项目自定义迁移（预留）
+  indexes/card_hashes.json  # P2（留给 v0.3）
+  skills/distill.md    # 蒸馏操作手册
```

---

## v0.3 — SQLite 运行时（强一致）

**主题：** 将查询、索引、状态管理迁入 SQLite。Markdown cards 继续作为 canonical 主数据。

### 核心切换

```
v0.2:  文件系统 → JSON indexes → CLI 查询
v0.3:  文件系统 → SQLite indexes → SQL 查询 → CLI
                    ↑
              Markdown cards 仍是主数据
```

### SQLite 存储内容

```txt
.pmem/pmem.db:
  cards           # 卡片元数据（id, type, title, status, file_path, hash）
  edges           # 图边
  aliases         # 别名索引
  tags            # 标签索引
  tasks           # 任务状态
  traces          # trace 元数据
  sessions        # agent session 记录
  dirty_flags     # 脏状态
  update_log      # 更新日志
  migrations_log  # 迁移历史
```

### v0.3 关键能力

| 功能 | 说明 |
|------|------|
| SQLite-backed recall | 替代 JSON 遍历 |
| SQLite-backed ask | JOIN 查询替代内存匹配 |
| SQLite-backed related | 图邻居 SQL 查询 |
| transaction-based update | 原子写入卡片 + 索引 |
| 乐观锁 | 在 SQLite 层实现 version check |
| incremental rebuild | 只重建变更部分 |
| card_hashes.json → db | 完整并发语义 |
| `pmem serve` | HTTP API / MCP Server 原型 |

### v0.3 不做的

- 不把 Markdown 全文存入数据库（保持 Git 友好）
- 不做 AI embedding / semantic search
- 不做自动 memory quality scoring

---

## v0.4 — Agent 集成 & 自动化

**主题：** 让不同 Agent 框架真正能稳定接入 pmem，自动化记忆维护流程。

| 功能 | 说明 |
|------|------|
| Claude Code hooks | PostToolUse / Stop hooks 模板 |
| Cursor rules | `.cursor/rules/pmem.mdc` 完整版 |
| Codex / OpenClaw | AGENTS.md / skill 模板 |
| `pmem update --auto --mode=suggest` | 智能检测 → 生成更新建议 |
| session tracking | 记录 Agent 会话起止、操作摘要 |
| distill 工作流优化 | 定期自动建议蒸馏 |
| stale memory detection | 基于 `source_files` 变更的过时检测 |
| integration verify 增强 | 检查各框架 hooks 是否正确安装 |

---

## v0.5 — Productization Beta ✅ 已完成

**主题：** 把 v0.4 已经跑通的 Agent Workflow Runtime 包装成一个真实项目可以安装、理解、运行、验证、反馈的 Beta CLI 产品。

| 功能 | 说明 |
|------|------|
| README / quick start | 外部用户可独立理解 pmem 并跑通 5 分钟流程 |
| npm package readiness | package metadata、bin、files、build、pack smoke |
| install smoke E2E | 验证 tarball 安装后的 `pmem` 二进制可用 |
| real workflow E2E | 覆盖 init → rebuild → recall/ask → status → mark-dirty → update → verify |
| Agent docs sync | `AGENTS.md`、`CLAUDE.md`、integration templates 统一到 v0.5 产品口径 |
| Error UX / exit code docs | 明确 workflow signal exit code，不把 exit 1 都视为失败 |
| CHANGELOG / release checklist | 支持可重复 Beta 发布 |

详细设计：`docs/v0.5 pre-design.md`

---

## v0.6 — Agent-native Workflow Polish

**主题：** 让 v0.5 已经成立的 Beta CLI 更适合 AI Agent 程序化调用、跨会话恢复、无人工兜底使用。

v0.6 不扩大能力边界，不做 embedding、MCP/REST、Graph UI、遥测或远程服务。它专注处理 v0.5 真实使用反馈中暴露出的 Agent 摩擦点。

| 功能 | 说明 |
|------|------|
| 非交互 init | `init --guided` 提供参数 / answers 文件路径，避免 Agent 卡在 TTY |
| git 前置检查 | `status` / `mark-dirty --auto` 在非 git 或 git 不可用时给友好提示 |
| 空结果引导 | `update --suggest` / `ask` 不静默返回空数组，解释下一步 |
| session 容错 UX | `session end` 未 start 时给出可操作建议，评估显式容错 option |
| Claude Code slash commands | `integration install claude-code` 生成 `.claude/commands/pmem-*.md` |
| integration verify 增强 | 检查 root files、settings、slash commands、rules 是否真实存在 |
| 全局 skills 安装 | `pmem install --skills --claude/--codex/--gemini` 一键安装到 agent skills 目录 |
| pmem doctor | 8 项诊断检查（pmem_dir/manifest/database/cards/dirty_flags/session/git/integrations） |
| Agent-native E2E | 覆盖非交互 init、integration install、空结果、非 git UX、skills install |
| 文档口径同步 | README / AGENTS / CLAUDE 解释 pmem 的跨会话价值 |

详细设计：`docs/v0.6 pre-design.md`

---

## 版本间迁移路径

```
v0.1 → v0.2:
  pmem migrate --to 0.2
  变更：manifest 加 schema_version + memory_status + card_policy
       卡片 frontmatter 加 schema_version

v0.2 → v0.3:
  pmem migrate --to 0.3
  变更：JSON indexes → SQLite db
       manifest indexes.mode: sqlite
       保留 .md 卡片不变

v0.3 → v0.4:
  pmem migrate --to 0.4
  变更：新增 sessions table
       新增 update_log table
       manifest integrations 扩展

v0.4 → v0.5:
  无强制 memory schema migration
  变更：README / package / E2E / agent docs / release checklist 产品化

v0.5 → v0.6:
  无强制 memory schema migration
  变更：非交互 init、Agent integration 文件、错误 UX、空结果引导
```

每次迁移自动备份到 `.pmem/backups/YYYY-MM-DD-before-vX.Y/`。

---

## 总览

```
v0.1 ───→ v0.2 ───→ v0.3 ───→ v0.4 ───→ v0.5 ───→ v0.6
能用      防损坏    强一致    自动化    Beta上线  Agent原生
10 cmd    14 cmd    16 cmd    18 cmd    产品化    低摩擦
文件模式   文件模式   +SQLite   +集成     +体验     +程序化调用
```

---

## 当前状态

- **v0.1:** ✅ 完成（10 个命令实现并测试）
- **v0.2:** ✅ 完成（文件模式可信）
  - 设计决策：`docs/v0.2 pre-design.md`
  - 架构规划：`docs/v0.2 pre-roadmap.md`
- **v0.3:** ✅ 完成（SQLite runtime）
  - 设计决策：`docs/v0.3 pre-design.md`
- **v0.4:** ✅ 完成（Agent workflow runtime）
  - 设计决策：`docs/v0.4 pre-design.md`
  - handover：`docs/handover-v0.4.md`
- **v0.5:** ✅ 完成并上线 npm（Productization Beta）
  - 设计决策：`docs/v0.5 pre-design.md`
  - 发布清单：`docs/release-checklist-v0.5.md`
- **v0.6:** 📋 设计完成，待开工（Agent-native Workflow Polish）
  - 设计决策：`docs/v0.6 pre-design.md`

---

## 未决事项

以下问题留待后续版本讨论：

- MCP Server vs HTTP API 的选择
- 多项目 / workspace 支持
- 记忆共享与协作机制
- 记忆权限模型
- 多语言 CLI 支持
- telemetry 的范围和隐私策略（v0.6 继续不做）
- 是否支持嵌入到 VS Code / JetBrains 插件
