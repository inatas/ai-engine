# 作者侧 AI 生成与候选契约

更新日期：2026-10-13。本文维护作者生成的当前设计契约。

关联：[编辑器交互](scenario-editor.md)、[DSL 与校验](scenario-schema.md)、[HTTP 契约](api-contract.md)、[工程边界](technical-stack.md)。

本文维护作者生成的输入快照、候选数据、变更分组、版本与失败语义。编辑器控件仍以编辑器文档为准；生成不能改变 DSL、引擎规则或已有世界。本契约描述要求，不作为接口可用性或真实生成结果的证明。

## 1. 三种生成操作

| stage | 输入与输出 | 可以改变什么 |
| --- | --- | --- |
| outline | 作者描述、工作副本及可空的已编辑大纲 → 新大纲候选 | 仅替换待采纳大纲，不改变工作副本 |
| detail | 作者确认／微调后的大纲、工作副本及可空的已编辑细则 → 细则候选 | 展示对工作副本的整组变更，等待采纳 |
| revise | 新描述、工作副本及可空的待采纳细则 → 新细则候选 | 有旧候选时继续修改它，没有时针对工作副本形成下一批建议 |

描述允许同时涉及多个角色、事件、字段、行动及引用。模型应集中列出少量决定性问题；普通补足放入 assumptions，不能把创作流程退化为逐字段问卷。questions 不会自动改变已有内容，回答通过下一次描述提交。

首期采用同步 HTTP 请求，不增加队列、后台任务或 SSE 候选流。调用期间不持有数据库事务；所有生成都只计算候选，不自动保存、定稿、创建 preview 或 play。只有明确采纳后的工作副本才进入已有保存流程。

## 2. 源快照与并发

生成前需要一份已建立的本人草稿，但不要求每次先保存全部本地修改。请求提供当前完整工作副本 document 与服务端已确认的 expected_revision；只影响本人草稿的生成上下文，不能指定其他用户对象作为来源。

| 字段 | 规则 |
| --- | --- |
| draft_id | URL 中的本人草稿标识，先按 owner 查询 |
| expected_revision | 当前已确认服务端修订，安全非负整数；请求开始及响应前检查 |
| workspace_id | 打开当前工作副本时产生的非空随机标识；换账号或换草稿重建 |
| content_version | 工作副本每次内容修改递增的安全非负整数；撤销／重做也递增 |
| proposal_version | 大纲、细则及描述每次修改递增的安全非负整数；只切换视图不递增 |
| generation_id | 每次显式发起尝试的随机标识，用于匹配响应和诊断，不是持久化业务 request_id |
| document_digest | 服务端计算的工作副本摘要，响应返回，不以客户端摘要作为授权依据 |

摘要规则与业务请求规范化共用：对象键排序，数组保留顺序，字符串与标量不改写，再对 UTF-8 JSON 计算 SHA-256。摘要不证明身份，也不包含平台 owner。大纲与候选正文另有 proposal_digest，绑定模型实际读取的输入；null 也参与摘要。

浏览器只接收与当前账号、草稿、workspace_id、content_version、proposal_version、generation_id 和输入摘要一致的响应。编辑、撤销后再改回相同文字仍不能接受旧版本响应。保存导致 revision 改变时，旧候选也标记过期；允许保留查看或重新生成，首期不自动重基或合并。

生成结束后服务端重新检查登录有效性、归属和来源 revision。被并发保存推进则返回 revision_conflict，不返回可采纳候选；浏览器保留描述与本地内容。切换账号、关闭工作区或取消生成后迟到响应一律丢弃。

## 3. 请求与响应数据

POST /api/drafts/{draft_id}/generate 的封装字段统一由 contracts 的严格 schema 校验，未知封装键拒绝。HTTP 形状见 API，本节维护嵌套数据。

| 请求字段 | 内容 |
| --- | --- |
| generation_id、expected_revision、workspace_id、content_version、proposal_version | 第 2 节的源绑定字段 |
| stage | outline、detail 或 revise |
| instruction | 非空作者描述，最多 8000 个 Unicode 码点 |
| document | 当前工作副本，必须通过现有草稿顶层与复杂度约束；允许未完成 |
| proposal | null 或完整 OutlineProposal／DetailProposal；detail 要求 OutlineProposal，outline 可传 OutlineProposal，revise 可传 DetailProposal |
| edit_scope | 下表的变更授权范围，不等于平台权限 |

