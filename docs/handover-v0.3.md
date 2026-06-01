# pmem v0.3 交接文档

## 一、项目概况

**pmem**（Project Memory for Agents）是一个面向 AI coding agent 的图结构项目记忆 CLI 运行时。它让 Agent 以极少 token 恢复项目上下文、查找相关记忆、溯源决策、回写记忆。

- **仓库位置：** `/Users/kerye/Codings/pmem`
- **技术栈：** TypeScript (strict, CommonJS, ES2022) + Commander + js-yaml
- **运行时：** Node.js ≥18
- **测试目录：** `temp/`（gitignored）

---

## 二、已完成工作（v0.1 + v0.2）

### v0.1 — 核心闭环（10 命令）

文件模式下的完整记忆工作流：init → recall → ask → related → trace → update → verify → rebuild。

### v0.2 — 工程底座（12 命令，+2 新增）

在 v0.1 基础上补齐：冷启动、迁移、并发保护、卡片治理、蒸馏。

| 命令 | 职责 | v0.2 变化 |
|------|------|----------|
| `pmem init` | 初始化 .pmem/ | +`--guided` 交互模式、项目扫描、`candidates/`、`memory_incomplete` |
| `pmem rebuild` | .md → indexes/graph.json | +atomicWrite（writeJson） |
| `pmem recall` | 输出项目最小上下文 | 无变化 |
| `pmem ask` | 图引导召回 | 无变化 |
| `pmem related` | 图谱邻居查询 | 无变化 |
| `pmem trace` | 溯源追踪 | 无变化 |
| `pmem verify` | 一致性检查 | +schema_version 兼容检查、card_policy 违规检测（ID 命名/大小/关系数）、dirty 检测 |
| `pmem update` | 记忆更新（四级） | +atomicWrite、file lock、manifest.memory_status 管理 |
| `pmem mark-dirty` | 脏标记 | +atomicWrite、manifest.memory_status |
| `pmem integration` | 框架适配 | +distill 提及 |
| `pmem migrate` | **新增** — schema 版本迁移 | `--dry-run`、`--to`、`--backup`、0.1→0.2 迁移路径 |
| `pmem distill` | **新增** — trace→card 蒸馏 | `--confirm`、`--suggest-splits` |

### 关键技术决策（v0.2）

- **并发策略降级**：不做完整乐观锁（留给 v0.3 SQLite），只做 atomicWrite + 简单 file lock（mkdir-based）
- **YAML 库**：手写解析器替换为 js-yaml
- **manifest 版本化**：`pmem.schema_version: "0.2"` 写入 manifest + 每张卡片
- **迁移保障**：自动备份 + dry-run + migration 历史记录

---

## 三、代码库地图

```
pmem/
├── CLAUDE.md                          # Agent 使用说明（你可能需要先读这个）
├── package.json                       # 依赖：commander, js-yaml；dev：typescript, ts-node, @types/*
├── tsconfig.json                      # strict mode, ES2022, CommonJS
├── temp/                              # gitignored 测试目录
│
├── docs/                              # 设计文档（按顺序读）
│   ├── Voorlopige projekidee.md       # 长期架构总纲（最初的项目构想）
│   ├── prd.md                         # 产品需求文档（用户、场景、成功指标）
│   ├── project-roadmap.md             # v0.1→v0.5 全版本路线图
│   ├── v0.2 pre-design.md             # v0.2 前置设计决策（冷启动/并发/粒度/迁移）
│   ├── v0.2 pre-roadmap.md            # v0.2 实现路线图（P0/P1/P2）
│   ├── v0.3 pre-design.md             # ⭐ v0.3 开工前必读 — 最终技术决策
│   └── handover-v0.3.md               # 本文档
│
├── src/
│   ├── index.ts                       # CLI 入口（Commander），13 个命令注册
│   ├── types.ts                       # 全部 TS 类型（CardFrontmatter, Manifest, v0.2 新增类型等）
│   ├── core/
│   │   ├── fs.ts                      # 文件工具：atomicWrite, acquireLock, releaseLock, readJson, writeJson 等
│   │   └── manifest.ts                # Manifest 加载/保存（js-yaml），getDefaultManifest()
│   └── commands/
│       ├── init.ts                    # pmem init [--guided]
│       ├── rebuild.ts                 # pmem rebuild
│       ├── recall.ts                  # pmem recall --budget N
│       ├── verify.ts                  # pmem verify --fix
│       ├── ask.ts                     # pmem ask <query>
│       ├── graph.ts                   # pmem related / pmem trace
│       ├── update.ts                  # pmem update / pmem mark-dirty
│       ├── integration.ts             # pmem integration list/install/verify
│       ├── migrate.ts                 # pmem migrate --dry-run/--to/--backup
│       └── distill.ts                 # pmem distill --confirm/--suggest-splits
└── dist/                              # tsc 编译输出
```

