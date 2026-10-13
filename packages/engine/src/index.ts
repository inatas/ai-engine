import type { Scenario, Scalar, Operand, Condition, Effect, World, Decision, Change, Audience, PlayerView, PlayerTurn } from '@ai-engine/contracts';
import { validateScenario, valueValid, parametersValid, validateWorld } from './validate.js';
export { validateScenario, validateWorld } from './validate.js';

export class RuleError extends Error {}
export function initializeWorld(input: unknown): World {
  const result = validateScenario(input);
  if (!result.definition) throw new RuleError(result.issues.map(i => i.definition_path + ': ' + i.message).join('; '));
  const s = clone(result.definition);
  return { schemaVersion: 1, scenario_snapshot: s, turn: 0, status: 'active',
    values: { ...s.initial_state.values }, fired_events: [], terminal_objective_id: null, turns: [] };
}
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function read(o: Operand, values: Record<string, Scalar>, parameters: Record<string, Scalar>, turn: number): Scalar {
  if ('literal' in o) return o.literal;
  if ('turn' in o) return turn;
  const value = 'field' in o ? values[o.field] : parameters[o.parameter];
  if (value === undefined) throw new RuleError('引用不存在');
  return value;
}
export function evaluate(c: Condition, values: Record<string, Scalar>, parameters: Record<string, Scalar>, turn: number): boolean {
  if ('all' in c) return c.all.every(child => evaluate(child, values, parameters, turn));
  if ('any' in c) return c.any.some(child => evaluate(child, values, parameters, turn));
  if ('not' in c) return !evaluate(c.not, values, parameters, turn);
  const left = read(c.left, values, parameters, turn), right = read(c.right, values, parameters, turn);
  if (c.operator === 'eq') return left === right;
  if (c.operator === 'ne') return left !== right;
  if (typeof left !== 'number' || typeof right !== 'number') throw new RuleError('比较必须为整数');
  switch (c.operator) {
    case 'gt': return left > right; case 'gte': return left >= right;
    case 'lt': return left < right; case 'lte': return left <= right;
  }
}
export function applyEffects(s: Scenario, original: Record<string, Scalar>, effects: Effect[], parameters: Record<string, Scalar> = {}): { values: Record<string, Scalar>; changes: Change[] } {
  const values = { ...original };
  const changes: Change[] = [];
  const fields = new Map(s.state_schema.map(f => [f.key, f]));
  function write(key: string, value: Scalar) {
    const field = fields.get(key), before = values[key];
    if (!field || before === undefined || !valueValid(field, value)) throw new RuleError('字段值非法或越界：' + key);
    values[key] = value;
    changes.push({ field: key, before, after: value });
  }
  for (const e of effects) {
    if (e.type === 'transfer') {
      const amount = read(e.amount, values, parameters, 0);
      const from = values[e.from_field], to = values[e.to_field];
      const f = fields.get(e.from_field), t = fields.get(e.to_field);
      if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0 ||
        typeof from !== 'number' || typeof to !== 'number' || e.from_field === e.to_field ||
        f?.type !== 'integer' || t?.type !== 'integer' || f.unit !== t.unit) throw new RuleError('非法资源转移');
      write(e.from_field, from - amount); write(e.to_field, to + amount);
    } else {
      const value = read(e.value, values, parameters, 0);
      if (e.type === 'set') write(e.field, value);
      else {
        const current = values[e.field];
        if (typeof current !== 'number' || typeof value !== 'number') throw new RuleError('add 必须为整数');
        write(e.field, current + value);
      }
    }
  }
  return { values, changes };
}
function act(s: Scenario, values: Record<string, Scalar>, actor: string, actionId: string, parameters: Record<string, Scalar>, turn: number) {
  const action = s.actions.find(a => a.id === actionId);
  if (!action || !action.allowed_actor_ids.includes(actor) || !parametersValid(action.parameters, parameters)) throw new RuleError('动作或参数非法');
  if (!evaluate(action.conditions, values, parameters, turn)) throw new RuleError('动作条件不满足');
  const result = applyEffects(s, values, action.effects, parameters);
  const decision: Decision = { kind: 'action', id: action.id, actor_id: actor, accepted: true, reason: '', audience: action.visibility, changes: result.changes };
  return { values: result.values, decision };
}
export function advanceWorld(original: World, actionId: string, parameters: Record<string, Scalar>): World {
  if (!validateWorld(original)) throw new RuleError('世界载荷无效');
  if (original.status !== 'active') throw new RuleError('游戏已经结束');
  const world = clone(original), s = world.scenario_snapshot, turn = world.turn + 1;
  if (!Number.isSafeInteger(turn)) throw new RuleError('回合超过安全整数');
  const player = act(s, world.values, s.player.character_id, actionId, parameters, turn);
  world.values = player.values;
  const decisions = [player.decision];
  for (const npc of s.simulation.npc_order) {
    let accepted = false;
    for (const candidate of s.simulation.npc_actions[npc] ?? []) {
      try {
        const result = act(s, world.values, npc, candidate.action_id, candidate.parameters, turn);
        world.values = result.values; decisions.push(result.decision); accepted = true; break;
      } catch (error) {
        if (!(error instanceof RuleError)) throw error;
        const action = s.actions.find(a => a.id === candidate.action_id)!;
        decisions.push({ kind: 'action', id: action.id, actor_id: npc, accepted: false, reason: error.message, audience: action.visibility, changes: [] });
      }
    }
    if (!accepted) decisions.push({ kind: 'action', id: 'no_action', actor_id: npc, accepted: false, reason: '无合法候选', audience: [npc], changes: [] });
  }
  for (const event of s.events) {
    if (!event.repeatable && world.fired_events.includes(event.id)) continue;
    if (!evaluate(event.conditions, world.values, {}, turn)) continue;
    try {
      const result = applyEffects(s, world.values, event.effects);
      world.values = result.values;
      if (!event.repeatable) world.fired_events.push(event.id);
      decisions.push({ kind: 'event', id: event.id, actor_id: null, accepted: true, reason: '', audience: event.visibility, changes: result.changes });
    } catch (error) {
      if (!(error instanceof RuleError)) throw error;
      decisions.push({ kind: 'event', id: event.id, actor_id: null, accepted: false, reason: error.message, audience: event.visibility, changes: [] });
    }
  }
  const objective = s.objectives.map((o, index) => ({ o, index }))
    .filter(({ o }) => evaluate(o.conditions, world.values, {}, turn))
    .sort((a, b) => a.o.priority - b.o.priority || a.index - b.index)[0]?.o;
  if (objective) {
    world.status = objective.outcome; world.terminal_objective_id = objective.id;
    decisions.push({ kind: 'objective', id: objective.id, actor_id: null, accepted: true, reason: '', audience: objective.visibility, changes: [] });
  }
  world.turn = turn; world.turns.push({ turn, decisions });
  return world;
}
function visible(a: Audience, actor: string): boolean { return a === 'public' || a.includes(actor); }
export function playerView(world: World): PlayerView {
  const s = world.scenario_snapshot, actor = s.player.character_id;
  const fields = s.state_schema.filter(f => visible(f.visibility, actor));
  const visibleFields = new Set(fields.map(f => f.key));
  const entityNames = new Map([...s.entities.characters, ...s.entities.factions, ...s.entities.locations].map(entity => [entity.id, entity.name]));
  const history: PlayerTurn[] = world.turns.map(t => ({ turn: t.turn,
    decisions: t.decisions.filter(d => visible(d.audience, actor) && d.accepted).map(d => ({
      kind: d.kind, id: d.id,
      name: (d.kind === 'action' ? s.actions : d.kind === 'event' ? s.events : s.objectives).find(item => item.id === d.id)!.name,
      actor_id: d.actor_id, actor_name: d.actor_id === null ? null : entityNames.get(d.actor_id)!,
      changes: d.changes.filter(c => visibleFields.has(c.field)),
    })),
  }));
  const actions = s.actions.filter(a => a.allowed_actor_ids.includes(actor)).map(a => ({ id: a.id, name: a.name, description: a.description, parameters: a.parameters }));
  const referenced = new Set<string>();
  for (const field of fields.filter(f => f.type === 'entity_ref')) {
    referenced.add(world.values[field.key] as string);
    for (const record of history) for (const decision of record.decisions) for (const change of decision.changes) {
      if (change.field === field.key) { referenced.add(change.before as string); referenced.add(change.after as string); }
    }
  }
  for (const action of actions) for (const parameter of Object.values(action.parameters)) {
    if (parameter.type === 'entity_ref') for (const id of parameter.allowed_entity_ids) referenced.add(id);
  }
  const ending = s.objectives.find(o => o.id === world.terminal_objective_id && visible(o.visibility, actor));
  return {
    scenario_id: s.metadata.id, name: s.metadata.name, turn: world.turn, status: world.status,
    opening: s.narrative.opening,
    fields: fields.map(f => ({ key: f.key, label: f.label, type: f.type, value: world.values[f.key]!, unit: f.type === 'integer' ? f.unit : null })),
    memories: s.initial_state.memories.filter(m => visible(m.audience, actor)).map(m => ({ id: m.id, text: m.text })),
    records: s.simulation.memory_recent_turns === 0 ? [] : history.slice(-s.simulation.memory_recent_turns),
    history, actions,
    entities: [...referenced].map(id => ({ id, name: entityNames.get(id)! })),
    ending: ending ? { id: ending.id, name: ending.name, outcome: ending.outcome } : null,
  };
}
