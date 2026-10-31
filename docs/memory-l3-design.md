# L3 关键词缓存设计

本文定义 PMEM L3 的定位、数据形态、生成、权重、过期和查询边界。L3 尚未实现；本文是首版设计基线。总体依赖见 [Memory 代码设计基线](memory-design.md)，L2 设计见 [L2 代码设计](memory-l2-design.md)。

## 定位

L3 是长期 Agent 工作沉淀出的关键词缓存，不是一份长期文档，也不是新的内容权威。

- 输入只来自 L2，不直接读取 L0/L1。
- 每条 L3 是一个短关键词或别名，不是事实句、摘要段或原文摘录。
- L3 是派生检索层：来源仍是 L2/L1/L0；关键词随来源变化而刷新或过期。
- 一个调用方看到的 L3，是其可读空间范围内所有关键词条目按归一化词合并后的总和。
- 关键词可以跨空间存在；同一词在不同空间范围可以是不同条目，查询时合并。

关键词应当：

- **短**：优先 1–4 个词，最长不超过配置上限。
- **间接**：抽象为可复用的检索入口，不直接复制 L2 句子，不把一次任务状态写成关键词。
- **有代表性**：能稳定指向一类主题、对象、偏好、工具或概念，而不是一次性细节。

## 首版范围

**包含**

- 从 L2 变化生成、更新关键词
- 别名、类型、基础权重
- 跨空间可见范围、来源关联和失效处理
- 命中统计、权重、滑动过期
- 精确/别名查询和 FTS 兜底
- 关键词列表、索引状态和重建
- 与 L2 变更同事务的失效标记

**不包含**

- L3 文档、画像章节或叙事模板
- 人工编辑
- 关键词删除接口；首版用过期和刷新代替
- 深层检索算法、查询扩展、图遍历
- 与 Knowledge / Wiki Graph 的任何表、API 或排序耦合
- L1/L2/L3 组合排序
- 多 Agent 身份模型；当前仍按空间与会话范围表达

## 职责与依赖

- `domain/memory/l3.ts`：关键词、别名、类型、权重、状态和错误；不依赖 SQLite、模型或入口。
- `service/memory/l3.ts`：查询、列表、生成批次提交、命中记录、过期和刷新。
- `service/memory/l3-ports.ts`：关键词仓储、搜索索引、模型和时钟端口。
- `db/memory/l3-repository.ts`：关键词、范围、来源、变更和任务表；拥有迁移。
- `db/memory/l3-search-index.ts`：FTS5 索引、状态检查和重建。
- `server/l3.ts`、`server/l3-scheduler.ts`：装配 Service、仓储和模型。
- `other/models/openai.ts`：实现 L3 模型端口。

L3 是 Memory 内部派生层。L2 变更与受影响关键词的范围收紧、`needs_refresh` 标记在同一事务内完成；L2 不直接查询 L3 私有表，由 L3 适配器实现失效端口。

## 数据模型

使用 `memory_l3_*` 前缀。

### `memory_l3_keywords`

| 字段                       | 说明                                                        |
| -------------------------- | ----------------------------------------------------------- |
| `id`                       | 稳定标识                                                    |
| `term`                     | 展示词                                                      |
| `normalized_term`          | 归一化词：NFKC、去首尾空白、折叠空白、小写                  |
| `aliases_json`             | 别名数组，受同样的长度限制                                  |
| `kind`                     | `topic`、`entity`、`preference`、`tool`、`concept`、`other` |
| `scope_key`                | 完整可见空间集合的规范化键                                  |
| `base_weight`              | 生成时权重，1–5                                             |
| `weight`                   | 当前权重，随命中更新                                        |
| `hit_count`                | 命中次数                                                    |
| `last_hit_at`              | 最近命中时间                                                |
| `needs_refresh`            | 来源 L2 变化后待刷新                                        |
| `state`                    | `active`、`expired`                                         |
| `expires_at`               | 滑动过期时间                                                |
| `created_at`、`updated_at` | 时间                                                        |

唯一约束：`(scope_key, normalized_term)`。索引：`normalized_term`、`scope_key + weight`、`expires_at`、`needs_refresh`。

### `memory_l3_keyword_spaces`

`keyword_id`、`space_id`。表示关键词的完整可见范围；`scope_key` 是该集合的规范化表示。双向索引。

关键词的范围由来源 L2 的完整范围交集计算，不单独授予空间权限。没有共同范围的关键词不能存在。

