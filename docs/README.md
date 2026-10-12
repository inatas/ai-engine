# 全局设计索引

本文档集维护当前项目设计，项目约束见 [AGENTS.md](../AGENTS.md)。架构描述领域关系，各专题维护一份权威规范；开发项和实际结果在 note，依赖版本与启动方式见根 README。

## 1. 文档职责

| 文档 | 唯一维护内容 |
| --- | --- |
| [architecture.md](architecture.md) | 产品边界、三个业务域、数据所有者和域间协作 |
| [technical-stack.md](technical-stack.md) | 工程组织、技术方案、依赖与纯计算边界、构建门禁 |
| [scenario-schema.md](scenario-schema.md) | 引擎输入 DSL、类型、规则节点与定义校验 |
| [runtime.md](runtime.md) | 初始化、行动／NPC／事件／目标结算、角色知识和可见反馈 |
| [personal-saves.md](personal-saves.md) | 世界检查点、版本、持久化事务、继续与恢复 |
| [auth-and-ownership.md](auth-and-ownership.md) | 认证、会话、CSRF／限流及统一访问原则 |
| [scenario-editor.md](scenario-editor.md) | 创作工作区、全部领域控件、编辑／保存／校验／试玩／定稿交互 |
| [api-contract.md](api-contract.md) | HTTP 接口形状、通用响应、请求去重和冲突语义 |
| [custom-scenarios.md](custom-scenarios.md) | 基于编辑器制作的大明与空间站示例内容、操作路径及验收 |

## 2. 开发项与状态

| 开发项 | 范围 | 当前状态 |
| --- | --- | --- |
| [001 世界引擎与个人存档](../note/001-world-engine-foundation.md) | DSL／定义校验、通用执行、工程、游戏应用及存档 | 实施中，核心基础已有，业务尚未完成 |
| [002 账号鉴权与数据归属](../note/002-auth-and-ownership.md) | 身份上下文、认证防护、访问约定与身份界面 | 已实现；78 项检查及浏览器身份／重启链路通过 |
| [003 专业剧本编辑器](../note/003-scenario-editor.md) | 创作域全部草稿／模板／定稿服务、领域控件和作者试玩流程 | 设计待确认，功能未实现 |
| [004 基于编辑器的示例剧本](../note/004-custom-scenarios.md) | 使用 003 制作、导出与运行两个具体 example | 待确认，依赖 003；既有 JSON 只作内容参考和规则夹具 |

依赖顺序：001 已有核心供创作调用，002 提供身份，003 提供完整创作工作流，004 用工作流制作用例；运行应用与创作接口接通后联合验收首期保存恢复。003 不等待 001 全部存档功能完成，但 004 的完成必须有 003 实际浏览器证据。

## 3. 阅读与更新

先读架构和技术方案，再按所属领域读专题及开发 note。一个规则只有一个规范来源，其他文档保留关联说明。完成状态依据实际功能与验收，已有 schema、表结构或 JSON 不能代替编辑器、身份或端到端完成证据。

[AI Dungeon 研究](research/ai-dungeon-review.md)是额外参考，不是当前需求或域划分依据。