---

## 四、v0.3 目标

> **SQLite-backed CLI Runtime** — 将查询、索引、状态管理迁入 SQLite，但 Markdown cards 保持为唯一主数据。

核心公式：
```
pmem v0.3 =
  Markdown canonical memory cards
+ SQLite-backed graph/index/runtime
+ content-hash incremental rebuild
+ Agent-first CLI output contract (--format compact/json/paths/pack)
+ skills-based usage protocol
```

### 不做的事情

- 不做 MCP Server（只留 experimental 接口）
- 不做 REST API
- 不做 embedding 真接入（只设计 provider interface）
- Markdown 不搬家到数据库
- 不删除旧 JSON indexes

---

## 五、v0.3 开工指南

### 步骤 1：阅读关键文档（30 分钟）

按顺序读：
1. `CLAUDE.md` — 了解项目命令和架构
2. `docs/v0.3 pre-design.md` — **全部 14 章**，这是 v0.3 的正式技术决策文档
3. `docs/project-roadmap.md` 中 v0.3 部分
4. `src/types.ts` — 了解现有类型系统（v0.3 需要新增大量类型）

### 步骤 2：安装 SQLite 依赖

```bash
npm install better-sqlite3
npm install --save-dev @types/better-sqlite3
```

`better-sqlite3` 是 Node.js 生态最成熟的同步 SQLite 库，适合 CLI 工具。

### 步骤 3：按 P0 顺序逐项实现

**Phase 1：类型与基础设施**

1. 在 `src/types.ts` 中新增 v0.3 类型：
   - `RuntimeConfig`（mode, db_path, markdown_source）
   - `RebuildConfig`（strategy, hash 配置）
   - `CliConfig`（default_format, supported_formats, default_budget）
   - `EmbeddingConfig`（enabled, provider, model, dimension, store, index）
   - `ServeConfig`（enabled, mode, experimental）
   - 更新 `Manifest` 接口以包含 v0.3 新字段

2. 创建 `src/core/db.ts` — SQLite 数据库管理：
   - `openDatabase(pmemPath: string): Database` — 打开/创建 `.pmem/pmem.db`
   - `createSchema(db: Database): void` — 创建 P0 7 张表
   - `getSchemaVersion(db: Database): string | null`

**Phase 2：Rebuild 切换到 SQLite**

3. 重写 `src/commands/rebuild.ts`：
   - 从 Markdown cards 解析 frontmatter
   - 写入 SQLite cards / edges / aliases / tags / paths 表
   - 计算 file_hash / frontmatter_hash / body_hash
   - 支持 `--changed`（增量）和 `--full`（全量）
   - `--changed` 逻辑：对比 hash，相同跳过，不同更新
   - 旧 JSON index 仍写入（legacy 兼容），但主输出是 SQLite

**Phase 3：查询命令切换到 SQLite**

4. 重写 `src/commands/recall.ts`：
   - 从 SQLite cards 表读取项目信息
   - 读取 state.md / next.md
   - 查询 dirty_flags 和 update_log
   - 支持 `--format compact/json/paths/pack`

5. 重写 `src/commands/ask.ts`：
   - 召回链路：exact match（aliases/tags）→ graph expansion（edges）→ FTS keyword → rerank
   - FTS5 全文检索（如果可用）
   - 支持 `--format compact/json/paths/pack`
   - 输出必须标注 match_type（可解释召回）

