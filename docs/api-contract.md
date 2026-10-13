# 首期应用接口契约

更新日期：2026-10-13。本文维护通用 HTTP 封装与创作、作者生成、世界和存档接口契约。
关联文档：[编辑器](scenario-editor.md)、[账号鉴权与数据归属](auth-and-ownership.md)、[个人存档](personal-saves.md)、[运行机制](runtime.md)、[剧本结构](scenario-schema.md)。

## 1. 通用约定

网页与 API 同源，路径以 `/api` 开始。请求和响应使用 JSON；请求封装中的未知字段明确拒绝；草稿 document 内部的未完成结构按第 3 节处理。密码、Cookie 与 CSRF 令牌不进入 URL、普通诊断日志或对象定义。

除注册、登录及 CSRF 初始化外，以下接口都要求有效登录。每次操作再检查对象是否归当前用户所有；非本人对象与不存在对象都返回相同的 404，不泄露名称、数量或状态。

请求保护遵循 [身份文档](auth-and-ownership.md)，本文件不重复 Cookie、CSRF 和限流参数。

对象 id 是服务端生成的不透明标识。`owner_user_id` 不出现在可写请求里；动作请求不接受 `actor_id`，服务端按本局 player 选择角色。

revision 与 expected_revision 都是非负整数。创建草稿及世界会话从 0 开始；成功草稿修改或世界回合增加 1。定稿与检查点不可修改，不增加来源对象 revision。

整数输入、revision 与回合数均要求 JavaScript 安全整数。持久化检查点的 schemaVersion 初始为 1，由服务端生成，不是请求输入，不与 revision 混用。依赖世界载荷的入口先验证归属，再通过当前版本与完整结构门禁，包括请求去重返回路径。

成功响应包含 data；错误响应包含 error，其字段为 code、message、details。认证失败与非本人对象的 details 为空；校验问题可包含 definition_path。HTTP 状态与业务错误语义见第 6 节。

## 2. 认证接口（独立维护）

账号注册、登录、退出、当前身份与 CSRF 初始化的具体路径、参数、响应、Cookie、Origin／CSRF 和限流策略统一维护在 [账号鉴权与数据归属](auth-and-ownership.md)第 2–6 节。本接口文档不重复维护另一份登录契约。

所有下述私有业务入口依赖该认证与逐对象授权基础；每个入口仍须验证自己的对象归属与角色／模式权限。

## 3. 创作域接口

本节所有 templates／drafts／releases 接口由创作域维护，身份域只提供认证与访问约定，引擎提供定义校验，世界域提供运行服务。具体示例使用这些标准入口，不新增 API。

自然语言批量生成属于创作域必需能力；候选数据、上下文授权、版本绑定、采纳与失败规则见[作者生成契约](scenario-generation.md)，HTTP 入口见第 3.1 节。生成只返回候选，不隐式保存、定稿或创建世界；采纳后的定义仍通过保存／校验流程，预置演示不能替代真实模型输出。

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

导入必须首先是可解析 JSON 对象，顶层只接受当前 DSL 栏目；未知顶层键及平台身份／世界载荷根字段拒绝。已知栏目内部的不完整或错误形状可成为待修正草稿，必须重新通过完整校验才可试玩／定稿。导出 API 返回 {document, valid, issues}，不返回数据库行。编辑器“导出剧本”仅在 valid 时下载 document；“导出草稿”下载该当前交换封装。导入 API 只接收 document，网页导入封装时先提取 document；不得信任随文件携带的 valid／issues。JSON 请求和导入文件上限为 2 MiB，过大返回 413 payload_too_large。

校验、试玩、定稿、导出基于服务端已保存的 expected_revision。浏览器存在未保存修改时，应先保存，再执行操作；不同时校验浏览器内容却定稿另一份数据库内容。

草稿接口可返回完整定义，因为调用者是内容所有者；这不允许游戏接口直接返回完整剧本。preview 会话的内部轨迹通过下节独立调试入口取得。

### 3.1 作者生成接口

