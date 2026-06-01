# Project Graph Memory Kit

简称可以叫：

**PGM / GraphMemo / Agent Project Memory / `.pmem`**

它不是普通 docs，而是一个给任意 Agent 使用的：

> **模块化图记忆层 + skills 使用说明 + CLI 快速回忆工具 + 溯源证据系统**

目标是让 Agent 在任何项目里用极少 token 获得三件事：

1. **我在哪个项目里？**
2. **当前项目状态是什么？**
3. **下一步最应该做什么？为什么？证据在哪？**

---

# 一、核心 Super Idea：不要让 Agent 读 docs，让 Agent 读"记忆图索引"

传统方式是：

```txt
Agent -> 读取 README / docs / changelog / issue / 代码 -> 自己总结
```

问题是 token 消耗大，而且每个 Agent 理解不稳定。

你要做的是：

```txt
Agent -> 读取 .pmem/index.md
      -> 根据任务类型按需读取记忆卡片
      -> CLI 查询相关节点和证据
      -> 回写进度与决策
```

---

# 二、修订后的目录结构

```txt
.pmem/
  manifest.yml

  index.md
  state.md
  next.md

  modules/
  features/
  decisions/
  tasks/
  traces/
  summaries/

  skills/
    recall.md
    code-task.md
    architecture-task.md
    update.md

  indexes/
    graph.json
    bm25.json

  integrations/
    claude-code/
      CLAUDE.md
      settings.example.json
    cursor/
      rules.example.md
    codex/
      AGENTS.md

AGENTS.md
```

关键变化：

- `graph.json` 移入 `indexes/`：语义更清楚——它是派生数据，不是主数据
- 新增 `integrations/`：Agent 框架适配模板，与 `skills/` 职责分离
- `features/` 与 `modules/` 并列：功能模块的记忆粒度更细

---

# 三、第一条架构原则：Markdown 记忆卡片是单一真相来源

> **`.md` 记忆卡片是 Source of Truth，`graph.json` 是派生索引 / 缓存。**

```txt
.pmem/**/*.md          主数据
.pmem/indexes/         派生缓存
.pmem/index.md         人类/Agent 入口摘要，可由主数据辅助生成
```

禁止手动编辑 graph.json，它随时可以 `rm` 后重建。

## 6 条设计规则

```txt
Rule 1: Markdown memory cards are the source of truth.
Rule 2: Graph indexes are generated caches.
Rule 3: pmem ask must be explainable and graph-guided.
Rule 4: Agent update must not rely only on instruction; provide hooks and verification.
Rule 5: Graph storage must be abstracted and migration-ready.
Rule 6: AGENTS.md is entry instruction; skills are pmem workflows; integrations are framework adapters.
```

---

# 四、`.pmem/index.md`：Agent 的最小入口

这个文件应该极短，控制在 300 到 800 tokens。

```md
# Project Memory Index

## Project
Name: StockBro
Type: AI trading assistant / backtest sandbox
Stage: MVP architecture design

## Current Focus
Build a backtest sandbox that allows agents to test strategies in a simulated trading environment.

## Read First
- .pmem/state.md
- .pmem/next.md
- .pmem/modules/agent_runtime.md
- .pmem/modules/backtest_sandbox.md

## Stable Decisions
- Backtest is designed as agent virtual practice environment.
- Agent should not directly mutate core trading state.
- Data source layer must be abstracted.

## Current Risks
- Product value may become too technical.
- Backtest system may become over-engineered before MVP.

## CLI
Use:
pmem recall
pmem next
pmem trace backtest_sandbox
pmem ask "how does the agent use sandbox?"
```

---

# 五、记忆卡片格式

每个记忆卡片是结构化 Markdown，以 frontmatter 存储机器可读 metadata。

