import type { DraftDocument, DetailProposal, ProposalChange, Target } from './index.js';

export const collectionPaths: Record<Target['collection'], string[]> = {
  metadata: ['metadata'], world: ['world'], player: ['player'], narrative: ['narrative'], simulation: ['simulation'],
  characters: ['entities', 'characters'], factions: ['entities', 'factions'], locations: ['entities', 'locations'],
  fields: ['state_schema'], memories: ['initial_state', 'memories'], actions: ['actions'], events: ['events'], objectives: ['objectives'],
};
export const singletonCollections = ['metadata', 'world', 'player', 'narrative', 'simulation'];
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, child]) => JSON.stringify(key) + ':' + canonicalJson(child)).join(',') + '}';
  const result = JSON.stringify(value);
  if (result === undefined) throw new Error('摘要输入必须是 JSON');
  return result;
}
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, i) => sameValue(value, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const aa = Object.entries(a), bb = Object.entries(b);
    return aa.length === bb.length && aa.every(([key, value]) => Object.hasOwn(b, key) && sameValue(value, (b as Record<string, unknown>)[key]));
  }
  return false;
}
export function atPath(definition: unknown, path: readonly (string | number)[]): unknown {
  let value = definition;
  for (const key of path) value = value && typeof value === 'object' ? (value as Record<string | number, unknown>)[key] : undefined;
  return value;
}
export function itemKey(value: unknown, collection: string): string | null {
  const key = atPath(value, [collection === 'fields' ? 'key' : 'id']);
  return typeof key === 'string' && key ? key : null;
}
function objects(definition: DraftDocument, collection: Target['collection']): Map<string, unknown> {
  const values = atPath(definition, collectionPaths[collection]);
  if (!Array.isArray(values)) throw new Error(`请先修复 ${collection} 的列表结构`);
  const result = new Map<string, unknown>();
  for (const value of values) {
    const key = itemKey(value, collection);
    if (!key || result.has(key)) throw new Error(`请先修复 ${collection} 的缺失或重复标识`);
    if (collection === 'fields') {
      const initial = atPath(definition, ['initial_state', 'values']);
      result.set(key, { declaration: value, initial: initial && typeof initial === 'object' && Object.hasOwn(initial, key)
        ? { present: true, value: (initial as Record<string, unknown>)[key] } : { present: false } });
    } else result.set(key, value);
  }
  return result;
}
export function proposalChanges(before: DraftDocument, after: DraftDocument): ProposalChange[] {
  const result: ProposalChange[] = [];
  const add = (target: Target, operation: ProposalChange['operation'], previous: unknown, next: unknown) => {
    result.push({ change_id: `change_${result.length + 1}`, target, operation, before: previous ?? null, after: next ?? null });
  };
  for (const collection of Object.keys(collectionPaths) as Target['collection'][]) {
    if (singletonCollections.includes(collection)) {
      const previous = before[collection], next = after[collection];
      if (!sameValue(previous, next)) add({ collection, key: null }, previous === undefined ? 'add' : next === undefined ? 'delete' : 'update', previous, next);
      continue;
    }
    const previous = objects(before, collection), next = objects(after, collection);
    for (const [key, value] of previous) {
      if (!next.has(key)) add({ collection, key }, 'delete', value, null);
      else if (!sameValue(value, next.get(key))) add({ collection, key }, 'update', value, next.get(key));
    }
    for (const [key, value] of next) if (!previous.has(key)) add({ collection, key }, 'add', null, value);
    // Appending additions preserves the original relative order without requiring a reorder operation.
    const expected = [...previous.keys()].filter(key => next.has(key)).concat([...next.keys()].filter(key => !previous.has(key)));
    if (!sameValue(expected, [...next.keys()])) add({ collection, key: null }, 'reorder', [...previous.keys()], [...next.keys()]);
  }
  return result;
}
export function checkScope(before: DraftDocument, after: DraftDocument, scope: { mode: 'extend' | 'revise'; targets: Target[] }): void {
  if (atPath(before, ['metadata', 'id']) !== atPath(after, ['metadata', 'id'])) throw new Error('已有剧本标识不可改变');
  for (const change of proposalChanges(before, after)) {
    if (change.operation === 'add' && change.target.key !== null) continue;
    if (scope.mode === 'revise' && scope.targets.some(t => t.collection === change.target.collection && t.key === change.target.key)) continue;
    // New NPC configuration is the sole permitted update to the simulation singleton in extend mode.
    if (change.target.collection === 'simulation') {
      const oldSimulation = atPath(before, ['simulation']) as Record<string, unknown>;
      const newSimulation = atPath(after, ['simulation']) as Record<string, unknown>;
      const oldIds = objects(before, 'characters'), newIds = objects(after, 'characters');
      const appended = [...newIds.keys()].filter(id => !oldIds.has(id));
      const oldOrder = oldSimulation?.npc_order, newOrder = newSimulation?.npc_order;
      const oldActions = oldSimulation?.npc_actions, newActions = newSimulation?.npc_actions;
      if (Array.isArray(oldOrder) && Array.isArray(newOrder) && oldActions && newActions && typeof oldActions === 'object' && typeof newActions === 'object' &&
        sameValue(oldOrder, newOrder.slice(0, oldOrder.length)) && newOrder.slice(oldOrder.length).every(id => appended.includes(id as string)) &&
        Object.entries(oldActions).every(([id, value]) => sameValue(value, (newActions as Record<string, unknown>)[id])) &&
        Object.keys(newActions).every(id => Object.hasOwn(oldActions, id) || appended.includes(id)) &&
        sameValue({ ...oldSimulation, npc_order: null, npc_actions: null }, { ...newSimulation, npc_order: null, npc_actions: null })) continue;
    }
    throw new Error(`生成改动超出选定范围：${change.target.collection}/${change.target.key ?? ''}`);
  }
}
// References used for grouping are conservative: connected changes form an atomic group.
function strings(value: unknown): Set<string> {
  const result = new Set<string>(), pending = [value];
  while (pending.length) {
    const item = pending.pop();
    if (typeof item === 'string') result.add(item);
    else if (item && typeof item === 'object') for (const [key, child] of Object.entries(item)) { result.add(key); pending.push(child); }
  }
  return result;
}
export function proposalGroups(changes: ProposalChange[]): DetailProposal['groups'] {
  const parents = changes.map((_, i) => i);
  const root = (index: number): number => parents[index] === index ? index : root(parents[index]!);
  const references = changes.map(c => strings([c.before, c.after]));
  for (let i = 0; i < changes.length; i++) for (let j = 0; j < i; j++) {
    const a = changes[i]!, b = changes[j]!;
    if (a.target.collection === b.target.collection && (a.target.key === null || b.target.key === null) ||
      a.target.key !== null && references[j]!.has(a.target.key) || b.target.key !== null && references[i]!.has(b.target.key)) parents[root(i)] = root(j);
  }
  const groups = new Map<number, DetailProposal['groups'][number]>();
  changes.forEach((change, index) => {
    const key = root(index);
    if (!groups.has(key)) groups.set(key, { group_id: `group_${key + 1}`, label: `${change.target.collection} 关联改动`, change_ids: [], requires: [] });
    groups.get(key)!.change_ids.push(change.change_id);
  });
  return [...groups.values()];
}
export function applyProposal(definition: DraftDocument, proposal: DetailProposal, selected: string[]): DraftDocument {
  const result = JSON.parse(JSON.stringify(definition)) as DraftDocument;
  const selectedGroups = new Set(selected);
  for (const group of proposal.groups) if (selectedGroups.has(group.group_id)) for (const requirement of group.requires) {
    if (!selectedGroups.has(requirement)) throw new Error('请同时选择依赖组');
  }
  const ids = new Set(proposal.groups.filter(g => selectedGroups.has(g.group_id)).flatMap(g => g.change_ids));
  const write = (path: string[], value: unknown) => {
    let parent = result;
    for (const key of path.slice(0, -1)) {
      if (!parent[key] || typeof parent[key] !== 'object' || Array.isArray(parent[key])) parent[key] = {};
      parent = parent[key] as DraftDocument;
    }
    parent[path.at(-1)!] = value;
  };
  const chosen = proposal.changes.filter(c => ids.has(c.change_id));
  for (const change of chosen.filter(c => c.operation !== 'reorder')) {
    const path = collectionPaths[change.target.collection];
    if (singletonCollections.includes(change.target.collection)) { write(path, change.after); continue; }
    const list = atPath(result, path) as unknown[];
    const index = list.findIndex(value => itemKey(value, change.target.collection) === change.target.key);
    const value = change.target.collection === 'fields' ? (change.after as { declaration: unknown } | null)?.declaration : change.after;
    if (change.operation === 'delete') list.splice(index, 1);
    else if (change.operation === 'add') list.push(value);
    else list[index] = value;
    if (change.target.collection === 'fields') {
      const values = atPath(result, ['initial_state', 'values']) as DraftDocument;
      const initial = (change.after as { initial: { present: boolean; value?: unknown } } | null)?.initial;
      if (initial?.present) values[change.target.key!] = initial.value;
      else delete values[change.target.key!];
    }
  }
  for (const change of chosen.filter(c => c.operation === 'reorder')) {
    const path = collectionPaths[change.target.collection], list = atPath(result, path) as unknown[];
    write(path, (change.after as string[]).map(key => list.find(value => itemKey(value, change.target.collection) === key)));
  }
  return result;
}