edit_scope 恰含 mode 与 targets。mode=extend 时 targets 必须为空，保留全部既有对象及内容，只允许增加新条目和必要的配套初值／新 NPC 配置。mode=revise 时 targets 为作者明确选中的非空稳定定位列表，允许修改这些对象及展示出来的必要关联变化。首次从空白起稿或补全骨架使用 revise，将 metadata／world 等实际要补的栏目明确列入范围；不能靠 extend 悄悄改动既有背景。

两种模式均可增加新的相关条目；extend 保持所有既有条目的相对顺序及模拟配置，只能附加新 NPC 的必要配置。revise 的关联改动必须能从引用图解释并在差异中列出原因，不能把无关正文或规则当成关联一起重写。范围标签随此次生成按钮一起确认，不要求逐卡确认。

自然语言提到既有对象时，编辑器可建议范围，作者通过可见的范围标签确认后生成。重名或匹配不唯一时要求选择；模型不能替作者授予全局改写范围。范围不是任意 JSON 路径，target 采用第 5 节的有限定位结构。

成功响应由服务端组装，不能信任模型输出的平台字段：

| 响应字段 | 内容 |
| --- | --- |
| source | 上述源绑定字段、draft_id、document_digest、proposal_digest |
| candidate_id | 当前返回候选的随机身份，由服务端生成；没有候选数据库行或额外持久化格式 |
| candidate | OutlineProposal 或 DetailProposal |
| assumptions | 文本数组，明示补足的时代、资源或目标假设 |
| questions | 文本数组，只列需要作者决定的问题 |
| usage | input_tokens、output_tokens，可为 null；仅采用供应方实际报告，不伪造用量／价格 |

OutlineProposal 恰含 kind=outline、premise、player、characters、conflicts、event_directions、gameplay、ending_directions。premise／player 为文本，其余为文本数组；名称相同不自动等同实体。它是临时规划，不包含可运行标记，也不写入 DSL。直接采纳大纲时仍需服务端生成 DetailProposal，将描述和未完成骨架映射到当前 DSL；不把整份大纲复制为另一个权威正文。

DetailProposal 恰含 kind=detail、document、changes、groups、validation。document 是相对当前工作副本的目标草稿快照；changes 和 groups 由服务端比较两份快照、构造引用图后计算，不能直接采用模型声称的差异或 valid。validation 使用引擎的统一完整定义校验返回 valid、issues；大纲阶段不提供假冒的执行校验结果。

再次细化或改写已编辑候选时，传入最新 proposal。候选里的手动修改视为输入，未在 edit_scope 指定的已有部分不得被生成覆盖。source 同时绑定工作副本和 proposal 版本，不能只校验保存修订就忽略本地候选修改。

客户端传入 DetailProposal 的 changes／groups／validation 不是可信结论；服务端以 proposal.document 为候选输入，重新计算其相对 document 的差异和校验。检查本次改写范围时还比较模型输出与最新 proposal，防止丢失待采纳候选中的手动修改；最终返回的采纳差异仍以工作副本 document 为基准。

## 4. 模型输出与校验流水线

1. 认证／CSRF／本人草稿检查；验证修订、请求大小、深度与节点上限，再执行生成频率和并发额度检查。
2. 从该请求的工作副本、大纲／候选、描述和范围构造上下文。系统说明提供当前 DSL 和限制，不读取其他草稿、WorldSession、SaveGame、Cookie 或密钥。
3. 调用唯一配置的作者模型适配器，明确要求结构化输出；结构化输出能力缺失时也必须解析并校验完整 JSON，不能把文本假装成有效定义。
4. 校验模型候选封装与当前草稿结构、允许栏目、标识稳定性和改写范围；拒绝脚本、平台字段、整体覆盖无关对象及不支持的字段。已存在标识不可重命名；新增标识由创作应用生成／确认，引用统一映射后再校验，不用显示名自动改绑。
5. 计算真实差异和关联组，调用 engine 的统一结构／语义校验。返回可编辑候选及真实问题；来源请求允许未完成，所以 valid=false 不是自动模型故障，也不能宣称可试玩。
6. 重新检查身份与来源修订，组装 source 和实际用量；浏览器再检查本地版本，等待作者采纳。

