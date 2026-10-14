# 规则夹具与后续编辑器示例

另有 [cyberpunk 2077 场景故事稿](../docs/scenarios/cyberpunk-2077-scene-story.md)：同一场景容纳多轮对话、调查与 action，结束阶段后形成一个 turn；[故事概览](../docs/scenarios/cyberpunk-2077-story.md)提供背景、原作资料与结局方向。当前尚未生成最终模板或可运行定义。通用回合设计依据见 [回合、场景与分支流转](../docs/turn-flow.md)。

现有 ming-crisis.json、station-repair.json 是当前 DSL 的规则夹具，机制数值和路径说明见 [具体示例设计](../docs/custom-scenarios.md)。它们已有核心规则测试证据，但尚未经过专业编辑器制作。

[001](../note/001-world-engine-foundation.md)维护 [DSL](../docs/scenario-schema.md)、语义校验及跨题材执行；[003](../note/003-scenario-editor.md)提供领域编辑和创作服务；[004](../note/004-custom-scenarios.md)必须使用 003 从空白制作两份 example、导出、定稿并验证实际运行。

未来编辑器导出的材料存入 examples 下的对应题材目录，可能有自动生成的不同 id。既有夹具不盲目覆盖，内容验证按稳定字段 key、对象关系和行为语义核对。任何具体题材逻辑不能写入 engine。