### `memory_l3_keyword_l2_links`

`keyword_id`、`l2_id`。表示该关键词当前引用的 L2 来源。双向索引。L2 合并、范围变化或失效时更新。

L3 不复制 L0 正文。需要依据时通过关联 L2 读取当前可读的 L1/L0 和来源完整性。

### `memory_l3_changes`

| 字段                         | 说明                                                       |
| ---------------------------- | ---------------------------------------------------------- |
| `id`                         | 变更标识                                                   |
| `l2_id`                      | 发生变化的 L2                                              |
| `kind`                       | `created`、`updated`、`scope_changed`、`merged`、`removed` |
| `l2_hash`                    | 变化时的内容与范围指纹                                     |
| `state`                      | `pending`、`claimed`、`processed`、`failed`                |
| `job_id`                     | 当前或最近一次处理任务                                     |
| `reason`                     | 失败原因                                                   |
| `created_at`、`processed_at` | 时间                                                       |

L2 创建、更新、`needs_update`、范围变化和关联迁移都登记变更。待处理索引按 `state + created_at`。

### `memory_l3_jobs`

`id`、`state`、`run_id`、`prompt_version`、`error_code`、`error_message`、`created_at`、`started_at`、`finished_at`。

任务状态为 `pending`、`running`、`succeeded`、`partial`、`failed`、`unknown`。L3 关键词之间相互独立，允许逐关键词提交和 `partial`。

### `memory_l3_job_results`

`id`、`job_id`、`result_index`、`state`、`action`、`keyword_id`、`l2_ids_json`、`error_code`、`error_message`、`created_at`。

结果状态为 `committed`、`failed`、`skipped`；首版动作只有 `upsert`。`skipped` 表示归一化词和范围未变化、无需写入；`l2_ids_json` 记录该结果引用的来源 L2。

### 检索索引

`memory_l3_fts` 使用 FTS5 trigram 保存 `term` 和 `aliases_json` 的可检索文本；精确查询先走 `normalized_term` 索引，FTS 只作为别名和部分匹配兜底。状态检查和重建与 L1/L2 索引一致，错误码为 `L3_INDEX_MISSING`、`L3_INDEX_STALE`、`L3_INDEX_CORRUPT`、`L3_INDEX_UNAVAILABLE`。

## 关键词形态

- `term`：1–8 个词，长度由配置上限控制，默认不超过 64 个字符。
- `aliases`：最多 5 个，每个同样受长度限制；不能与主词重复。
- 禁止：完整句子、项目进度、任务状态、版本号、一次性事件、直接引用的 L0/L2 原文。
- 允许：主题、对象、人物、作品、工具、偏好、概念、稳定方法名。
- 关键词不表达真值或确认状态；它只是检索入口。事实与依据仍由 L2/L1/L0 保存。

## 生成与批次

- L2 变化登记后，按 `memory_l3_changes` 创建顺序取最多 10 条；达到 10 条、空闲 30 秒或最早变化等待 24 小时时安排批次。
- 首批 L2 出现后执行冷启动；调用方也可以显式请求刷新。
- 批次全局处理，不按单个空间切分；调度器使用内部可信访问上下文读取来源 L2。
- 同一时间最多一个 L3 模型调用，避免多个 L3 批次并发更新同一关键词。
- 跨空间的来源可以在同一批出现；模型输出每个关键词的 `l2Ids`，Service 计算这些 L2 的共同范围。
- 来源 L2 没有共同范围时，该关键词无效；模型应改为分别输出更窄范围的关键词。
- 输入超过模型容量时明确失败 `L3_INPUT_TOO_LARGE`，不静默截断 L2 内容。
- 批次成功但没有任何关键词是合法的：所有变化标记为已处理，记录空结果。

## 模型契约

输入：

- 本批变化的 L2：ID、标题、摘要、正文、完整共享范围、变更类型
- 相关已有 L3 关键词：词、别名、类型、权重、命中次数、范围、来源 L2
- 当前时间、批次规模、关键词上限
- 可选：同一范围内其他 L2 的标题/摘要，用于判断词是否具有代表性

输出：

```json
{
  "keywords": [
    {
      "term": "...",
      "aliases": ["..."],
      "kind": "topic",
      "baseWeight": 3,
      "l2Ids": ["..."]
    }
  ]
}
```

校验规则：

