# 账号鉴权与数据归属

关联文档：[架构](architecture.md)、[技术选型](technical-stack.md)、[应用契约](api-contract.md)、[编辑器](scenario-editor.md)、[个人存档](personal-saves.md)。

本文维护账号身份、登录生命周期、请求保护和逐对象授权的统一规范。业务对象的访问必须由其所属域逐入口检查，不能由登录成功推定全部业务授权成立。

## 1. 职责与边界

User 是平台账号，AuthSession 是平台登录会话；Character 是剧本角色，WorldSession 是一次游戏。认证确定当前账号，数据归属决定可以访问哪些对象，角色可见性决定游戏中可以看到哪些内容，三者分别检查。

首期草稿、定稿、试玩、正式世界和个人存档均为私有。拥有剧本可以在作者入口看到完整定义，拥有正式游戏仍只能获得玩家视图。公共模板只供复制；复制品属于当前登录账号。

账号及所有权处理只位于 apps/server，engine 不接收浏览器身份、不查询 User／AuthSession、不依赖 NestJS 或 Prisma。个人检查点、存档版本、游戏事务和恢复语义由个人存档及运行文档维护。

身份域独立范围是账号、登录会话、请求保护、可信身份上下文和访问原则。草稿、模板、定稿均属创作域，世界和存档属世界域；对象授权由其所属域调用本身份上下文并查询 owner，不能把业务仓储放入身份模块。

## 2. 账号与密码策略

| 项目 | 规则 |
| --- | --- |
| 用户名 | 3–32 个 ASCII 字母、数字或下划线；统一转为小写作为登录名，数据库唯一；不静默删除首尾空格 |
| 密码 | 15–128 个 Unicode 码点，同时限制 UTF-8 为 512 字节；允许空格和 Unicode，不截断、不修剪、不改写，不强制字符组合；单独 UTF-16 代理项拒绝，避免编码时替换密码 |
| 弱密码 | 注册时拒绝服务端本地 SecLists 常见密码列表中的值；固定版本与许可见[清单说明](../apps/server/resources/README.md)，不把密码发往第三方服务 |
| 密码存储 | 使用成熟 Argon2id 库； memoryCost=19456 KiB、timeCost=2、parallelism=1，库生成每个密码独立的随机盐 |
| 登录失败 | 不存在的账号与错误密码返回相同 401、相同文案；不存在账号仍执行固定虚拟哈希验证，不声称能够完全消除时间差 |
| 用户名占用 | 注册返回 409 username_unavailable；这是注册入口明确允许暴露的可用性信息，不暴露私人业务对象 |

注册只建立 User，不自动登录。密码、哈希、原始 Cookie、CSRF 令牌不进入普通日志、URL、错误详情或剧本定义。

以上长度和资源参数是项目政策。Argon2id 起始参数依据 [OWASP 密码存储指南](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)，密码长度、统一失败提示和限流原则依据 [OWASP 鉴权指南](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)。库选择与依赖边界由[技术方案](technical-stack.md)维护，调整账号策略须同步本文。

## 3. 登录会话

服务端使用成熟密码学随机源生成 32 字节不透明令牌，浏览器仅持有令牌 Cookie；数据库保存 SHA-256 令牌摘要。该摘要用于随机令牌查找，不用于密码哈希。客户端不能编辑令牌来指定 user_id。

绝对有效期 7 天、空闲有效期 24 小时，均由服务端校验；lastSeenAt 最多每 5 分钟更新一次。数据库读取后检查撤销、绝对过期与空闲过期；退出立即撤销当前会话并清除 Cookie。重启服务后有效登录由数据库恢复，单个账号可以拥有多个独立登录会话，退出不影响其他设备。

登录成功建立新的会话令牌和 CSRF 上下文，事务内消费匿名上下文或撤销当前浏览器原来的有效会话；重登录不沿用旧令牌。同一旧上下文并发登录只允许一次成功，竞争失败返回 409 auth_context_changed，刷新后重试。过期会话返回 401 unauthenticated，不通过前端 Cookie 是否存在来判断登录成功。

认证 Cookie 名称 ai_engine_session，HttpOnly、SameSite=Lax、Path=/，不设置 Domain；正式 HTTPS 环境必须 Secure。本地开发仅允许回环 HTTP，同源网页代理访问 API。生产环境缺少 HTTPS 同源配置时拒绝启动认证功能。身份及私有数据响应使用 Cache-Control: no-store。

设计依据：[OWASP 会话管理指南](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)。

## 4. CSRF、Origin 与限流

所有 POST／PUT／PATCH／DELETE（包括注册、登录、退出）同时检查配置的精确 Origin 和 X-CSRF-Token；无 Origin、无令牌、跨站来源或错误令牌均拒绝。信任的 Origin 从服务端配置获取，不从任意 Host 或转发请求头自动推导。GET 不产生业务写入。

GET /api/auth/csrf 建立或复用匿名浏览器上下文，返回 csrf_token；该上下文不具有用户权限。匿名上下文有效期 30 分钟，随机上下文标识放入 HttpOnly／SameSite Cookie，服务端保存上下文标识摘要、CSRF 摘要和有效期。登录后改用 AuthSession 绑定的 CSRF 令牌，退出后原认证上下文失效；匿名上下文不能用来修改已登录的私有对象。

