# L2 代码设计

本文把 [Memory System](memory.md) 的 L2 决策落到领域、服务、数据库适配器和任务边界。L2 尚未实现；本文是首版代码设计基线，未决项列在末尾。总体依赖方向见 [Memory 代码设计基线](memory-design.md)。

## 首版范围

**包含**

- 从已完成后台维护的 L1 生成 L2，并更新已有 L2
- 变更登记、批次调度、任务状态、逐结果提交和失败恢复
- 共享范围计算、范围收窄时的失效处理和 L1 合并后的关联迁移
- 标题、摘要、正文的 SQLite 存储，当前 L1 关联和生成时 L0 来源
- FTS5 关键词召回、列表和按 ID 读取
- 索引状态检查与显式重建

**不包含**

- L2 合并、删除和历史版本
- 人工编辑 L2
- 累计热度或使用次数
- Embedding 召回和 L1/L2 组合排序
- L3、Memory SDK、宿主适配和 Knowledge
- 跨归属空间 L1 作为批次主输入

## 职责与依赖

- `domain/memory/l2.ts`：L2 记录、变更类型、任务和结果状态、错误；不依赖 SQLite、Drizzle、模型或入口。
- `service/memory/l2.ts`：列出、读取、召回、变更登记、批次提交、失效处理和显式重试。
- `service/memory/l2-ports.ts`：L2 仓储、搜索索引、模型、时钟和标识端口。
- `db/memory/l2-repository.ts`：L2 表、关联表、变更和任务仓储；拥有迁移。
- `db/memory/l2-search-index.ts`：FTS5 索引、状态检查和重建。
- `db/memory/l2-scheduler-repository.ts`：领取待处理变更、持久化批次进度和并发围栏。
- `server/l2.ts`、`server/l2-scheduler.ts`：装配 Service、仓储和模型；资源由 Runtime 关闭。
- `other/models/openai.ts`：实现 L2 模型端口；不向 Service 暴露模型 SDK 类型。

Service 不直接访问 SQL，领域不依赖 ORM 行类型。L1 变更与受影响 L2 的失效更新在同一 SQLite 事务内完成，不允许 L1 已变化而 L2 仍按旧范围可见；事务由 Memory 内部协调，L1 不直接查询 L2 私有表，失效由 L2 适配器实现。

## 数据模型

使用 `memory_l2_*` 前缀，与 L1 表并列，由 Memory 自己的迁移维护。

### `memory_l2`

| 字段                       | 说明                                   |
| -------------------------- | -------------------------------------- |
| `id`                       | 稳定标识                               |
| `owner_space_id`           | 归属空间，必须处于共享范围内           |
| `title`                    | 标题                                   |
| `summary`                  | 摘要                                   |
| `body`                     | 灵活正文                               |
| `content_hash`             | 标题、摘要、正文的指纹，用于提交前检查 |
| `needs_update`             | 是否需要重新生成                       |
| `visible`                  | 无法确定安全范围时置为不可召回         |
| `generation_id`            | 当前内容的生成标识                     |
| `created_at`、`updated_at` | 时间                                   |

索引：`owner_space_id + updated_at`，`needs_update`，`visible`。

### `memory_l2_space_links`

`l2_id`、`space_id`。只保存归属空间之外的关联空间；完整共享范围 = 归属空间 + 关联空间。双向索引，唯一约束防止重复。

### `memory_l2_l1_links`

`l2_id`、`l1_id`，表示 L2 当前关联的 L1。双向索引。L1 合并或删除时按更新流程迁移或移除。

### `memory_l2_l0_sources`

`l2_id`、`l0_id`、`generation_id`。表示当前这次生成实际使用的 L0 来源，不复制正文。重新生成时删除该 L2 的旧来源并写入新 `generation_id` 的来源；不保留 L2 内容历史。来源原文仍按各自空间独立授权。

### `memory_l2_changes`

