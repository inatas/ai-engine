# AI Engine

采用 **world engine + 自定义剧本** 的 AI 文字交互游戏项目。剧本是完整世界定义包，包含背景、NPC、规则、初始局势、记忆、事件、目标和叙事设置；引擎负责运行这个世界。

作者通过专业剧本编辑器初始化世界，玩家注册登录后运行游戏并保存、读取自己的个人存档。首期规划覆盖这两项目标。

当前阶段：已完成全局文档与首期实施设计，尚未编写程序。

技术方案已确定：全 TypeScript，React + Vite + Ant Design、Node.js + NestJS、Zod、PostgreSQL + Prisma。engine 核心独立，工程检查强制依赖边界；自动会话与手动存档从第一天带 schemaVersion，仅支持当前版本。

## 文档入口

- [项目规范](AGENTS.md)：docs + note 双向文档驱动、破坏性更新与引擎边界。
- [全局技术文档](docs/README.md)：架构、剧本 DSL、专业编辑器、运行机制与鉴权存档。
- [技术选型与工程边界](docs/technical-stack.md)：具体技术组合、规划包、禁止 API、CI 门禁与存档版本策略。
- [首期实施 note](note/001-world-engine-foundation.md)：专业编辑器、鉴权和个人存档闭环的范围、任务、验收与结果。
- [AI Dungeon 额外参考](docs/research/ai-dungeon-review.md)：产品研究与未采纳的候选想法，不属于实施需求。

`docs/` 维护整个项目的当前设计，`note/` 维护每次迭代开发项。实现发生变化时双向回写；不维护旧字段、旧日志或旧格式兼容。

首期计划以《大明末年危局》验证完整剧本与回合结算，并用另一题材的最小剧本验证引擎通用性。首期使用固定 NPC 行为与结构化反馈，真实模型在后续迭代接入。

## 当前目录

```text
ai-engine/
├── AGENTS.md
├── README.md
├── docs/
│   ├── README.md
│   ├── architecture.md
│   ├── technical-stack.md
│   ├── scenario-schema.md
│   ├── scenario-editor.md
│   ├── runtime.md
│   ├── identity-and-saves.md
│   ├── api-contract.md
│   └── research/
│       └── ai-dungeon-review.md
└── note/
    └── 001-world-engine-foundation.md
```

网页编辑器、服务端、数据库与运行入口将在首期实施时落地。本轮只完善 docs/note，功能尚未实现。
