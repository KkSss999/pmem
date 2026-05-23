---
id: trace.pmem_feedback_0_6_1
type: trace
tags: [pmem, feedback, developer-letter]
---
# 给 pmem 开发者的一封信

我是 pmem 0.6.1 的真实重度用户。在 voxo v1.0（一个从零到发布的跨平台 CLI 项目）的完整开发周期中，pmem 是我们唯一的项目记忆系统。25 张卡片，27 条追踪记录，跨越 2 天密集开发，最后 pmem verify 100/100。

下面是我实战后的真实感受。

---

## 一、做得最好的地方

### 1）Markdown 卡片作为唯一真相源

这是 pmem 最核心的正确设计。卡片是普通的 `.md` 文件，带 YAML frontmatter，放在 `.pmem/` 下面。这意味着：

- **Git 友好**：改了什么一目了然，可以 diff、可以 blame、可以 revert
- **工具无关**：不需要 pmem CLI 也能读——任何编辑器打开 `.pmem/decisions/v1_product_contract.md` 就能看懂
- **不会丢数据**：SQLite 是重建索引，不是主存储。误删 `.pmem/pmem.db` 跑 `pmem rebuild` 就恢复

对比市面上那些把知识锁在数据库里、导出还要跑命令的工具，这个设计选择是决定性的。

### 2）卡片类型设计恰到好处

`decision`、`module`、`task`、`feature`、`risk`、`trace` 六种类型刚好覆盖项目管理需要的所有维度，不会少也不会多到让人选择困难。

尤其是 `trace`——把每一次 `pmem update --confirm` 自动生成一条追踪记录，这个设计让"谁在什么时候做了什么决策"变得可追溯。我们的 27 条 trace 就是项目的完整开发日志。

### 3）`pmem ask` 的语义搜索

不是简单的关键词匹配。问 "MLX only Mac rework" 能匹配到 `decision.mlx_only_mac`，还能沿着 `depends_on` 图展开关联的决策和模块。这个图展开能力在实际使用中比我想象的有用——很多时候我要找的不是一个孤立的决定，而是一个决策链。

### 4）Claude Code 集成的开箱体验

`pmem integration install claude-code` 自动生成了 CLAUDE.md、AGENTS.md 和 4 个 slash 命令。新的 agent 进来两条命令就能恢复全部上下文。这个集成做得很好——不需要手动配置 hook，不需要研究 Claude Code 的 settings.json 格式。

---

## 二、实际使用中遇到的痛点

这些不是 bug，是设计和体验层面的问题。按对我工作的影响程度排序：

### 1）SQLite 锁竞争——最影响效率的问题

在我们的开发过程中，`pmem update --confirm` 至少失败了 3 次，报 `Failed to acquire pmem lock`。问题在于：

- 没有命令能查看当前谁持有锁
- 没有命令能强制释放锁
- 锁文件不在 `.pmem/` 下面，无法手动清理
- 错误消息没有给出解决建议

最后我是靠 `pmem rebuild --full` 解决的问题。但对于普通用户来说，看到这个错误的第一反应是"坏了，数据会不会丢"。

**建议**：
- 给 `pmem verify` 加一个 `--fix-locks` 选项
- 锁超时后自动释放，加一个 `--lock-timeout` 参数
- 错误消息里给出排查步骤

### 2）卡片大小限制过于激进

`task` 卡片 600 token 上限、`decision` 卡片 800 token 上限，我在写 v1.0 分 P 计划时被 `pmem verify` 打了两次 `card_too_large` 警告。

问题是：有些决策确实需要详细说明（背景、选项对比、后果分析），强行拆分到多个卡片会破坏阅读连贯性。而且 `pmem verify` 只是 warn 不是 error，说明你们也知道这个限制在实际使用中会被突破。

**建议**：
- 把大小限制从硬编码常量改为可配置项（`.pmem/config.yml`）
- 或者提供 `--relaxed` 模式，放宽到 1200/1500 token
- 或者让 `pmem distill --suggest-splits` 真正可用（目前这个命令存在但我不确定它做了什么）

### 3）跨卡片批量操作缺失

我们的项目从 `breakdown-v` 改名为 `voxo` 时，pmem 里有 6 个文件包含旧包名引用。我只能手动 `grep` + `sed` + `pmem rebuild`。

**建议**：加一个 `pmem rename` 命令：
```bash
pmem rename --find "breakdown_v" --replace "voxo" --dry-run
pmem rename --find "breakdown_v" --replace "voxo"
```
这个命令在项目重构期会非常高频使用。

### 4）`pmem recall` 输出随卡片数量线性增长

现在我们 25 张卡片，`pmem recall --format compact --budget 2000` 的输出已经很长了。当项目卡片到 50-100 张时，2000 token 的预算可能不够展示足够上下文。

**建议**：给 recall 加一个 `--since` 参数，只展示最近 N 天的变化：
```bash
pmem recall --since 7d
```

### 5）`pmem update --suggest` 的 exit code 1

文档里说 "exit code 1 is a workflow signal, not a hard failure"，但实际使用中每次看到 exit code 1 我都会心里一紧。而且很多 CI 系统会把 exit code 1 当作失败。

**建议**：有建议时 exit code 0 但输出中包含建议列表，或者用 exit code 2 让 1 留给真正的错误。

### 6）session 状态偶尔丢失

中间的 session 会报 `No active pmem session found`，但明明跑了 `session start`。这可能和进程生命周期有关，但确实影响了 `session end` 的可用性。

---

## 三、如果有机会，我希望 pmem 有的功能

1. **`pmem health`**：一键诊断——锁状态、卡片健康、索引一致性、磁盘占用。比 `pmem doctor` 更面向用户。

2. **卡片模板生成**：`pmem new decision "标题"` 自动生成带 YAML frontmatter 的空卡片，不用手写 `---\nid: ...\ntype: ...\n---`。

3. **Markdown 卡片内容校验**：frontmatter 必填字段缺失时给出明确警告，而不是等到 rebuild 时静默跳过。

4. **Git hook 集成**：`pmem integration install git-hooks` 自动在 pre-commit 时跑 `pmem verify`。

---

## 四、总结

pmem 是一个方向完全正确的项目。Markdown 卡片 + SQLite 索引 + 图展开的设计组合，比市面上任何 "AI memory" 方案都更适合实际的软件工程项目。

我在 voxo v1.0 上用 pmem 管了 25 张卡片、做了 27 次追踪记录、跨越了从 P0 到发布的完整周期。没有 pmem 的话，CTO 和总工之间的决策传递、上下文恢复、验收追溯都会散落在聊天记录里不可找回。

**最核心的三个改进优先级：锁竞争修复 > 卡片大小可配置 > 批量重命名。**

期待 0.7.0。

— voxo 项目 CTO，2026-05-23
