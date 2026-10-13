import { scenarioSchema, atPath, collectionPaths, itemKey } from '@ai-engine/contracts';
import type { Scenario, Issue, Field, Parameter, Scalar, Operand, Condition, Effect, Audience, World } from '@ai-engine/contracts';

export function valueValid(declaration: Parameter | Field, value: unknown): value is Scalar {
  switch (declaration.type) {
    case 'integer': return typeof value === 'number' && Number.isSafeInteger(value) && value >= declaration.min && value <= declaration.max;
    case 'boolean': return typeof value === 'boolean';
    case 'string': return typeof value === 'string';
    case 'entity_ref': return typeof value === 'string' && declaration.allowed_entity_ids.includes(value);
  }
}
export function parametersValid(declarations: Record<string, Parameter>, values: Record<string, Scalar>): boolean {
  return Object.keys(declarations).length === Object.keys(values).length &&
    Object.entries(declarations).every(([key, declaration]) => Object.hasOwn(values, key) && valueValid(declaration, values[key]));
}
// Check complexity before the recursive schema parser to avoid a stack overflow.
function withinLimits(input: unknown): boolean {
  const pending = [{ value: input, depth: 0 }];
  let nodes = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (++nodes > 20000 || item.depth > 48) return false;
    if (item.value && typeof item.value === 'object') {
      for (const value of Object.values(item.value)) pending.push({ value, depth: item.depth + 1 });
    }
  }
  return true;
}
export function validateScenario(input: unknown): { valid: boolean; issues: Issue[]; definition?: Scenario } {
  const identities = (issues: Issue[]): Issue[] => issues.map(issue => {
    const parts = issue.definition_path.split('/').slice(1).map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'));
    for (const [collection, path] of Object.entries(collectionPaths)) {
      if (!path.every((part, index) => parts[index] === part)) continue;
      const values = atPath(input, path);
      if (!Array.isArray(values)) continue;
      const id = itemKey(values[Number(parts[path.length])], collection);
      if (id) return { ...issue, object_id: id };
    }
    return issue;
  });
  if (!withinLimits(input)) return { valid: false, issues: [{ severity: 'error', definition_path: '/', message: '定义超过深度或节点限制' }] };
  const parsed = scenarioSchema.safeParse(input);
  if (!parsed.success) {
    const pointer = (parts: PropertyKey[]) => '/' + parts.map(part => String(part).replaceAll('~', '~0').replaceAll('/', '~1')).join('/');
    return {
      valid: false, issues: identities(parsed.error.issues.flatMap(issue =>
        issue.code === 'unrecognized_keys'
          ? issue.keys.map(key => ({ severity: 'error' as const, definition_path: pointer([...issue.path, key]), message: '未知字段' }))
          : [{ severity: 'error' as const, definition_path: pointer(issue.path), message: issue.message }],
      )),
    };
  }
  const s = parsed.data;
  const issues: Issue[] = [];
  const error = (path: string, message: string) => issues.push({ severity: 'error', definition_path: path, message });
  const entities = [...s.entities.characters, ...s.entities.factions, ...s.entities.locations];
  const entityIds = new Set(entities.map(x => x.id));
  const characters = new Set(s.entities.characters.map(x => x.id));
  const factions = new Set(s.entities.factions.map(x => x.id));
  const fields = new Map(s.state_schema.map(x => [x.key, x]));
  const actions = new Map(s.actions.map(x => [x.id, x]));
  function unique(values: string[], path: string) {
    const seen = new Set<string>();
    values.forEach((value, index) => { if (seen.has(value)) error(path + '/' + index, '重复标识：' + value); seen.add(value); });
  }
  const seenEntities = new Set<string>();
  for (const kind of ['characters', 'factions', 'locations'] as const) s.entities[kind].forEach((entity, index) => {
    if (seenEntities.has(entity.id)) error(`/entities/${kind}/${index}/id`, '重复标识：' + entity.id);
    seenEntities.add(entity.id);
  });
  unique(s.state_schema.map(x => x.key), '/state_schema');
  unique(s.actions.map(x => x.id), '/actions');
  unique(s.events.map(x => x.id), '/events');
  unique(s.objectives.map(x => x.id), '/objectives');
  unique(s.initial_state.memories.map(x => x.id), '/initial_state/memories');
  function refs(ids: string[], allowed: Set<string>, path: string) {
    unique(ids, path);
    ids.forEach((value, index) => { if (!allowed.has(value)) error(path + '/' + index, '未知引用：' + value); });
  }
  function audience(value: Audience, path: string) { if (value !== 'public') refs(value, characters, path); }
  function declaration(d: Parameter | Field, path: string) {
    if (d.type === 'integer' && d.min > d.max) error(path, '最小值超过最大值');
    if (d.type === 'entity_ref') refs(d.allowed_entity_ids, entityIds, path + '/allowed_entity_ids');
  }
  if (!characters.has(s.player.character_id)) error('/player/character_id', '玩家必须引用角色');
  s.entities.characters.forEach((c, i) => {
    const p = '/entities/characters/' + i;
    if (c.faction_id !== null && !factions.has(c.faction_id)) error(p + '/faction_id', '未知阵营');
    c.relationships.forEach((r, j) => { if (!entityIds.has(r.target_id)) error(p + '/relationships/' + j + '/target_id', '未知实体'); });
  });
  s.state_schema.forEach((f, i) => {
    const p = '/state_schema/' + i;
    declaration(f, p); audience(f.visibility, p + '/visibility');
    if (f.owner_id !== null && !entityIds.has(f.owner_id)) error(p + '/owner_id', '未知实体');
    if (!Object.hasOwn(s.initial_state.values, f.key) || !valueValid(f, s.initial_state.values[f.key])) error('/initial_state/values/' + f.key, '初始值缺失、类型错误或越界');
  });
  for (const key of Object.keys(s.initial_state.values)) if (!fields.has(key)) error('/initial_state/values/' + key, '未声明字段');
  s.initial_state.memories.forEach((m, i) => audience(m.audience, '/initial_state/memories/' + i + '/audience'));
  type ValueType = 'integer' | 'boolean' | 'string' | 'entity_ref';
  function operand(o: Operand, params: Record<string, Parameter>, path: string, allowTurn: boolean): ValueType | undefined {
    if ('literal' in o) return typeof o.literal === 'number' ? 'integer' : typeof o.literal === 'boolean' ? 'boolean' : 'string';
    if ('turn' in o) { if (!allowTurn) error(path, '效果不能引用回合'); return 'integer'; }
    const d = 'field' in o ? fields.get(o.field) : params[o.parameter];
    if (!d) error(path, '未知字段或参数引用');
    return d?.type;
  }
  function compatible(a: ValueType | undefined, b: ValueType | undefined, oa: Operand, ob: Operand): boolean {
    if (a === b) return true;
    const literal = a === 'entity_ref' && 'literal' in ob ? ob.literal : b === 'entity_ref' && 'literal' in oa ? oa.literal : null;
    return typeof literal === 'string' && entityIds.has(literal);
  }
  function condition(c: Condition, params: Record<string, Parameter>, path: string) {
    if ('all' in c || 'any' in c) {
      const key = 'all' in c ? 'all' : 'any';
      const children = 'all' in c ? c.all : c.any;
      children.forEach((child, i) => condition(child, params, path + '/' + key + '/' + i));
    } else if ('not' in c) condition(c.not, params, path + '/not');
    else {
      const a = operand(c.left, params, path + '/left', true);
      const b = operand(c.right, params, path + '/right', true);
      if (!compatible(a, b, c.left, c.right)) error(path, '比较操作数类型不匹配');
      if (!['eq', 'ne'].includes(c.operator) && (a !== 'integer' || b !== 'integer')) error(path, '大小比较只支持整数');
    }
  }
  function effects(list: Effect[], params: Record<string, Parameter>, path: string) {
    list.forEach((e, i) => {
      const p = path + '/' + i;
      if (e.type === 'transfer') {
        const from = fields.get(e.from_field), to = fields.get(e.to_field);
        if (!from || !to || from.type !== 'integer' || to.type !== 'integer' || from.unit !== to.unit || e.from_field === e.to_field) error(p, '转移需要两个不同的同单位整数字段');
        if (operand(e.amount, params, p + '/amount', false) !== 'integer') error(p, '转移数量必须为整数');
        if ('literal' in e.amount && typeof e.amount.literal === 'number' && e.amount.literal < 0) error(p + '/amount', '转移数量不能为负数');
      } else {
        const f = fields.get(e.field);
        const kind = operand(e.value, params, p + '/value', false);
        if (!f) error(p + '/field', '未知字段');
        else if (e.type === 'add') { if (f.type !== 'integer' || kind !== 'integer') error(p, 'add 只支持整数'); }
        else {
          if (!compatible(f.type, kind, { field: e.field }, e.value)) error(p, 'set 类型不匹配');
          if ('literal' in e.value && !valueValid(f, e.value.literal)) error(p + '/value', 'set 字面量越界或非法引用');
        }
      }
    });
  }
  s.actions.forEach((a, i) => {
    const p = '/actions/' + i;
    refs(a.allowed_actor_ids, characters, p + '/allowed_actor_ids'); audience(a.visibility, p + '/visibility');
    Object.entries(a.parameters).forEach(([key, d]) => declaration(d, p + '/parameters/' + key));
    condition(a.conditions, a.parameters, p + '/conditions'); effects(a.effects, a.parameters, p + '/effects');
  });
  refs(s.simulation.npc_order, characters, '/simulation/npc_order');
  if (s.simulation.npc_order.includes(s.player.character_id)) error('/simulation/npc_order', 'NPC 顺序不能包含玩家');
  for (const npc of s.simulation.npc_order) {
    const candidates = s.simulation.npc_actions[npc];
    if (!candidates) error('/simulation/npc_actions/' + npc, '缺少 NPC 候选数组');
    else candidates.forEach((c, i) => {
      const a = actions.get(c.action_id);
      if (!a || !a.allowed_actor_ids.includes(npc) || !parametersValid(a.parameters, c.parameters)) error('/simulation/npc_actions/' + npc + '/' + i, 'NPC 候选引用、授权或参数无效');
    });
  }
  for (const npc of Object.keys(s.simulation.npc_actions)) if (!s.simulation.npc_order.includes(npc)) error('/simulation/npc_actions/' + npc, '候选角色不在 NPC 顺序中');
  s.events.forEach((e, i) => {
    const p = '/events/' + i;
    audience(e.visibility, p + '/visibility'); condition(e.conditions, {}, p + '/conditions'); effects(e.effects, {}, p + '/effects');
  });
  s.objectives.forEach((o, i) => {
    const p = '/objectives/' + i;
    audience(o.visibility, p + '/visibility'); condition(o.conditions, {}, p + '/conditions');
  });
  return issues.length ? { valid: false, issues: identities(issues) } : { valid: true, issues, definition: s };
}

export function validateWorld(world: World): boolean {
  const s = world.scenario_snapshot;
  if (!validateScenario(s).valid || !Number.isSafeInteger(world.turn) || world.turn < 0) return false;
  if (Object.keys(world.values).length !== s.state_schema.length || !s.state_schema.every(f => valueValid(f, world.values[f.key]))) return false;
  const fired = new Set(world.fired_events);
  if (fired.size !== world.fired_events.length || world.fired_events.some(id => !s.events.some(e => e.id === id && !e.repeatable))) return false;
  if (world.turns.length !== world.turn || world.turns.some((t, i) => t.turn !== i + 1)) return false;
  if (world.status === 'active') return world.terminal_objective_id === null;
  return s.objectives.some(o => o.id === world.terminal_objective_id && o.outcome === world.status);
}
