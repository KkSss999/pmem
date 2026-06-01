# v0.6.4 Handover

This handover focuses on **polish 5 — session 状态丢失根因排查** (v0.6.4 pre-design §4.1).
Other v0.6.4 polish items (1, 2, 3, 4, 6, 7, 8) are tracked in their own commits
and are not in scope of this document.

---

## Session 状态丢失根因排查

### 排查方法

**目标症状：** `pmem session end` 在已经 `pmem session start` 后偶发输出
`No active pmem session found.`（来源：`src/commands/session.ts:78-83`）。
v0.6.2 pre-design §5.6 列出三个候选根因：

1. WAL 模式写入可见性
2. `closeDatabase()` 时机错误
3. 多次 `start` 隐式行为

**核心 CRUD 流程（已审阅，行号锚点）：**

- `src/commands/session.ts:23-51` — `sessionStartCommand`：
  - L23 `openDatabase(pmemPath)`
  - L24 `createSchema(db)`
  - L27 `getActiveSession(db)` 防多次 start
  - L38 生成 `session-YYYYMMDD-HHmmss` ID
  - L41 `startSession(db, sessionId, agentName)`
  - L51 `closeDatabase()`
- `src/commands/session.ts:70-129` — `sessionEndCommand`：
  - L74 `getActiveSession(db)`
  - L77-83 **报错路径**（"No active pmem session found"）
  - L86 `endSession(db, active.id, ...)`
- `src/core/db.ts:115-124` — `sessions` 表 schema：
  - PK 是 `id`（即 `session-YYYYMMDD-HHmmss`）
  - 关键字段：`ended_at`、`status`
- `src/core/db.ts:295-312` — session CRUD：
  - L295-299 `startSession`：`INSERT OR REPLACE INTO sessions (id, agent_name, started_at, status, dirty) VALUES (?, ?, ?, 'active', 0)`
  - L301-305 `endSession`：`UPDATE sessions SET ended_at, status, task_summary WHERE id = ?`
  - L307-312 `getActiveSession`：`SELECT ... WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1`
- `src/core/db.ts:8-26` — `openDatabase`：
  - L14 `pragma('journal_mode = WAL')`
  - L15 `pragma('foreign_keys = ON')`
- `src/core/db.ts:28-33` — `closeDatabase`：
  - 直接 `_db.close()`，better-sqlite3 会自动 checkpoint WAL
- `src/core/db.ts:233-244` — **关键嫌疑点** `clearAllTables`：
  - L242 `DELETE FROM sessions;` ← 任何调用方都会清空 sessions 表
- `src/commands/rebuild.ts:46`（修改前） — `clearAllTables` **唯一调用方**就是 `rebuild --full`

**锁流程审阅结论：** `session.ts` 不使用 `acquireLock`/`releaseLock`
（grep `src/commands/session.ts` 无任何 lock 调用）。锁竞争与 session 状态丢失**无关**。

### 复现结果

**Scenario A — plain start/end 循环 20 次：**

```bash
cd /Users/kerye/Codings/pmem/temp/polish-5-test
rm -rf .pmem
npx ts-node ../../src/index.ts init polish-5-test
npx ts-node ../../src/index.ts rebuild
N_CYCLES=20 /Users/kerye/Codings/pmem/scripts/repro-session-loss.sh
```

输出（已剪裁）：

```
Scenario A: 20 plain start/end cycles...
A start fails : 0
A end   losses: 0
RESULT: not reproduced (0 failures across all scenarios)
```

→ **WAL 候选根因 1 排除。** better-sqlite3 在 `close()` 时自动
checkpoint WAL，跨进程读取没有可见性问题。在 20 次循环后查看磁盘也没有
残留的 `.pmem/pmem.db-wal` / `.pmem/pmem.db-shm` 文件。

**候选根因 2（`closeDatabase()` 时机）排除：** better-sqlite3 是同步的，
`prepare().run()` 返回时已写入 WAL；`closeDatabase()` 永远在 `startSession()` /
`endSession()` 之后调用（`session.ts:41, 51` 与 `session.ts:86, 129`）。

