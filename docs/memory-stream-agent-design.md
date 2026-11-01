# Memory Stream Agent 设计

本文替代此前的 Memory Worker 池设计。L1/L2/L3 不再按 batch job 并行生成，也不再使用 Worker pool。所有待处理记忆进入一个持久化队列，由单个 Memory Stream Agent 按顺序逐条处理。

状态：Phase A–D 已完成（`0012_drop_jobs`、`0013_drop_orphan_job_results` 与 2026-11-01 的 batch job API 清理）。用户数据表（L0/L1/L2/L3 事实）没有被删除。

## 实现进度

已完成：

- `memory_stream_queue` 持久化队列。
- enqueue 去重、串行 next、claim、finish、retry、running 恢复。
- `MemoryStreamAgent` 单 session、固定 submit tool。
- L1 / L1 maintenance / L2 / L3 stream handlers。
- L0 append 自动入队 L1。
- L1 自动入队 maintenance + L2。
- L2 自动入队 L3。
- `MemoryStreamPipeline` 与 `MemoryStreamIngest`。
- 旧 job 表和旧 scheduler 已删除。
- L1 不再需要 job 外键。

当前测试：

```text
bun run check
26 tests
26 pass
```

Stream live 验证：

```text
L1 count: 2
L2 count: 2
L3 count: 5
queue state: 7 done
model calls: 15
```

Live 使用真实网关模型和 `memory_stream_submit`，最终队列全部 done。

## 1. 结论

```text
Memory Queue
  -> one item
  -> persistent Memory Stream Agent session
  -> typed submit tool
  -> Service apply
  -> next item
```

只有一个长期 session，一条串行队列。

不再使用：

- L1/L2/L3 batch job
- Worker pool
- 并发 worker
- 按 scope/family 拆多个生成 session
- 每批新请求重新构造上下文

保留：

- 持久化队列
- 单条 item 状态
- 失败/unknown/幂等
- L2 Jev 门控
- Service/Repository 数据权威

## 2. 为什么

当前 worker/batch 设计的问题：

- job 的 claim、批大小、并发、重试和清理复杂。
- 多 worker / 多 job 并行会制造多个上下文前缀，provider cache 命中差。
- 每个 batch 重新发送相似上下文，token 成本高。
- 失败时 batch 内部分成功/部分失败，状态复杂。
- 为了 cache 还要做 worker key/session 映射、pool、rotation。

串行 stream 的收益：

- 一个稳定 system/tool prefix。
- 所有 item 追加到同一 transcript。
- 没有并行 cache 分叉。
- 队列天然串行，不需要 worker pool。
- 每条 item 的 apply 更小、更容易幂等。
- 长上下文模型可以把历史留在上下文里。
- cache read 更稳定。

代价：

- 吞吐量低于并行。
- 单条 item 延迟不变，但总处理时间可能更长。
- 必须控制 context 增长和 session 轮换。

这里明确接受吞吐量下降，换取更稳定的 cache 成本和更简单的状态。

## 3. 队列模型

不叫 job。使用 `memory_queue_items`。

```text
id
workspace_id
scope_id
kind: l1-extract | l1-maintenance | l2-synthesize | l3-keywords
subject_id
source_ref
state: pending | running | done | failed | unknown
attempt
available_at
started_at
finished_at
error_code
created_at
updated_at
```

`subject_id` 指向：

- L1 extract：L0 message id
- L1 maintenance：L1 memory id
- L2 synthesize：L1 change id
- L3 keywords：L2 change id

`source_ref` 用于携带处理时的 hash 或版本，防止源变化后提交旧结果。

### 单项状态

```text
pending
  -> running
  -> done | failed | unknown
```

- 单条处理，最多一个 running item。
- 失败不会阻塞整个队列；记录后继续下一条。
- unknown 不自动重放；显式 retry。
- 不删除原始 L0/L1/L2 数据。

## 4. 单 session

每个 workspace/scope 一个持久 Memory Stream session：

```text
memory-stream:<workspace>:<scope>
```

session 共享：

- 一个稳定 Harness。
- 一组稳定 submit tools。
- 一个持久 transcript。
- 一个 model/provider。
- 一个 cache 序列。

不按 L1/L2/L3 分 session，因为：

- 用户明确要求不再使用 worker。
- 一个 session 可以共享前缀 cache。
- 所有 item 都是同一条记忆流。
- 工具 set 固定后不会因 job 改变。

