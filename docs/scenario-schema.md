# 剧本结构与 DSL

更新日期：2026-10-13。本文维护共享 DSL 结构、类型与引擎语义校验规范。
关联文档：[全局架构](architecture.md)、[基于编辑器的具体示例](custom-scenarios.md)、[专业编辑器](scenario-editor.md)、[运行机制](runtime.md)、[应用接口契约](api-contract.md)。
DSL 是引擎输入契约；编辑器与作者生成消费同一校验能力，具体示例只提供题材内容，不拥有另一套定义语义。

场景与分支目标设计见[回合、场景与分支流转](turn-flow.md)。当前以下字段表为已实现 DSL 基线；新增场景／剧情节点、推进模式、节点开篇、进入／结束条件、互动引用、调度时机及后继边须在正式实施前落实为严格共享契约。届时破坏性更新全部内容与校验，不做两套格式兼容；action 与 scene 是同一新格式中的两种合法玩法，不是旧版兼容分支。

## 1. 剧本的含义

Scenario 是完整世界定义包。世界背景、NPC、规则、记忆种子、初始状态与事件都在其中；“剧情”只是其中一部分。

DSL 是作者表达这个定义包的结构化约定，不等同于文件扩展名。JSON 承载结构；引擎定义字段、引用、条件与效果的语义。首期采用受限的声明式规则，不执行作者提供的任意代码。

作者通过专业编辑器创建完整定义，JSON 导入导出用于交换。编辑草稿可以不完整，但试玩、定稿和正式世界初始化均必须通过同一服务端规范校验。账号身份、所有权、草稿修订和个人存档不属于 DSL。

结构契约采用共享 Zod schema 与推导的 TypeScript 类型；服务端仍执行完整结构与语义校验，详见[技术选型](technical-stack.md)。存档 schemaVersion 属于持久化检查点，不加入作者 DSL。

将内容分为三层：

| 层次 | 示例 | 引擎处理 |
| --- | --- | --- |
| 自由描述 | 世界背景、角色性格、叙述风格 | 保存并提供给角色或叙述上下文 |
| 结构化事实 | 实体标识、玩家角色、财政余额、已知信息 | 校验并建立状态或可知上下文 |
| 可执行定义 | 动作条件、资源转移、事件与结束条件 | 按固定语义求值和结算 |

自由文本中的数字或剧情描述不会隐式变成可执行规则。

## 2. 顶层结构

首期定义以下顶层部分。除注明可空者外均必填；可空部分也保留空集合，避免多套表示。未知字段报错，格式调整直接破坏性更新。

| 字段 | 类型 | 内容 |
| --- | --- | --- |
| metadata | 对象 | id、name、description；描述剧本身份，不用于兼容路由 |
| world | 对象 | background、start_time、turn_unit、constraints；时间展示与世界边界 |
| entities | 对象 | characters、factions、locations 三个列表；后两者可空 |
| player | 对象 | character_id，指向一名已定义角色 |
| state_schema | 列表 | 可变化字段的声明；可空 |
| initial_state | 对象 | values、memories；初始化字段值与角色知识 |
| actions | 列表 | 玩家与 NPC 可发起的动作；至少包含一个可结算动作 |
| simulation | 对象 | 固定 NPC 顺序、候选动作顺序、记忆上下文上限 |
| events | 列表 | 条件事件；可空 |
| objectives | 列表 | 终局条件；至少一项 |
| narrative | 对象 | opening、style、perspective；开场、风格与玩家视角 |

world.constraints 为描述性约束文本列表；需要强制执行的限制应写入字段范围、权限或条件。start_time 为展示字符串；实际时间计算以整数回合为准，首期不做历史日历运算。

## 3. 实体、角色与关系

所有实体使用全剧本唯一且非空的 id，显示名不承担引用职责。

实施约束：所有引用标识（实体／规则 id、字段 key、参数名）使用 1–120 个 ASCII 字母、数字、下划线或连字符，禁止保留名 `__proto__`、`constructor`、`prototype`。定义最多 20000 个节点、嵌套深度最多 48；在递归结构校验前检查，超限返回可定位问题。结构错误位置采用 JSON Pointer 的 ~0／~1 转义。

| 实体 | 内容 |
| --- | --- |
| Character | id、name、description、faction_id（可为空）、personality、goals、relationships |
| Faction | id、name、description、goals |
| Location | id、name、description |