无法解析、未知封装、越权上下文、超复杂度或超改写范围的输出不作为候选返回。合法但缺必需角色、参数或终局的草稿可以返回未完成候选，并定位缺口。模型生成的未知 DSL 子字段不能通过“未完成”借口成为新能力。

导入草稿中已有错误子结构按编辑器修复规则保留：未被本次改动涉及的原值保持并继续报告问题，不因生成而静默清洗；新增／修改区域必须符合当前已知结构或明确缺字段的骨架，不得新增未知字段或错误类型。修改非法基底需要先明确选择对应修复范围，无法建立可靠引用图时阻止部分采纳，保留原内容和可定位问题。

模型输出校验与输入 DSL 校验分开：引擎维护通用定义语义；创作域维护候选封装、改写范围和差异组装，不复制另一套条件或资源解释器。

## 5. 差异、稳定定位与关联组

变更比较使用稳定标识，不能仅按数组下标对比。新增／修改／删除／顺序变化分别显示，已有对象名称改变不产生新身份。

target 恰为 collection 和 key：collection 为 metadata、world、player、narrative、simulation、characters、factions、locations、fields、memories、actions、events、objectives。单例 key 固定为 null；列表对象用 id，fields 用字段 key。对象内部参数和条件仍属于该对象，配套初值归字段组。HTTP 不接受任意路径注入。

edit_scope 中列表集合的 key=null 只授权集合排序，不代表修改所有成员的通配符。完整新世界起稿仍保留编辑器已生成的 metadata.id；新对象使用临时标识到稳定标识的显式映射，新字段初值和所有关联引用一并改写，不能以映射为由改变已有标识。

每条 change 包含 change_id、target、operation（add／update／delete／reorder）、before、after。新增 before=null，删除 after=null。顺序变化定位相应集合且 key=null，before／after 为稳定标识顺序数组。模拟顺序与动作候选仍是 simulation 的实际结构，不能把界面排序当成执行排序。

fields 的 before／after 恰含 declaration 与 initial；initial 恰为 {present:false} 或 {present:true,value:Scalar}，明确区分缺失初值与合法标量，不用 null 冒充缺失。配对只是差异视图，不加入 DSL。其他对象的 before／after 是对应当前结构。同一 target 不返回互相覆盖的多条变更；每条变更恰属于一个组，多个 NPC 共同修改同一 simulation 对象时合并关联组，不能部分采纳时覆盖另一组配置。

每个 group 包含 group_id、label、change_ids、requires。一个新角色及其私有记忆、字段／初值、行动权限、NPC 候选等相关变更可归同组；共享依赖组通过 requires 引用。依赖循环合并为一个原子组，不返回不可选择的循环 requires。

差异与依赖来自既有引用规范，包括实体候选、初值、玩家、权限、受众、关系、条件、效果和 NPC 配置。被修改对象的旧依赖解除也要检查，删除不允许留下此前合法而此次变成悬空的引用。草稿中原有错误不因生成而自动消失，也不被伪造为模型新增错误。

默认整组采纳全部候选。部分采纳先计算 requires 闭包，明示必须同时加入的组；不满足依赖或会产生新悬空引用时阻止采纳。不能按“单张 NPC 卡”只复制实体而丢失关联字段、初值和候选行动。

采纳以当前匹配的源快照为基准，应用完整选中组后重新做结构／语义检查。允许保留仍未完成的草稿，但阻止结构非法、新悬空引用和范围越界；显示其他校验缺口。整次采纳写入一次本地撤销记录，不增加数据库 revision。重复采纳同一 candidate_id 被阻止；重新生成产生新身份。候选手动编辑后重算差异和组，旧分组不能继续套用。

## 6. 取消、重试与成本

取消立即使 generation_id 失效，浏览器 AbortController 中止请求，服务端在可中止阶段转发取消。供应方已收到的请求不保证停止或免计费；取消不采纳，也不保存。离开页面后不增加后台轮询或自动恢复任务。

