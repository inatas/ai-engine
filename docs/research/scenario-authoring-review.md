# 剧本创作方式研究

研究日期：2026-10-13。关联[编辑器方案](../scenario-editor.md)与[作者生成契约](../scenario-generation.md)。本文研究作者体验，区分官方可核实能力、本项目推论和候选功能。依据公开帮助、产品页面及官方技能源文件，未登录第三方作者后台，未实测其模型或保存流程。本项目交互示意不作为竞品截图。

## 1. AI Dungeon：开场与世界卡片

作者创建 Scenario，编写开场 Prompt，补充 Plot Essentials 和 Author’s Note，并用 Story Cards 描述角色、地点与世界知识。卡片触发词用于将相关内容送入模型上下文；Scenario 用来创建独立 Adventure。它仍使用分组文本输入，不应称为完全没有表单。官方帮助存在新旧界面名称混用，本文不将旧标签当作当前界面的精确布局。

来源：[Scenario 创作说明](https://help.aidungeon.com/faq/what-are-scenarios)、[Story Cards](https://help.aidungeon.com/faq/story-cards)、[Plot Components](https://help.aidungeon.com/faq/plot-components)。这些页面含官方界面插图，可查看原产品操作示意。

本项目推论：学习“开场先行、内容分块、世界条目按需展开”，不要将所有 DSL 字段同时摊开。卡片触发词是 AI 上下文机制，不能直接替代本项目角色引用、数值状态和执行条件；本项目不引入其脚本系统。

## 2. WorldOS：可玩的世界与创作技能

本轮暂按 [worldos.cc](https://worldos.cc/) 和其 [官方组织](https://github.com/WorldOSAI) 识别 WorldOS；不混用同名项目。公开页面提供世界、角色、地图、应用市场以及 Remix 入口。这能证明产品入口，不能证明其登录后编辑器的全部交互。

官方 [worldos-authoring 技能](https://github.com/WorldOSAI/worldos-agent-skills/blob/main/skills/worldos-authoring/SKILL.md) 采用完整世界候选、校验、写入及读取验证流程；更新绑定版本，发布另有明确操作。它是可研究的 AI 世界创作 skill，本轮仅阅读，没有安装、连接或执行其外部操作。

[世界设计参考](https://github.com/WorldOSAI/worldos-agent-skills/blob/main/skills/worldos-authoring/references/world-design.md) 从玩家身份和追求出发，建立“压力—选择—后果—持久状态变化”的循环，要求开场给出可行动情境，NPC 有动机，界面只服务核心玩法。

本项目推论：创作应围绕“玩家是谁、面临什么、能做什么、怎样结束”展开；AI 的交付物应是可检查的候选，而不是一整段看似完成却无法运行的小说。

## 3. Novelcrafter：故事稿与世界书并行

官方工作区按 Plan、Write、Chat、Review 切换；正文写作支持专注模式，Codex 条目可关联场景，计划视图支持卡片、矩阵和大纲。来源：[界面布局](https://www.novelcrafter.com/help/docs/app/app-layout)、[写作界面](https://www.novelcrafter.com/help/docs/write/the-write-interface)、[计划视图](https://www.novelcrafter.com/help/docs/plan/plan-views)。官方帮助含界面插图。

本项目推论：采用写作画布与世界书，而不是把作者的工作顺序绑定到数据库字段顺序。本项目是运行中的世界，不要求先写完整章节、预定全部剧情或建立小说章节模型。

## 4. Inky：写作与试玩靠近

[ink / Inky 官方介绍](https://www.inklestudios.com/ink/) 提供文本优先的叙事写作、错误定位与边写边试玩。其规则表达使用叙事脚本。

本项目推论：学习问题定位和快速试玩反馈，但不引入另一套脚本语言或编译器。试玩仍绑定保存修订，编辑不会自动覆盖进行中的世界。

## 5. 本项目采用的组合

采用“故事稿 + 世界书 + 规则卡 + 试玩”的能力组合；提供自然语言起稿和从空白手动创建两种入口。自然语言先生成可调整大纲，再批量细化关联内容，按批次累积；内容卡片用于创建、预览和微调，作者可整组采纳，两种入口随时混用，统一校验决定能否运行。此组合为本项目设计判断，不宣称各竞品使用相同引擎。

技能借鉴顺序：创作意图 → 世界事实与角色动机 → 可行动的冲突及后果 → 引擎规则候选 → 检查与试玩。当前会话可用技能中没有专门的小说写作技能；已找到官方 WorldOS 创作技能供参考，不以安装来源不明的技能作为编辑器开发前提。

不采纳：任意脚本、自动公开发布、完整小说章节系统、社区、第三方应用框架。真实作者侧批量生成属于创作域必需能力，候选／调用设计见[作者生成契约](../scenario-generation.md)，HTTP 形状见[接口规范](../api-contract.md)。交互、字段和事务分别维护在所属全局规范，本文不复制它们。