如果后续发现 L1/L2/L3 的指令互相干扰，再考虑按任务类别拆分；当前不拆分。

## 5. 处理流程

```text
queue.next()
  -> load one item
  -> append item envelope as user message
  -> Agent reads context
  -> Agent calls memory_submit (typed, discriminated by kind)
  -> Service validates + applies one item
  -> mark done
  -> append compact receipt
  -> next
```

个 item 的 envelope 只包含：

- item id
- kind
- subject
- 必要 source/evidence
- current time
- schema version

不包含 batch 数组，不包含其他 queue items。

## 6. 工具

一个固定的提交工具，或按 kind 的固定工具集。推荐：

```text
memory_stream_submit
```

参数使用 discriminated union：

```ts
{ kind: 'l1-extract', memories: [...] }
{ kind: 'l1-maintenance', decision: {...} }
{ kind: 'l2-synthesize', result: {...} }
{ kind: 'l3-keywords', keywords: [...] }
```

工具不接受：

- jobId
- claimToken
- spaceId
- scopeId
- queue item state

当前 item 由 Host 从 stream state 注入。

工具调用 Service 的 item apply 方法，Service 仍负责：

- source hash
- access
- L1/L2/L3 业务校验
- L2 Jev
- transaction
- idempotency

## 7. L2 Jev

L2 的 Jev 仍在 Service 内执行：

```text
process L2 item
  -> load changed L1 + candidates
  -> Jev replacement/addition/...
  -> Agent generates proposal
  -> apply item
  -> code applies supersede
```

Agent 不决定 supersede。

## 8. 上下文与 cache

稳定前缀：

```text
Harness system prompt
+ fixed submit tool schemas
+ stream instructions
```

追加：

```text
item envelope
submit call
receipt
next item envelope
...
```

规则：

- 不重建 system prompt。
- 不重写历史。
- 不把动态 memory 放进 system。
- 不并行 item。
- 不创建多个 cache 分叉。
- 只在一个 session 的尾部追加。

Context 预算：

- provider usage 返回的 input/cacheRead/cacheWrite 作为近似。
- 达到阈值后轮换 session，更新 stream mapping。
- 轮换只发生一次，不在 batch 中间发生。
- 长上下文幻觉问题当前不作为阻塞项；后续用评测观察。

## 9. 调度

一个串行 `MemoryStream` 循环：

```text
if one item running: wait
else next pending item
```

- 不启动 L1/L2/L3 独立 scheduler。
- 不做 batch 组装。
- 不做并发 claim。
- L0 append 只 enqueue 一条 L1 item。
- L1 commit enqueue maintenance / L2 item。
- L2 commit enqueue L3 item。
- 失败后继续队列，不阻塞其他 item。

## 9.4 记忆工作改为单次结构化调用（2026-11-01）

原先每条 item 都走 Miao 的工具循环：user 消息（envelope）→ `memory_stream_submit` 工具调用 → 工具结果 → 再要一句收尾。这等于**每条 item 两次模型调用**，还额外发送 harness 指令和工具 schema。

现在记忆工作不再经过 agent 会话，而是一次性构建 prompt：

- `MemoryStreamWorker`（`src/agent/memory-worker.ts`）只做「取队列 → 批处理 prepare → 一次模型调用 → apply → 收尾」，没有 session、没有工具循环。
- `OpenAIMemoryStreamModel`（`src/agent/memory-model.ts`）按 kind 选 system prompt 与 JSON Schema：system 放规则，user 只放数据（`itemIds`/`rules`/`outputTool` 等路由字段不进入 prompt），请求带 `response_format: json_schema`（strict）+ `max_tokens`，直接解析 JSON。
- 旧路径仍然保留：`MemoryStreamAgent` 用 Miao 会话跑队列，供需要工具/多轮能力的宿主使用；评测与无头处理应使用 Worker。

收益：每条 item 从 2 次调用降到 1 次，prompt 里不再有 harness/工具定义/历史会话，上下文大小稳定（不再随 item 累积增长）。

## 9.5 一次调用覆盖多条 item（2026-11-01）

串行不等于「一条 item 一次模型调用」。`MemoryStreamPipeline` 在取到一条 item 后，会把同 kind、同 scope 的 pending sibling 一起准备，一次 prompt 覆盖整批：

| kind             | 每批上限 |
| ---------------- | -------: |
| `l1-extract`     |        5 |
| `l1-maintenance` |        5 |
| `l2-synthesize`  |        3 |
| `l3-keywords`    |        6 |

