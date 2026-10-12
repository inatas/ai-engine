import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { advanceWorld, initializeWorld, applyEffects, evaluate, playerView, validateScenario, validateWorld } from '../packages/engine/src/index.js';
import { scenarioSchema, worldSchema } from '../packages/contracts/src/index.js';
import type { Scenario } from '../packages/contracts/src/index.js';
const ming = () => scenarioSchema.parse(JSON.parse(fs.readFileSync('scenarios/ming-crisis.json', 'utf8')));
const station = () => scenarioSchema.parse(JSON.parse(fs.readFileSync('scenarios/station-repair.json', 'utf8')));

describe('通用世界引擎', () => {
  it('两题材完整定义通过结构和语义校验', () => {
    expect(validateScenario(ming()).valid).toBe(true);
    expect(validateScenario(station()).valid).toBe(true);
  });
  it('独立初始化且不修改输入', () => {
    const s = ming(), a = initializeWorld(s), b = initializeWorld(s);
    a.values.treasury = 0;
    expect(b.values.treasury).toBe(100);
    expect(s.initial_state.values.treasury).toBe(100);
  });
  it('单动作转移与同回合变化分别记录', () => {
    const s = ming();
    const action = s.actions[0]!;
    expect(applyEffects(s, s.initial_state.values, action.effects, { amount: 30 }).values.treasury).toBe(70);
    const w = advanceWorld(initializeWorld(s), 'fund-payroll', { amount: 30 });
    expect(w.values).toMatchObject({ treasury: 60, relief: 10, payroll: 20, spent: 10, loyalty: 50 });
    expect(w.turns[0]!.decisions[0]!.changes[0]).toEqual({ field: 'treasury', before: 100, after: 70 });
  });
  it('玩家参数拒绝不推进或修改原世界', () => {
    const w = initializeWorld(ming());
    for (const parameters of [{ amount: 130 }, { amount: 1.5 }, { amount: Number.MAX_SAFE_INTEGER + 1 }, { amount: Infinity }, { amount: NaN }, { amount: 2, extra: 1 }]) {
      expect(() => advanceWorld(w, 'fund-payroll', parameters)).toThrow();
    }
    expect(() => advanceWorld(w, 'npc-relief', {})).toThrow();
    expect(w.turn).toBe(0); expect(w.values.treasury).toBe(100);
  });
  it('动作后续效果失败则整动作撤销', () => {
    const s = ming(), before = { ...s.initial_state.values };
    expect(() => applyEffects(s, before, [
      { type: 'transfer', from_field: 'treasury', to_field: 'payroll', amount: { literal: 30 } },
      { type: 'add', field: 'loyalty', value: { literal: 100 } },
    ])).toThrow();
    expect(before).toEqual(s.initial_state.values);
  });
  it('整数溢出和负转移拒绝，不自动截断', () => {
    const s = ming();
    s.state_schema = s.state_schema.map(f => f.key === 'treasury' && f.type === 'integer' ? { ...f, max: Number.MAX_SAFE_INTEGER } : f);
    const values = { ...s.initial_state.values, treasury: Number.MAX_SAFE_INTEGER };
    expect(() => applyEffects(s, values, [{ type: 'add', field: 'treasury', value: { literal: 1 } }])).toThrow();
    expect(() => applyEffects(s, values, [{ type: 'transfer', from_field: 'treasury', to_field: 'payroll', amount: { literal: -1 } }])).toThrow();
  });
  it('主示例成功路径可达、重复输入确定、终局拒绝', () => {
    let w = initializeWorld(ming());
    const a = advanceWorld(w, 'fund-payroll', { amount: 100 });
    expect(a).toEqual(advanceWorld(w, 'fund-payroll', { amount: 100 }));
    w = a;
    for (let turn = 2; turn <= 12; turn++) w = advanceWorld(w, 'wait', {});
    expect(w).toMatchObject({ turn: 12, status: 'success', terminal_objective_id: 'survive' });
    expect(w.values).toMatchObject({ spent: 100, loyalty: 40, controller: 'court' });
    expect(() => advanceWorld(w, 'wait', {})).toThrow();
    expect(validateWorld(worldSchema.parse(w))).toBe(true);
  });
  it('主示例失败路径第八回合失守且一次性标记一致', () => {
    let w = initializeWorld(ming());
    for (let turn = 1; turn <= 8; turn++) w = advanceWorld(w, 'wait', {});
    expect(w).toMatchObject({ turn: 8, status: 'failure', fired_events: ['fall'] });
  });
  it('第二题材 NPC 使用最新余额，成功与超时路径可达', () => {
    const a = advanceWorld(initializeWorld(station()), 'allocate', { amount: 20 });
    expect(a.values).toMatchObject({ reserve: 10, 'repair-energy': 10, integrity: 40 });
    expect(advanceWorld(a, 'wait', {}).status).toBe('success');
    let b = initializeWorld(station());
    for (let i = 0; i < 4; i++) b = advanceWorld(b, 'wait', {});
    expect(b.status).toBe('failure');
  });
  it('事件失败原子撤销且不标记；成功一次性事件不重复', () => {
    const s = station();
    s.events = [
      { id: 'bad', name: '失败事件', conditions: { all: [] }, effects: [
        { type: 'add', field: 'integrity', value: { literal: 1 } },
        { type: 'transfer', from_field: 'reserve', to_field: 'spent', amount: { literal: 100 } },
      ], repeatable: false, visibility: 'public' },
      { id: 'once', name: '一次性事件', conditions: { all: [] }, effects: [{ type: 'add', field: 'integrity', value: { literal: 5 } }], repeatable: false, visibility: 'public' },
    ];
    let w = advanceWorld(initializeWorld(s), 'wait', {});
    expect(w.values.integrity).toBe(5); expect(w.fired_events).toEqual(['once']);
    expect(w.turns[0]!.decisions.find(d => d.id === 'bad')?.accepted).toBe(false);
    w = advanceWorld(w, 'wait', {});
    expect(w.values.integrity).toBe(5);
  });
  it('目标按优先级及声明顺序选择', () => {
    const s = station();
    s.objectives = ['first', 'second'].map(id => ({ id, name: id, outcome: 'failure', priority: 0, conditions: { all: [] }, visibility: 'public' }));
    expect(advanceWorld(initializeWorld(s), 'wait', {}).terminal_objective_id).toBe('first');
    s.objectives[1]!.priority = -1;
    expect(advanceWorld(initializeWorld(s), 'wait', {}).terminal_objective_id).toBe('second');
  });
  it('私有初始记忆、字段变化和事件从玩家视图过滤', () => {
    const s = ming();
    s.state_schema.find(f => f.key === 'loyalty')!.visibility = ['general'];
    s.events[0]!.visibility = ['general'];
    const view = playerView(advanceWorld(initializeWorld(s), 'wait', {}));
    expect(view.fields.some(f => f.key === 'loyalty')).toBe(false);
    expect(view.memories.some(m => m.id === 'private-worry')).toBe(false);
    expect(JSON.stringify(view.records)).not.toContain('arrears');
    expect(JSON.stringify(view)).not.toContain('conditions');
    expect(JSON.stringify(view)).not.toContain('effects');
  });
  it('零回合记忆窗口不会错误返回全部历史', () => {
    const s = ming(); s.simulation.memory_recent_turns = 0;
    expect(playerView(advanceWorld(initializeWorld(s), 'wait', {})).records).toEqual([]);
  });
  it('all/any/not 与候选回合语义', () => {
    expect(evaluate({ all: [] }, {}, {}, 1)).toBe(true);
    expect(evaluate({ any: [] }, {}, {}, 1)).toBe(false);
    expect(evaluate({ not: { any: [] } }, {}, {}, 1)).toBe(true);
    expect(evaluate({ operator: 'eq', left: { turn: true }, right: { literal: 1 } }, {}, {}, 1)).toBe(true);
  });
});

