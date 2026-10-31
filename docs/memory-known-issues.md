# Memory 已知问题记录

本文记录 2026-10-31 对 LongMemEval oracle 进行首轮评测时暴露的问题、证据和当前状态。这里记录的是实际观察，不把未验证的修复写成已完成。

## 评测背景

- 数据集：LongMemEval oracle，500 题中先取 10 题，stratified 抽样。
- 评测方式：每题独立 SQLite；导入 L0；建立 L1、L2、L3；L3 → L2 → L1 → L0 检索；独立上下文回答；LLM judge。
- 第一次完整 10 题使用 `deepseek-flash`、`max-context=16000`、回答 `max_tokens=1024`、L1 maintenance 使用确定性 keep。
- 之后的单题验证使用 `deepseek/deepseek-v4.1-flash-ultrafast`、OpenAI Chat Completions 网关、`max-context=24000`、回答 `max_tokens=4096`，并按 session 增量建立记忆。
- 结果目录：
  - 10 题：`/tmp/pmem-lme-10`
  - 单题：`/tmp/pmem-lme-gw-supersede`
- 结果目录只在本地，不进入仓库。

## 10 题总体结果

| 指标                   |         结果 |
| ---------------------- | -----------: |
| 题目数                 |           10 |
| 完成回答               |            9 |
| 失败                   |            1 |
| Judge 正确             | 4 / 9 已回答 |
| Judge 错误             | 5 / 9 已回答 |
| 端到端正确率           | 4 / 10 = 40% |
| L3 命中                |       8 / 10 |
| 降级 L2                |       2 / 10 |
| 平均 session recall    |        0.861 |
| 平均 session precision |        1.000 |
| 平均 turn recall       |        0.694 |
| 平均 context           |   9,664 字符 |
| context 截断           |        2 / 9 |
| 总耗时                 |     844.7 秒 |
| 模型调用               |        67 次 |
| total tokens           |      394,670 |

阶段耗时：

| 阶段    | 总耗时 | 调用 |  tokens |
| ------- | -----: | ---: | ------: |
| L1 提炼 | 425.1s |   19 | 173,600 |
| L1 维护 |   1.0s |    0 |       0 |
| L2 生成 | 278.8s |   20 | 150,804 |
| L3 生成 | 112.3s |   10 |  46,783 |
| 检索    |  0.13s |    0 |       0 |
| QA 回答 |  11.3s |    9 |  21,203 |
| Judge   |   9.3s |    9 |   2,280 |

## 2026-10-31 复测

使用同一套 10 题 stratified oracle 样本，在 `deepseek/deepseek-v4.1-flash-ultrafast` 网关和 `max-context=24000` 下复测：

| 指标         |        结果 |
| ------------ | ----------: |
| 完成回答     |     10 / 10 |
| Judge 正确   |      7 / 10 |
| Judge 错误   |      3 / 10 |
| L3 命中      |      9 / 10 |
| 降级 L2      |      2 / 10 |
| cache hit    |      9 / 10 |
| 平均 context | 12,378 字符 |
| 总耗时       |    468.9 秒 |
| 模型调用     |       79 次 |

阶段耗时：

| 阶段    |   耗时 | 调用 |  tokens |
| ------- | -----: | ---: | ------: |
| L1 提炼 | 210.2s |   19 | 170,755 |
| L1 维护 |   1.0s |    0 |       0 |
| L2 生成 | 138.0s |   22 | 131,996 |
| L3 生成 | 101.5s |   18 |  72,107 |
| 检索    |   0.2s |    0 |       0 |
| QA 回答 |  11.4s |   10 |  30,361 |
| Judge   |   6.1s |   10 |   3,088 |

结果目录（不进入仓库）：

```text
/tmp/pmem-lme-agentboundary
```

### 结论

- Jev 替代门控生效：`27:12 -> 25:50` 题回答为 `25:50`，judge 正确。
- 端到端正确率从上一轮的 4 / 10 提升到 7 / 10。
- 仍错的 3 题不是同一个原因：
  - `0a995998`：答案只列出 2 件衣物，参考为 3 件；检索 session 齐全，回答漏项。
  - `8a2466db`：context 达到 24,000 字符上限，回答变成拒绝；需要更大上下文或更好的压缩。
  - `6d550036`：只召回 3 / 4 个 session，回答只识别 1 / 2 个项目；检索缺口。
- 这次是 Memory pipeline 的 live 评测，不是 Agent runtime 的工具循环评测；Agent runtime 的 live 验证仍需单独跑。

