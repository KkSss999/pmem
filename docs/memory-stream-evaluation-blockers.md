# Memory Stream 评测阻塞问题

本文记录 2026-10-31 对当前 Stream 版本跑 LongMemEval 10 题时暴露的问题。结论是：**当前 Stream 不适合直接进入 10 题评测，先修性能和失败隔离。**

## 评测配置

```text
数据集: LongMemEval oracle cleaned
题目: 10 题 stratified
模型: deepseek/deepseek-v4.1-flash-ultrafast
网关: https://apis.opengateway.ai/v1
Jev: off
top-k: 5
max-context: 24,000
```

评测在以下状态停止：

```text
第 1 题失败
第 2 题刚开始
进程手动停止
没有生成完整 10 题 summary
```

因此当前不能报告 10 题正确率，也不能把旧版 7/10 当成 Stream 版本结果。

## 实测数据

### 第 1 题 `6a1eabeb`（knowledge-update）

第一段会话，12 条 L0：

```text
stream items: 71
model calls: 122
tokens: 5,091,147
耗时: 121,973 ms
```

这 122 秒不是单条 L0 的 L1 提炼，而是 12 条 L0 串联跑完：

```text
L1 提炼
-> L1 maintenance
-> L2
-> L3
```

第二段会话，同样 12 条 L0：

```text
卡在: l1-maintenance
等待: 300,000 ms
结果: Timed out waiting for the Agent response.
整题耗时: 465,297 ms
整题结果: failed
```

### 早先跑通的单题 `gpt4_2655b836`

36 turns / 3 sessions：

```text
stream items: 242
model calls: 397
tokens: 65,020,498
耗时: 730,813 ms（约 12 分钟）
L3 session recall: 1.0
Judge: correct
```

这说明链路可以跑通，但成本和时间不可接受。

### 与旧版 10 题对比

旧版 10 题总计：

```text
model calls: 79
tokens: 394,670
耗时: 468.9s
```

Stream 单题：

```text
model calls: 397
tokens: 65,020,498
耗时: 730s
```

**Stream 一题的调用量和 token 已超过旧版十题。**

## 问题清单

### 1. Stream item 数量放大

12 条 L0 产生 71 个 item，约 6 倍放大。

当前触发关系：

```text
每条 L0 -> 一个 L1 item
每条 L1 -> 一个 maintenance item + 一个 L2 item
每个 L2 result -> 一个或多个 L3 item
```

问题不在串行本身，而在“串行 + 每个小步骤都单独调用模型”。串行把一个本来可以合并的工作拆成了大量昂贵请求。

### 2. 每条 L1 都单独触发 L2 / L3

当前粒度是“每条 L1 一次 L2”，而不是“一段会话的 L1 集合一次 L2”。

后果：

```text
L2 反复生成
L3 反复生成
候选和上下文重复
调用次数随 L1 数量线性增长
```

需要重新确定聚合单位。这里不是恢复 batch job，而是 Stream item 的 subject 粒度选错了。

### 3. 持久 session 上下文无限增长

所有 item 共用一个持久 session。每个 prompt 都携带前面的 transcript，因此 prompt token 随 item 数量快速增长。

单题实测：

```text
5.09M tokens / 12 条 L0
65M tokens / 36 turns
cache hit rate: 98.8%
```

缓存降低了单价，但没有降低总 token、延迟和上下文压力。

当前在 700k context budget 才轮转 session，轮转太晚。需要重新设计：

```text
每个 item 独立短上下文
或按更小预算轮转
或只保留固定前缀 + 当前 envelope
```

### 4. maintenance 无候选时仍然调用模型

现在每条 L1 都会入队 maintenance，即使没有候选需要合并，仍会发一次模型请求。

应该在 `prepareStream` 阶段直接判断：

```text
没有 candidates
-> 直接 keep
-> 不调用模型
```

这是低风险、确定性的优化。

### 5. 20k 输入上限靠截断绕过

MiaoTs `input.send` 限制 20,000 字符。L2 candidate envelope 很容易超限。

调试时加入了 `fitStreamEnvelope`，默认压到 10,000 字符：

```text
长字符串截断
数组截断
```

这会让模型丢失候选、证据和来源。它不是正式方案，只是让评测继续跑的临时绕过。

需要从 envelope 设计上解决：

```text
只传 ID 和必要摘要
候选分页
按需读取证据
```

不能依赖运行时静默截断。

### 6. 一个 item 超时会废掉整题

`l1-maintenance` 等待 300 秒后，`runUntilIdle` 抛错，整题进入失败分支，剩余 pending item 不再处理。

缺少：

```text
item 级超时
单 item 失败后继续
队列状态与失败状态一致
可恢复/可重试路径
```

