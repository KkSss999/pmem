# Agent 与 Jev 的职责边界

本文确定 PMEM 中两类模型能力的调用边界：

- **Agent**：开放任务执行者，负责对话、工具循环、上下文和多步回答。
- **Jev**：TypeSafe System One 判断器，只回答受限的 typed question，不生成文本。

两者不是互相替代关系。把它们混用，会同时损失 Agent 的开放能力和 Jev 的确定性。

## 一句话规则

```text
需要执行任务、调用工具、组织回答  -> Agent
需要对一个事实变更做类型化判断    -> Jev
需要确定性计算、索引、授权         -> 都不用
需要批量提炼/摘要/生成内容         -> 内部生成模型
```

## 核心区别

| 维度     | Agent                               | Jev                                 |
| -------- | ----------------------------------- | ----------------------------------- |
| 输出     | 自然语言、工具调用、任务结果        | 结构化 choice / score / noul        |
| 主要职责 | 完成任务                            | 做判断                              |
| 状态     | 多轮 session / transcript           | 单次请求，无会话状态                |
| 工具     | 可调用 `pmem_recall`、`pmem_get` 等 | 不调用工具                          |
| 授权     | Host 绑定身份，工具执行前检查       | 不授予权限                          |
| 失败语义 | 可以重试、降级、询问用户            | `unknown` 必须保留，不能当成 `none` |
| 延迟     | 秒级到分钟级                        | 目标毫秒到数秒                      |
| 输入规模 | 上下文窗口                          | 小状态，当前 adapter 限制 30k 字符  |
| 结果权威 | 代码执行 Agent 提议                 | 代码拥有真值表，Jev 只提供判断      |

## 按生命周期划分

| 场景                             | 应由谁处理        | 原因                                 |
| -------------------------------- | ----------------- | ------------------------------------ |
| 用户打开会话、发送问题           | Agent             | 多轮对话和回答                       |
| 判断是否需要调用 Memory 工具     | Agent             | 开放任务规划                         |
| 自动 recall 的检索               | Host + 确定性检索 | 查询由 Host 提供，结果只追加 context |
| 读取 L2/L1/L0                    | 确定性服务        | ACL、可见性、来源完整性              |
| 把 user/assistant 写入 L0        | 确定性服务        | 原始记录，不需要生成                 |
| L1 从 L0 提炼事实                | 内部生成模型      | 生成内容，不是 typed 判断            |
| L1 维护 keep / merge / uncertain | 内部维护模型      | 需要内容合并，Jev 不做生成           |
| L2 判断新事实是否替代旧事实      | **Jev**           | 典型的 fact-level typed 判断         |
| L2 生成标题、摘要、正文          | 内部生成模型      | 生成内容                             |
| L3 生成关键词和别名              | 内部生成模型      | 生成内容                             |
| L3 关键词匹配、FTS、排序         | 确定性服务        | 可重复、可测试                       |
| 空间、来源、可写权限             | Host / Service    | 安全边界，不能交给模型               |
| 最终回答                         | Agent             | 需要综合检索结果和用户目标           |
| 评测 judge                       | 评测用 LLM / 规则 | 不是生产 Agent 或 Jev                |

## Jev 的适用范围

Jev 适合：

- 输入可以压缩成一个小 `state`。
- 答案是一个有限集合中的类型。
- 需要概率或置信度，而不是一段解释。
- 错误可以被代码识别并进入 `failed` / `unknown`。
- 不需要工具、文件、网络或多轮任务。

当前实际用例：

```text
memory change:
replacement / addition / reinforcement / conflict / none
```

为什么 L2 替代判断必须是 Jev：

- 它不是“写一段总结”，而是“新事实是否替换旧事实”的离散判断。
- 代码需要根据判断决定是否隐藏旧 L2、设置 `superseded_by`、刷新 L3。
- 让生成模型在正文里“顺便决定”会导致旧值和新值同时留在正文中。
- Jev 的 `replacement` 已被实际验证：`27:12 -> 25:50` 返回 `replacement`，置信度 0.99。

