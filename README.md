# AI Engine

采用 **world engine + 自定义剧本** 的 AI 文字交互游戏项目。剧本是完整世界定义包，包含背景、NPC、规则、初始局势、记忆、事件、目标和叙事设置；引擎负责运行这个世界。

作者通过专业剧本编辑器初始化世界，玩家注册登录后运行游戏并保存、读取自己的个人存档。首期规划覆盖这两项目标。

当前阶段：首期实施中。已建立四包工程、纯计算规则引擎、两份可执行规则夹具及 Docker PostgreSQL 入口。账号鉴权与浏览器身份流程已实现并通过验收；专业编辑器与个人存档业务尚未完成。

技术方案已确定：全 TypeScript，React + Vite + Ant Design、Node.js + NestJS、Zod、PostgreSQL + Prisma。engine 核心独立，工程检查强制依赖边界；自动会话与手动存档从第一天带 schemaVersion，仅支持当前版本。

## 文档入口

- [项目规范](AGENTS.md)：docs + note 双向文档驱动、破坏性更新与引擎边界。
- [全局技术文档](docs/README.md)：架构、剧本 DSL、专业编辑器、运行机制与鉴权存档。
- [技术选型与工程边界](docs/technical-stack.md)：具体技术组合、规划包、禁止 API、CI 门禁与存档版本策略。
- [001 开发项](note/001-world-engine-foundation.md)：工程基础、DSL／定义校验、通用执行、游戏应用与个人存档。
- [账号鉴权与数据归属设计](docs/auth-and-ownership.md)及 [002 开发项](note/002-auth-and-ownership.md)：已实现，身份接口、真实数据库及浏览器验收通过。
- [专业剧本编辑器设计](docs/scenario-editor.md)及 [003 开发项](note/003-scenario-editor.md)：领域编辑与作者内容工作流，待确认。
- [引擎 DSL](docs/scenario-schema.md)：001 的输入契约与校验规范。
- [具体示例设计](docs/custom-scenarios.md)及 [004 开发项](note/004-custom-scenarios.md)：通过 003 从空白制作大明与空间站，已有 JSON 只作规则对照。
- [AI Dungeon 额外参考](docs/research/ai-dungeon-review.md)：产品研究与未采纳的候选想法，不属于实施需求。

`docs/` 维护整个项目的当前设计，`note/` 维护每次迭代开发项。实现发生变化时双向回写；不维护旧字段、旧日志或旧格式兼容。

首期计划以《大明末年危局》验证完整剧本与回合结算，并用另一题材的最小剧本验证引擎通用性。首期使用固定 NPC 行为与结构化反馈，真实模型在后续迭代接入。

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
pnpm db:up
pnpm db:generate
pnpm db:push
pnpm build
pnpm check
pnpm test
pnpm db:verify
pnpm dev
```

打开 [世界工坊](http://127.0.0.1:5173/) 注册、登录或退出，网页通过同源代理连接 API。注册后需要另行登录，刷新时由 me 确认身份。[健康入口](http://127.0.0.1:3000/api/health)同时检查数据库连接。剧本编辑和游戏操作仍待开发。

PostgreSQL 使用独立容器和持久化卷，绑定本机 55432 端口。先运行 setup:local 建立根 `.env`，随机 CSRF_SECRET 不进入 Git；重复运行保留已有密钥。API 和 Prisma 工具读取该文件，自定义终端环境变量优先；AUTH_ORIGIN 必须与网页精确同源。切勿把密钥设到 VITE_ 前缀的前端变量。正式环境必须显式设置数据库连接和 HTTPS 同源入口，当前只提供本地开发入口。

`pnpm db:push` 直接将项目数据库调整为当前表结构；已有数据出现破坏性变更时会明确失败，需要开发者处理后重新创建当前格式数据。没有旧版兼容或数据迁移工具。`pnpm db:stop` 停止容器并保留卷。数据库验证会创建专用随机探针账号，验证事务与 JSONB 后删除探针数据。

## 已实现的程序目录

- `apps/web`：React + Vite + Ant Design 首页、注册／登录／当前身份／退出、身份变化事件和 API 代理。
- `apps/server`：NestJS 健康与认证入口、全局身份／CSRF 守卫、持久化会话与限流、Prisma 表结构与事务验证。
- `packages/contracts`：严格 Zod 剧本结构、未完成草稿、认证输入／身份视图和核心世界状态类型。
- `packages/engine`：语义校验、初始化、原子效果、NPC／事件／目标顺序与玩家视图过滤。
- `scenarios`：大明末年危局与空间站维修 JSON，以及作者说明。
- `tests`、`scripts`、`.github/workflows`：行为验证、强制工程边界和 CI。

本轮已 review 领域与详细功能：002 管身份、003 管完整创作工作流、001 管引擎契约与运行／存档；004 依赖 003 制作具体 example。002 已实现，接下来开发 003 创作域，并接入 001 世界应用。各项分别验收，纯计算引擎测试通过不等于首期完整产品目标已完成。


`pnpm test` 包含规则／边界／前端测试和独立 PostgreSQL 鉴权测试，需数据库在线；`pnpm test:auth` 可单独复验身份功能。每次鉴权测试使用专用随机 schema 并清理，不删除开发账号。凭据／格式及保护策略见身份文档。
