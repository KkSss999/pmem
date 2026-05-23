# pmem v0.6 交班文档

> 写给下一任总工。本文档让你在 10 分钟内理解 pmem 是什么、做了什么、怎么继续。

## 一、pmem 是什么

**pmem = Project Memory for AI Agents**

一个本地 CLI 运行时，给 coding agent 提供跨会话的项目记忆。核心能力：

| 能力 | 命令 | 价值 |
|------|------|------|
| 恢复上下文 | `pmem recall --budget 2000` | 新 session 秒级恢复项目状态 |
| 图查询 | `pmem ask "<query>"` | ID/alias/tag → 图邻居扩展 → 关键词兜底 |
| 变更感知 | `pmem status` | git/mtime 检测代码变更→定位受影响的记忆卡片 |
| 记忆更新 | `pmem update --suggest/--confirm` | 检测→建议→确认→写入，确认优先 |
| 一致性检查 | `pmem verify` | manifest/DB/hash/边/stale memory 全量检查 |
| 集成安装 | `pmem integration install claude-code` | 生成 CLAUDE.md + slash commands |
| 技能安装 | `pmem install --skills --claude` | 一键安装到 agent 全局 skills 目录 |
| 诊断 | `pmem doctor` | 8 项健康检查 |

**核心数据原则：** `.pmem/**/*.md` Markdown cards 是唯一 source of truth。SQLite 是 rebuildable runtime index。

## 二、当前版本状态

```
v0.1 → v0.2 → v0.3 → v0.4 → v0.5 → v0.6 → v0.6.1
能用   防损坏  强一致  自动化  Beta上线   Agent原生  建议可行动
```

| 版本 | 主题 | 状态 |
|------|------|------|
| v0.5 | Productization Beta | ✅ npm 已发布 (`pmem-ai@0.5.0`) |
| v0.6 | Agent-native Workflow Polish | ✅ npm 已发布 (`pmem-ai@0.6.0`) |
| v0.6.1 | Actionable Update Suggestions | ✅ npm 已发布 (`pmem-ai@0.6.1`) |

**v0.6 新增能力：** 非交互 init、错误 UX 不崩栈、空结果引导、Claude Code slash commands、全局 skills 安装、pmem doctor、integration 模板版本化。

**v0.6 约束：** 不做 embedding、MCP/REST、Graph UI、遥测、远程服务。这是刻意的——pmem 是本地 CLI，不引入网络依赖和隐私变量。

## 三、代码架构

```
src/
  index.ts                     CLI 入口 (Commander)，注册 17 个命令
  types.ts                     ManifestV02 | ManifestV03 等全部类型
  core/
    db.ts                      SQLite CRUD（better-sqlite3, WAL mode）
    manifest.ts                Manifest YAML 读写 (js-yaml)
    fs.ts                      文件工具 (atomicWrite, lock, read/write/list)
    hash.ts                    SHA-256 内容哈希
    yaml.ts                    共享 frontmatter 解析器
    format.ts                  compact/json/paths/pack 输出格式
    git.ts                     git status --porcelain 解析
    *.test.ts                  node:test 测试 (90 个用例)
  commands/
    init.ts                    pmem init [--guided] [--description/--stage/--next/--answers]
    rebuild.ts                 pmem rebuild --changed/--full/--card
    recall.ts                  pmem recall --budget N --format compact|json|paths|pack
    ask.ts                     pmem ask <query> (exact→alias→tag→graph→FTS5→LIKE)
    graph.ts                   pmem related / pmem trace
    status.ts                  pmem status (git porcelain 或 mtime fallback)
    update.ts                  pmem update / pmem mark-dirty
    distill.ts                 pmem distill (trace→stable card 蒸馏)
    verify.ts                  pmem verify (10 项一致性检查)
    session.ts                 pmem session start/end
    integration.ts             pmem integration list/install/verify
    migrate.ts                 pmem migrate --to 0.3
    doctor.ts                  pmem doctor (8 项诊断)
    install.ts                 pmem install --skills --claude/--codex/--gemini/--all
```

## 四、关键设计规则

