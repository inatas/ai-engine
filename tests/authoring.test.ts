import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { applyProposal, checkScope, emptyScenario, proposalChanges, proposalGroups, danglingReferences, canonicalJson, draftShapeProblems,
  type DraftDocument, type GenerationInput, type Scenario } from '@ai-engine/contracts';
import { authorModelConfig, buildCandidate, callAuthorModel, type AuthorModelConfig } from '../apps/server/src/content/generation.js';
import { parseShorthand, formatShorthand } from '../apps/web/src/state-shorthand.js';
import { acknowledgeSave, candidateMatches, editWorkspace, openWorkspace, travelWorkspace, writePath } from '../apps/web/src/workspace-state.js';
import { initializeWorld, validateScenario } from '../packages/engine/src/index.js';
import { decodeCheckpoint } from '../apps/server/src/world/service.js';

const fixture = () => JSON.parse(readFileSync('scenarios/station-repair.json', 'utf8')) as Scenario;
const draft = (scenario: Scenario) => scenario as unknown as DraftDocument;
function input(document: DraftDocument): GenerationInput {
  return { generation_id: 'attempt', expected_revision: 0, workspace_id: 'workspace', content_version: 0, proposal_version: 0,
    stage: 'revise', instruction: '增加角色', document, proposal: null, edit_scope: { mode: 'extend', targets: [] } };
}
describe('候选范围与原子采纳', () => {
  it('领域修复将错误对象与列表恢复到路径要求的容器，根字段移除不会写出 undefined 属性', () => {
    const broken = { world: [], actions: {}, metadata: '错误', unexpected: true } as DraftDocument;
    const repaired = writePath(writePath(writePath(broken, ['world', 'background'], '夜班'), ['actions', 0, 'name'], '等待'), ['metadata', 'name'], '练习');
    expect(repaired).toEqual({ world: { background: '夜班' }, actions: [{ name: '等待' }], metadata: { name: '练习' }, unexpected: true });
    expect(broken.world).toEqual([]);
    const { unexpected: _unexpected, ...known } = repaired;
    expect(writePath(repaired, [], known)).toEqual(known);
  });
  it('按稳定标识比较名称和顺序，不把移动误判为新对象', () => {
    const before = fixture(), after = structuredClone(before);
    after.entities.characters.reverse(); after.entities.characters[0]!.name += '调整';
    const changes = proposalChanges(draft(before), draft(after));
    expect(changes.map(c => c.operation).sort()).toEqual(['reorder', 'update']);
    const proposal = { kind: 'detail' as const, document: draft(after), changes, groups: proposalGroups(changes), validation: { valid: true, issues: [] } };
    expect(applyProposal(draft(before), proposal, proposal.groups.map(g => g.group_id))).toEqual(after);
  });
  it('字段声明和合法 false / 空文本初值配对，完整采纳不会漏掉初值', () => {
    const before = emptyScenario('练习', 'practice'), after = structuredClone(before);
    after.state_schema.push({ key: 'ready', label: '准备', type: 'boolean', owner_id: null, visibility: 'public' });
    after.initial_state.values.ready = false;
    const changes = proposalChanges(draft(before), draft(after));
    expect(changes[0]!.after).toEqual({ declaration: after.state_schema[0], initial: { present: true, value: false } });
    const groups = proposalGroups(changes);
    expect(applyProposal(draft(before), { kind: 'detail', document: draft(after), changes, groups, validation: { valid: false, issues: [] } }, groups.map(g => g.group_id))).toEqual(after);
  });
  it('角色、权限、状态、行为配置的循环关联合为原子组；独立条目可单独选择', () => {
    const before = emptyScenario('练习', 'practice'), after = structuredClone(before);
    after.entities.characters.push({ id: 'npc', name: '值班员', description: '', faction_id: null, personality: [], goals: [], relationships: [] });
    after.actions.push({ id: 'wait', name: '等待', description: '', parameters: {}, allowed_actor_ids: ['npc'], conditions: { all: [] }, effects: [], visibility: ['npc'] });
    after.simulation.npc_order = ['npc']; after.simulation.npc_actions.npc = [{ action_id: 'wait', parameters: {} }];
    after.entities.locations.push({ id: 'location', name: '孤立地点', description: '独立' });
    const changes = proposalChanges(draft(before), draft(after)), groups = proposalGroups(changes);
    expect(groups).toHaveLength(2); expect(groups.every(g => g.requires.length === 0)).toBe(true);
    const group = groups.find(g => g.change_ids.length === 3)!;
    const result = applyProposal(draft(before), { kind: 'detail', document: draft(after), changes, groups, validation: { valid: false, issues: [] } }, [group.group_id]);
    expect(danglingReferences(result)).toEqual([]); expect((result.entities as Scenario['entities']).locations).toEqual([]);
  });
  it('extend 禁止覆盖背景；列表 key=null 只允许排序；保留 metadata.id', () => {
    const before = fixture(), after = structuredClone(before); after.world.background = '覆盖';
    expect(() => checkScope(draft(before), draft(after), { mode: 'extend', targets: [] })).toThrow('范围');
    expect(() => checkScope(draft(before), draft(after), { mode: 'revise', targets: [{ collection: 'characters', key: null }] })).toThrow('范围');
    expect(() => checkScope(draft(before), draft(after), { mode: 'revise', targets: [{ collection: 'world', key: null }] })).not.toThrow();
    after.metadata.id = 'new'; expect(() => checkScope(draft(before), draft(after), { mode: 'revise', targets: [{ collection: 'metadata', key: null }, { collection: 'world', key: null }] })).toThrow('标识');
  });
  it('真实输出校验拒绝越界和未知执行字段，新标识与引用一起映射', () => {
    const before = emptyScenario('练习', 'practice'), next = structuredClone(before);
    next.entities.characters.push({ id: 'temp_npc', name: '值班员', description: '', faction_id: null, personality: [], goals: [], relationships: [] });
    next.actions.push({ id: 'temp_wait', name: '等待', description: '', parameters: {}, allowed_actor_ids: ['temp_npc'], conditions: { all: [] }, effects: [], visibility: ['temp_npc'] });
    const result = buildCandidate(input(draft(before)), { candidate: { kind: 'detail', document: next }, assumptions: [], questions: [] });
    expect(result.kind).toBe('detail'); if (result.kind !== 'detail') throw new Error();
    const entities = result.document.entities as Scenario['entities'], actions = result.document.actions as Scenario['actions'];
    expect(entities.characters[0]!.id).not.toBe('temp_npc'); expect(actions[0]!.allowed_actor_ids).toEqual([entities.characters[0]!.id]);
    const bad = structuredClone(next) as unknown as { actions: Record<string, unknown>[] }; bad.actions[0]!.run_script = 'fetch()';
    expect(() => buildCandidate(input(draft(before)), { candidate: { kind: 'detail', document: bad }, assumptions: [], questions: [] })).toThrow();
    const badCondition = structuredClone(next) as unknown as { actions: Record<string, unknown>[] };
    badCondition.actions[0]!.conditions = { all: [], run_script: 'fetch()' };
    expect(() => buildCandidate(input(draft(before)), { candidate: { kind: 'detail', document: badCondition }, assumptions: [], questions: [] })).toThrow();
    expect(draftShapeProblems({ actions: [{ conditions: { operator: 'eq' } }] })).toEqual([]);
  });
});
describe('工作区版本与保存', () => {
  it('连续文本输入在失焦前合为一条撤销，但每次内容修改递增版本', () => {
    const document = draft(emptyScenario('练习', 'practice'));
    const original = openWorkspace('one', { draft_id: 'draft', name: '练习', revision: 0, updated_at: '', document }, 'workspace');
    const first = editWorkspace(original, { ...document, narrative: { opening: '灯' } }, '/narrative/opening');
    const second = editWorkspace(first, { ...document, narrative: { opening: '灯塔' } }, '/narrative/opening');
    expect(second.past).toHaveLength(1); expect(second.contentVersion).toBe(2); expect(travelWorkspace(second, 'undo').document).toEqual(document);
    const blurred = editWorkspace(second, second.document), again = editWorkspace(blurred, { ...document, narrative: { opening: '灯塔值班' } }, '/narrative/opening');
    expect(again.past).toHaveLength(2);
  });
  it('保存期间继续编辑，迟到确认只更新保存快照，撤销也使旧生成失效', () => {
    const document = draft(emptyScenario('练习', 'practice'));
    const initial = openWorkspace('one', { draft_id: 'draft', name: '练习', revision: 0, updated_at: '', document }, 'workspace');
    const snapshot = editWorkspace(initial, { ...document, world: { changed: 'first' } });
    const latest = editWorkspace(snapshot, { ...document, world: { changed: 'second' } });
    const saved = acknowledgeSave(latest, snapshot, { ...initial.draft, document: snapshot.document, revision: 1 });
    expect(saved.document).toEqual(latest.document); expect(saved.savedDocument).toEqual(snapshot.document);
    expect(acknowledgeSave({ ...latest, owner: 'other' }, snapshot, { ...initial.draft, revision: 1 })).toEqual({ ...latest, owner: 'other' });
    const undo = travelWorkspace(latest, 'undo'); expect(undo.document).toEqual(snapshot.document); expect(undo.contentVersion).toBeGreaterThan(latest.contentVersion);
    expect(candidateMatches(undo, { source: { ...input(document), draft_id: 'draft', document_digest: '', proposal_digest: '' }, candidate_id: 'candidate', candidate: { kind: 'outline', premise: '', player: '', characters: [], conflicts: [], event_directions: [], gameplay: [], ending_directions: [] }, assumptions: [], questions: [], usage: { input_tokens: null, output_tokens: null } }, 'attempt')).toBe(false);
  });
});
describe('属性简写', () => {
  const entities = [{ id: 'npc', name: '值班员', character: true }, { id: 'room', name: '值班室' }, { id: 'tower', name: '灯塔' }];
  it.each(['体力 = 8 [0..10] 点 @公开', '在岗 = true @私有', '备注 = "待命" @公开', '位置 = ref(值班室) {值班室|灯塔} @私有'])('解析并往返 %s', text => {
    const result = parseShorthand(text, 'state', 'npc', entities); expect(parseShorthand(formatShorthand(result.declaration, result.value), 'state', 'npc', entities)).toEqual(result);
  });
  it.each(['体力 = 8 @公开', '体力 = 8.5 [0..10] 点 @公开', '体力 = 11 [0..10] 点 @公开', '体力 = 9007199254740992 [0..9007199254740992] @公开', '位置 = ref(未知) {灯塔} @公开', '属性 = alert(1) @公开'])('非法输入不生成领域值 %s', text => {
    expect(() => parseShorthand(text, 'state', 'npc', entities)).toThrow();
  });
  it('全局私有和重名实体不自动推断', () => {
    expect(() => parseShorthand('在岗 = true @私有', 'state', null, entities)).toThrow();
    expect(() => parseShorthand('位置 = ref(灯塔) {灯塔} @公开', 'state', null, [...entities, { id: 'other', name: '灯塔' }])).toThrow('重名');
  });
});
it('完整检查点校验拒绝版本、知识和已提交值损坏，JSONB 键排序不影响摘要', () => {
  const world = initializeWorld(fixture());
  const payload = { ...world, scenario_id: world.scenario_snapshot.metadata.id, known_records: Object.fromEntries(world.scenario_snapshot.entities.characters.map(c => [c.id,
    world.scenario_snapshot.initial_state.memories.filter(m => m.audience === 'public' || m.audience.includes(c.id)).map(m => `initial:${m.id}`)])) };
  expect(decodeCheckpoint(payload, 1n)).toEqual(payload);
  expect(canonicalJson({ b: false, a: 1 })).toBe(canonicalJson({ a: 1, b: false }));
  expect(() => decodeCheckpoint({ ...payload, schemaVersion: 2 }, 2n)).toThrow('已无法');
  expect(() => decodeCheckpoint({ ...payload, known_records: {} }, 1n)).toThrow('读取失败');
  const corrupted = structuredClone(payload); corrupted.values[Object.keys(corrupted.values)[0]!] = 1;
  expect(() => decodeCheckpoint(corrupted, 1n)).toThrow('读取失败');
});
it('重复实体校验定位到真实集合和稳定对象', () => {
  const value = fixture(); value.entities.locations.push({ id: value.entities.characters[0]!.id, name: '重复', description: '' });
  const issue = validateScenario(value).issues.find(i => i.message.startsWith('重复标识'))!;
  expect(issue.definition_path).toBe('/entities/locations/0/id'); expect(issue.object_id).toBe(value.entities.characters[0]!.id);
});