**候选根因 3（多次 start）排除：** `session.ts:27-32` 已有 idempotent guard：
第二次 start 会检测到 active session 并提示 "Active session already exists"，
不会覆盖。两并发 `session start` 进程的实测也只有一个能写入，另一个被 guard
拦截。

**Scenario B — start → `rebuild --full` → end（v0.6.4 新发现路径）：**

```bash
npx ts-node ../../src/index.ts session start -a "PreRebuild"
# sessions 表里有 active session
npx ts-node ../../src/index.ts rebuild --full
# clearAllTables 触发 DELETE FROM sessions
npx ts-node ../../src/index.ts session end -s "post-rebuild"
```

实测输出（修复前）：

```
=== Start ===
Session started: session-20260601-173815
=== sessions after start ===
session-20260601-173815|

=== rebuild --full ===
Full rebuild: cleared all tables.

=== sessions after rebuild --full ===
(empty)

=== end ===
No active pmem session found.
Next: run `pmem session start -a "<agent-name>"` to begin a session.
```

→ **稳定 100% 复现。**

### 根因定位

**根因：`pmem rebuild --full` 调用的 `clearAllTables()` 会执行
`DELETE FROM sessions`，把进行中的 active session 一并清空。**

- 代码定位：`src/core/db.ts:233-244` `clearAllTables()`，第 242 行
  `DELETE FROM sessions;`。
- 调用点：`src/commands/rebuild.ts:46`（修改前），是 `clearAllTables` 的
  **唯一**调用方。
- 触发路径：用户/agent 在 session 进行中接到诊断建议（
  `src/core/db.ts:20` SQLITE_NOTADB、`src/commands/verify.ts:56`、
  `src/commands/doctor.ts:90`、`src/commands/ask.ts:54` 都建议
  `pmem rebuild --full`），运行后 session 立即丢失。

**为什么之前 v0.6.2 候选根因没指向这里：** v0.6.2 排查聚焦在
session 命令本身的并发/WAL 问题，未把 `rebuild --full` 纳入"间接路径"。
实际上 session 状态是**运行时状态**而非从 Markdown 卡片派生的索引，
理应在 "rebuild from cards" 流程中被保留。`clearAllTables` 同时清掉
`sessions` 是 v0.3 早期 schema 引入时的遗留行为。

### 修复方案

**已修复。** 改动 1 个文件 1 段（5-29 行净增），不动 `session.ts` 和
`db.ts`，把 `clearAllTables` 的语义包在 rebuild 命令层：rebuild 前快照
active sessions，clear 后再原样写回。

**修复 diff 摘要（`src/commands/rebuild.ts:45-72`）：**

```typescript
if (isFull) {
  // v0.6.4 polish 5: preserve active sessions across `rebuild --full`.
  // ... (rationale comment)
  type ActiveSessionRow = {
    id: string;
    agent_name: string | null;
    started_at: string;
    ended_at: string | null;
    task_summary: string | null;
    base_index_hash: string | null;
    status: string | null;
    dirty: number;
  };
  const activeSessions = db
    .prepare("SELECT id, agent_name, started_at, ended_at, task_summary, base_index_hash, status, dirty FROM sessions WHERE ended_at IS NULL")
    .all() as ActiveSessionRow[];

  clearAllTables(db);

  if (activeSessions.length > 0) {
    const restore = db.prepare(
      "INSERT INTO sessions (id, agent_name, started_at, ended_at, task_summary, base_index_hash, status, dirty) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    for (const s of activeSessions) {
      restore.run(s.id, s.agent_name, s.started_at, s.ended_at, s.task_summary, s.base_index_hash, s.status, s.dirty);
    }
    console.log(`Full rebuild: cleared all tables (preserved ${activeSessions.length} active session(s)).`);
  } else {
    console.log('Full rebuild: cleared all tables.');
  }
}
```