describe('定义拒绝与定位', () => {
  const mutations: [string, (s: Scenario) => void][] = [
    ['重复实体', s => { s.entities.characters[1]!.id = s.entities.characters[0]!.id; }],
    ['错误玩家', s => { s.player.character_id = 'missing'; }],
    ['缺失初值', s => { delete s.initial_state.values.treasury; }],
    ['未知字段', s => { s.initial_state.values.extra = 1; }],
    ['初值越界', s => { s.initial_state.values.treasury = -1; }],
    ['参数引用', s => { s.actions[0]!.effects = [{ type: 'add', field: 'treasury', value: { parameter: 'missing' } }]; }],
    ['事件参数', s => { s.events[0]!.conditions = { operator: 'eq', left: { parameter: 'amount' }, right: { literal: 1 } }; }],
    ['效果回合', s => { s.actions[0]!.effects = [{ type: 'set', field: 'treasury', value: { turn: true } }]; }],
    ['异单位转移', s => { s.actions[0]!.effects = [{ type: 'transfer', from_field: 'treasury', to_field: 'loyalty', amount: { literal: 1 } }]; }],
    ['NPC 冒充玩家', s => { s.simulation.npc_order.push('emperor'); }],
    ['NPC 错误参数', s => { s.simulation.npc_actions.treasurer![0]!.parameters = { extra: 1 }; }],
    ['未知受众', s => { s.events[0]!.visibility = ['missing']; }],
    ['错误比较类型', s => { s.events[0]!.conditions = { operator: 'gte', left: { field: 'controller' }, right: { literal: 1 } }; }],
  ];
  for (const [name, mutate] of mutations) it(name, () => {
    const s = ming(); mutate(s); const result = validateScenario(s);
    expect(result.valid).toBe(false); expect(result.issues[0]!.definition_path).toMatch(/^\//);
  });
  it('未知字段与多来源操作数严格拒绝', () => {
    expect(validateScenario({ ...ming(), owner_user_id: 'forged' }).valid).toBe(false);
    const s = ming() as unknown as Record<string, unknown>;
    s.actions = [{ ...ming().actions[0], effects: [{ type: 'set', field: 'treasury', value: { literal: 1, field: 'treasury' } }] }];
    expect(validateScenario(s).valid).toBe(false);
  });
  it('超深条件不会导致栈溢出', () => {
    let condition: unknown = { all: [] };
    for (let i = 0; i < 100; i++) condition = { not: condition };
    const s = ming(); const input = { ...s, events: [{ ...s.events[0], conditions: condition }] };
    expect(validateScenario(input).issues[0]!.message).toContain('限制');
  });
  it('当前世界结构和状态损坏拒绝', () => {
    const w = initializeWorld(ming());
    expect(worldSchema.safeParse({ ...w, schemaVersion: 2 }).success).toBe(false);
    w.values.treasury = -1; expect(validateWorld(w)).toBe(false);
  });
});