- sibling 只在其 source hash 仍然匹配时并入；source 变化或消失的项不进入批次。
- 成功 apply 后，被覆盖的 sibling 标记为 `done`（`MemoryStreamRepository.absorb`），失败时保持 pending，下一条 item 会重新组成批次，因此单条失败不会拖垮整批。
- 生产环境逐轮捕获时队列里通常只有一条 pending item，批大小为 1，行为与之前一致；收益出现在积压（批量导入、评测、追平）场景。
- L2 改为在 **maintenance 提交之后**入队（`L1MaintenanceStreamHandler.onCommitted`），此前 L1 一提交就入队，导致 L2 可能先于 maintenance 被消费并以 `INVALID_INPUT`（L1 尚未 ready）失败。
- 非 `l1-extract` 的 item 切换时轮换 session（`MemoryStreamAgent.runNext`），避免把整段抽取历史带给 maintenance/L2/L3；L1 保持同一 session 以维持 prompt cache。
- 记忆工作全局关闭 provider 侧 thinking（`MemoryStreamAgent` 强制 `thinkingLevel: 'off'`，catalog 使用 `thinking: 'off'`）：抽取/维护/合成是机械任务，thinking 只增加延迟与 token。回答由宿主决定，保持 provider 默认。
- 模型能力按 1M 上下文窗口、256k 单次输出配置；session 轮换预算默认取满窗口 1M（`contextBudgetTokens`），暂不设置额外上限，成本核对后再收紧。
- 过期（`*_STALE_INPUT`）会以当前 hash 重新入队；source 已不存在或工作已完成（`JOB_NOT_FOUND` / `JOB_NOT_PENDING`）直接跳过。

## 10. 迁移

### Phase A：新队列

- 新增 `memory_queue_items`。
- L0 append 入队 L1 extract。
- 旧的 job 表保留但不写入，作为回退。（后续 `0012_drop_jobs` 已删除这些表：它们只保存派生状态，不属于用户数据。）

### Phase B：单 session stream

- 创建 `MemoryStreamAgent`。
- 固定 Harness 和 submit tool。
- 从队列取一条 item，append，submit，apply。
- 不做 batch，不创建 worker。

### Phase C：替换 L1/L2/L3

- L1 extract 逐条处理。
- L1 maintenance 逐条处理。
- L2 逐条处理（Jev 仍执行）。
- L3 逐条处理。
- 删除旧 job 调用路径。

### Phase D：清理（已完成）

- 删除 Worker 代码、worker pool、L1/L2/L3 scheduler 的 job 路径。
- 删除 job 表和迁移只在新迁移中完成，不直接删除用户数据：`0012_drop_jobs` 删除 12 张 job/change 表，`0013_drop_orphan_job_results` 清掉漏掉的 `memory_l3_job_results`。
- 代码侧同步删除：`L1Service.enqueue/run/getJob/listJobs/retry/markInterrupted/getJobMemories`、`L2Service.recordChange/listChanges/enqueue/getJob/retry/run`、`L3Service.listChanges/enqueueColdStart/enqueue/getJob/retry/run`、`L1MaintenanceService.startBatch/listTasks/retry/markInterrupted`，以及 `schema.ts` 中对应的表声明。
- 保留的是真实行为：`scope-propagation.ts` 继续在 L1 scope 变化、L1 合并和 L2 写入后重算 L2 scope 与 L3 关键词（`l2-invalidation.ts`/`l3-invalidation.ts` 中只写 change 表的部分已删除）。
- 保留旧迁移和回退说明。

## 11. 删除边界

“清除 job 和 worker”指：

- 删除 batch job API。
- 删除 WorkerPool / worker session 映射。
- 删除 L1/L2/L3 独立 scheduler 的 job 编排。
- 删除 batch claim / partial batch 状态。

不等于：

- 删除队列 item 状态。
- 删除 source/evidence 记录。
- 删除失败/unknown/幂等。
- 删除历史数据表。

队列 item 是持久化事实；可以改名字/模型，但不能没有状态。

## 12. 验收

- 没有 batch job，没有 worker pool。
- 单 workspace/scope 只有一个 stream session。
- item 串行 append，不并行。
- 每条 item 有独立状态、错误和幂等。
- L2 Jev 仍生效。
- provider cacheRead 随 item 累积。
- 单条失败不会阻塞队列。
- session 预算轮换不丢 item。
- 旧数据表不在未迁移情况下删除。