当前 `lastItem` 仍显示 `running`，说明队列状态和运行状态之间也需要检查。

### 7. 评测统计没有按 kind 拆分

目前只有：

```text
stream items 总数
model calls 总数
tokens 总数
```

看不出 L1、maintenance、L2、L3 各自占多少时间、调用和 token。

下一步至少需要记录：

```text
kind
subjectId
queue wait
prepare time
model time
prompt chars
calls
result state
```

没有这些数据，只能看到“慢”，不能判断该砍哪一段。

### 8. 评测脚本已迁移到 Stream（已修复）

`scripts/eval-l1.cjs` 和 `scripts/eval-longmemeval.cjs` 曾调用旧的 `l1.enqueue/run`、`l2.enqueue/run`、`l3.enqueue/run`，在 job 路径删除后无法运行。

现在两个脚本都通过 `scripts/stream-eval-runtime.cjs` 驱动生产流水线：独立数据库、独立 Stream 会话、`MemoryStreamAgent.runUntilIdle`，L1 维护、L2、L3 由流水线自动产生，脚本只负责构造 L0、检索、回答与打分。评测结果按队列项状态统计，models 调用与 token 用量来自 runtime 的 model journal。

仍有待处理：

- 单 item 失败（模型输出未通过校验）会留在队列里，脚本只做统计不做重跑。
- 缺少按 kind、按题恢复运行的能力。

### 9. Jev 不是本次瓶颈

本次评测 `--jev=off`，Jev 没有参与。

Jev 平均响应约 500ms，和当前 2 分钟会话、300 秒超时不在一个量级。Jev 只影响 L2 候选判断，不能解释 L1/maintenance 的调用量。

后续应该保持 Jev 开启，但不要把它当成当前性能问题的根因。

## 当前工作树状态

以下改动尚未提交：

```text
Stream queue / session / pipeline / handlers
Stream 版 L1/L2/L3 service 方法
旧 scheduler / job 路径删除
fitStreamEnvelope 临时截断
lastItem 调试字段
Stream 评测临时脚本（/tmp）
```

`bun run check` 的 26 个测试通过，但没有覆盖真实模型延迟、20k envelope 和长会话成本。

## 下一步顺序

1. ~~**先做 kind 级 instrumentation**，跑一个 12 条 L0 的单 session，拿到 L1 / maintenance / L2 / L3 的精确分布。~~ 已完成：`scripts/stream-eval-runtime.cjs` 的 `runTraced` 记录每条 item 的 envelope、模型原文、提交 payload、每次调用的耗时/tokens/上下文大小。
2. ~~**跳过无候选 maintenance 的模型调用**，直接 keep。~~ 已完成：`L1MaintenanceStreamHandler` 在无可比较 case 时本地收尾。
3. ~~**重新设计 L2/L3 聚合粒度**：会话级 L1 集合，而不是每条 L1 单独触发。~~ 已完成：同 kind 的 pending item 合并成一次调用（L1 5 / maintenance 5 / L2 3 / L3 6），见 [memory-stream-agent-design](memory-stream-agent-design.md#95-一次调用覆盖多条-item2026-11-01)。
4. ~~**控制 session 上下文**：不能每个 item 都带完整历史。~~ 已完成：非 `l1-extract` 的 kind 切换时轮换 session；模型按 1M 窗口 / 256k 输出配置，轮换预算默认 1M（`--context-budget` 可覆盖）；记忆工作全局关闭 thinking，仅回答保留 provider 默认。
5. **从设计上限制 envelope**，去掉 `fitStreamEnvelope` 静默截断。（未做：截断仍静默，需要 envelope 预算和显式报错。）
6. ~~**加 item 级超时和失败隔离**，单 item 失败不能废掉整题。~~ 已完成：`--item-timeout` 映射到 `promptTimeoutMs`；失败项只标记自身，sibling 保持 pending 重新组批。
7. ~~**把 Stream 版评测脚本收进仓库**，支持按 kind、按题恢复运行。~~ 部分完成：脚本已收进仓库，`questions.json` 支持按题恢复（`--resume=off` 关闭）；按 kind 恢复未做。
8. 用 12 条 L0 的单 session 设性能门槛；达标后再跑 10 题。
9. 10 题通过后，再开 Jev 做 knowledge-update 对比。

## 结论

当前问题不是 LongMemEval 太难，也不是 Jev 慢，而是：

```text
任务粒度过细
+ 持久上下文增长
+ L2/L3 重复生成
+ 缺少失败隔离
```

在这些问题解决前，继续跑 10 题只会消耗时间和 token，不能得到可信的评测结论。
