# 全局技术文档

更新日期：2026-10-12。本文档集描述当前设计；目前尚未实现程序。

项目规范以根目录 [AGENTS.md](../AGENTS.md) 为准。`docs/` 维护全局技术架构，`note/` 记录每次迭代的开发项与结果，两者与实现同步更新。

## 阅读顺序

| 文档 | 维护内容 |
| --- | --- |
| [architecture.md](architecture.md) | 项目目标、world engine 与剧本边界、模块与数据职责 |
| [technical-stack.md](technical-stack.md) | 全 TypeScript 技术选型、包依赖、lint／CI 强制边界与存档版本 |
| [scenario-schema.md](scenario-schema.md) | 完整世界定义包的结构、规则表达、作者流程与校验 |
| [scenario-editor.md](scenario-editor.md) | 专业编辑器、个人草稿、错误定位、试玩与定稿 |
| [runtime.md](runtime.md) | 回合推进、事实与记忆、提交、保存恢复与叙述 |
| [identity-and-saves.md](identity-and-saves.md) | 用户鉴权、数据归属、个人存档保存／读取与恢复 |
| [api-contract.md](api-contract.md) | 首期接口、输入输出、错误响应、去重与并发约定 |

## 关联实施项

- [首期：专业剧本编辑器、用户鉴权与个人存档闭环](../note/001-world-engine-foundation.md)：落实本次全局设计，状态为待实施。开发任务、执行顺序和验收结果在该 note 中维护。

首期目标：作者可通过专业编辑器初始化完整世界；玩家经过鉴权可保存、列出、读取和恢复本人存档。本轮仍只交付 docs/note，不将设计完成标为功能完成。

## 额外参考

[AI Dungeon 产品参考](research/ai-dungeon-review.md)仅保存研究结论与未采纳想法，不属于上述技术规范或实施计划；参考差异不自动扩大项目范围。

## 更新约定

全局文档只保留当前有效约定，不保留多套版本以供兼容。字段、接口、日志或存储设计调整时，直接更新相关文档和开发项，旧格式不要求继续可用。

此次文档替代原 `design-v0.1.md`，统一采用“剧本是完整世界定义包”的含义。WorldOS 仅是讨论中的产品参考，未核实其内部实现；此处描述的是本项目设计。