describe('供应方 HTTP 协议（显式测试响应，不调用真实模型）', () => {
  it.each([
    ['https://model.example.test', 'https://model.example.test/chat/completions'],
    ['https://model.example.test/v1/', 'https://model.example.test/v1/chat/completions'],
    ['https://model.example.test/v1/chat/completions', 'https://model.example.test/v1/chat/completions'],
  ])('服务根地址与完整接口只解析一次：%s', (url, expected) => {
    vi.stubEnv('MODEL_API_URL', url); vi.stubEnv('MODEL_API_KEY', 'test-only-key'); vi.stubEnv('MODEL_NAME', 'test-model');
    try { expect(authorModelConfig()?.url).toBe(expected); } finally { vi.unstubAllEnvs(); }
  });
  const config: AuthorModelConfig = { url: 'https://model.example.test/v1/chat/completions', key: 'test-only-key', model: 'test-model', timeoutMs: 1000,
    contextTokens: 65536, outputTokens: 12000, maxResponseBytes: 1048576, globalConcurrency: 2, callsPerMinute: 2 };
  const envelope = { candidate: { kind: 'outline', premise: '夜班', player: '值班员', characters: [], conflicts: [], event_directions: [], gameplay: [], ending_directions: [] }, assumptions: [], questions: [] };
  const response = (finish_reason: string, refusal: unknown = null) => ({ choices: [{ finish_reason, message: { content: JSON.stringify(envelope), refusal } }], usage: { prompt_tokens: 123, completion_tokens: 45 } });
  it('完整输出保留实际用量，缺失报告不虚构 token', async () => {
    const network = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(response('stop'))))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: response('stop').choices })));
    try {
      const result = await callAuthorModel(config, input(emptyScenario('练习', 'practice')), new AbortController().signal);
      expect(result).toEqual({ value: envelope, inputTokens: 123, outputTokens: 45 });
      expect(await callAuthorModel(config, input(emptyScenario('练习', 'practice')), new AbortController().signal)).toMatchObject({ inputTokens: null, outputTokens: null });
    } finally { network.mockRestore(); }
  });
  it.each([['length', null], ['stop', '供应方拒绝原文']])('拒绝被截断或标记拒绝的输出，即使正文是完整 JSON：%s', async (finish, refusal) => {
    const network = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(response(finish!, refusal))));
    try {
      await expect(callAuthorModel(config, input(emptyScenario('练习', 'practice')), new AbortController().signal)).rejects.toMatchObject({ code: 'invalid_model_output' });
      expect(network).toHaveBeenCalledTimes(1);
    } finally { network.mockRestore(); }
  });
  it('响应字节超限中止读取，上游失败过滤原文且不自动重试', async () => {
    const network = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(response('stop'))))
      .mockResolvedValueOnce(new Response('包含上游私有诊断信息', { status: 500 }));
    try {
      await expect(callAuthorModel({ ...config, maxResponseBytes: 10 }, input(emptyScenario('练习', 'practice')), new AbortController().signal)).rejects.toThrow('response too large');
      await expect(callAuthorModel(config, input(emptyScenario('练习', 'practice')), new AbortController().signal)).rejects.toMatchObject({ code: 'generation_failed', message: '模型服务调用失败，请稍后主动重试' });
      expect(network).toHaveBeenCalledTimes(2);
    } finally { network.mockRestore(); }
  });
});
