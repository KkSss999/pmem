# 底层重构

本文记录当前阶段的实施范围和验收条件。目标架构见 [基础架构](architecture.md)，数据库职责见 [数据库基础设施与 DB 适配器](database.md)。

## 实施顺序

1. 清退旧 SDK、CLI、MCP 接线和旧业务实现，保留用户数据；旧数据迁移另行设计。
2. 使用 SQLite、better-sqlite3 和 Drizzle 建立连接与迁移基础设施。
3. 建立 Runtime 装配及 SDK 生命周期入口。
4. 整理依赖、构建配置、CI 和文档；后续再设计 LnMemory、Knowledge 和其他入口。

## SDK 与数据库

- `Pmem.create({ databasePath })`：创建新数据库；目标必须不存在，父目录必须已存在。
- `Pmem.open({ databasePath, readOnly? })`：打开已存在且迁移状态与 SDK 一致的数据库；不会自动创建或迁移。`readOnly` 默认为 `false`。
- `Pmem.migrate({ databasePath, backupPath })`：有待执行迁移时先创建一致性备份，再按顺序执行迁移；目标备份路径必须不存在。没有待执行迁移时不创建备份。失败可能留下创建的文件以供诊断。
- `runtime.status()`：报告只读状态和全部领域已应用迁移的总数；`runtime.close()` 释放连接，可重复调用。关闭后的状态查询报告 `CLOSED`。

Runtime 持有连接。SDK 不暴露连接、Drizzle 对象或数据库行。当前数据库已包含基础设施和 Memory 领域迁移；L0、L1、关键词召回和相似维护已内部实现，Memory SDK、宿主适配与 Knowledge 仍在后续阶段。SQLite 标识和各归属下已应用迁移的顺序及内容用于识别数据库；未来版本和不匹配的迁移历史会被拒绝。

迁移使用 SQLite 写锁防止备份和迁移之间有其他写入；备份由独立的只读连接完成。事务开始前关闭外键约束，提交前执行完整的外键检查；检查或迁移失败会回滚数据库事务，已创建的备份保留。文件系统错误和 SQLite 错误保留给调用方。新数据库使用 SQLite 默认日志模式，不启用 WAL；为避免只读访问产生 WAL 附属文件，打开或迁移 WAL 模式的数据库会被拒绝。

## 验收条件

- 创建后关闭并重新打开；已存在的创建目标、无效路径和未知数据库失败。
- 只读打开不创建数据库、不执行迁移；打开需要迁移的数据库时报告错误。
- 不支持的数据库版本、备份失败、迁移失败和数据库锁冲突均报告真实结果，不能删除或重置原有数据。
- 独立 Runtime 管理各自连接，关闭后操作报错；SDK 只导出当前底座。
- 构建、Oxc 检查和数据库基础设施针对性验证通过。

## 领域装配与迁移

`OwnedDatabase.createAdapter` 仅供内部装配使用，向 DB 适配器工厂提供同一个 Runtime 所持有的 Drizzle 连接及只读状态；不向 SDK 或领域 Service 暴露数据库对象。领域适配器需自行通过其 Service 端口表达操作和事务，不得访问其他领域的私有表。

基础设施、Memory 和 Knowledge 各维护独立迁移记录。Memory 和 Knowledge 的 schema 分别位于 `src/db/memory/schema.ts` 和 `src/db/knowledge/schema.ts`，由各自的 `drizzle.memory.config.ts`、`drizzle.knowledge.config.ts` 生成到独立目录。尚无领域 schema 或迁移时，无需创建空目录。执行器按基础设施、Memory、Knowledge 的顺序执行当前待处理迁移，全部迁移作为一个事务提交；两个领域的迁移文件和历史必须各自只追加。