生成不是数据库写入幂等操作，不写入 ProcessedRequest，也不承诺同 generation_id 能返回原候选或只计费一次。禁止前端网络自动重试、供应方 SDK 隐式重试和自动修复调用；失败由作者显式再生成，使用新的 generation_id，并保留上一输入。与草稿保存沿用同 request_id 重试的语义明确分开。

作者模型配置仅在 server：供应方、固定 HTTPS endpoint、model、API key、超时、输入／输出额度、每账号频率和并发上限。浏览器不能传 endpoint、key、model 或工具配置。无真实配置时返回 generation_unavailable，手动创作仍可用，不返回预置剧情冒充真实生成。

服务端适配使用 OpenAI 兼容 Chat Completions HTTP 协议，由根 .env 的 MODEL_API_URL、MODEL_API_KEY、MODEL_NAME 三项配置。URL 可填写 HTTPS 服务根地址或完整 /chat/completions 接口；先移除路径尾部斜线，仅对未带 /chat/completions 的路径附加该后缀，不重复附加，不探测其他地址。不能填写控制台地址。DeepSeek 的服务根地址与调用路径见[官方接入文档](https://api-docs.deepseek.com/)。请求使用 messages、response_format=json_object 和 max_tokens，要求 finish_reason=stop 后才解析完整候选。适配不引入供应方 SDK；不支持这些参数的服务需要明确调整适配并验证，不能忽略截断或拒绝标记。

可选上限及默认值为 AUTHOR_MODEL_TIMEOUT_MS=60000、AUTHOR_MODEL_CONTEXT_TOKENS=65536、AUTHOR_MODEL_OUTPUT_TOKENS=12000、AUTHOR_MODEL_MAX_RESPONSE_BYTES=1048576、AUTHOR_MODEL_GLOBAL_CONCURRENCY=2、AUTHOR_MODEL_CALLS_PER_MINUTE=2。输入预检暂按 UTF-8 字节数加输出额度及协议余量保守限制，不把中文字符数当 token；部署必须按实际模型上下文及 tokenizer 校准，不能将默认值当成供应方能力保证。响应有独立字节上限，usage 缺失时返回 null，不虚构用量。

并发和频率使用 PostgreSQL 的 AuthorGenerationLease、AuthorGenerationRate 记录，在短事务内以统一额度锁检查并预留。每账号一条在途租约，实例间共享总额度；租约过期清理并在调用结束释放。失败调用也计入已发起尝试，避免失败重试绕过频率；这两表仅存额度元数据，不持久化提示词、正文或候选。

首期每账号最多一条在途调用，应用总并发、每账号频率、单请求 token／响应大小及调用超时均必须有配置上限；限额在供应方适配选定后用实际 tokenizer／请求参数核实并记录，不猜测中文字符等于 token。超预算拒绝或要求缩小范围，不静默截断作者内容。多进程部署不得仅用进程内计数声称全局限额已生效；额度计量由创作应用层负责。

不保存完整提示词／模型原文到诊断日志，不记录密钥、认证令牌或作者秘密正文。可记录 generation_id、耗时、响应状态、模型名称和实际用量。生成内容作为纯文本或领域值展示，不执行 HTML、代码或外部工具。当前候选只在工作区内存，刷新会丢失未采纳候选；界面应提示采纳并保存，不能声称候选已云端保存。

本契约与供应方无关，具体模型及 SDK 由服务端适配选择。接入必须核实结构化输出、取消、额度和用量能力，批准依赖并验证真实生成；不得伪造密钥、价格或调用结果。

## 7. 示例与实施边界

描述“灯塔停电，增加两名互相怀疑的 NPC，第三回合出现求救信号”可形成同批角色、能源字段、恢复供电行动、条件事件和记忆。事件条件引用本批字段／行动时归关联组；没有指定结局时可以先返回未完成候选并指出缺口，不能编造已可通关结论。

作者接着修改 NPC 目标或把求救改为第五回合，再生成时使用最新 proposal；其他手动填写的背景及既有字段保持。生成期间又改了能源初值，则旧响应过期，整组采纳按钮禁用，输入保留。采纳后点撤销会同时撤回该批新增角色、状态初值、规则与 NPC 配置。

本方案不新增 DSL 字段、候选数据库表、后台任务、独立小说章节或运行侧 AI 裁决。接口、控件与模型适配共同遵守本契约，预置交互示例不能代替真实生成行为。