- `term`、别名、`kind`、`baseWeight` 合法且非空。
- `l2Ids` 必须是本批变化或已有相关来源中可读的 L2。
- 关键词范围 = 所有 `l2Ids` 的完整共享范围交集；必须非空且可确定。
- 同一次输出中 `(normalizedTerm, scope)` 不得重复。
- 模型不能引用未提供的 L2，也不能把 L2 原文直接当作关键词；Service 只校验长度和结构，不能判断语义代表性。
- 输出结构无法解析、引用未知 L2 或范围为空时，该关键词失败；其他关键词仍可提交。
- 模型调用失败或结果未知时，任务为 `failed` 或 `unknown`，不产生部分成功。

## 提交与并发

每个关键词独立提交：

1. 重新读取来源 L2、范围和权限。
2. 比较来源 `l2_hash` 和关键词当前范围；变化时该关键词失败。
3. 归一化词并计算 `scope_key`。
4. 新建或更新关键词：合并来源、`base_weight = max(旧值, 新值)`、刷新 `expires_at`、保留命中统计。
5. 更新空间关联和 L2 来源关联，写入结果。

任务状态：

- `pending` → `running`：事务内领取变化并写入 `run_id`。
- `running` → `succeeded`：全部关键词已处理，包括合法空结果。
- `running` → `partial`：至少一个关键词失败，至少一个成功或跳过。
- `running` → `failed`：模型失败或输出结构不可解析，未提交关键词。
- `running` → `unknown`：远端结果未知；阻塞后续 L3 任务，直到显式处理。
- 失败关键词对应的变化保持 `failed`，显式重试；不自动重放。每个结果记录来源 L2；任务 `partial` 时，仍有失败结果引用的变化保持 `failed`，其余标记 `processed`。重试按 `(scope_key, normalized_term)` 幂等 upsert。
- 晚到的旧 `run_id` 结果不能覆盖新任务。
- 模型调用在数据库事务之外执行。

## 权重、命中与过期

首版采用简单、可解释的缓存权重，不引入深层排序算法。权重是检索优先级，不代表事实正确性、确认状态或访问权限。

- `base_weight`：生成时由模型给出 1–5，代表代表性/覆盖度。
- `weight`：初始等于 `base_weight`；每次命中 `weight = min(50, weight + 1)`；刷新时 `weight = max(weight, base_weight)`。
- `hit_count`：命中次数；`last_hit_at`：最近命中。
- 排序：`weight DESC, last_hit_at DESC, updated_at DESC`。
- 跨空间合并查询时，按归一化词合并，权重和命中次数求和，`last_hit_at` 取最大值。
- 首版不引入 Redis 或外部缓存进程；L3 的缓存语义由 SQLite 条目、权重、命中统计和 TTL 实现，进程内缓存仅作为后续可选优化。

命中记录：

- `matchL3Keywords` 先做精确/别名匹配，再做 FTS 兜底。
- 可写数据库：命中后在独立事务中尽力更新 `hit_count`、`weight`、`last_hit_at` 和 `expires_at`；更新失败不影响查询结果。
- 只读数据库：只返回结果，不写命中统计。
- 命中统计是派生数据，不作为内容权威。

过期：

- 默认 TTL 90 天；生成、刷新或命中时重置为 `now + TTL`。
- `expires_at` 到期后标记 `expired`，默认查询和列表排除。
- 过期维护由 L3 Service 定期执行，不调用模型；过期后保留宽限期再清理，清理只删除关键词缓存，不删除 L2/L1/L0。
- `needs_refresh` 表示来源 L2 已变化但关键词尚未重新生成；它不影响过期，但应优先刷新。
- TTL、宽限期、权重上限是首版参数，按实际命中率、召回质量和存储规模评测后调整。

## 作用域、失效与 L2 变更

- 关键词范围 = 来源 L2 完整范围的交集；不扩大来源范围。
- 调用方只能看到范围与其可读锚定空间有交集的关键词；来源 L2/L0 ID 仍按各自空间过滤。
- L2 范围收窄：新关键词范围 = 原范围 ∩ 当前来源 L2 范围；移除失去权限的空间，标记 `needs_refresh`。交集为空或无法确定时标记 `expired`，不再返回。
- L2 合并或删除：更新关键词的来源关联；没有剩余来源时标记 `expired`；有剩余来源时重算范围并标记 `needs_refresh`。
- L2 更新：标记相关关键词 `needs_refresh`，下一次 L3 批次刷新词、别名和权重。
- 上述 L2 变更与关键词范围收紧、`needs_refresh`/`expired` 更新在同一事务内完成。
- 同一词在不同范围是不同关键词条目；跨空间查询按归一化词合并，不把不同范围的来源混成一个可越权的关键词。