```md
---
id: module.backtest_sandbox
type: module
status: designing
priority: high
tags:
  - backtest
  - agent
  - sandbox
aliases:
  - 回测沙盒
  - virtual practice environment
related:
  - module.agent_runtime
  - decision.agent_tool_boundary
depends_on:
  - module.market_data
updated: 2026-05-20
last_verified: 2026-05-20
freshness:
  ttl: 14d
  policy: verify_on_related_code_change
source_files:
  - src/backtest/sandbox.ts
---

# Backtest Sandbox

## One-liner
A simulated trading environment for agents to test trading strategies safely.

## Responsibilities
- Load historical market data.
- Run strategy simulation.
- Record agent actions.
- Produce evaluation metrics.

## Non-goals
- Real-money trading.
- Broker integration.
- High-frequency execution.

## Current State
Architecture not finalized.

## Next Step
Design minimal sandbox API:
- reset()
- step(action)
- evaluate()
- export_report()

## Evidence
- User discussed making backtest a virtual practice sandbox for agents.
- Related code: `src/backtest/`
```

关键字段：

- `aliases`：中文/英文/术语切换时的命中关键
- `freshness`：过时检测的 TTL 和触发策略
- `source_files`：关联的代码文件，变更时自动标记记忆可能过期
- `last_verified`：最后一次人工/Agent 确认此记忆仍然准确的时间

---

# 六、图索引结构：Node + Edge + Evidence

```json
{
  "kind": "pmem.graph_index",
  "pmem_version": "0.1.0",
  "generated_at": "2026-05-20T12:00:00Z",
  "source": {
    "type": "markdown_frontmatter",
    "glob": ".pmem/**/*.md",
    "source_hash": "sha256:xxxx"
  },
  "node_count": 128,
  "edge_count": 392,
  "nodes": [
    {
      "id": "module.backtest_sandbox",
      "type": "module",
      "title": "Backtest Sandbox",
      "status": "designing",
      "file": ".pmem/modules/backtest_sandbox.md",
      "tags": ["backtest", "agent", "sandbox"]
    }
  ],
  "edges": [
    {
      "from": "module.backtest_sandbox",
      "to": "module.agent_runtime",
      "type": "related"
    },
    {
      "from": "module.backtest_sandbox",
      "to": "module.market_data",
      "type": "depends_on"
    }
  ]
}
```

边分为三类：

1. **显式边**：来自 frontmatter 的 `depends_on`、`related` 等字段（人工确认的高质量边）
2. **推导边**：从字段自动推导，如 `type: task + module: module.X → belongs_to → module.X`
3. **弱关联边**：由 tags / mentions 推导，标记 confidence（v0.2+）

节点类型：`project | module | feature | task | decision | risk | assumption | constraint | person | resource | file | doc | trace`

边类型：`depends_on | blocks | implements | constrains | decided_by | derived_from | related_to | supersedes | conflicts_with | next_step_of`

---

# 七、`pmem ask`：可解释的图引导召回

`pmem ask` 不伪装成 AI 问答。它是**多阶段可解释召回器**。

## 流程

```txt
Input Query
   ↓
Normalize query
   ↓
Step 1: Exact match (id / title / alias / tag)
   ↓
Step 2: Graph expansion (depends_on / constrained_by / implements / related / next_step_of)
   ↓
Step 3: Keyword fallback (title / summary / headings / BM25)
   ↓
Rank by: match type → graph distance → priority → status → updated_at
   ↓
Return: summary + matched nodes + expanded nodes + recommended files + evidence paths
```

## 输出示例

```txt
Query: 节点 CRUD 下一步怎么做？

Matched:
- feature.node_crud by alias: "节点 CRUD"

Expanded:
- module.persistence via depends_on
- decision.sqlite_for_v04 via constrained_by
- task.implement_node_repository via next_step_of

Recommended Read:
1. .pmem/features/node_crud.md
2. .pmem/modules/persistence.md
3. .pmem/decisions/2026-05-20-sqlite-for-v04.md
4. .pmem/tasks/implement_node_repository.md
```

每条结果标注匹配路径（"Matched by alias" / "Expanded by depends_on" / "Fallback by keyword"），让 Agent 能判断召回质量。

---

# 八、记忆更新的四级模式

记忆更新不是全有或全无。分成四个层级：

### 1. `pmem mark-dirty`

只标记状态可能过期，不写 trace。

```bash
pmem mark-dirty --reason code_changed
```

### 2. `pmem update --auto`