**为什么改 `rebuild.ts` 而不是 `db.ts`：**

1. 不改 `clearAllTables` 的字面语义（仍然清空所有表），降低对其它潜在
   调用方的语义冲击。
2. 修复就近 root cause site（`rebuild --full` 是唯一现实触发路径），
   不修改 session.ts 也不修改 db.ts，避免引入大改。
3. 仍然清空 `update_log`、`dirty_flags`：那些是日志/标记，rebuild 后
   失去关联也不直接破坏 session 生命周期；本次只修复"session end 找不到
   active session"这条直接 user-facing 报错。

**未在 v0.6.4 修复的次级影响（推迟到 v0.7+）：**

- `update_log` 的 `session_id` 在 rebuild --full 后会指向被清空的旧
  log 行。`pmem session end` 输出"Actions: 0 update(s), 0 trace(s)"
  会偏低。属于"已知非阻塞"，不阻塞核心 session 关闭流程。
- `dirty_flags` 的 `session_id` 同理。

### E2E 验证

**修复后 Scenario B 实测：**

```
=== Start ===
Session started: session-20260601-174108
=== sessions before rebuild --full ===
session-20260601-174108||active
=== rebuild --full (should preserve) ===
Full rebuild: cleared all tables (preserved 1 active session(s)).
Full rebuild: 0 cards processed, 0 skipped (hash match), 0 updated
=== sessions after rebuild --full ===
session-20260601-174108||active
=== end ===
Session ended: session-20260601-174108
  Summary: fix-verify
  Actions: 0 update(s), 0 trace(s) created
```

→ 复现路径修复，session end 正常关闭。

**修复后无 active session 时回归：**

```
=== rebuild --full with no active session ===
Full rebuild: cleared all tables.
```

→ 输出与修复前一致，零回归。

**修复后 Scenario A（plain cycles）回归：**

```
A start fails : 0
A end   losses: 0
B end   loss  : 0
RESULT: not reproduced (0 failures across all scenarios)
```

**单元测试：** `npm test` 137/137 通过，0 失败。

**`npx tsc --noEmit`：** 0 error。

### 复现脚本

`/Users/kerye/Codings/pmem/scripts/repro-session-loss.sh`
（v0.6.4 polish 5 新增，包含 Scenario A + Scenario B）。

用法：

```bash
N_CYCLES=20 ./scripts/repro-session-loss.sh
PROJECT_DIR=/tmp/foo ./scripts/repro-session-loss.sh
```

退出码 0 = 跑完（不区分是否复现），需读末尾 `RESULT:` 行判断。

### 决策

- **根因：** `clearAllTables` 一并清空 `sessions` 表 + `rebuild --full`
  在诊断流程中被频繁建议。
- **修复：** v0.6.4 polish 5 内修复完成，仅改 `src/commands/rebuild.ts`
  一处，不改 `session.ts` 也不改 `db.ts`。
- **范围纪律：** 没有触碰 `clearAllTables` 字面语义，没有引入
  `--create-if-missing`，没有改 session lifecycle。
- **推迟到 v0.7+：** `update_log` / `dirty_flags` 中指向被清空 session 的
  孤立行，留作 v0.7 通用化阶段连带处理。

---

## 文件清单（polish 5 范围）

| 文件 | 改动 |
|------|------|
| `src/commands/rebuild.ts` | 在 `--full` 分支前后快照/恢复 active sessions（行 45-72） |
| `scripts/repro-session-loss.sh` | 新增复现脚本（Scenario A + Scenario B） |
| `docs/handover-v0.6.4.md` | 本文件 |

未触碰：`src/commands/session.ts`、`src/core/db.ts`、`src/core/fs.ts`。

---

## 审批记录

| 角色 | 决定 | 日期 |
|------|------|------|
| 执行人 | 完成 polish 5 根因 + 修复 | 2026-06-02 |
| CTO | 待审批 | 2026-06-02 |