personality 与 goals 为文本列表。relationships 为指向其他实体的 target_id 与 description 列表，表达初始关系。若信任、归属或控制权需要动态结算，另声明状态字段；初始关系描述只作为背景，不作为当前关系账本。

simulation.npc_order 为有序角色 id 列表，不含玩家且不重复；允许只激活关键角色。npc_actions 为角色到有序候选动作的映射，每项含 action_id 和具体参数。首期按顺序选择第一个合法候选，每名角色每回合最多执行一个；没有合法候选时无动作。这里是固定行为配置，后续模型可替换提议来源。

## 4. 状态声明与初始值

首期采用平面字段表，字段 key 在剧本内唯一。引擎只解释字段类型和操作，不根据财政、忠诚等名称分支。

| 声明属性 | 约定 |
| --- | --- |
| key / label | 稳定字段标识与展示名称 |
| type | integer、boolean、string、entity_ref 四选一 |
| owner_id | 所属实体，可为空，表示世界级字段 |
| min / max | integer 必填边界；其他类型不接受 |
| unit | integer 的展示单位，可为空 |
| allowed_entity_ids | entity_ref 必填非空候选集合；其他类型不接受 |
| visibility | public 或非空角色 id 列表 |

initial_state.values 必须覆盖所有声明字段，且不能包含未声明字段。类型严格匹配；integer 不接受布尔值或小数。整数值、min／max、参数与运算结果均须为 JavaScript 安全整数，禁止超范围、NaN 和 Infinity，不自动舍入。初始值、结算值和恢复值均检查范围及引用。

资源用 integer 字段表达；资源转移必须在同单位字段间执行。地点控制可使用 entity_ref 字段。状态不存在另一份隐含资源副本。

initial_state.memories 每项包含 id、text、audience；audience 为 public 或非空角色 id 列表。记忆文本可以表达某角色的误解，但不改变 values 中的客观事实。

## 5. 动作结构

| 字段 | 约定 |
| --- | --- |
| id / name / description | 动作身份、显示名与玩法说明 |
| allowed_actor_ids | 可发起动作的角色 id 列表，不能为空 |
| parameters | 参数声明，可空；首期支持 integer、boolean、string、entity_ref，类型约束与状态字段一致 |
| conditions | 必填条件树；无前置条件时使用空 all |
| effects | 有序效果列表，可空，例如等待动作 |
| visibility | public 或非空角色 id 列表；限定该动作结果的受众 |

动作提议含 actor_id、action_id、parameters。参数名与声明严格一致；不接受额外参数。所有角色均使用同一动作权限与结算路径。

参数没有隐式默认值。动作拒绝必须返回动作标识、具体参数或字段及原因；不得部分扣费。等待是一个无效果但合法的剧本动作，会推进时间。

## 6. 条件表达式

条件使用树结构，节点只能为 all、any、not 或比较节点。all 表示全部成立，空 all 为真；any 表示任一成立，空 any 为假；not 恰含一个子条件。

序列化节点为 JSON 对象：组合节点恰含 all、any 或 not 中的一个键；all 与 any 的值是条件节点数组，not 的值是一个条件节点对象。比较节点恰含 operator、left、right，不可混入组合键。

比较节点包含 operator、left、right。operator 为 eq、ne、gt、gte、lt、lte；大小比较仅支持 integer，同类值才能比较，entity_ref 可与合法实体 id 字面量做等值比较。

每个操作数恰好选择一种来源：

| 来源 | 内容 |
| --- | --- |
| literal | 整数、布尔值或字符串常量 |
| field | 已声明的状态字段 key |
| parameter | 当前动作声明中的参数名；仅动作条件及效果可用 |
| turn | 当前候选回合号；只有条件可用 |

操作数为恰含一个来源键的对象；literal 的值是常量，field 和 parameter 的值是名称字符串，turn 的值固定为 true。turn 的 false／null、额外来源键或空对象都非法；literal 的 false 则是合法布尔常量。

字段、参数和实体引用在加载时检查。事件与目标没有动作参数，不得引用 parameter。首期不支持任意表达式、循环、脚本执行或字符串模板求值。

## 7. 效果表达式

效果按声明顺序应用到动作的临时状态；任一效果失败，整个动作不生效。