自动检测变化，生成候选项但不直接写入。

```bash
pmem update --auto
```

### 3. `pmem update --confirm`

经确认后写入 state.md / next.md / traces / module cards / indexes。

### 4. `pmem update --force`

明确强制写入（适合高级 Agent 或人类）。

---

## trace 写入标准

只有满足以下任一条件才写 trace：

```txt
产生新决策
完成一个任务
改变模块边界
发现重要风险
验证或推翻一个假设
实现了影响后续开发的接口
修复了关键 bug
用户明确要求记录
```

不应该写 trace：简单重命名、格式化、无结论探索、临时 debug、失败的短尝试、微小重复修改。

---

# 九、`pmem verify`：一致性检查

`verify` 检查 index 是否与主数据一致。任何不一致，修复方式永远是 `pmem rebuild`，不是手改 index。

```txt
Memory Verify Result: Failed

Issue:
- indexes/graph.json is stale.
- Source cards changed after the graph index was generated.

Do not edit the index manually.

Fix:
  pmem rebuild
```

`--fix` 标志自动执行 rebuild + verify。

---

# 十、记忆新鲜度与过时检测

每张卡片携带 freshness metadata，`verify` 检查相关代码变更后是否应更新记忆：

```txt
Potential stale memory:
- module.backtest_sandbox.md
  Reason: source file src/backtest/sandbox.ts changed after last_verified.
  Fix:
    pmem update module.backtest_sandbox
```

---

# 十一、`pmem distill`：从流水到沉淀（v0.2）

`distill` 是 pmem 长期不衰减的关键机制。它做 4 件事：

```txt
1. 从 traces 中抽取稳定事实
2. 更新 module / decision / task 卡片
3. 压缩或归档旧 trace
4. 标记过时记忆
```

trace frontmatter 携带 `distilled: false` 标记，蒸馏后改为 `distilled: true` 并记录蒸馏目标。

---

# 十二、`AGENTS.md`、`skills/`、`integrations/` 的层级关系

```txt
Agent 框架入口文件
  ↓
AGENTS.md / CLAUDE.md / Cursor Rules
  ↓
告诉 Agent 使用 pmem
  ↓
pmem recall / pmem ask
  ↓
按需读取 .pmem/skills/
  ↓
按需读取 .pmem/modules / decisions / tasks
```

- **`AGENTS.md`**：顶层入口，告诉 Agent "本项目使用 pmem，启动时先跑 pmem recall"
- **`.pmem/skills/`**：pmem 内部任务流程说明（recall、code-task、architecture-task、update）
- **`.pmem/integrations/`**：各 Agent 框架的适配模板（Claude Code、Cursor、Codex 等）

---

# 十三、修订后的 `manifest.yml`

```yml
version: 0.2
pmem_version: "0.1.0"

project:
  name: StockBro
  language: zh-CN

source_of_truth:
  type: markdown_cards
  path: ".pmem"
  card_globs:
    - ".pmem/modules/**/*.md"
    - ".pmem/features/**/*.md"
    - ".pmem/decisions/**/*.md"
    - ".pmem/tasks/**/*.md"
    - ".pmem/traces/**/*.md"

indexes:
  path: ".pmem/indexes"
  generated: true
  graph:
    mode: single
    path: ".pmem/indexes/graph.json"
  keyword:
    mode: bm25
    path: ".pmem/indexes/bm25.json"

auto_update:
  enabled: true
  on_code_change: mark_dirty
  on_doc_change: mark_dirty
  on_memory_change: rebuild_indexes
  on_session_end: prompt
  on_git_commit: suggest_trace
  min_trace_interval: 30m
  max_auto_traces_per_day: 5
  ignore_patterns:
    - "node_modules/**"
    - "dist/**"
    - "build/**"
    - "*.lock"
    - "*.log"
  trace_policy:
    require_meaningful_change: true
    require_summary: true
    require_related_node: true

distill:
  enabled: true
  cadence: weekly
  max_undistilled_traces: 20
  group_by:
    - related
    - module
    - task
  output:
    update_cards: true
    update_summaries: true
    archive_traces: false
  require_confirmation: true

freshness:
  default_ttl: 14d
  stale_on_related_code_change: true
  require_last_verified: true

integrations:
  active:
    - claude-code

  claude-code:
    template_version: "0.2"
    files:
      - "CLAUDE.md"
      - ".claude/settings.json"
    hooks:
      on_edit: "pmem mark-dirty --reason code_changed"
      on_stop: "pmem update --auto --mode=suggest"

concurrency:
  lock: file
  lock_path: ".pmem/.lock"
  timeout: 5s
```

