# 技术选型与工程边界

决策日期：2026-10-12。状态：已确定方案，配置与程序尚未实施。  
关联文档：[全局架构](architecture.md)、[剧本结构](scenario-schema.md)、[运行机制](runtime.md)、[鉴权与存档](identity-and-saves.md)、[接口契约](api-contract.md)。  
关联开发项：[首期实施 note](../note/001-world-engine-foundation.md)。

## 1. 技术选型

| 层次 | 当前选择 | 用途与理由 |
| --- | --- | --- |
| 语言 | 全 TypeScript，开启 strict | 编辑器、契约、引擎与服务端使用同一语言，减少跨端定义不同步 |
| 前端 | React + Vite + Ant Design | 专业领域表单、引用选择、条件树与个人游戏界面 |
| 服务端 | Node.js + NestJS | 组织鉴权、内容、回合应用服务、事务与存档入口 |
| 引擎核心 | 独立 TypeScript 包 | 通用剧本语义校验、初始化、条件与效果、回合结算与可见结果计算 |
| 数据契约 | Zod schema 与推导类型 | 运行时结构校验与静态类型；必要时导出 JSON Schema |
| 数据库 | PostgreSQL | 保存账号、草稿、定稿、世界会话与检查点；事务与条件更新 |
| 数据访问 | Prisma | 仅在服务端适配数据库，不成为 engine 或共享契约的依赖 |
| 工程组织 | pnpm workspace | 同仓库管理前端、服务端、引擎和共享契约 |
| 静态检查 | ESLint + TypeScript 编译 + 包依赖检查 | 强制依赖方向、禁止外部 API、发现类型错误和边界绕过 |
| 验证工具 | Vitest + Playwright | 规则与服务端行为验证，以及浏览器编辑、登录、保存恢复流程 |

采用模块化单体：网页静态资源与 API 对外同源，服务端内部按职责组织。开发时由前端代理访问 API；正式部署提供同源入口。不引入微服务、任务队列或额外 Python 运行环境。真实模型仍在后续迭代接入。

首期开发与验收统一使用 PostgreSQL，替换此前“可使用 SQLite”的未实施方案。事务、并发与重启恢复验收在实际目标数据库执行，不维护另一套数据库实现。

鉴权沿用 Cookie 与服务端 AuthSession。NestJS 负责应用组织；密码哈希、令牌、CSRF 与限流使用成熟组件，具体库、参数和中间件顺序在首期实施前核实并回写 note。选择框架不意味着这些能力已自动完成。

具体 Node.js、包管理器和依赖版本在实施时确定、记录并锁定。当前没有依赖文件、配置或可执行命令，不把规划写成已经安装。

## 2. 规划包与依赖方向

| 规划位置 | 内容 | 允许的项目依赖 |
| --- | --- | --- |
| apps/web | 编辑器、游戏与个人存档界面 | packages/contracts；调用服务端 API |
| apps/server | NestJS 入口、鉴权、内容、模型适配、存储与事务 | packages/contracts、packages/engine |
| packages/contracts | 剧本 schema、动作与结果类型、API 视图、检查点 schema | 不依赖任何 apps 或 engine |
| packages/engine | 语义校验、世界初始化、规则与确定性结算 | packages/contracts；其他运行时依赖须明确批准 |

初始运行时依赖白名单：contracts 仅使用 Zod；engine 仅直接依赖 contracts。Zod 是允许的传递依赖。工具与测试依赖单独管理，不得由生产源码导入。新增运行时依赖先更新 note 与本文件，检查传递依赖后加入白名单。

contracts 不导出 ORM 实体、NestJS 装饰器、服务端配置或带副作用的初始化。跨包导入只通过公开导出；禁止跨包相对路径和内部源码路径。engine 的 type-only 导入也不得引用应用或框架类型。

共享的是契约与校验，不是所有内部数据。浏览器使用经过可见性过滤的 PlayerView／SaveView；完整检查点 schema 不构成下载 NPC 私有状态的权限。未完成草稿使用草稿契约，试玩与定稿必须通过完整定义校验。

## 3. engine 的执行边界

engine 包指纯计算核心。架构中的广义 world engine 还包括服务端编排与适配能力；两者通过数据交互，不能将所有运行职责都放入核心包。

应用服务验证身份与归属、读取当前格式状态，调用核心校验或结算，再用短事务提交状态、记录、请求结果与 revision。核心接收不依赖存储来源的数据，返回候选状态、裁决、变化和可见结果；不能自行保存或调用模型。

首期 NPC 候选选择和事件顺序由核心确定。未来模型调用在 server 适配模块完成，结构化提议再交给核心裁决。等待模型期间不持有数据库事务；提交时重新检查 revision，冲突时不提交过期结果。

核心禁止直接访问：

- React、NestJS、Prisma、模型 SDK，以及任何应用层模块。
- Node.js 内置模块（包括 node: 与裸名称）、文件系统、网络、数据库、进程与环境变量。
- fetch、WebSocket、window、document、localStorage 等外部或浏览器 API。
- Date 构造／当前时间、Math.random、计时器及直接随机 ID 生成；需要时间、标识或随机结果时显式传入可记录数据。
- eval、Function 构造、动态 import 与 require；首期 DSL 不执行作者脚本。