CSRF 令牌保存在前端内存，不放入 URL 或 localStorage。采用 Node.js 标准密码学 API，以独立 CSRF_SECRET 对“上下文类型 + 原始随机上下文令牌”执行 HMAC-SHA-256，结果编码为 base64url；匿名与登录的上下文类型不同。数据库仍保存 CSRF 摘要，校验时采用恒定时间比较。刷新时服务端先验证 Cookie 绑定的上下文，再重新派生并返回 CSRF 令牌；不把不可逆摘要当成可恢复令牌。登录更换上下文使旧 CSRF 失效。

CSRF_SECRET 由部署环境提供至少 32 字节随机密钥，开发与生产均需配置，重启保持一致；缺失时认证模块拒绝启动。密钥只位于服务端，不进入 Git 或前端包。改变密钥时同步撤销既有认证与匿名上下文，不让旧摘要与新令牌并存。此派生规则为项目方案，采用标准 HMAC，不自制密码学算法。

滚动窗口：登录每 IP 每 15 分钟 30 次、每规范化用户名每 15 分钟 10 次；注册每 IP 每小时 10 次；CSRF 初始化每 IP 每分钟 60 次。计数在 PostgreSQL 持久化，覆盖未知账号并在重启后继续生效；超过任一门限返回 429 rate_limited 和 Retry-After。失败不永久锁住账号，短时间封禁与恢复通过实际测试验证。

当前单服务开发环境读取直接连接的客户端 IP；反向代理仅接受 TRUSTED_PROXY_IPS 显式列出的 IP，不接受任意 X-Forwarded-For 绕过限流。匿名上下文由 AnonymousAuthContext 保存；AuthRateLimit 按操作／IP 或用户名摘要保存有界滚动时间列表，事务锁定对应键后检查和追加。AuthSecurityState 保存密钥指纹，启动时事务检查密钥变化并撤销所有旧认证／匿名上下文；不保存原密钥。

设计依据：[OWASP CSRF 防护指南](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)。具体时限与频率是已确认的项目政策。

## 5. 数据归属与处理顺序

所有业务对象由服务端把已验证账号写为 owner_user_id（Prisma 当前字段 ownerUserId），客户端不得提交或修改 owner。User 的 id、AuthSession 的 userId 和业务对象 id 不能互相替代。

| 对象 | 授权约定 | 业务实现归属 |
| --- | --- | --- |
| ScenarioDraft | 列表、创建、读取、保存及作者操作均限定本人 | 创作域 |
| ScenarioRelease | 作者读取和启动游戏均限定本人 | 创作域定稿服务；世界域正式游戏初始化 |
| WorldSession | 列表、视图、动作、debug、保存逐次检查本人；debug 另检查 preview | 世界域运行服务；创作域草稿试玩创建入口 |
| SaveGame | 列表、详情、恢复逐次检查本人 | 世界域个人存档 |
| ProcessedRequest | 按账号、操作、来源对象和请求 id 隔离；来源授权在去重查询之前 | 创作域事务；世界域运行／存档事务 |

私有读取先认证，再以对象 id + owner 查询；不存在和非本人统一返回 404 object_unavailable。修改请求先执行 Origin／CSRF，再认证与归属检查；合法身份和上下文之外不读取对象内部内容。不能只在列表过滤或界面隐藏按钮。

通过归属后才查询该操作的去重结果，再检查 revision／模式和业务校验。涉及世界载荷还要在查询去重结果前通过当前版本及完整载荷门禁，详见个人存档文档。不能从他人的 request_id、版本错误或 revision 详情获知对象信息。

创作／世界域的修订与业务去重遵循 API 契约；世界载荷门禁遵循个人存档。只有本人对象的修订冲突可返回当前 revision，身份模块不管理其业务写入。

该授权原则参考 [OWASP 授权指南](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)。业务接口必须直接调用验证，不能以界面表现代替服务端授权证据。

## 6. 认证接口与响应

请求正文严格拒绝未知字段。成功包含 data；错误包含 error.code、message、details，公共错误封装见应用契约。

| 方法与路径 | 输入 | 成功结果 |
| --- | --- | --- |
| GET /api/auth/csrf | 无 | csrf_token，绑定当前匿名或登录上下文，不建立用户权限 |
| POST /api/auth/register | username、password | user_id、username，不自动登录 |
| POST /api/auth/login | username、password | 用户概要及新的 csrf_token；Cookie 建立登录，正文不返回认证会话令牌 |
| GET /api/auth/me | 无 | 当前 user_id、username |
| POST /api/auth/logout | 空对象 | 撤销当前 AuthSession、清除认证 Cookie |

私有入口认证失效返回 401 unauthenticated；来源或 CSRF 错误返回 403 csrf_failed；输入错误返回 422 invalid_request；凭据错误统一返回 401 invalid_credentials；注册用户名占用返回 409 username_unavailable；旧登录上下文已被并发消费返回 409 auth_context_changed；限流返回 429 rate_limited。认证错误和他人对象的 details 为空。

认证接口不使用业务 request_id 去重，不缓存或复用认证令牌。创作域与世界域的业务请求去重规则以应用契约为准，认证请求不使用业务账本。

## 7. 身份界面与消费者

身份界面提供注册、登录、退出和当前账号，显示服务端确认身份。编辑器消费身份失效／切换事件，未提交内容的保留和明确跨账号复制由[编辑器交互规范](scenario-editor.md)维护。

刷新及服务重启后，身份由服务端会话重新确认；退出后不再显示登录成功。创作、游戏和存档仍须逐对象检查授权，身份界面的可用性不替代这些业务约束。
