# 首期应用接口契约

更新日期：2026-10-12。状态：健康与认证入口已实现并通过身份验收；创作、世界和存档契约待实现。
关联文档：[编辑器](scenario-editor.md)、[账号鉴权与数据归属](auth-and-ownership.md)、[个人存档](personal-saves.md)、[运行机制](runtime.md)、[剧本结构](scenario-schema.md)。
关联开发项：[001 世界引擎与个人存档](../note/001-world-engine-foundation.md)、[002 账号与归属](../note/002-auth-and-ownership.md)、[003 专业编辑器](../note/003-scenario-editor.md)、[004 编辑器示例](../note/004-custom-scenarios.md)。

## 1. 通用约定

网页与 API 同源，路径以 `/api` 开始。请求和响应使用 JSON；请求封装中的未知字段明确拒绝；草稿 document 内部的未完成结构按第 3 节处理。密码、Cookie 与 CSRF 令牌不进入 URL、普通诊断日志或对象定义。

除注册、登录及 CSRF 初始化外，以下接口都要求有效登录。每次操作再检查对象是否归当前用户所有；非本人对象与不存在对象都返回相同的 404，不泄露名称、数量或状态。

请求保护遵循 [身份文档](auth-and-ownership.md)，本文件不重复 Cookie、CSRF 和限流参数。

对象 id 是服务端生成的不透明标识。`owner_user_id` 不出现在可写请求里；动作请求不接受 `actor_id`，服务端按本局 player 选择角色。

revision 与 expected_revision 都是非负整数。创建草稿及世界会话从 0 开始；成功草稿修改或世界回合增加 1。定稿与检查点不可修改，不增加来源对象 revision。

整数输入、revision 与回合数均要求 JavaScript 安全整数。持久化检查点的 schemaVersion 初始为 1，由服务端生成，不是请求输入，不与 revision 混用。依赖世界载荷的入口先验证归属，再通过当前版本与完整结构门禁，包括请求去重返回路径。

成功响应包含 data；错误响应包含 error，其字段为 code、message、details。认证失败与非本人对象的 details 为空；校验问题可包含 definition_path。HTTP 状态与业务错误语义见第 6 节。

## 2. 认证接口（独立维护）

账号注册、登录、退出、当前身份与 CSRF 初始化的具体路径、参数、响应、Cookie、Origin／CSRF 和限流策略统一维护在 [账号鉴权与数据归属](auth-and-ownership.md)第 2–6 节，实施清单与基础验收由 [002](../note/002-auth-and-ownership.md)承接。本接口文档不重复维护另一份登录契约。

所有下述私有业务入口依赖该认证与逐对象授权基础；后续世界和存档入口仍须在自身开发项中验证授权接入。

## 3. 创作域接口

本节所有 templates／drafts／releases 接口由 003 创作域维护，002 只提供认证与访问约定，001 提供定义校验及世界服务。004 使用这些标准入口制作示例，不新增 API。

| 方法与路径 | 输入 | 成功结果 |
| --- | --- | --- |
| GET /api/templates | 分页参数 | 可复制示例列表，不含私人内容 |
| GET /api/drafts | 分页参数 | 本人草稿概要 |
| POST /api/drafts | name、source、request_id | 新草稿；source 为 blank、template 或本人 release 的明确来源 |
| POST /api/drafts/import | document、request_id | 导入后个人草稿及完整定义的校验结果 |
| GET /api/drafts/{draft_id} | 无 | 本人 draft_id、revision、document、更新时间 |
| PUT /api/drafts/{draft_id} | document、expected_revision、request_id | 已保存的本人草稿及新 revision；允许保存未完成定义 |
| POST /api/drafts/{draft_id}/validate | expected_revision | 对已保存修订的 valid 与 issues，不建立定稿 |
| POST /api/drafts/{draft_id}/preview | expected_revision、request_id | 有效定义的 preview 会话与玩家视图 |
| POST /api/drafts/{draft_id}/releases | expected_revision、request_id | 重新验证后创建的 release_id、source_revision 与概要 |
| GET /api/drafts/{draft_id}/export | expected_revision | 当前 document 与 valid／issues；有效定义可作为完整 DSL 导入 |
| GET /api/releases | 分页参数 | 本人定稿概要 |
| GET /api/releases/{release_id} | 无 | 本人定稿及完整 definition，仅用于作者内容入口 |