| 字段                         | 说明                                                               |
| ---------------------------- | ------------------------------------------------------------------ |
| `id`                         | 变更标识                                                           |
| `l1_id`                      | 发生变化的 L1                                                      |
| `kind`                       | `created`、`content_changed`、`scope_changed`、`merged`、`removed` |
| `l1_hash`                    | 变化时的内容与范围指纹                                             |
| `survivor_l1_id`             | `merged` 时保留的 L1                                               |
| `state`                      | `pending`、`claimed`、`processed`、`uncovered`、`failed`           |
| `job_id`                     | 当前或最近一次处理任务                                             |
| `reason`                     | `uncovered` 或 `failed` 的原因                                     |
| `created_at`、`processed_at` | 时间                                                               |

新 L1 只在相似维护完成后登记；L1 更新、合并和范围变化在发生时登记。待处理索引按 `state + created_at`，按 L1 的索引用于迁移关联。

### `memory_l2_jobs`

`id`、`owner_space_id`、`state`、`run_id`、`prompt_version`、`error_code`、`error_message`、`created_at`、`started_at`、`finished_at`。

任务状态为 `pending`、`running`、`succeeded`、`partial`、`failed`、`unknown`。同一归属空间同时最多一个活动任务；`run_id` 用于拒绝旧执行结果。

### `memory_l2_job_results`

`id`、`job_id`、`result_index`、`state`、`action`、`l2_id`、`error_code`、`error_message`、`created_at`。

结果状态为 `committed`、`failed`、`skipped`；动作首版为 `create`、`update`。`skipped` 表示校验通过但内容与现有 L2 相同、无需写入。

### 检索索引

`memory_l2_fts` 使用 FTS5 trigram 保存 `title`、`summary`、`body`，通过触发器在同一事务同步。状态检查、失败码和重建流程与 L1 索引一致：`L2_INDEX_MISSING`、`L2_INDEX_STALE`、`L2_INDEX_CORRUPT`、`L2_INDEX_UNAVAILABLE`。索引是派生数据，重建不修改 L2、L1 或来源。

## 批次、作用域与调度

- 按 L1 的归属空间分组。每条 L1 的完整共享范围都包含其归属空间，因此同一归属空间内的主输入至少共享该空间。
- 跨归属空间的关联 L1 首版不作为批次主输入；重新生成时可以作为必要依据加入，但必须通过共同范围校验。
- 每组按 `memory_l2_changes` 的创建顺序取最多 10 条待处理变化；达到 10 条、空闲 30 秒或最早变化等待 5 分钟时安排批次。触发只表示安排，不保证完成。
- 已有 L2 的关联 L1 是更新所需的必要依据，不计入 10 条上限。输入超过模型容量时明确失败，不静默截断。
- 同一归属空间串行处理，避免并发更新同一 L2。L2 使用独立调度器和并发预算，默认最多一个模型调用；具体预算按评测调整。
- 调度器需要内部调用方显式启动和停止；宿主生命周期接线后置。
- 批次可以包含不同主题，不因同批处理就合并成一条 L2。

## 模型契约

每批一次结构化模型调用。输入包含：

- 归属空间、当前时间
- 本批 L1：ID、正文、主抽象、线索、完整共享范围、变更类型
- 候选 L2：ID、标题、摘要、正文、当前关联 L1、更新时间、`needs_update`
- 候选 L2 当前关联 L1 的内容和来源空间；这些是更新所需依据
- 候选 L2 由 Service 选择：同归属空间内，按当前 L1 关联或输入 L1 关键词从 FTS 选取，首版上限 10 条。模型只能更新候选中出现的 L2。

模型输出：

```json
{
  "results": [
    {
      "action": "create",
      "title": "...",
      "summary": "...",
      "body": "...",
      "l1Ids": ["..."]
    },
    {
      "action": "update",
      "l2Id": "...",
      "title": "...",
      "summary": "...",
      "body": "...",
      "l1Ids": ["..."]
    }
  ],
  "uncoveredL1Ids": [{ "l1Id": "...", "reason": "..." }]
}
```

校验规则：