1. **Markdown cards 是唯一 source of truth。** 不建 database-only cards。不直接编辑 SQLite。
2. **SQLite 是 generated index。** `pmem rebuild` 必须能从 cards 完全重建 DB。
3. **JSON indexes 是 legacy cache。** `indexes/graph.json` 仅为向后兼容保留。
4. **Agent workflow 是 confirmation-first。** detect → suggest → confirm → rebuild → verify。
5. **Manifest 类型是 discriminated union。** Narrow on `manifest.pmem.schema_version` before reading version-specific fields。
6. **Avoid `as any`。** Extend types instead。
7. **退出码简化为 0/2。** v0.6.2 起，exit 1 不再作为 workflow signal。`status`/`update --suggest`/`distill --suggest`/`verify` 有结果或警告时 exit 0，仅运行时错误 exit 2。
8. **不做 scope creep。** embedding、MCP、Graph UI、telemetry、remote service 全不做。

## 五、开发命令

```bash
npm run build          # TypeScript → dist/
npm run dev            # ts-node src/index.ts
npm test               # node:test (90 用例)
npm run test:e2e:install     # npm pack + 全局安装烟雾测试
npm run test:e2e:workflow   # 完整 git 项目工作流
npm run test:e2e:non-git    # 非 git mtime fallback
npm run test:e2e:v06-*      # v0.6 新增 6 个 E2E
```

测试全在 `temp/` 下运行，该目录 gitignored。

## 六、CI/CD

GitHub Actions (`.github/workflows/ci.yml`)：
- **push to main** → Test matrix (Node 18/20/22) → E2E → Pack verification → **auto-publish to npm**
- 版本号变化时自动发布；相同版本跳过
- npm secret: `NPM_TOKEN`

## 七、npm 发布

```bash
npm install -g pmem-ai    # 包名 pmem-ai，命令名 pmem
pmem --version             # 当前 0.6.1
```

## 八、已解决的反馈

| 反馈 | v0.6 解决方案 |
|------|-------------|
| init --guided 只能交互 | `--description/--stage/--next` 参数 + `--answers file.json` |
| 非 git 场景 raw stack trace | git 前置检查 + 友好指引 |
| 空结果无解释 | JSON 输出含 `message` + `next_steps` |
| session end 无引导 | 提示 `session start` 或直接 `update --confirm` |
| skills 不通用 | `pmem install --skills` 安装到 Claude/Codex/Gemini 全局目录 |
| 无全量诊断 | `pmem doctor` 8 项检查 |

## 九、待观察的反馈点

v0.6.1 已发布，当前进入真实用户观察期。优先观察 `update --suggest` 的去重、分级、compact 摘要和 verify/suggest 语义对齐是否真正降低误判与噪声。

以下问题需要真实用户反馈后决定是否进入 v0.7：

- **跨项目记忆？** 当前一个 `.pmem/` 绑定一个项目。多项目/workspace 场景待反馈。
- **自动 session start？** 当前显式 `pmem session start`，隐式启动可能隐藏状态。
- **更多 agent 框架的深度集成？** 当前 Claude Code 有 slash commands，Codex/Cursor 有 AGENTS/rules 模板。Windsurf、Copilot 等待反馈。
- **记忆质量自动评分？** 当前 verify 检查一致性，但不评价 card 内容质量。
- **npm 下载量和 issue 反馈？** 当前仅靠直接采访。
- **是否需要 publish 到其他 registry？** 当前仅 npm。

## 十、v0.7 方向建议

基于 v0.6 已完成的工作和 pmem 的产品定位，v0.7 的候选方向：

1. **真实项目反馈驱动** — 等 StockBro 等项目的 pmem 嵌入反馈，从实际摩擦点提炼 P0
2. **distill 能力增强** — 当前 distill 是手动触发，可探索自动检测 distill 时机
3. **多项目 workspace** — 如果用户同时维护多个关联项目
4. **更多 agent 框架深度集成** — Windsurf、GitHub Copilot 的 skills/slash commands

**关键原则：** 不预设需求。让真实用户告诉你下一步该做什么。

---

**交班人：** Claude Opus 4.6  
**交班日期：** 2026-05-22  
**仓库：** https://github.com/KkSss999/pmem  
**npm：** `pmem-ai@0.6.1`
