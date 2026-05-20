# pmem v0.4 交接文档

## 一、项目概况

**pmem**（Project Memory for Agents）是一个面向 AI coding agent 的图结构项目记忆 CLI 运行时。它让 Agent 以极少 token 恢复项目上下文、查找相关记忆、溯源决策，并通过感知代码变更自动建议记忆更新。

- **仓库：** [github.com/KkSss999/pmem](https://github.com/KkSss999/pmem)（Private）
- **当前版本：** v0.4.0（main 分支）
- **技术栈：** TypeScript (strict, CommonJS, ES2022) + Commander + js-yaml + better-sqlite3
- **运行时：** Node.js ≥18
- **测试框架：** Node.js 原生 `node:test`（88 测试，~760ms）
- **测试隔离区：** `temp/`（gitignored）

### 一句话状态

> v0.1 + v0.2 + v0.3 + v0.4 全部完成。15 个命令、零 TypeScript 错误、88 测试全通过。Agent workflow 闭环已打通：代码变更感知 → dirty 标记 → 建议生成 → 确认写入 → 蒸馏 → 验证。

---

## 二、版本演进概览

| 版本 | 主题 | 关键交付 |
|------|------|---------|
| v0.1 | 核心闭环 | 10 命令，Markdown 主数据 + JSON indexes |
| v0.2 | 工程底座 | +migrate, +distill, atomicWrite, file lock, card_policy |
| v0.3 | SQLite Runtime | 7 P0 表, content-hash 增量 rebuild, FTS5, 四格式输出 |
| v0.4 | **Agent Workflow Automation** | status, mark-dirty --auto, update --suggest, 退出码协议, integration templates |

---

## 三、v0.4 完成清单

### P0 — 8/8

| # | 功能 | 文件 | 说明 |
|---|------|------|------|
| 1 | `pmem status` | [src/commands/status.ts](src/commands/status.ts) **新建** | git status + paths 表反查，三级匹配（exact/directory/graph_neighbor），`--format compact/json`，退出码 0/1/2 |
| 2 | `mark-dirty --auto` | [src/commands/update.ts](src/commands/update.ts) | git status → paths 反查 → 自动 insertDirtyFlag |
| 3 | `update --suggest` | [src/commands/update.ts](src/commands/update.ts) | dirty_flags + state 时效 → 结构化建议，`--format json` 输出 |
| 4 | `update --apply-suggestion` | [src/commands/update.ts](src/commands/update.ts) | 自动执行建议（update_card/create_trace/update_state） |
| 5 | `distill --suggest` | [src/commands/distill.ts](src/commands/distill.ts) | SQLite edges 推断分组，退出码 0/1 |
| 6 | `distill --apply-suggestion` | [src/commands/distill.ts](src/commands/distill.ts) | 非交互式应用蒸馏到指定 card |
| 7 | session start/end | [src/commands/session.ts](src/commands/session.ts) | 已在 v0.3 P1 完成，v0.4 增强 update_log 汇总 |
| 8 | CLI hooks-friendly output | update/distill/verify/status | 统一退出码（0=正常, 1=建议/警告, 2=错误），所有 suggest 命令 `--format json` |
| 9 | Integration templates | `.pmem/integrations/` + [src/commands/init.ts](src/commands/init.ts) | Claude Code / Cursor / Codex 模板，嵌入 v0.4 workflow 指令 |
| 10 | verify stale memory | [src/commands/verify.ts](src/commands/verify.ts) | paths 表 source_files 的 mtime 对比 card updated_at |

### P1 — 3/3

| # | 功能 | 文件 |
|---|------|------|
| 1 | status 三级匹配 | [src/commands/status.ts](src/commands/status.ts) — exact → directory → graph_neighbor |
| 2 | session update_log 汇总 | [src/commands/session.ts](src/commands/session.ts) — end 时聚合 actions + affected_cards + unresolved dirty_flags |
| 3 | AGENTS.md 模板优化 | [src/commands/init.ts](src/commands/init.ts) — 内联模板已更新，写入 v0.4 完整内容 |

### v0.4 排除项（明确不做）

| 排除 | 原因 |
|------|------|
| embedding 真接入 | 仅保留 Provider Interface + manifest 配置 |
| pmem serve (MCP/REST) | 完全搁置 |
| Graph UI | v0.5+ |
| 多用户远程服务 | v0.5+ |

---

## 四、代码库地图

```
pmem/
├── CLAUDE.md                              # Agent 入口指令
├── package.json                           # v0.4.0，依赖：commander, js-yaml, better-sqlite3
├── tsconfig.json                          # strict, ES2022, CommonJS
├── .gitignore                             # node_modules, dist, temp, .pmem, .DS_Store, .claude
├── temp/                                  # gitignored 测试隔离区
│
├── docs/                                  # 设计文档（按顺序读）
│   ├── Voorlopige projekidee.md           # 长期架构总纲
│   ├── prd.md                             # 产品需求文档
│   ├── project-roadmap.md                 # v0.1 → v0.5 路线图
│   ├── v0.2 pre-design.md                 # v0.2 前置设计
│   ├── v0.2 pre-roadmap.md                # v0.2 路线图
│   ├── v0.3 pre-design.md                 # ⭐ v0.3 圣经 — 14 章技术决策
│   ├── v0.4 pre-design.md                 # ⭐ v0.4 圣经 — Agent Workflow Automation
│   ├── handover-v0.3.md                   # v0.3 交接文档
│   └── handover-v0.4.md                   # 本文档
│
├── src/
│   ├── index.ts                           # CLI 入口（Commander），15 命令，版本 0.4.0
│   ├── types.ts                           # 全部 TS 类型，Manifest = ManifestV02 | ManifestV03
│   │
│   ├── core/                              # 共享基础设施
│   │   ├── fs.ts                          # 文件工具：atomicWrite, acquireLock, readFile, listFiles...
│   │   ├── manifest.ts                    # Manifest 加载/保存(js-yaml)，getDefaultManifest()→ManifestV03
│   │   ├── db.ts                          # ⭐ SQLite 核心：schema 创建(10 表)、CRUD、dirty/session/update_log
│   │   ├── hash.ts                        # SHA-256 内容 hash（file/frontmatter/body）
│   │   ├── yaml.ts                        # 共享 YAML frontmatter 解析器
│   │   ├── format.ts                      # CLI 输出格式化（compact/json/paths/pack）
│   │   ├── *.test.ts                      # 4 个测试文件（88 用例）
│   │
│   └── commands/                          # 15 个命令文件
│       ├── init.ts                        # pmem init [--guided] — 已更新 v0.4 integration 模板
│       ├── rebuild.ts                     # pmem rebuild --changed/--full/--card — SQLite 写入
│       ├── recall.ts                      # pmem recall --budget N --format compact/json/paths/pack
│       ├── ask.ts                         # pmem ask <query> — 6 步召回（exact→alias→tag→graph→FTS→rerank）
│       ├── graph.ts                       # pmem related --depth N --type X / pmem trace
│       ├── verify.ts                      # pmem verify --fix — hash 对比 + orphan + stale + exit codes
│       ├── update.ts                      # ⭐ pmem update --suggest/--apply-suggestion/--confirm
│       │                                  #    pmem mark-dirty --auto
│       ├── migrate.ts                     # pmem migrate --to 0.3 --dry-run
│       ├── distill.ts                     # ⭐ pmem distill --suggest/--apply-suggestion/--confirm
│       ├── session.ts                     # pmem session start/end（+ update_log 汇总）
│       ├── status.ts                      # ⭐ pmem status — git status + paths 三级匹配
│       └── integration.ts                 # pmem integration list/install/verify
└── dist/                                  # tsc 编译输出（gitignored）
```

---

## 五、关键技术决策

### 1. 架构原则

```
Markdown cards (.pmem/**/*.md)  ← 唯一主数据
SQLite (.pmem/pmem.db)          ← 索引、缓存、运行时状态
JSON indexes (.pmem/indexes/)   ← legacy 保留
```

- **永远不**在 SQLite 中创建"数据库独有"的卡片
- **永远不**删除旧 JSON indexes
- **永远不**直接修改 SQLite（修改必须通过 Markdown → rebuild）

### 2. Content Hash 增量

三 hash 体系：
- `file_hash` — 整个 .md 文件（变化 = 重解析全部）
- `frontmatter_hash` — YAML 部分（变化 = 更新元数据+关系）
- `body_hash` — 正文部分（变化 = 更新 FTS/summary/token_count）

`--changed` 模式下对比 hash，全部匹配则跳过。

### 3. 退出码协议

| 命令 | 0 | 1 | 2 |
|------|---|---|---|
| `pmem status` | 有变更 | 无变更 | 错误 |
| `pmem update --suggest` | 无建议 | 有建议 | 错误 |
| `pmem distill --suggest` | 无需蒸馏 | 建议蒸馏 | 错误 |
| `pmem verify` | 通过 | 有 warning | 有 error |

### 4. Status 三级匹配

```
Pass 1: exact — changed file path LIKE paths.path
Pass 2: directory — changed file directory LIKE paths.path
Pass 3: graph_neighbor — edges 表 1-hop 扩展
```

优先级：exact > directory > graph_neighbor（高优先级覆盖低优先级）。

### 5. update --suggest 建议引擎

基于三个数据源生成建议：
1. `getUnresolvedDirtyFlags(db)` — 未解决的脏标记
2. `state.md` mtime — 超过 24h = stale
3. `next.md` 内容长度 — < 50 chars = minimal

建议类型：`update_card`, `create_trace`, `update_state`, `update_next`。

### 6. Manifest 类型系统

```typescript
type ManifestSchemaVersion = '0.2' | '0.3';
type Manifest = ManifestV02 | ManifestV03;  // discriminated union on pmem.schema_version

interface ManifestBase { /* 共享字段 */ }
interface ManifestV02 extends ManifestBase { pmem: { schema_version: '0.2' }; indexes: ManifestIndexes; }
interface ManifestV03 extends ManifestBase { pmem: { schema_version: '0.3' }; runtime; rebuild; cli; embedding; serve; }
```

严禁 `as any` 绕过类型检查。迁移函数返回 `ManifestV03`。

---

## 六、命令行完整参考（15 命令）

```bash
# 初始化
pmem init [project-name] [--guided]

# 内存查询
pmem recall [--budget N] [--format compact|json|paths|pack]
pmem ask <query> [--format compact|json|paths|pack]
pmem related <id> [--depth N] [--type depends_on|related_to|...]
pmem trace <id>

# 变更感知（v0.4 新增）
pmem status [--since <timestamp>] [--format compact|json]

# 工作流（v0.4 增强）
pmem mark-dirty [-r <reason>] [--auto]
pmem update [--auto|--suggest|--apply-suggestion <id>|--confirm|--force] [-s <summary>] [-n <next>] [--format compact|json]

# 蒸馏（v0.4 增强）
pmem distill [--suggest|--apply-suggestion <id>|--confirm|--suggest-splits]

# 维护
pmem rebuild [--changed|--full|--card <id>]
pmem verify [--fix]
pmem migrate --to 0.3 [--dry-run] [--backup]

# 会话（v0.3 P1 完成，v0.4 增强汇总）
pmem session start [-a <agent-name>]
pmem session end [-s <summary>]

# 框架集成
pmem integration list|install <framework>|verify
```

---

## 七、测试基础设施

```
npm test  # node --require ts-node/register --test src/core/*.test.ts
```

| 文件 | 用例数 | 覆盖 |
|------|--------|------|
| [src/core/yaml.test.ts](src/core/yaml.test.ts) | 21 | parseYamlValue/parseSimpleYaml/parseFrontmatter |
| [src/core/manifest.test.ts](src/core/manifest.test.ts) | 21 | getDefaultManifest/getDefaultManifestV03 全字段 |
| [src/core/db.test.ts](src/core/db.test.ts) | 22 | 10 表 schema + CRUD + dirty/session/update_log |
| [src/core/hash.test.ts](src/core/hash.test.ts) | 16 | computeHash/computeCardHashes/tokenCount/sectionCount |
| **合计** | **88** | **0 失败** |

### E2E 测试流程

```bash
cd temp && rm -rf v04-test && mkdir v04-test && cd v04-test

# 初始化 + 创建卡片
npx ts-node ../../src/index.ts init v04-test
mkdir -p .pmem/modules .pmem/decisions .pmem/traces
# ... 写入测试卡片（含 YAML frontmatter）...

# 核心链路
npx ts-node ../../src/index.ts rebuild
npx ts-node ../../src/index.ts recall --format compact --budget 2000
npx ts-node ../../src/index.ts ask "关键词" --format json
npx ts-node ../../src/index.ts related <card_id> --depth 2
npx ts-node ../../src/index.ts trace <card_id>

# Workflow 闭环
npx ts-node ../../src/index.ts session start -a "test"
npx ts-node ../../src/index.ts status --format json
npx ts-node ../../src/index.ts mark-dirty -r "test" --auto
npx ts-node ../../src/index.ts update --suggest --format json
npx ts-node ../../src/index.ts update --confirm -s "summary" -n "next"
npx ts-node ../../src/index.ts distill --suggest
npx ts-node ../../src/index.ts session end -s "test complete"
npx ts-node ../../src/index.ts verify
```

---

## 八、v0.5 路线图（接班人方向）

### v0.5 目标：上线可用 Beta

v0.4 完成了 Agent workflow 闭环。v0.5 应聚焦"真实可用性"：

**建议优先级：**

| 优先级 | 方向 | 说明 |
|--------|------|------|
| P0 | 实战打磨 | 在真实项目中使用 pmem，收集 ask/recall 不准、status 误报、建议噪音等案例 |
| P0 | 性能优化 | 大项目（100+ cards）的 rebuild 和 ask 性能 |
| P0 | 错误处理 | 完善 corner case 处理（DB 损坏、并发的 pmem 实例、空项目） |
| P1 | embedding ? | 基于收集的召回不准案例判断是否接入 embedding，以及 provider 选型 |
| P1 | `pmem serve` ? | 如果 Agent 不能运行 shell 的需求明确，再考虑 |
| P2 | npm 发布 | `npm publish` 为可全局安装的 CLI |

### v0.4 明确推迟到 v0.5+ 的

- embedding 真接入（API 或 local）
- pmem serve（MCP/REST/daemon）
- Graph UI
- 多用户远程服务
- npm 包发布

### 开工建议

1. 先读 `docs/v0.4 pre-design.md` — 了解 v0.4 设计意图
2. 在真实项目中使用 pmem — 积累 1-2 周的使用反馈
3. 基于反馈写 `docs/v0.5 pre-design.md`
4. 不急于堆功能，先打磨可用性

---

## 九、常见陷阱

### 1. Markdown 是唯一主数据
SQLite 中 `is_deleted` / `is_candidate` 只是标记。所有卡片必须对应 .md 文件。不要创建"数据库独有"的卡片。

### 2. 不要修改 SQLite 直接
修改记忆流程：编辑 .md 文件 → `pmem rebuild --changed`。不要写代码直接 UPDATE SQLite。

### 3. Hash 不是 timestamp
增量 rebuild 用 content hash（SHA-256），不用 mtime。git checkout 会改变 mtime 但不改变内容。

### 4. FTS5 可能不可用
`hasFTS5(db)` 检查后降级到 `LIKE` 查询。不要假设 FTS5 一定存在。

### 5. Manifest 是 discriminated union
`Manifest = ManifestV02 | ManifestV03`。访问版本特有字段前必须 narrow：`if (manifest.pmem.schema_version === '0.3')`。

### 6. 退出码不要吞掉
`pmem update --suggest` 和 `pmem distill --suggest` 的退出码是 Agent 决策依据。`process.exit(1)` = 有建议待处理，不是错误。

### 7. status 依赖 git
`pmem status` 优先用 `git status --porcelain`。非 git 项目自动降级到 mtime。测试时注意：temp/ 子目录不是 git repo，会 fallback 到 mtime。

### 8. DB 不存在时 graceful fallback
所有需要 SQLite 的命令必须检查 `.pmem/pmem.db` 是否存在。不存在时打印提示（不要 crash），降级到文件操作。

### 9. 事务边界
先 atomicWrite Markdown → 再 SQLite transaction。不要反过来。Markdown 写入无法回滚，SQLite 可以。

### 10. 不要引入 as any
manifest 类型系统已建立 discriminated union。新增 manifest 版本时扩展 union，不要绕过。

---

## 十、依赖清单

```json
{
  "dependencies": {
    "better-sqlite3": "^12.10.0",
    "commander": "^14.0.3",
    "js-yaml": "^4.1.1"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.13",
    "@types/js-yaml": "^4.0.9",
    "@types/node": "^25.9.1",
    "ts-node": "^10.9.2",
    "typescript": "^6.0.3"
  }
}
```

---

## 十一、接班人阅读顺序

1. **CLAUDE.md** — 5 分钟了解项目
2. **docs/v0.3 pre-design.md** — v0.3 SQLite 架构决策（14 章）
3. **docs/v0.4 pre-design.md** — v0.4 workflow 决策（12 章）
4. **docs/handover-v0.4.md** — 本文档
5. **src/types.ts** — 类型系统（特别注意 Manifest discriminated union）
6. **src/core/db.ts** — SQLite schema 和 CRUD 辅助函数
7. **src/commands/update.ts** — v0.4 最复杂的命令（suggest 引擎）
8. **src/commands/status.ts** — v0.4 新增命令（三级匹配）

然后在 `temp/` 中跑一次完整 E2E 测试，建立肌肉记忆。