---

# 十四、三层记忆压缩

## 第一层：Hot Memory

Agent 每次都读，极短。

```txt
.pmem/index.md
.pmem/state.md
.pmem/next.md
```

控制在 1000 到 2000 tokens。

## 第二层：Warm Memory

按需读取。

```txt
.pmem/modules/*.md
.pmem/decisions/*.md
.pmem/tasks/*.md
```

只有相关时才读。

## 第三层：Cold Memory

只做溯源，不默认读取。

```txt
.pmem/traces/*.md
.pmem/archive/*.md
.pmem/summaries/*.md
```

除非 Agent 需要查"为什么"，否则不读。

---

## Token Budget Aware Recall

```bash
pmem recall --budget 800
pmem recall --budget 2000
pmem recall --budget 5000
```

不同预算输出不同层级的内容。

---

# 十五、核心命令体系

```bash
pmem init              # 初始化项目记忆
pmem recall            # 快速回忆项目
pmem next              # 只看下一步
pmem ask               # 图引导召回
pmem related           # 图谱邻居查询
pmem trace             # 溯源
pmem update            # 更新记忆（分级：mark-dirty / auto / confirm / force）
pmem mark-dirty        # 标记状态可能过期
pmem rebuild           # 从主数据重建所有索引
pmem verify            # 一致性/新鲜度/集成检查
pmem distill           # 长期记忆蒸馏（v0.2）
pmem integration       # Agent 框架适配管理
```

---

# 十六、数据流总结

```txt
写入：
用户 / Agent 修改项目
        ↓
pmem mark-dirty（检测变化）
        ↓
pmem update --confirm（确认后写入 .md 记忆卡）
        ↓
pmem rebuild（解析 frontmatter，重建 indexes）
        ↓
pmem verify（检查一致性）

读取：
pmem recall / ask / related（使用 indexes）
        ↓
返回最小上下文包
```

一句话：

> **写入走 Markdown，读取走 Index。**

---

# 十七、开发路线

## v0.1：可用

```txt
pmem init
pmem recall
pmem ask（精确匹配 + 图邻居 + BM25 兜底）
pmem related
pmem trace
pmem update（mark-dirty / auto / confirm / force）
pmem rebuild
pmem verify
pmem integration（list / install / verify）
```

技术栈：Node.js / TypeScript，文件系统 + frontmatter + JSON graph。

## v0.2：可持续

```txt
pmem distill（trace → card 蒸馏）
stale memory detection
trace 噪音控制
token-budget recall
graph 分片存储
integration hooks
```

## v0.3：更智能

```txt
embeddings / semantic search
sqlite graph index
incremental rebuild
memory quality scoring
pmem serve（HTTP API / MCP Server）
```

---

# 十八、核心定位

> **面向 AI Agent 的图结构项目记忆运行时。**

不是智能文档系统，不是知识库，而是：

> **低 token、可溯源、可恢复状态的 Agent 项目记忆协议。**

它的核心交互不是"读文档"，而是：

```txt
恢复状态 -> 查找相关记忆 -> 溯源依据 -> 规划下一步 -> 回写记忆
```

---

# 十九、解决问题的清单

```txt
Agent 经常忘记项目背景         → pmem recall
Agent 每次都重复理解代码       → 按需读取 warm memory
Agent 容易推翻之前决策         → decisions/ + trace 溯源
Agent 不知道下一步做什么       → pmem next
Agent 读取上下文 token 消耗大  → token-budget recall + 三层记忆
项目长期演进缺少可溯源记忆     → traces + distill
记忆过时无人发现               → freshness detection + pmem verify
```