6. 重写 `src/commands/graph.ts`（related / trace）：
   - related：从 edges 表查询图邻居
   - 支持 `--depth 2`（多跳查询）和 `--type depends_on`（边类型过滤）
   - trace：从 cards + edges 表组装溯源链

**Phase 4：Verify 切换到 SQLite**

7. 重写 `src/commands/verify.ts`：
   - 对比 SQLite 中的 hash 与 Markdown 文件的当前 hash
   - 检查 edges 是否有孤儿引用
   - 检查 card_policy 违规
   - `--fix` 行为：运行 `pmem rebuild --changed`

**Phase 5：Migration（0.2 → 0.3）**

8. 创建/重写 `src/commands/migrate.ts` 的 0.2→0.3 路径：
   - `--dry-run`：预览 schema 创建、数据导入、manifest 变更
   - 正式执行：备份 → 创建 SQLite → 从 Markdown rebuild → 更新 manifest → verify
   - 保留旧 JSON indexes（legacy 标记）

**Phase 6：CLI 输出协议**

9. 在查询命令中实现 `--format`：
   - `compact`：低 token 纯文本（Agent 直接阅读）
   - `json`：结构化 JSON（Agent 程序化处理）
   - `paths`：仅文件路径（极低 token）
   - `pack`：受 `--budget` 控制的上下文包

**Phase 7：接线与测试**

10. 更新 `src/index.ts`：注册新选项（`--format`、`--depth`），更新版本为 `0.3.0`
11. 更新 `src/core/manifest.ts`：`getDefaultManifest()` 生成 v0.3 manifest 模板
12. 在 `temp/` 中进行完整 E2E 测试

### 步骤 4：E2E 测试流程

每次 Phase 完成后，在 `temp/` 中跑这个测试流程：

```bash
cd temp && rm -rf test-v03 && mkdir test-v03 && cd test-v03

# 1. 初始化（从 v0.2 manifest 开始，模拟已有项目）
npx ts-node ../../src/index.ts init test-v03

# 2. 添加示例卡片
mkdir -p .pmem/modules .pmem/decisions .pmem/tasks .pmem/traces
# ... 写入测试卡片 ...

# 3. 重建索引
npx ts-node ../../src/index.ts rebuild

# 4. 迁移到 v0.3
npx ts-node ../../src/index.ts migrate --to 0.3 --dry-run
npx ts-node ../../src/index.ts migrate --to 0.3

# 5. 验证
npx ts-node ../../src/index.ts verify

# 6. 查询
npx ts-node ../../src/index.ts recall --budget 2000 --format compact
npx ts-node ../../src/index.ts ask "回测沙盒" --format json
npx ts-node ../../src/index.ts related module.backtest_sandbox --depth 2
npx ts-node ../../src/index.ts trace module.backtest_sandbox

# 7. 更新流程
npx ts-node ../../src/index.ts mark-dirty --reason "test"
npx ts-node ../../src/index.ts update --confirm --summary "Test update"

# 8. 蒸馏
npx ts-node ../../src/index.ts distill
npx ts-node ../../src/index.ts distill --suggest-splits
```

### 步骤 5：关键验收标准

v0.3 完成的标准：

- [ ] `better-sqlite3` 安装成功，`npx tsc --noEmit` 零错误
- [ ] `pmem rebuild` 将卡片数据写入 SQLite cards/edges/aliases/tags/paths 表
- [ ] `pmem rebuild --changed` 只更新有变化的卡片（hash 对比）
- [ ] `pmem recall --format compact` 输出低 token 纯文本
- [ ] `pmem recall --format json` 输出有效 JSON
- [ ] `pmem ask "<query>"` 召回链路包含 exact → graph → FTS 阶段
- [ ] `pmem ask` 输出标注 match_type（可解释召回）
- [ ] `pmem related <id> --depth 2` 多跳查询正确
- [ ] `pmem verify` 检测到 SQLite 与 Markdown 不一致
- [ ] `pmem verify --fix` 自动 rebuild 并修复
- [ ] `pmem migrate --to 0.3 --dry-run` 预览迁移计划
- [ ] `pmem migrate --to 0.3` 执行迁移（自动备份 + 不删除 JSON indexes）
- [ ] 并发写入时 file lock + SQLite transaction 正常工作
- [ ] 所有 v0.1/v0.2 命令仍可工作（无回归）
- [ ] `temp/` 中完整 E2E 测试通过