- `create` 的 `l1Ids` 只能来自本批变化。
- `update` 的 `l1Ids` 必须包含该 L2 当前关联的全部 L1，并可加入本批新 L1；首版不允许借更新丢弃已有依据。
- 每条本批变化必须至少出现在一条结果的 `l1Ids` 中，或被列入 `uncoveredL1Ids`；同一条 L1 可以参与多条 L2；`uncoveredL1Ids` 必须给出原因。
- `uncoveredL1Ids` 表示模型判断无需形成 L2，不是失败；对应变化标记为 `uncovered` 并记录原因。
- 标题、摘要、正文非空；长度上限由配置控制，超限结果无效。
- 来源 L1 必须可读、属于本批或候选 L2 的当前关联，且完整共享范围包含目标归属空间。
- 结果共享范围 = 所有 `l1Ids` 的完整共享范围交集；必须包含目标归属空间。交集为空、不包含归属空间或无法确定时，该结果无效。
- 输出结构、覆盖关系或动作类型无法解析时，批次失败，不提交任何结果，不能伪装成部分成功。
- 单条结果的来源 ID、权限、长度或共享范围校验失败时，只使该结果失败；其他通过校验的结果仍可提交，任务为 `partial`。
- 模型拒绝、调用失败或输出无法解析时，任务为 `failed` 或 `unknown`；`unknown` 不自动重放。
- 合法空结果（全部 `uncovered`）记为 `succeeded`，不产生 L2。

## 提交、并发与恢复

每条结果独立事务提交：

1. 重新读取目标 L2、输入 L1、来源范围和调用方权限。
2. 比较 L2 的 `content_hash`、`updated_at` 和 L1 的 `l1_hash`；发生变化时该结果失败。
3. 写入或更新 L2、`content_hash`、`generation_id` 和 `updated_at`。
4. 替换当前 L1 关联、生成时 L0 来源和关联空间。生成时 L0 来源由结果使用的全部 L1 的当前来源并集计算，不要求模型逐条列出 L0。
5. 将对应变化标记为 `processed` 或 `uncovered`，写入结果状态。

任务状态转换：

- `pending` → `running`：事务内领取变化并写入 `run_id`。
- `running` → `succeeded`：所有结果已处理，包括合法空结果。
- `running` → `partial`：至少一条结果 `failed`，且至少一条结果已 `committed` 或 `skipped`。
- `running` → `failed`：模型失败或契约校验失败，未提交任何结果。
- `running` → `unknown`：远端结果未知；阻塞同归属空间后续任务，直到显式处理。
- `failed` 或 `unknown` 任务领取的变化置为 `failed`，等待显式重试，不自动回到 `pending`。
- 失败结果对应的变化重新登记为 `pending`；成功结果对应的变化保持已处理。
- `running` 在进程重启后不自动重放；按 L1 的做法显式标记中断或重试。
- 晚到的旧 `run_id` 响应不能覆盖新任务。
- 模型调用在数据库事务之外执行；提交前必须重新检查输入。

## 更新、失效与 L1 变更

- **L1 合并**：将受影响的 `memory_l2_l1_links` 从被合并 L1 迁到保留 L1；生成时 L0 来源不变；标记 L2 `needs_update`。
- **L1 删除**：移除当前关联；重新计算共享范围；标记 `needs_update`。没有可用来源或范围无法确定时，`visible = false`。
- **范围收窄**：新范围 = 原 L2 范围 ∩ 所有当前来源 L1 的完整范围；移除失去权限的空间并标记 `needs_update`。交集为空、不包含归属空间或无法确定时，`visible = false`，暂不召回。
- 上述 L1 变更与 L2 的链接、范围和标记在同一事务内完成；失败时一起回滚。
- `needs_update` 的 L2 在安全范围内仍可召回，结果必须返回该标记。
- **重新生成**：替换正文、当前 L1 关联和生成时 L0 来源，写入新的 `generation_id`；不保留旧内容版本。
- **新增更窄 L1**：已有 L2 保留原内容和范围；模型可新建范围更窄的相关 L2，两条 L2 可以关联同一部分 L1。
- 范围扩大不自动扩大 L2 共享范围；保持当前范围，重新生成时再按实际输入计算。
- 首版不做 L2 与 L2 合并，也不做 L2 删除；后续根据重复率和容量评测再设计。