创建 source 恰为 `{"type":"blank"}`、`{"type":"template","template_id":"…"}` 或 `{"type":"release","release_id":"…"}`；未知键拒绝。后两者通过来源授权再复制，草稿创建从 revision=0 开始。

导入必须首先是可解析 JSON 对象，顶层只接受当前 DSL 栏目；未知顶层键及平台身份／世界载荷根字段拒绝。已知栏目内部的不完整或错误形状可成为待修正草稿，必须重新通过完整校验才可试玩／定稿。导出 API 返回 {document, valid, issues}，不返回数据库行。003 的“导出剧本”仅在 valid 时下载 document；“导出草稿”下载该当前交换封装。导入 API 只接收 document，网页导入封装时先提取 document；不得信任随文件携带的 valid／issues。JSON 请求和导入文件上限拟定 2 MiB，过大返回 413 payload_too_large。

校验、试玩、定稿、导出基于服务端已保存的 expected_revision。浏览器存在未保存修改时，应先保存，再执行操作；不同时校验浏览器内容却定稿另一份数据库内容。

草稿接口可返回完整定义，因为调用者是内容所有者；这不允许游戏接口直接返回完整剧本。preview 会话的内部轨迹通过下节独立调试入口取得。

## 4. 世界与个人存档接口

| 方法与路径 | 输入 | 成功结果 |
| --- | --- | --- |
| GET /api/world-sessions | 分页参数；mode 默认 play | 本人当前游戏概要、schemaVersion、loadable；显式 mode=preview 可查看本人试玩 |
| POST /api/world-sessions | release_id、request_id | 本人定稿初始化的 play 会话与 PlayerView |
| GET /api/world-sessions/{session_id} | 无 | 本人会话的 PlayerView |
| POST /api/world-sessions/{session_id}/turns | action_id、parameters、expected_revision、request_id | 本回合可见结果、PlayerView 与新 revision |
| GET /api/world-sessions/{session_id}/debug | 无 | 仅本人 preview 会话的完整内部轨迹；play 拒绝 |
| POST /api/world-sessions/{session_id}/saves | name、expected_revision、request_id | 本人 play 会话当前检查点的 save_id 与概要 |
| GET /api/saves | 分页参数 | 本人检查点概要列表、schemaVersion、loadable |
| GET /api/saves/{save_id} | 无 | 本人检查点的 SaveView |
| POST /api/saves/{save_id}/restore | request_id | 从该检查点新建的 play 会话与 PlayerView |

PlayerView 包含 session_id、scenario_id、剧本显示名、mode、turn、revision、status、玩家可见字段与记录，以及该角色可用动作的输入描述。动作描述不含完整条件树、隐藏效果或其他角色私有知识。

SaveView 包含 save_id、名称、schemaVersion、剧本显示名、保存回合、创建时间、终局状态及保存时的玩家可见内容；不暴露内部 scenario_snapshot、known_records 或未过滤的 TurnRecord。

世界及存档概要列、loadable、详情完整性与格式版本的检查规则以 [个人存档](personal-saves.md)为唯一规范；本节只维护响应形状。

恢复响应返回新 session_id 与 revision=0 的 PlayerView，状态来自原检查点；恢复事务与原对象保护见个人存档。

## 5. 去重与事务边界

所有创建对象与修改对象的业务请求都使用非空 request_id。查询、只读校验、认证操作不通过业务去重账本复用登录令牌。

去重键由当前 user_id、操作类型、来源对象 id（没有来源时为空）与 request_id 组成。来源对象分别为：草稿保存／试玩／定稿的 draft_id，新游戏的 release_id，回合／保存检查点的 session_id，恢复的 save_id。草稿创建的三种 source 共用 draft-create 操作及空来源 id，source 全部内容参与正文摘要；导入使用独立 draft-import 操作及空来源 id，不能借改变 source 逃过同请求不同正文冲突。

