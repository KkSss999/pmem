---
id: feature.v1_1_system_memory_release_20260722
type: feature
title: "v1.1 System Memory Release"
status: implementing
tags: [v1.1, system-memory, namespace, capability-acl, memory-poisoning, quotas, branch-merge, security]
created: "2026-07-22"
updated: "2026-07-23T00:00:00.000Z"
source_files:
  - src/runtime/policy.ts
  - src/core/consistency.ts
  - src/core/capture.ts
  - src/types/cards.ts
  - src/core/format.ts
  - src/commands/verify.ts
  - src/commands/context.ts
depends_on:
  - feature.v1_0_agentic_memory_runtime_20260722
  - decision.pmem_two_layer_architecture_20260722
  - decision.v1_1_system_memory_release_20260722
related_to:
  - decision.pmem_two_layer_architecture_20260722
classification: plan
trust_label: user_confirmed
sensitivity: internal
last_verified: "2026-08-02T08:44:58.629Z"
---
# v1.1 System Memory Release

## Goal

将 pmem 从单项目 Memory Runtime 升级为 OS 级 System Memory Infrastructure。Miao 是旗舰使用者和联合验证平台，pmem 仍是独立、通用、可嵌入的开源 Memory Runtime。

## Three Red Lines

1. **pmem Core 不依赖 Miao** — `Miao depends on pmem`，反过来不行
2. **先定义通用 System Memory Protocol** — Miao 是第一个实现和验证者，不是协议本身
3. **Miao 专属逻辑全部位于 Adapter** — `pmem-miao` 独立包，核心零侵入

## Capabilities

### System Security Model
- principal identity + namespace isolation（system/user/application/workspace/agent/task/session/private/shared）
- capability-based access control（memory.read/search/observe/propose/commit/amend/supersede/forget/purge/share/export/admin）
- trust label（system_trusted/user_confirmed/application_trusted/agent_generated/tool_observed/imported_external/untrusted_content）
- sensitivity label（public/internal/personal/confidential/secret）
- audit event + secret scanning + memory poisoning defense

### System Runtime
- 常驻 `pmemd`（Rust prototype）
- Unix Socket / named pipe IPC
- async write pipeline（热路径同步 + 冷路径异步）
- backpressure + quota + priority queue
- graceful degradation（向量故障 → FTS+graph；graph 故障 → lexical）

### Reliability
- append-only event log（所有状态可回放恢复）
- WAL mode + atomic transactions + crash recovery tests
- 索引永远可重建（FTS/vector/graph/rank features/context cache 都不是唯一事实源）
- corruption injection tests + power-loss simulation

### Multi-Agent Memory
- private/shared scope 原生支持
- branch memory（Agent 工作分支 → merge → 共享稳定层）
- conflict detection（不 last-write-wins 静默覆盖）
- shared task blackboard（不自动进入长期语义记忆）
- per-Agent quotas

### Miao Integration（独立包 `integrations/miao/`）
- adapter / capability-map / event-bridge / policy-preset / context-provider / lifecycle-hooks
- Miao 负责 Agent 身份、调度、capability token 签发、用户审批、工具调用、应用沙箱
- pmem 负责记忆存储、生命周期、recall、context packing、provenance、namespace 隔离、审计

### Third-Party Compatibility
- language-neutral Pmem Runtime Protocol
- TypeScript / Rust / Python clients
- MCP adapter
- conformance suite（storage / protocol / permission / lifecycle / crash recovery）

### Performance SLOs
| 操作 | 目标 |
|------|------|
| Working memory read P95 | < 5 ms |
| Exact memory get P95 | < 10 ms |
| Warm lexical recall P95 | < 30 ms |
| Hybrid recall P95 | < 100 ms |
| Observation append P95 | < 10 ms |
| Policy evaluation P95 | < 20 ms |
| 空闲基础内存 | < 30–50 MB |

### Package Split (Small Core)
`pmem-core` / `pmem-sqlite` / `pmem-fts` / `pmem-graph` / `pmem-vector` / `pmem-embedding-local` / `pmem-sync` / `pmem-mcp` / `pmem-miao` — 默认安装不含大型模型、GPU 运行时、云端服务。

## Acceptance Scenarios

1. **多 Agent 隔离**：A/B 同时运行，私有不互见，共享可读，capability 撤销立即生效
2. **记忆污染防护**：恶意网页 → observation 可进，不能成系统指令，recall 标记 untrusted
3. **资源攻击**：单 Agent 疯狂写入 → quota + backpressure，其他 Agent recall 不受影响
4. **突然崩溃**：写入中强制终止 → 无半条记忆，event log 恢复，索引可重建
5. **降级运行**：vector provider 故障 → 自动回退 FTS+graph，系统继续工作
6. **第三方接入**：Python Agent 通过标准协议接入，不需要任何 Miao 组件
