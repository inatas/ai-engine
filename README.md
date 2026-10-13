# AI Engine

采用 **world engine + 自定义剧本** 的 AI 文字交互游戏项目。剧本是完整世界定义包，包含背景、NPC、规则、初始局势、记忆、事件、目标和叙事设置；引擎负责运行这个世界。

产品核心是玩剧本：玩家登录默认选择剧本、开始或继续游戏，保存与读取自己的游戏记录。内置剧本可直接开局；创建／编辑剧本位于独立“创作”入口，作者可生成、编辑并定稿自己的世界。

当前阶段：首期实施中。四包工程、纯计算规则引擎、账号鉴权，以及草稿／定稿、领域编辑器、试玩／正式游戏和个人检查点流程已接入。作者生成已接通现有模型服务，真实大纲、细化、定向修订及采纳后试玩主流程验证通过；完整编辑器与生成异常验收仍待完成。

技术方案已确定：全 TypeScript，React + Vite + Ant Design、Node.js + NestJS、Zod、PostgreSQL + Prisma。engine 核心独立，工程检查强制依赖边界；自动会话与手动存档从第一天带 schemaVersion，仅支持当前版本。

## 文档入口

- [项目规范](AGENTS.md)：docs + note 双向同步、单向引用，破坏性更新与引擎边界。
- [全局技术文档](docs/README.md)：架构、剧本 DSL、专业编辑器、运行机制与鉴权存档。
- [技术选型与工程边界](docs/technical-stack.md)：具体技术组合、规划包、禁止 API、CI 门禁与存档版本策略。
- [001 开发项](note/001-world-engine-foundation.md)：工程基础、DSL／定义校验、通用执行、游戏应用与个人存档。
- [账号鉴权与数据归属设计](docs/auth-and-ownership.md)及 [002 开发项](note/002-auth-and-ownership.md)：已实现，身份接口、真实数据库及浏览器验收通过。
- [专业剧本编辑器设计](docs/scenario-editor.md)、[作者生成契约](docs/scenario-generation.md)及 [003 开发项](note/003-scenario-editor.md)：创作工作区、领域操作及模型候选契约；实施结果与待验收项见开发记录。
- [引擎 DSL](docs/scenario-schema.md)：001 的输入契约与校验规范。
- [具体示例设计](docs/custom-scenarios.md)及 [004 开发项](note/004-custom-scenarios.md)：通过 003 从空白制作大明与空间站，已有 JSON 只作规则对照。
- [AI Dungeon 额外参考](docs/research/ai-dungeon-review.md)：产品研究与未采纳的候选想法，不属于实施需求。

`docs/` 独立维护整个项目的当前设计，不引用开发 note；`note/` 引用相应 docs，维护迭代开发项、进度与实际验证。设计和实施发现双向回写，引用方向保持 `note → docs`；不维护旧字段、旧日志或旧格式兼容。根 README 同时提供全局规范与开发记录入口，不作为架构规范的替代来源。

## 开发项与状态

| 开发项 | 范围 | 当前记录状态 |
| --- | --- | --- |
| [001 世界引擎与个人存档](note/001-world-engine-foundation.md) | DSL／校验、通用执行、工程、游戏应用与存档 | 实施中，游戏与检查点业务已接入，完整验收待核对 |
| [002 账号鉴权与数据归属](note/002-auth-and-ownership.md) | 身份上下文、认证防护和身份界面 | 已实现；历史记录含 78 项检查及浏览器身份／重启链路 |
| [003 专业剧本编辑器](note/003-scenario-editor.md) | 创作服务、领域控件、真实作者生成与试玩 | 实施中；领域编辑与模型适配已接入，真实生成待本地配置与验收 |
| [004 基于编辑器的示例](note/004-custom-scenarios.md) | 使用标准编辑器制作、导出与运行具体世界 | 设计待确认，依赖编辑器；已有 JSON 仅作夹具 |

实际证据及遗留事项以对应 note 为准。

首期计划以《大明末年危局》验证完整剧本与回合结算，并用另一题材的最小剧本验证引擎通用性。运行侧使用固定 NPC 行为与结构化反馈；作者侧真实 AI 批量生成属于 003 必需范围，需配置现有模型服务并完成真实生成验收。运行侧模型行动与叙述在后续迭代接入。