### 状态更新

- 问题 1（旧事实仍进入回答）：本轮已不再出现，Jev 门控保留。
- 问题 2（L1 update / supersede）：仍未实现，L1 层仍可能保留旧版本。
- 问题 3（L2 当前/历史分离）：Jev 门控已覆盖当前 L2；仍需要 L1 层对应能力。

## 当前问题

### 1. 知识更新没有收敛，旧事实仍会进入回答

**状态：L2 已接入替代门控，未做 LongMemEval 复测。**

典型题目：

```text
What was my personal best time in the charity 5K run?
```

参考答案：

```text
25 minutes and 50 seconds (or 25:50)
```

10 题运行的回答：

```text
27:12
```

L2 同时保留了两个值：

```text
个人最好成绩是 25:50
（也记录了 2023-05-25 的 27:12）
```

单题重跑后，L2 仍然把两个值写在一起，回答仍然是 `27:12`。

影响：

- 知识更新题无法稳定回答当前有效事实。
- L3 关键词能命中，但不能判断哪个 L2 事实是当前有效版本。
- 旧 L0/L1/L2 会一起进入回答上下文，模型只能并列陈述。

### 2. L1 缺少 update / supersede 语义

**状态：未实现。**

当前 L1 maintenance 只有：

```text
keep / uncertain / merge
```

没有：

```text
update / supersede / skip
```

因此同一事实的新旧版本可以同时保留在 L1。旧 L1 仍然会被 L2 引用，也会被 L1 召回或进入回答上下文。

10 题评测为了控制变量使用了确定性 `keep`，这进一步放大了旧事实保留问题。它是评测捷径，不是生产行为。

### 3. L2 只有 create/update，没有“当前状态/历史状态”分离

**状态：已接入 Jev 门控，未做 LongMemEval 复测。**

在接入 Jev 门控前，L2 只有 create/update，没有稳定的：

- `supersededBy`
- 当前有效版本与历史版本分离
- 默认召回排除被替代版本
- 旧 L1 链接的自动迁移/移除

已尝试的修改：

- 增加 L2 `supersede` 标志。
- 允许更新时替换旧 L1 链接。
- L2 prompt 升级为 `l2-v2`，要求新事实替代旧事实时设置 `supersede: true`。
- 输入增加 L1 `createdAt` 和 L2 `updatedAt`。

单题验证结果：

- 模型没有设置 `supersede: true`。
- 它把旧值和新值都写进了 L2 body。
- 旧 L1 链接仍然保留。
- 回答仍然选到旧值。

结论：**只加 L2 标志和 prompt 约束不够。**

后续已补 L2 事实替代门控：

- TypeSafe Jev 1.14，经 OpenRouter Decisions API 调用。
- `replacement` 时把旧 L2 排除出模型上下文，生成新的当前 L2。
- 旧 L2 写入 `superseded_by`，`visible = 0`，默认列表、召回和 L3 解析都不再返回它。
- 判断失败时 L2 任务失败或未知，不把失败当成“没有替代”。
- 已用假 judge 验证 L2 集成，并用真实 Jev 1.14 验证 `27:12 → 25:50` 分类为 `replacement`。

仍未做完整 LongMemEval 复测，因此还不能把当前结果写成“知识更新已解决”。L1 旧记录仍保留，回答路径目前依赖当前 L2 不再关联它。

### 4. L3 是关键词缓存，不是事实权威

**状态：设计边界正确，但对知识更新不够。**

L3 能：

- 命中关键词
- 指向来源 L2
- 标记 `needsRefresh`
- 过期和刷新

L3 不能：

- 判断 `25:50` 和 `27:12` 哪个是当前事实
- 删除旧 L2
- 决定旧 L1 是否应被替代

当前 L3 的 `needsRefresh` 只表示“来源 L2 变了”，不等于“旧事实已经失效”。

### 5. 回答上下文混合 L2、L1、L0，旧证据可能同时出现

**状态：未解决。**

`resolve` 当前会返回：

```text
L3 keywords
L2 bodies
L1 content
L0 source turns
```

当 L2 没有收敛时，L0/L1 中的旧值仍会进入回答上下文。回答模型没有可靠的“当前/历史”标记，只能看到两个冲突事实。

需要：

- 默认只放当前有效 L2/L1。
- 旧版本加 `superseded` 标记。
- 只有明确需要历史时才返回旧版本。

### 6. 缺少来源时间和有效期

