---
id: task.v1_3_1_semantic_runtime_default_20260802
type: task
title: "v1.3.1 Semantic Runtime Default"
status: active
tags: [v1.3.1, semantic, runtime, embeddings, retrieval, lifecycle]
created: "2026-08-02"
updated: "2026-08-02T00:00:00.000Z"
depends_on:
  - decision.v1_3_0_runtime_first_schema_driven_backend_pluggable_20260802
related_to:
  - feature.v1_1_1_lightweight_semantic_layer_20260626
  - task.v1_3_0_total_architecture_and_vertical_slices_20260802
classification: plan
token_policy: relaxed
trust_label: user_confirmed
sensitivity: internal
---

# v1.3.1 Semantic Runtime Default

## Objective

将已经验证的 semantic retrieval 从显式高级选项提升为 Runtime 的默认感知能力，同时保持 deterministic、exact、lexical、graph 通道的权威优先级。Semantic 缺少模型或索引时必须可降级，不能阻断 canonical memory 写入。

## Locked contract

- `openV12Pmem({ root })` 为旧项目注入 pinned local semantic manifest；首次打开不下载模型。
- `embedding.auto_enabled: false` 是显式关闭标记；`pmem semantic clear` 写入该标记并保留模型资产。
- 模型资产仍由显式 `pmem semantic setup` 管理，缓存位于用户级目录，不进入 npm 包。
- capture 成功提交 canonical event 后执行 best-effort incremental semantic refresh；模型缺失、companion 缺失或推理失败只产生 `unavailable/degraded` 状态。
- semantic index metadata 固定记录 `metadata_version`、`model/revision/dimension`、`chunk_strategy` 与 receipt 文件一致性；版本不兼容时不可查询。

## Acceptance criteria

1. 默认 Runtime manifest 具备 pinned model coordinates，但不因打开项目而下载或导入模型。
2. 显式关闭在后续 Runtime open 中保持关闭；deterministic ask/recall 继续可用。
3. capture 在 semantic 不可用时仍提交 canonical event，并返回可机器读取的降级状态。
4. 缓存存在时增量构建复用未变 chunk；缓存或 index 不可用时提供可恢复原因。
5. semantic status 暴露 metadata/chunk strategy/version，旧 metadata 不会伪装成兼容索引。
6. TypeScript、targeted runtime/semantic tests 与完整 `npm test` 通过。

## Deferred

- Context Packaging、Memory Health、自动 consolidation 与新的 backend 不属于本切片。
- 直接 Markdown 编辑后的后台 watcher 不在 v1.3.1 引入；rebuild/semantic rebuild 仍是显式恢复入口。
