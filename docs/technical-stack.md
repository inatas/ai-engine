# 技术方案与工程边界

关联：[架构](architecture.md)、[001 工程与引擎](../note/001-world-engine-foundation.md)。当前工程配置见各包配置和锁文件，实际安装／验证结果见 note，启动命令见根 README。

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

开发及验收均使用 PostgreSQL，JSONB 保存定义和完整世界载荷，关系列用于身份、归属、修订及列表。已有数据采用当前格式调整，不建立 SQLite、旧解释器或数据迁移实现。首期没有微服务、队列、Python 或真实模型依赖。

## 2. 包依赖

| 包 | 允许的项目依赖 | 运行时边界 |
| --- | --- | --- |
| contracts | 无 | 仅 Zod；不引用 apps 或 engine |
| engine | contracts | 仅契约；Zod 是批准的传递依赖 |
| server | contracts、engine | 认证、数据库、HTTP、模型等 I/O 在这里适配 |
| web | contracts | 调用 API，不能直接导入 engine／server／ORM |

跨包只通过公开导出，禁止内部路径、跨包相对路径和 type-only 反向依赖。contracts 不导出 ORM 实体、NestJS 装饰器、配置或副作用初始化。生产代码不得导入工具／测试依赖；新增运行时依赖和传递依赖先回写技术方案与 note。

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

前端因现有第三方声明冲突单独采用 skipLibCheck，源码仍 strict，核心生产检查不跳过库声明。当前 CI 包含数据库基础探针，后续实际接口／浏览器行为由所属 note 补齐。

## 4. 数据适配与事务

身份域的应用依赖为 argon2 0.45.1 与 cookie 2.0.1，均为 MIT；限流使用 PostgreSQL 事务。弱密码使用固定版本、带许可的本地 SecLists 文件。选择依据和实际验证由 [002](../note/002-auth-and-ownership.md)维护；不新增核心运行时依赖。

各域拥有自己的业务查询和写入，Prisma 及连接由基础设施提供。完整 JSON 读取必须再做运行时结构／语义校验。revision、turn、schemaVersion 列采用 bigint，应用边界转 JSON number 时检查安全整数，不能把 BigInt 直接输出为 JSON。

业务请求去重采用 ProcessedRequest 表，作为所属操作的事务记录；唯一键、摘要与冲突规则只在 [API 契约](api-contract.md)维护。请求结果与对应对象／状态同事务提交。完整世界载荷及版本检查只在 [个人存档](personal-saves.md)维护。

Prisma 使用 prisma-client 生成器和 PostgreSQL driver adapter；生成代码不提交，服务端构建前重新生成。pnpm 版本及脚本授权由 workspace 配置与锁文件固定，仅批准已核实的构建脚本。

## 5. 实施状态与资料

四包、核心计算、数据库基础与身份防护已有实现；创作／世界业务接口和编辑器仍待实施。具体状态以 note 为准，不能从 framework／schema 的存在推定功能完成。

参考：[pnpm 11 配置](https://pnpm.io/blog/releases/11.0)、[Prisma 生成器](https://www.prisma.io/docs/orm/v7/prisma-schema/overview/generators)、[TypeScript lib](https://www.typescriptlang.org/tsconfig/lib.html)。这些资料核实工具能力，项目域划分与参数选择属于本项目设计。