同键且相同规范化请求正文返回已提交结果；同键不同正文返回 request_conflict。JSON 对象键顺序不影响规范化摘要；expected_revision、名称、参数等实际输入都参与摘要。

先验证身份与归属，再查询已提交请求；命中相同输入后不再次检查已经过期的 expected_revision，也不重复运行。未命中时才检查 revision、当前模式、合法性与效果。

涉及持久化世界内容的请求在读取去重结果前通过当前 schemaVersion 与完整载荷门禁；schemaVersion 变化后不复用旧账本的世界响应。当前格式内的正常重试仍遵守上述原结果返回语义。

新状态／对象与去重结果在同一事务提交。并发相同请求只能产生一条成功结果；先事务失败的请求不占用“已成功”标记，允许原输入重试。保存的去重结果只包含该入口可合法返回的视图，不把完整内部状态作为通用响应缓存。

回合与草稿修改通过 revision 条件更新。检查点保存只是复制当前已提交世界，不增加 session revision。两次不同 request_id 的合法保存可以产生两个检查点；重复同请求只产生一个。

保存与回合竞争时，事务内重新检查来源 revision：若先保存旧回合、再推进世界，两者可以成功；若世界已推进，旧 revision 的保存拒绝。不能承诺任何并发保存都只有一个成功。

## 6. 错误响应

| HTTP 状态 | code | 约定 |
| --- | --- | --- |
| 413 | payload_too_large | 请求或导入超过允许大小，不产生业务对象 |
| 400 | invalid_json | 正文不是可解析 JSON，不产生业务对象 |
| 401 | unauthenticated | 未登录、退出或过期，不返回私人数据 |
| 403 | csrf_failed / operation_forbidden | CSRF 失败，或本人对象的模式不允许该操作，如 preview 保存正式存档 |
| 404 | object_unavailable | 对象不存在或非本人，响应相同 |
| 409 | revision_conflict | 旧页面不得覆盖新内容，返回本人对象的当前 revision，不返回隐藏状态 |
| 409 | request_conflict / session_finished | 相同请求 id 对应不同输入；或终局拒绝新动作 |
| 422 | invalid_request / invalid_definition / action_rejected | 字段、定义或动作校验失败；返回经过权限过滤的可定位问题 |
| 422 | checkpoint_version_unsupported | 本人自动会话或手动检查点版本缺失、非法或不等于当前版本；不写入或恢复，无迁移入口 |
| 429 | rate_limited | 认证频率和 Retry-After 规则见独立账号鉴权文档 |
| 500 | persistence_failed / internal_error | 本次未提交；不向浏览器暴露内部堆栈、凭据或 SQL |
| 500 | checkpoint_invalid | 本人当前版本载荷损坏或元数据与载荷版本不一致；不推进或部分恢复，不暴露内部私有字段 |

调用者属于本人但仍不能获知的游戏条件，错误提示只说明动作无法执行，不返回私有字段的真实值。程序内部保留裁决原因供 preview 调试与诊断。

## 7. 编辑器与界面反馈

读取成功才替换浏览器中的当前文档或游戏视图。409 保留作者未提交修改，不自动覆盖；422 将 definition_path 映射到栏目、实体与节点；保存未确认前不得显示“已保存”。

网络中断后重试写请求沿用原 request_id 与原正文，不能自动生成新请求。用户主动修改输入后使用新 request_id。已经提交但丢失响应的动作、保存和恢复，应通过去重返回原结果。

存档版本不支持时显示“此存档已无法使用，请开始新游戏”，不提供转换按钮；程序错误导致的载荷损坏显示读取失败。上述错误均不自动新建会话、改写旧版本或隐藏失败。

离线浏览器缓存不算服务端保存。发生身份过期时保留本地未提交编辑内容，提示重新登录；只有原账号身份恢复后才能重试，切换账号不能把旧页面的私人对象直接写给新账号。