**状态：部分补充。**

L1 有 `createdAt`，但来源 L0 的 `occurredAt` 没有稳定进入 L2 的当前状态判断。L2 输入已增加 `createdAt` / `updatedAt`，但仍缺少：

- `observedAt`
- `validFrom`
- `validTo`
- `supersededAt`

没有这些字段，模型很难稳定判断“哪个事实更晚、哪个已被替代”。

### 7. 上下文预算不足

**状态：已调整参数，未复测。**

10 题运行使用 `max-context=16000`，有 2 题被截断：

- `6aeb4375` 韩餐计数
- `6d550036` 项目计数

`6d550036` 实际有 4 个 session、20 个 L1、18 个 L0，参考答案为 2，回答为 1。截断直接影响了多 session 计数。

之后已改为 `max-context=24000`，但没有完整复测。

### 8. 回答输出预算不足导致空响应

**状态：已调整参数，未复测。**

`0a995998` 在回答阶段返回：

```text
completion_tokens=1024
reasoning_tokens=1024
content 为空
```

原因是 reasoning tokens 用完了输出预算。回答 `max_tokens` 已从 1024 提高到 4096，但没有用同一批题目复测。

### 9. L2 生成失败时使用确定性 fallback

**状态：评测捷径。**

10 题中 `gpt4_2655b836` 的 L2 真实生成失败过一次，使用了确定性 fallback。它保证评测继续，但会改变该题的 L2 质量和耗时分布。

该 fallback 不应被当作生产策略。

### 10. 首轮 10 题不是增量建库

**状态：harness 已改，未复测。**

首轮 10 题是：

```text
一次性导入全部 session
→ 全部 L1
→ 全部 L2
→ 全部 L3
→ 回答
```

这不能真实测试知识更新和时序变化。

之后 harness 已改为：

```text
按 session 时间排序
→ 每个 session 建立 L0/L1
→ drain maintenance
→ drain L2
→ drain L3
→ 全部完成后再回答
```

单题已验证增量流程可以跑通，但还没有用同一批 10 题复测。

### 11. 缺少 L3-first 与 L2-only 对照

**状态：未完成。**

目前只测了 L3-first 路径，没有在相同题目上跑：

- L2-only
- L1-only
- 全量历史长上下文

因此不能判断 L3 是否真的优于直接检索 L2。

### 12. Judge 使用同一模型，存在评估偏差

**状态：未解决。**

当前 judge 使用生成模型做等价判断，没有人工复核。`answerContains` 只能做精确包含，和 judge 结果差异较大。

10 题中：

```text
Judge 正确：4
精确包含：2
```

这说明不能只用字符串匹配替代 judge，但 judge 本身也需要校准。

### 13. Oracle 的召回指标偏乐观

**状态：方法限制。**

Oracle 只保留证据 session，不含大量干扰。10 题的平均 session recall 0.861 不能代表 LongMemEval-S 的真实检索难度。

当前还没有跑 S 子集。

## 根因归纳

当前最核心的问题不是 L3 检索，而是**缺少事实级的冲突/替代机制**：

```text
新事实进入
→ 没有判断它是否替代旧事实
→ 旧 L1/L2/L3 仍然保留
→ 回答上下文同时看到新旧事实
→ 模型无法稳定选择当前事实
```

TencentDB 对应的是：

- L1 `store/update/skip/merge` 冲突检测
- L2 默认 UPDATE、冲突覆盖并记录演变
- L3 前置 JEV 判断 `conflict` / `replacement` / `addition` / `none`
- 旧版本不进入当前回答上下文

PMEM 目前只有：

- L1 `keep/uncertain/merge`
- L2 create/update
- L3 关键词 `needsRefresh/expired`

缺少“当前有效事实”的权威状态。

## 下一步

按优先级：

1. L1 增加 `update` / `supersede`，带 `targetIds` 和来源时间。
2. L2 事实替代门控已接入；仍需用同一批 10 题复测，确认模型不会把旧事实重新引入新 L2。
3. L3 只指向当前有效 L2；旧关键词刷新或过期。
4. 回答上下文默认排除 `superseded` 的 L1/L2/L0。
5. 用同一批 10 题复测，对比 40% 基线和修复后的结果。
6. 跑 L2-only 对照，确认 L3 的增量收益。
7. 再扩到 50 题和 LongMemEval-S 子集。

在任何复测前，不把当前 40% 结果当作 L3 或 Memory 的最终质量结论。
