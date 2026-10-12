import fs from 'node:fs';
const cmp = (field, operator, literal) => ({ operator, left: { field }, right: { literal } });
const all = (...conditions) => ({ all: conditions });
const turn = number => ({ operator: 'gte', left: { turn: true }, right: { literal: number } });
const transfer = (from, to, amount) => ({ type: 'transfer', from_field: from, to_field: to, amount });
const character = (id, name, faction_id = null) => ({
  id, name, faction_id, description: '', personality: [], goals: [], relationships: [],
});
const integer = (key, label, initial, max, unit = null, visibility = 'public') => ({
  declaration: { key, label, type: 'integer', owner_id: null, min: 0, max, unit, visibility }, initial,
});
const action = (id, name, actors, effects = [], conditions = all(), parameters = {}) => ({
  id, name, description: '', allowed_actor_ids: actors, effects, conditions, parameters, visibility: 'public',
});
const mingFields = [
  integer('treasury', '国库', 100, 1000, '财政点'),
  integer('payroll', '前线军饷', 0, 1000, '财政点'),
  integer('spent', '已用军费', 0, 1000, '财政点'),
  integer('relief', '赈济资金', 0, 1000, '财政点'),
  integer('loyalty', '军队忠诚', 50, 100),
];
const ming = {
  metadata: { id: 'ming-crisis', name: '大明末年危局', description: '机制验证局势，数值不对应真实历史财政或兵力。' },
  world: { background: '军饷与赈济同时告急。你需要分配有限的资金，维持前线忠诚。', start_time: '1643 年', turn_unit: '一周', constraints: ['仅作为规则验证，不代表完整历史模拟。'] },
  entities: {
    characters: [character('emperor', '皇帝', 'court'), character('treasurer', '财政官', 'court'), character('general', '前线将领', 'court')],
    factions: [{ id: 'court', name: '朝廷', description: '', goals: [] }, { id: 'enemy', name: '敌对阵营', description: '', goals: [] }],
    locations: [{ id: 'beijing', name: '北京', description: '' }, { id: 'front', name: '前线', description: '' }],
  },
  player: { character_id: 'emperor' },
  state_schema: [...mingFields.map(f => f.declaration), { key: 'controller', label: '北京控制者', type: 'entity_ref', owner_id: 'beijing', allowed_entity_ids: ['court', 'enemy'], visibility: 'public' }],
  initial_state: {
    values: { ...Object.fromEntries(mingFields.map(f => [f.declaration.key, f.initial])), controller: 'court' },
    memories: [{ id: 'requests', text: '军饷与赈济同时申请拨款。', audience: 'public' }, { id: 'private-worry', text: '前线将领担忧部下哗变。', audience: ['general'] }],
  },
  actions: [
    action('fund-payroll', '调拨军饷', ['emperor'], [transfer('treasury', 'payroll', { parameter: 'amount' })], all(), { amount: { type: 'integer', min: 1, max: 100 } }),
    action('fund-relief', '拨款赈济', ['emperor'], [transfer('treasury', 'relief', { parameter: 'amount' })], all(), { amount: { type: 'integer', min: 1, max: 100 } }),
    action('wait', '等待', ['emperor']),
    action('npc-relief', '财政官拨付赈济', ['treasurer'], [transfer('treasury', 'relief', { literal: 10 })], all(cmp('treasury', 'gte', 10), cmp('relief', 'lt', 30))),
  ],
  simulation: { npc_order: ['treasurer', 'general'], npc_actions: { treasurer: [{ action_id: 'npc-relief', parameters: {} }], general: [] }, memory_recent_turns: 4 },
  events: [
    { id: 'arrears', name: '欠饷', conditions: all(cmp('payroll', 'lt', 10), cmp('loyalty', 'gte', 5)), effects: [{ type: 'add', field: 'loyalty', value: { literal: -5 } }], repeatable: true, visibility: 'public' },
    { id: 'payment', name: '支付军饷', conditions: cmp('payroll', 'gte', 10), effects: [transfer('payroll', 'spent', { literal: 10 })], repeatable: true, visibility: 'public' },
    { id: 'fall', name: '北京失守', conditions: all(turn(8), cmp('loyalty', 'lt', 40)), effects: [{ type: 'set', field: 'controller', value: { literal: 'enemy' } }], repeatable: false, visibility: 'public' },
  ],
  objectives: [
    { id: 'defeat', name: '北京失守', outcome: 'failure', priority: 0, conditions: cmp('controller', 'eq', 'enemy'), visibility: 'public' },
    { id: 'survive', name: '度过危局', outcome: 'success', priority: 10, conditions: all(turn(12), cmp('controller', 'eq', 'court'), cmp('loyalty', 'gte', 40)), visibility: 'public' },
  ],
  narrative: { opening: '军饷与赈济的奏报摆在案前，国库只剩一百财政点。', style: '简洁、结构化', perspective: '皇帝' },
};
const stationFields = [integer('reserve', '能源储备', 30, 100, '能源点'), integer('repair-energy', '维修能源', 0, 100, '能源点'), integer('spent', '消耗能源', 0, 100, '能源点'), integer('integrity', '空间站完整度', 0, 100, '%')];
const station = {
  metadata: { id: 'station-repair', name: '空间站维修', description: '用另一题材验证通用引擎。' },
  world: { background: '空间站受损，工程师等待能源供应。', start_time: '任务第一日', turn_unit: '一小时', constraints: [] },
  entities: { characters: [character('commander', '指挥官'), character('engineer', '工程师')], factions: [], locations: [] },
  player: { character_id: 'commander' }, state_schema: stationFields.map(f => f.declaration),
  initial_state: { values: Object.fromEntries(stationFields.map(f => [f.declaration.key, f.initial])), memories: [] },
  actions: [
    action('allocate', '分配能源', ['commander'], [transfer('reserve', 'repair-energy', { parameter: 'amount' })], all(), { amount: { type: 'integer', min: 1, max: 30 } }),
    action('wait', '等待', ['commander']),
    action('repair', '维修', ['engineer'], [transfer('repair-energy', 'spent', { literal: 10 }), { type: 'add', field: 'integrity', value: { literal: 40 } }], all(cmp('repair-energy', 'gte', 10), cmp('integrity', 'lte', 60))),
  ],
  simulation: { npc_order: ['engineer'], npc_actions: { engineer: [{ action_id: 'repair', parameters: {} }] }, memory_recent_turns: 3 },
  events: [],
  objectives: [
    { id: 'repaired', name: '维修完成', outcome: 'success', priority: 0, conditions: cmp('integrity', 'gte', 80), visibility: 'public' },
    { id: 'timeout', name: '救援窗口关闭', outcome: 'failure', priority: 10, conditions: turn(4), visibility: 'public' },
  ],
  narrative: { opening: '工程师请求能源，维修窗口只有四小时。', style: '任务报告', perspective: '指挥官' },
};
fs.mkdirSync('scenarios', { recursive: true });
for (const scenario of [ming, station]) fs.writeFileSync('scenarios/' + scenario.metadata.id + '.json', JSON.stringify(scenario, null, 2) + '\n');