## 召回与列表

- `recallL2(query, anchoredSpaces, options)`：在可读锚定空间范围内检索 L2。
- `listL2(anchoredSpaces, options)`：按 `updated_at` 倒序返回摘要，供浏览或宿主自行注入。
- `getL2(id, anchoredSpaces)`：返回完整 L2 和来源。

召回规则：

- 使用 FTS5 trigram 检索 `title`、`summary`、`body`；排序与 L1 保持一致，以匹配词数为主、更新时间兜底。少于三个字符的词复用 L1 的扫描策略，避免 trigram 漏检。质量评测后调整。
- 索引缺失、过期、损坏或不可用时返回明确错误，不伪装成无匹配。
- L2 的归属空间或任一关联空间在可读锚定空间中即可召回；关联只共享该 L2，不共享其他记忆或来源原文。
- 返回当前 L1 ID、可读的 L0 来源 ID、来源完整性和 `needs_update`。不可读或不可用的来源不返回 ID，来源完整性标记为不完整。
- 正文超过预算时明确标记截断；摘要和正文的预算由调用方提供。
- 只读打开支持列表、读取、召回和索引检查，不支持生成、更新或重建。
- 默认不使用 Embedding；L1/L2 组合排序和 Embedding 对照放在 M6 之后。

## 错误与可观察性

至少区分以下错误：

- `L2_INPUT_TOO_LARGE`
- `L2_MODEL_FAILED`
- `L2_MODEL_OUTPUT_INVALID`
- `L2_MODEL_OUTCOME_UNKNOWN`
- `L2_STALE_INPUT`
- `L2_SCOPE_EMPTY`
- `L2_PERMISSION_DENIED`
- `L2_INDEX_MISSING` / `L2_INDEX_STALE` / `L2_INDEX_CORRUPT` / `L2_INDEX_UNAVAILABLE`

调用方可以查询任务、结果、待处理变化和索引状态。失败、未知、部分成功和未覆盖原因都必须可观察，不能只记录为笼统失败。

## 测试与验收

首版至少覆盖：

- 从维护完成的 L1 生成 L2，返回当前 L1 和可读 L0 来源
- 一次调用生成多条 L2，其中一条提交失败时任务为 `partial`，其他结果保留
- 更新已有 L2 时保留全部当前 L1 依据，拒绝丢弃旧依据的输出
- 模型失败、拒绝、输出无法解析和输出未知时状态正确，不产生部分成功
- 输入超限明确失败，不截断原文
- 范围收窄后 L2 只在新范围内可见，无法确定范围时不召回
- L1 合并后 L2 关联迁移并标记 `needs_update`
- 只读数据库拒绝生成和重建，但仍可召回
- 空间隔离：不可读来源 ID 不返回，关联不扩大其他记忆的读取权限
- FTS 索引缺失、过期、损坏、触发器变化和重建回滚
- 两个调度器竞争、旧 `run_id` 响应和进程中断后的恢复
- `uncoveredL1Ids` 原因可查，变化不会永久停留在待处理
- 迁移为已有数据建立表和索引，不调用模型

完成条件：可从 L1 生成、更新和召回 L2，来源与共享范围可追溯；部分成功、失败、未知和失效状态可观察；失败不会破坏已有 L2、L1 或来源。

## 待定

- 模型提示词、候选 L2 的具体排序和上限参数
- 标题、摘要、正文的长度上限和输入预算参数
- 失败结果的重试策略；是否保留失败提案以避免重新调用模型
- 是否增加不可变的 generation log 作为审计；首版先依赖任务和来源表
- 每个归属空间的 L2 数量上限、L2 合并和删除
- 热度、使用次数、人工编辑
- 范围扩大是否标记 `needs_update`
- L1/L2 组合召回、Embedding 对照和 L3
