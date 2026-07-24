---
id: decision.v1_1_system_memory_release_20260722
type: decision
title: "v1.1: System Memory Release — Miao Integration with Three Red Lines"
status: active
tags: [v1.1, system-memory, miao, security-model, multi-agent, reliability, three-red-lines]
created: "2026-07-22"
updated: "2026-07-22T00:00:00.000Z"
depends_on:
  - decision.pmem_two_layer_architecture_20260722
related_to:
  - feature.v1_1_system_memory_release_20260722
  - feature.v1_0_agentic_memory_runtime_20260722
---
# v1.1: System Memory Release

## Decision

pmem v1.1 正式命名为 **System Memory Release**，将 pmem 从单项目 Memory Runtime 升级为 OS 级 System Memory Infrastructure。

Miao Agentic OS Kernel 是 v1.1 的旗舰使用者和联合验证平台，但 pmem 必须保持独立、通用、可嵌入。

## Three Red Lines

### 第一条：pmem Core 不依赖 Miao

```text
Miao depends on pmem
pmem does not depend on Miao
```

### 第二条：先定义通用 System Memory Protocol

Miao 是第一个实现和验证者，而不是协议本身。协议定义在先，Miao adapter 实现在后。

### 第三条：Miao 专属逻辑全部位于 Adapter

```text
pmem core
pmem runtime
pmem protocol
pmem-miao adapter    ← 所有 Miao 专属内容在此
```

不允许 `pmem core` 内出现 `miaoAgentId` 等专属字段。Miao 概念必须映射到通用概念（principal、namespace、capability token、task/session scope 等）。

## Key Design Decisions

1. **Security-first**：namespace isolation + capability-based access + trust labels + sensitivity labels + memory poisoning defense + secret scanning
2. **Resident service**：`pmemd` 常驻，Unix Socket IPC，不再每次启动进程
3. **Hot/cold path split**：热路径同步低延迟，冷路径异步后台处理
4. **Graceful degradation**：单组件故障不拖垮整个 Memory Service
5. **Append-only event log**：所有状态可回放恢复
6. **Small core**：包拆分 `pmem-core` / `pmem-sqlite` / `pmem-fts` / `pmem-graph` / `pmem-vector` / `pmem-miao`，默认安装不含重型依赖
7. **Rust runtime prototype**：v1.1 引入 Rust 常驻服务原型，TypeScript SDK 作为客户端
8. **Conformance suite**：第三方接入运行统一测试

## Relationship to v1.0

- v1.0 冻结通用 Memory Model、Runtime API、namespace/scope、Policy Engine
- v1.1 在 v1.0 基础上增加 OS 级能力，不破坏 v1.0 的兼容性
- v1.0 是 v1.1 的硬前置

## Consequences

- Miao 集成通过独立 `integrations/miao/` 包完成，核心零侵入
- 所有 OS 级能力（quota、backpressure、crash recovery）通过通用接口暴露，非 Miao 专用
- v1.1 需要 benchmark 基础设施来验证 SLO
- Rust runtime 是 prototype，不强制替换 TypeScript 实现
- TypeScript SDK 继续作为一等客户端