同一剧本、状态和动作输入应得到同一语义结果；时间戳与请求身份由应用层赋予。首期无随机机制，不为假设需求先建设随机服务。

JSON 数值保持一致：integer 字段、边界、参数、回合及结算结果均须是 JavaScript 安全整数，运算后再次校验。禁止 NaN、Infinity、小数和超出安全范围的整数，不得自动舍入。需要更大整数时另行调整当前 DSL，不引入 BigInt 与 JSON 双格式。

## 4. 将边界变成强制检查

| 检查层 | 必须落实的约束 |
| --- | --- |
| ESLint 导入规则 | 限制生产源码的静态导入与重新导出；禁止应用／框架／Node 依赖，覆盖 bare、node:、子路径与 type-only 导入 |
| ESLint AST 与 API 规则 | 禁止动态 import、require、eval／Function；限制外部全局和 Date／Math.random 等调用，覆盖 globalThis 与其他全局访问路径 |
| 路径解析与包依赖检查 | 解析真实目标，检查别名、相对路径、重新导出与传递依赖；不可经中间包反向依赖 apps 或外部 I/O |
| 独立编译 | engine/contracts 生产编译仅使用需要的 ECMAScript lib，不自动加入 DOM、Node 或测试全局类型；各包严格声明依赖 |
| CI 门禁 | lint、依赖检查、独立类型检查与构建任一失败即失败；边界配置需有违规样例验证 |

不能只依赖 no-restricted-imports，它仅覆盖静态导入。具体解析插件或自定义规则在实施 note 记录；配置后验证动态导入、别名、中间包、globalThis 调用及 type-only 导入的拒绝行为。

依赖白名单与规则变更须经过文档回写，不以 eslint-disable、ts-ignore、扩大生产类型环境或偷偷加入间接依赖绕过。测试配置可以使用测试工具，不能因此豁免生产源码。这些是工程约束，不是运行任意不可信代码的安全沙箱；项目继续只解释受限声明式 DSL。

## 5. 存档格式版本

完整持久化世界检查点从第一天包含必填正安全整数 schemaVersion，初始值为 1。服务端维护唯一当前版本常量；字段由程序生成，不接受客户端指定。

WorldSession 自动持久化世界载荷与 SaveGame 手动检查点共用该约定。存储层保留版本元数据，检查点载荷根部也包含 schemaVersion；两者必须一致，在同一事务写入。请求去重账本是会话级数据，读取依赖世界内容的已提交结果前也必须经过当前版本检查，防止缓存绕过门禁。

读取、继续游戏、提交回合、保存检查点或恢复前，先完成鉴权与归属检查，再验证 schemaVersion，然后校验完整载荷与引用。缺失版本、非法版本或不等于当前版本时拒绝，不推测版本、不填默认值、不尝试旧 schema。版本相同但载荷损坏也明确失败。

列表可读取独立列中的名称、时间等概要，返回 loadable 标记；版本不支持时 loadable=false，界面显示存档不可用。该标记只表示版本是否支持，详情与恢复仍须完整校验，不能信任列表或客户端标记。元数据与载荷不一致属于存储损坏。

存档结构或恢复语义发生破坏性变化时递增；嵌入剧本、回合记录或事件语义改变，使旧检查点不能按新规则解释时，也必须递增。单纯文案、样式或新增剧本内容不要求递增。更新后直接重新创建当前格式数据，不实现迁移、旧版解释器或双格式读取。

| 标识 | 含义 |
| --- | --- |
| schemaVersion | 程序能否解释完整存档结构与恢复语义 |
| revision | 对草稿或会话进行条件写入，防并发覆盖 |
| release_id | 某份不可修改的剧本定稿身份 |
| scenario_snapshot | 该局启动时的完整定义，隔离后续草稿修改 |

schemaVersion 不加入作者的 ScenarioDefinition，不等于内容修订或兼容承诺。数据库表结构按当前格式直接调整，不将版本检查扩展成旧数据迁移要求。

## 6. 依据与适用范围

上述组织方式是本项目决策，官方资料只用于核实工具能力，不证明其他 AI 游戏采用相同方案。

- [Zod](https://zod.dev/)：运行时 schema、类型推导与 JSON Schema 转换。
- [TypeScript lib 配置](https://www.typescriptlang.org/tsconfig/lib.html)：按边界选择可见 API 类型。
- [NestJS](https://docs.nestjs.com/)：TypeScript 服务端模块组织。
- [Prisma 事务](https://www.prisma.io/docs/orm/fundamentals/transactions)：整体提交与回滚；具体 API 以实施时锁定版本为准。
- [ESLint 静态导入限制](https://eslint.org/docs/latest/rules/no-restricted-imports)、[全局限制](https://eslint.org/docs/latest/rules/no-restricted-globals)、[属性限制](https://eslint.org/docs/latest/rules/no-restricted-properties)：边界检查基础，需补齐覆盖范围。
- [pnpm workspace](https://pnpm.io/workspaces)、[Vite](https://vite.dev/guide/)、[Vitest](https://vitest.dev/guide/)、[Playwright](https://playwright.dev/docs/intro)：工程与验证工具。

本轮不创建代码、lint 配置、依赖文件或数据库；实际落实与验收在首期 note 记录。