---

## 六、常见陷阱与注意事项

### 1. Markdown 永远是主数据

不要在 SQLite 中创建"只存在于数据库"的卡片。所有卡片必须对应 `.pmem/` 下的一个 `.md` 文件。`is_deleted` 和 `is_candidate` 字段只是标记，不代表可以跳过 Markdown。

### 2. 不要删除 JSON indexes

v0.2 用户的项目中有 `indexes/graph.json`。迁移后保留它们，在 manifest 中标记 `legacy_json.retained: true`。不要删除。

### 3. Hash 对比，不是 timestamp

增量 rebuild 判断卡片是否变化时，用 content hash（SHA-256），不用文件 mtime。mtime 在 git checkout 等操作下不可靠。

### 4. FTS5 可能不可用

某些 Node.js / SQLite 发行版不包含 FTS5。在代码中检查 FTS5 是否可用，降级到 LIKE 查询。

```typescript
function hasFTS5(db: Database): boolean {
  const row = db.prepare("SELECT 1 FROM sqlite_master WHERE name='card_fts'").get();
  // Try to create, catch error if unsupported
}
```

### 5. 事务边界

写入操作必须在事务中：BEGIN → 写 cards/edges/aliases → COMMIT。如果中途失败，ROLLBACK。但 Markdown 文件写入不在事务内（文件系统不可回滚）。策略：先写 Markdown（atomicWrite），成功后再 SQLite transaction。如果 SQLite 失败，Markdown 已写入但 SQLite 标记 stale——下次 rebuild 会自动修复。

### 6. 锁的顺序

先拿 file lock，再开 SQLite transaction。释放时相反：先 COMMIT transaction，再 release lock。不要反过来。

### 7. 保持向后兼容

v0.3 的 `getDefaultManifest()` 生成的 manifest 必须能让 v0.2 命令（如 rebuild、verify）识别核心字段。新增的 `runtime`、`cli`、`embedding`、`serve` 字段对 v0.2 命令应该是可选的、被忽略的。

---

## 七、需要创建的新文件

| 文件 | 说明 |
|------|------|
| `src/core/db.ts` | SQLite 连接管理、schema 创建、hash 查询 |
| `src/core/hash.ts` | 内容 hash 计算（file_hash, frontmatter_hash, body_hash） |
| （可能）`src/core/format.ts` | CLI 输出格式化（compact/json/paths/pack） |

## 八、需要重写的现有文件

| 文件 | 重写程度 | 说明 |
|------|---------|------|
| `src/types.ts` | 追加 | 新增 v0.3 类型，更新 Manifest |
| `src/core/manifest.ts` | 更新 | getDefaultManifest() 生成 v0.3 模板 |
| `src/commands/rebuild.ts` | 重写 | SQLite 写入 + 增量 hash 对比 |
| `src/commands/recall.ts` | 重写 | SQLite 查询 + --format |
| `src/commands/ask.ts` | 重写 | SQLite + FTS + --format |
| `src/commands/graph.ts` | 更新 | SQL edges + --depth + --type |
| `src/commands/verify.ts` | 重写 | SQLite ↔ Markdown hash 对比 |
| `src/commands/migrate.ts` | 追加 | 0.2→0.3 迁移路径 |
| `src/index.ts` | 更新 | 注册新选项、版本 0.3.0 |

---

## 九、依赖与环境

```json
{
  "dependencies": {
    "commander": "^14.0.3",
    "js-yaml": "^4.1.1",
    "better-sqlite3": "待安装"
  },
  "devDependencies": {
    "@types/better-sqlite3": "待安装",
    "@types/js-yaml": "^4.0.9",
    "@types/node": "^25.9.1",
    "ts-node": "^10.9.2",
    "typescript": "^6.0.3"
  }
}
```

---

## 十、v0.3 完成后应更新的文档

- `CLAUDE.md` — 源文件树、实现状态表
- `docs/project-roadmap.md` — v0.3 状态标记为完成
- 新建 `docs/v0.4 pre-design.md` — v0.4 前置设计决策
