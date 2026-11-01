# Memory Stream Agent 设计

本文替代此前的 Memory Worker 池设计。L1/L2/L3 不再按 batch job 并行生成，也不再使用 Worker pool。所有待处理记忆进入一个持久化队列，由单个 Memory Stream Agent 按顺序逐条处理。

状态：目标架构，待替换现有 job/worker 实现。用户数据和迁移表不在此过程中删除。

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

## 10. 迁移

### Phase A：新队列

- 新增 `memory_queue_items`。
- L0 append 入队 L1 extract。
- 旧的 job 表保留但不写入，作为回退。

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

### Phase D：清理

- 删除 Worker 代码、worker pool、L1/L2/L3 scheduler 的 job 路径。
- 删除 job 表和迁移只在新迁移中完成，不直接删除用户数据。
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