## 当前目录

```text
ai-engine/
├── apps/
│   ├── web/
│   └── server/
├── packages/
│   ├── contracts/
│   └── engine/
├── scenarios/
├── scripts/
├── tests/
├── compose.yaml
├── package.json
├── AGENTS.md
├── README.md
├── docs/
│   ├── README.md
│   ├── architecture.md
│   ├── technical-stack.md
│   ├── scenario-schema.md
│   ├── custom-scenarios.md
│   ├── scenario-editor.md
│   ├── scenario-generation.md
│   ├── runtime.md
│   ├── auth-and-ownership.md
│   ├── personal-saves.md
│   ├── api-contract.md
│   └── research/
│       └── ai-dungeon-review.md
└── note/
    ├── 001-world-engine-foundation.md
    ├── 002-auth-and-ownership.md
    ├── 003-scenario-editor.md
    └── 004-custom-scenarios.md
```

## 本地运行

使用 Node.js 24.19.0、pnpm 11.25.0，以及已启动的 Docker Desktop Linux 引擎。

```powershell
pnpm install --frozen-lockfile
pnpm setup:local
pnpm db:up
pnpm db:generate
pnpm db:push
pnpm build
pnpm check
pnpm test
pnpm db:verify
pnpm dev
```

打开 [世界工坊](http://127.0.0.1:5173/) 注册、登录或退出，网页通过同源代理连接 API。注册后需要另行登录，刷新时由 me 确认身份。[健康入口](http://127.0.0.1:3000/api/health)同时检查数据库连接。登录后可以创建／导入草稿、编辑、校验、试玩与定稿，再开始正式游戏、保存检查点和恢复独立分支。

PostgreSQL 使用独立容器和持久化卷，默认绑定本机 55433 端口。先运行 setup:local 建立根 `.env`，随机 CSRF_SECRET 不进入 Git；重复运行保留已有密钥。API 和 Prisma 工具读取该文件，自定义终端环境变量优先；AUTH_ORIGIN 必须与网页精确同源。切勿把密钥设到 VITE_ 前缀的前端变量。正式环境必须显式设置数据库连接和 HTTPS 同源入口，当前只提供本地开发入口。

AI 创作需要在根 `.env` 填写 MODEL_API_URL（HTTPS 服务根地址或完整 Chat Completions 接口）、MODEL_API_KEY、MODEL_NAME，然后重启服务端。服务根地址自动附加 /chat/completions；不能填写控制台地址。配置缺失时显示生成不可用，手动创作仍可运行；不会返回预置内容代替模型。可选额度配置见[作者生成契约](docs/scenario-generation.md)。

`pnpm db:push` 直接将项目数据库调整为当前表结构；已有数据出现破坏性变更时会明确失败，需要开发者处理后重新创建当前格式数据。没有旧版兼容或数据迁移工具。`pnpm db:stop` 停止容器并保留卷。数据库验证会创建专用随机探针账号，验证事务与 JSONB 后删除探针数据。

## 已实现的程序目录

- `apps/web`：身份界面、可撤销领域编辑器、NPC 七分组、属性简写、模型候选工作区、游戏与个人检查点。
- `apps/server`：身份／CSRF、本人草稿与定稿、作者生成适配与共享额度、世界／存档完整校验和事务去重。
- `packages/contracts`：严格 Zod DSL、创作 DTO、引用与候选差异、身份／世界及检查点契约。
- `packages/engine`：语义校验、初始化、原子效果、NPC／事件／目标顺序与玩家视图过滤。
- `scenarios`：大明末年危局与空间站维修 JSON，以及作者说明。
- `tests`、`scripts`、`.github/workflows`：行为验证、强制工程边界和 CI。

002 管身份、003 管完整创作工作流、001 管引擎契约与运行／存档；004 依赖 003 制作具体 example。各项分别验收，纯计算引擎测试通过不等于首期完整产品目标已完成。


`pnpm test` 包含规则／边界／创作状态测试和独立 PostgreSQL 身份／创作／世界测试，需数据库在线；`pnpm test:auth` 单独运行该数据库测试组。每次使用专用随机 schema 并清理，不删除开发账号。凭据／格式及保护策略见身份文档。