| 方法与路径 | 输入 | 成功结果 |
| --- | --- | --- |
| POST /api/drafts/{draft_id}/generate | generation_id、expected_revision、workspace_id、content_version、proposal_version、stage、instruction、document、proposal、edit_scope | source、candidate_id、candidate、assumptions、questions、usage |

stage 为 outline／detail／revise；proposal 为 null 或与 stage 匹配的最新大纲／细则。嵌套字段与范围定位结构只在作者生成契约维护。整数版本为安全非负整数，标识必须非空，instruction 最多 8000 个 Unicode 码点；整个 JSON 仍受 2 MiB 和定义复杂度上限保护。客户端不传供应方配置、账号身份或数据库权威字段。

该入口要求有效登录、Origin／CSRF 和本人草稿；查询与返回前检查 expected_revision。document 是本人工作区的生成输入，不能授权修改已保存草稿；生成不写 ScenarioDraft／ScenarioRelease／WorldSession 或 ProcessedRequest。response.source 返回服务端计算的输入摘要，前端必须同时校验账号、工作区、内容与候选版本，不能只匹配 generation_id。

服务器完整检查模型输出，并自行计算差异、依赖组与统一定义校验结果。合法但未完成的细则返回 200 且 validation.valid=false；无法解析、非法输出或改写范围越界返回 502 invalid_model_output，不把裸模型文本当作候选。大纲不返回可执行 valid 标记。

取消通过断开当前请求并立即失效本地 generation_id 实现，无持久化任务或取消 API；供应方调用不保证免计费。generation_id 只关联尝试，不提供持久化幂等保证；网络、模型和修复调用均不自动重试。用户重新生成使用新 generation_id，保留原输入。草稿保存仍按第 5 节幂等规则处理。

## 4. 世界与个人存档接口

本节表格是已实现动作式回合接口。[回合、场景与分支](turn-flow.md)要求后续区分场景内互动与结束回合，并让 PlayerView 提供当前剧情节点／实例、推进模式、每回合开篇、已完成交流、可用互动与结束按钮状态。过渡节点只返回结束操作，私有记忆和内部事实不进入玩家响应。

新写请求必须绑定 session_id、当前节点实例、expected_revision 和 request_id，互动提交与结束提交使用不同操作类型；重复请求不得再次生成已完成交流、执行效果或推进。场景内互动增加 revision 而不增加 turn，action 模式仍自动结束。新增路径、模型请求生命周期与精确 DTO 在实施前固定，本表的 /turns 不应被当作所有新操作已可用的入口。

| 方法与路径 | 输入 | 成功结果 |
| --- | --- | --- |
| GET /api/world-sessions | 分页参数；mode 默认 play | 本人当前游戏概要、schemaVersion、loadable；显式 mode=preview 可查看本人试玩 |
| POST /api/world-sessions | request_id，及 template_id / release_id 二选一 | 内置剧本或本人定稿初始化的 play 会话与 PlayerView；内置剧本不创建草稿／定稿，未知模板及他人定稿返回统一 404 |
| GET /api/world-sessions/{session_id} | 无 | 本人会话的 PlayerView |
| POST /api/world-sessions/{session_id}/turns | action_id、parameters、expected_revision、request_id | 本回合可见结果、PlayerView 与新 revision |
| GET /api/world-sessions/{session_id}/debug | 无 | 仅本人 preview 会话的完整内部轨迹；play 拒绝 |
| POST /api/world-sessions/{session_id}/saves | name、expected_revision、request_id | 本人 play 会话当前检查点的 save_id 与概要 |
| GET /api/saves | 分页参数 | 本人检查点概要列表、schemaVersion、loadable |
| GET /api/saves/{save_id} | 无 | 本人检查点的 SaveView |
| POST /api/saves/{save_id}/restore | request_id | 从该检查点新建的 play 会话与 PlayerView |

PlayerView 包含 session_id、scenario_id、剧本显示名、mode、turn、revision、status、玩家可见字段与记录，以及该角色可用动作的输入描述。动作描述不含完整条件树、隐藏效果或其他角色私有知识。