| 效果 | 参数 | 执行语义 |
| --- | --- | --- |
| add | field、value 操作数 | integer 字段增加指定整数，允许负增量；结果必须在范围内 |
| set | field、value 操作数 | 替换字段值；类型、范围或实体候选须合法 |
| transfer | from_field、to_field、amount 操作数 | 在同单位 integer 字段间转移非负整数；来源与目标须不同，两端范围均合法 |

效果对象用 type 指定上述效果之一：add、set 恰含 type、field、value；transfer 恰含 type、from_field、to_field、amount。field／from_field／to_field 为字段 key 字符串；value 与 amount 是操作数对象。

效果值仅可使用 literal、field、parameter。每一步读取当前临时状态，后续效果看到前序效果的结果。事件效果不允许 parameter。影响同一字段的多个效果也必须逐步满足范围，不通过自动截断隐藏错误。

字段 key 在效果定义中必须静态声明。首期不允许玩家用任意字段路径作为参数，从而越过作者给定的玩法边界。

## 8. 事件、目标与信息范围

事件包含 id、name、conditions、effects、repeatable、visibility。events 列表顺序就是处理顺序，每回合在全部行动后执行一次扫描；每个事件每回合最多执行一次，不重新扫描前面的事件。后面的事件可看到前面已生效的变化。

repeatable 为 false 的事件成功执行后记录为已触发，后续跳过；条件成立但效果失败时记录错误，不标记已触发。开局事项可放入初始知识与 opening，首期不另行执行隐藏开局效果。

目标包含 id、name、outcome（success 或 failure）、priority（整数）、conditions、visibility。完成事件扫描后评估目标，成立者按 priority 从小到大选取，相同值按声明顺序决定终局；作者可以令失败优先。首期 objectives 都是终局条件，非终局目标可先作为角色描述。

visibility 限制动作、事件、目标结果的受众。默认不推导“关系亲近所以知晓”。一条变化只有同时满足结果受众与对应字段 visibility 时，才能进入该角色的反馈与记忆上下文；被过滤的条件、参数和字段变化不通过错误详情泄露给玩家。

完整回合记录属于内部调试数据，玩家界面不能直接显示整个记录。首期不实现复杂的传闻传播系统。

## 9. 作者交付与编辑入口

作者交付当前格式的完整世界定义，具体题材、模板和说明见 [基于编辑器的具体示例](custom-scenarios.md)。从空白／模板／导入建立草稿、领域编辑、保存、校验、试玩和定稿的操作流程由 [专业剧本编辑器](scenario-editor.md)维护；本规范只维护可表达的数据和语义。

DSL 不足以表达新玩法时，先设计当前契约及引擎通用执行扩展，编辑器同步领域控件，具体示例在已有能力上更新内容。禁止嵌入题材专用代码、任意脚本或另外维护一套执行解释器。

## 10. 校验要求

加载检查结构、类型、未知字段、重复 id、实体引用、字段范围、参数引用、操作符类型和候选动作参数。每条错误应带文件、定义位置与原因，例如某动作效果引用了不存在的字段。

首期不承诺静态证明目标一定可达、故事完全一致或自然语言没有泄密；这些通过规则验证与试玩补足。

修改 DSL、字段或效果语义时同步修改所有示例和校验项，不维护旧格式兼容。

## 11. 集合与定位约定

state_schema 为字段声明对象数组；actions.parameters 为参数名到声明的对象映射，空参数写空对象。integer 参数声明含 type、min、max；entity_ref 参数含 type、allowed_entity_ids；boolean 与 string 参数仅含 type。参数不含字段专用的 owner_id、visibility 或 unit，避免混淆平台归属与动作输入。

initial_state.values 为字段 key 到初始标量值的对象。simulation 恰含 npc_order、npc_actions、memory_recent_turns；npc_actions 的键集合与 npc_order 一致，每个值为候选数组，空数组表示无固定候选。候选恰含 action_id、parameters，parameters 是具体值映射，与参数声明区分。

定义位置使用从根开始的 JSON Pointer 语义：字段定位到具体对象属性，数组按当前下标定位。服务端返回 definition_path 与稳定实体／规则 id；编辑器收到结果后若本地文档已发生变化，应标记结果过期并重新校验，避免把旧下标错误贴到新条目。