Jev 不应：

- 生成用户回答。
- 决定权限、空间或工具。
- 替代 L1 维护、L2/L3 内容生成。
- 在失败时被静默当成 `none`。
- 被用来做长时间、多步任务。

## Agent 的适用范围

Agent 适合：

- 用户问题需要多轮上下文。
- 需要主动调用 Memory 工具。
- 需要组合多个来源、比较、解释或追问。
- 需要执行工具或产生副作用（未来写工具必须单独授权）。
- 需要把 Memory 结果转成自然语言回答。

Agent 不应：

- 直接决定事实是否替代；这属于 Jev + 代码真值表。
- 直接读写内部仓储或绕过 `MemoryAccess`。
- 把检索到的 Memory 正文当作用户授权。
- 把 `pmem_recall` 结果原样倾倒给用户而不做回答。
- 在没有 host scope 的情况下读取其他空间。

## 组合链路

```text
User
  -> Agent session
  -> Agent decides: answer directly / pmem_recall / pmem_get
  -> PMEM deterministic retrieval (L3 -> L2 -> L1 -> L0)
  -> Agent answer

Background:
L0 append
  -> L1 generation model
  -> L1 maintenance model
  -> L2 change candidate
  -> Jev replacement/addition/... judgment
  -> code applies supersede/write
  -> L3 generation model
```

关键点：

- Agent 读取的是已经由代码治理过的 Memory。
- Jev 不参与 Agent 的回答循环。
- Agent 不参与 Jev 的真值判断。
- L2/L3 的生成模型也不是 Agent；它们没有工具循环和会话。

## 失败与降级

### Jev 失败

- `failed`：请求未被接受或输入不合法，可明确重试。
- `unknown`：请求可能已经发出，结果未知，不能当成 `none`。
- L2 job 记录失败/未知，不默默合并旧事实。
- 不用 Agent 自动接管判断；需要显式重试或人工处理。

### Agent 失败

- 工具失败：Agent 可以看到工具错误并决定下一步。
- 模型/上下文失败：返回会话错误，不伪造 Memory 写入。
- 权限失败：工具拒绝，模型不能通过改参数绕过。

### 内部生成模型失败

- L1/L2/L3 各自有 job 状态和重试语义。
- 不能因为 Agent 可用就把后台生成失败隐藏掉。

## 当前代码映射

| 能力                 | 位置                                             |
| -------------------- | ------------------------------------------------ |
| Agent session / loop | MiaoTs `createAgentApplication`                  |
| Agent Memory 读取    | `src/agent/memory.ts`                            |
| Agent 自动 recall    | `src/agent/plugin.ts` context provider           |
| Agent 工具           | `src/agent/plugin.ts` `pmem_recall` / `pmem_get` |
| L2 替代判断          | `src/other/models/jev.ts`                        |
| L2 判断接入          | `src/service/memory/l2.ts`                       |
| Jev 真值表/状态变更  | L2 service + repository                          |
| L1 提炼/维护         | `src/service/memory/l1.ts`、`l1-maintenance.ts`  |
| L2/L3 生成           | `src/other/models/l2-prompt.ts`、`l3-prompt.ts`  |

## 判断清单

新增一个模型调用前，按顺序问：

1. 这是不是确定性计算、索引、授权或格式转换？是 -> 不用模型。
2. 输出是不是有限类型的判断？是 -> 优先 Jev。
3. 是否需要生成文本、摘要、合并内容？是 -> 内部生成模型。
4. 是否需要多轮、工具、任务执行或面向用户的回答？是 -> Agent。
5. 失败时谁来负责？Jev 失败进入显式状态；Agent 失败进入会话错误；生成失败进入 job 状态。
6. 这个模型能不能改变权限或事实真值？不能；权限由 Host，事实由代码真值表。