纯计算 PlayerView 的共享类型位于 contracts，应用世界视图另附加会话元数据。fields 包含声明 type；entities 仅含必要引用的 id／name；ending 为玩家可见的终局 id／name／outcome 或 null。records 是受记忆窗口约束的近期上下文，history 是独立的完整可见游戏记录，两者每回合包含 turn 与 decisions；每项 decision 含 kind、id、name、actor_id、actor_name 及已过滤的字段 changes。两份记录的受众过滤相同，不返回内部失败原因；完整历史不会通过近期上下文限制截断。

SaveView 包含 save_id、名称、schemaVersion、剧本显示名、保存回合、创建时间、终局状态及保存时的玩家可见内容；不暴露内部 scenario_snapshot、known_records 或未过滤的 TurnRecord。

世界及存档概要列、loadable、详情完整性与格式版本的检查规则以 [个人存档](personal-saves.md)为唯一规范；本节只维护响应形状。

恢复响应返回新 session_id 与 revision=0 的 PlayerView，状态来自原检查点；恢复事务与原对象保护见个人存档。

## 5. 去重与事务边界

所有创建对象与修改对象的业务请求都使用非空 request_id。查询、只读校验、认证操作不通过业务去重账本复用登录令牌。

作者生成只计算临时候选，不属于上述对象创建／修改；使用 generation_id，不进入 ProcessedRequest。它的重试与费用规则以第 3.1 节及作者生成契约为准，不能套用保存请求的原结果复用承诺。

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
| 409 | generation_busy | 本账号已有在途生成；不开始第二次模型调用 |
| 422 | invalid_request / invalid_definition / action_rejected | 字段、定义或动作校验失败；返回经过权限过滤的可定位问题 |
| 422 | checkpoint_version_unsupported | 本人自动会话或手动检查点版本缺失、非法或不等于当前版本；不写入或恢复，无迁移入口 |
| 429 | rate_limited | 认证频率和 Retry-After 规则见独立账号鉴权文档 |
| 429 | generation_limited | 作者生成频率或应用并发额度耗尽；不调用模型，按额度配置提供 Retry-After |
| 422 | generation_input_too_large | 生成输入超出所配置模型上下文／token 额度；不静默截断，提示缩小范围 |
| 502 | invalid_model_output / generation_failed | 模型输出不能解析、越界，或上游调用失败；过滤供应方原文与秘密，不保存或采纳 |
| 503 | generation_unavailable | 作者模型未配置或暂不可用；手动编辑和保存继续可用，不返回预置生成 |
| 504 | generation_timeout | 达到作者生成超时；不产生候选采纳或业务写入，不自动重试 |
| 499 | generation_cancelled | 客户端断开或取消生成；丢弃候选并释放租约，不保证供应方停止计费；已断开的浏览器通常无法收到该响应 |
| 500 | persistence_failed / internal_error | 本次未提交；不向浏览器暴露内部堆栈、凭据或 SQL |
| 500 | checkpoint_invalid | 本人当前版本载荷损坏或元数据与载荷版本不一致；不推进或部分恢复，不暴露内部私有字段 |

调用者属于本人但仍不能获知的游戏条件，错误提示只说明动作无法执行，不返回私有字段的真实值。程序内部保留裁决原因供 preview 调试与诊断。

## 7. 编辑器与界面反馈

读取成功才替换浏览器中的当前文档或游戏视图。409 保留作者未提交修改，不自动覆盖；422 将 definition_path 映射到栏目、实体与节点；保存未确认前不得显示“已保存”。

网络中断后重试写请求沿用原 request_id 与原正文，不能自动生成新请求。用户主动修改输入后使用新 request_id。已经提交但丢失响应的动作、保存和恢复，应通过去重返回原结果。

存档版本不支持时显示“此存档已无法使用，请开始新游戏”，不提供转换按钮；程序错误导致的载荷损坏显示读取失败。上述错误均不自动新建会话、改写旧版本或隐藏失败。

离线浏览器缓存不算服务端保存。发生身份过期时保留本地未提交编辑内容，提示重新登录；只有原账号身份恢复后才能重试，切换账号不能把旧页面的私人对象直接写给新账号。
