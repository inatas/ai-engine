# 技术方案与工程边界

关联：[架构](architecture.md)、[DSL](scenario-schema.md)、[身份与访问](auth-and-ownership.md)、[作者生成](scenario-generation.md)、[个人存档](personal-saves.md)。本文维护技术组合、包依赖和工程门禁；各包配置及锁文件固定具体版本。

## 1. 技术组合

| 层 | 方案 |
| --- | --- |
| 语言／工程 | TypeScript strict、pnpm workspace、模块化单体 |
| 网页 | React + Vite + Ant Design，身份、编辑器和游戏使用同源 API |
| 应用服务 | Node.js + NestJS，按身份、创作、世界三个业务域组织 |
| 共享契约 | Zod 结构校验及推导类型；完整 DSL、草稿、请求／响应视图和检查点 |
| 纯计算核心 | 独立 engine，承担定义语义、规则和世界计算 |
| 数据库／访问 | PostgreSQL + Prisma，仅在 server 适配 |
| 验证 | ESLint、TypeScript、依赖检查、Vitest、Playwright 和 GitHub CI |

开发前端代理 /api 到本机服务端，数据库只绑定回环地址；正式部署网页和 API 同源且 HTTPS。部署配置明确可信 Origin 和代理，不从客户端转发头推测权限。正式环境数据库连接必须显式提供。

开发及验收均使用 PostgreSQL，JSONB 保存定义和完整世界载荷，关系列用于身份、归属、修订及列表。已有数据采用当前格式调整，不建立 SQLite、旧解释器或数据迁移实现。首期没有微服务、队列或 Python 运行依赖。作者侧生成由 server 应用层适配，候选与调用边界见[作者生成契约](scenario-generation.md)。供应方与模型属于部署适配选择，不改变 engine 的依赖边界；新增依赖须先明确批准并更新本规范。

## 2. 包依赖

| 包 | 允许的项目依赖 | 运行时边界 |
| --- | --- | --- |
| contracts | 无 | 仅 Zod；不引用 apps 或 engine |
| engine | contracts | 仅契约；Zod 是批准的传递依赖 |
| server | contracts、engine | 认证、数据库、HTTP、模型等 I/O 在这里适配 |
| web | contracts | 调用 API，不能直接导入 engine／server／ORM |

跨包只通过公开导出，禁止内部路径、跨包相对路径和 type-only 反向依赖。contracts 不导出 ORM 实体、NestJS 装饰器、配置或副作用初始化。生产代码不得导入工具／测试依赖；新增运行时依赖和传递依赖须先明确允许范围并更新本规范。

浏览器可引用校验结构，但只获取经过权限过滤的业务响应；共享完整检查点类型不构成下载完整世界的权限。

## 3. 纯计算限制与门禁

engine 与 contracts 的生产编译只暴露所需 ECMAScript lib，types=[]，不隐式加入 Node、DOM 或测试全局。禁止 engine 访问应用／框架／ORM／模型 SDK、Node 内置模块、文件／网络／数据库／进程、fetch／浏览器存储、Date／随机／计时器、eval／Function、动态 import 和 require。时间戳、标识与未来随机输入由应用显式提供并记录。

同样输入必须产生相同语义结果；所有 JSON 整数输入、边界及运算结果检查 JavaScript 安全整数，不舍入、不自动截断。完整数值定义见 DSL，业务版本语义见个人存档。

| 门禁 | 验证要求 |
| --- | --- |
| ESLint AST | 静态及 type-only 导入、重新导出、动态导入／require、全局访问和禁止 API |
| 实际目标解析 | tsconfig 别名、相对路径和重新导出不能绕到应用／非生产源码 |
| 依赖图 | manifest 白名单及批准依赖的传递依赖；中间包不能掩盖 I/O 或反向依赖 |
| 独立类型／构建 | 核心生产环境不借测试／DOM／Node 类型通过 |
| CI | 任一检查失败即阻断；用真实违规样例证明门禁，而非只保留配置 |

现有自定义 boundaries/pure 规则复用 TypeScript AST，独立脚本补充目标和依赖检查；首期整体禁止 Math／Date／globalThis、反射构造器路径与检查豁免。不得通过 eslint-disable、ts-ignore、扩大类型环境或间接依赖绕过。这是工程依赖约束，不是任意不可信代码沙箱；作者仅使用声明式 DSL。

前端因第三方声明冲突单独采用 skipLibCheck，源码仍 strict，核心生产检查不跳过库声明。CI 覆盖工程边界、独立构建、数据库及对应业务行为；基础探针不能替代实际接口和浏览器流程检查。

React 19 与 Ant Design 5 在网页入口加载官方 @ant-design/v5-patch-for-react-19 1.0.3（MIT，无额外运行依赖），用于按钮波纹及静态弹层的 ReactDOM 渲染适配；批准范围仅 apps/web，不进入 contracts 或 engine。依据[Ant Design 官方 React 19 说明](https://5x.ant.design/docs/react/v5-for-19/)，不是项目旧数据兼容层。

## 4. 数据适配与事务

身份域的应用依赖为 argon2 0.45.1 与 cookie 2.0.1，均为 MIT；限流使用 PostgreSQL 事务。弱密码使用固定版本、带许可的本地 SecLists 文件，不新增核心运行时依赖。采用成熟密码哈希与 Cookie 库避免自制安全算法；账号政策与会话规则只在[身份与访问](auth-and-ownership.md)维护。

各域拥有自己的业务查询和写入，Prisma 及连接由基础设施提供。完整 JSON 读取必须再做运行时结构／语义校验。revision、turn、schemaVersion 列采用 bigint，应用边界转 JSON number 时检查安全整数，不能把 BigInt 直接输出为 JSON。

作者生成采用同一 server 中的窄适配接口，输入受控上下文、输出严格候选；配置和密钥只在服务端，不增加通用工具 Agent 或独立模型网关。同步请求期间不持有数据库事务，不自动重试或修复调用；调用取消、用量及额度以作者生成契约为准。候选仅为工作区临时状态，不新增持久化候选表或改变存档版本。

业务请求去重采用 ProcessedRequest 表，作为所属操作的事务记录；唯一键、摘要与冲突规则只在 [API 契约](api-contract.md)维护。请求结果与对应对象／状态同事务提交。完整世界载荷及版本检查只在 [个人存档](personal-saves.md)维护。

Prisma 使用 prisma-client 生成器和 PostgreSQL driver adapter；生成代码不提交，服务端构建前重新生成。pnpm 版本及脚本授权由 workspace 配置与锁文件固定，仅批准已核实的构建脚本。workspace 使用 hoisted 安装布局；依赖边界仍以包声明与实际模块解析检查，不能依赖 node_modules 的固定层级判断批准依赖。

本地 PostgreSQL 绑定回环地址，默认端口 55433，通过 AI_ENGINE_DB_PORT 可调整；DATABASE_URL 必须与该端口一致。开发环境由根 .env 提供服务端配置，模型地址、密钥和模型名只在服务端读取，具体参数见[作者生成契约](scenario-generation.md)。

## 5. 技术资料

参考：[pnpm 11 配置](https://pnpm.io/blog/releases/11.0)、[Prisma 生成器](https://www.prisma.io/docs/orm/v7/prisma-schema/overview/generators)、[TypeScript lib](https://www.typescriptlang.org/tsconfig/lib.html)。这些资料核实工具能力，项目域划分与参数选择属于本项目设计。