## 查询与跨空间总和

- `matchL3Keywords(query, anchoredSpaces, options)`：返回匹配关键词和合并后的权重。
- `listL3Keywords(anchoredSpaces, options)`：按合并权重列出关键词，供缓存预热或浏览。
- `getL3Keyword(id, anchoredSpaces)`：返回单个关键词、范围、来源 L2 和来源完整性。

返回内容：

- 词、别名、类型、合并权重、命中次数、最近命中时间
- 关键词范围（只包含调用方可读的空间）
- 来源 L2 ID（只返回可读来源）
- `needsRefresh`、来源完整性
- 是否因过期或范围失效而被排除，用错误或状态表达，不伪装成无命中

跨空间总和：

- 同一归一化词在不同范围的条目，在调用方可读范围内合并为一条结果。
- 合并权重 = 可读条目权重之和；命中次数求和；最近命中取最大值；别名取并集。
- 合并结果的来源只包含调用方可读的 L2；不可读来源不返回 ID，完整性标记为不完整。
- 没有可读范围交集时不返回该关键词。

## 与 Knowledge 的边界

2.0.0 明确不做：

- 不读取或写入 Knowledge / Wiki Graph 的表、文件或 API。
- 不做关键词到 Wiki 页面、图谱边或知识块的映射。
- 不做跨领域排序、图遍历、查询扩展或深层检索算法。
- 不把 Knowledge 的数据作为 L3 生成输入。

后续版本可以基于 L3 的通用关键词接口设计：

- 关键词与 Wiki 页面/图谱节点的关联
- 共现、别名图和权重传播
- 基于命中率、时效和来源的过期策略
- 更深层的检索算法和跨领域排序

这些都需要独立设计、评测和权限审查，不在 2.0.0 承诺 schema 或 API 兼容性。

## 错误与可观察性

至少区分：

- `L3_INPUT_TOO_LARGE`
- `L3_MODEL_FAILED`
- `L3_MODEL_OUTPUT_INVALID`
- `L3_MODEL_OUTCOME_UNKNOWN`
- `L3_STALE_INPUT`
- `L3_SCOPE_EMPTY`
- `L3_PERMISSION_DENIED`
- `L3_INDEX_MISSING` / `L3_INDEX_STALE` / `L3_INDEX_CORRUPT` / `L3_INDEX_UNAVAILABLE`

调用方可查询任务、结果、待处理变化、关键词范围和索引状态。失败、未知、部分成功、过期和待刷新原因都必须可观察。

## 测试与验收

首版至少覆盖：

- 从 L2 生成短关键词、别名和来源关联
- 同一词在不同范围生成不同条目，跨空间查询按可读范围合并
- 来源范围没有交集时关键词无效，其他关键词仍可提交
- 关键词范围收窄后只在新范围可见，无法确定时不返回
- L2 合并/删除后来源关联迁移或过期
- 命中后权重、命中次数和过期时间更新；只读不写
- 过期关键词不参与查询，清理不删除 L2/L1/L0
- 精确/别名查询、FTS 兜底、索引缺失/过期/损坏和重建
- 模型失败、输出无效、部分关键词失败和未知结果状态
- 输入超限明确失败，不截断 L2 内容
- 空间隔离：不可读来源 ID 不返回，合并不扩大权限
- 不读取 Knowledge/Wiki 数据，不引入跨领域依赖

完成条件：可从 L2 沉淀出短关键词，按范围和权重查询，跨空间合并安全；命中、过期、刷新和失败状态可观察；不破坏 L2/L1/L0 或引入 Knowledge 耦合。

## 待定

- 关键词批次阈值、TTL、权重上限和宽限期参数
- 权重是否加入时间衰减或来源覆盖度；首版只用线性权重
- 别名数量、词长和每范围关键词数量上限
- 是否提供显式删除/合并关键词的接口
- 跨空间合并时权重求和是否会导致热门词过度靠前
- 命中统计的批量写入和并发更新策略
- 多 Agent 身份模型；当前只按空间和会话汇总
- 未来 Knowledge Wiki Graph 的关联、过期和深层检索算法
