# 全局设计索引

本文档集独立维护整个项目的当前架构与技术规范，项目约束见 [AGENTS.md](../AGENTS.md)。架构描述领域关系，各专题维护一份权威规范；本索引只说明设计职责、阅读顺序与主题依赖。

## 1. 文档职责

| 文档 | 唯一维护内容 |
| --- | --- |
| [architecture.md](architecture.md) | 产品边界、三个业务域、数据所有者和域间协作 |
| [technical-stack.md](technical-stack.md) | 工程组织、技术方案、依赖与纯计算边界、构建门禁 |
| [scenario-schema.md](scenario-schema.md) | 引擎输入 DSL、类型、规则节点与定义校验 |
| [runtime.md](runtime.md) | 初始化、行动／NPC／事件／目标结算、角色知识和可见反馈 |
| [turn-flow.md](turn-flow.md) | action／scene 两种推进模式、场景定义、剧情分支、过渡与逐回合开篇的目标语义 |
| [personal-saves.md](personal-saves.md) | 世界检查点、版本、持久化事务、继续与恢复 |
| [auth-and-ownership.md](auth-and-ownership.md) | 认证、会话、CSRF／限流及统一访问原则 |
| [scenario-editor.md](scenario-editor.md) | 创作工作区、全部领域控件、编辑／保存／校验／试玩／定稿交互 |
| [scenario-generation.md](scenario-generation.md) | 作者生成源快照、候选契约、依赖组、过期／取消／重试及模型配置边界 |
| [api-contract.md](api-contract.md) | HTTP 接口形状、通用响应、请求去重和冲突语义 |
| [custom-scenarios.md](custom-scenarios.md) | 基于编辑器制作的大明与空间站示例内容、操作路径及验收 |

## 2. 阅读顺序与主题依赖

先读架构与技术方案，再按职责进入专题：

- 身份与访问规范为创作、世界与个人存档提供可信用户和授权原则。
- DSL 定义引擎输入及统一校验；编辑器和作者生成共同消费这一契约。
- 编辑器负责草稿、定稿和作者入口；世界运行负责初始化、回合计算、玩家视图与调试。
- 回合与场景规范定义多轮互动、结束回合及有条件的剧情节点流转；DSL、运行、API 与存档按职责落实其契约，不能将回合计数当作固定剧情下标。
- 个人存档在世界运行之上定义事务、版本门禁、保存及恢复；HTTP 契约统一各入口的输入、响应和错误。
- 具体示例消费标准编辑器及引擎能力，提供跨题材的内容设计，不增加示例专用机制。

各域可按公开契约独立衔接，编辑器不依赖所有个人存档功能才能表达剧本；完整产品链路必须覆盖创作、运行、保存与恢复。

## 3. 阅读与更新

一个规则只有一个规范来源，其他全局文档通过主题链接引用。修改架构、契约或行为语义时更新所属专题，设计理由在该专题内完整说明。本索引和专题不维护迭代进度、实施历史或运行结果。

[创作方式研究](research/scenario-authoring-review.md)为编辑器交互方案提供来源；采纳边界维护在编辑器规范。[AI Dungeon 研究](research/ai-dungeon-review.md)中的其他候选仍为额外参考，不自动成为需求或域划分依据。
