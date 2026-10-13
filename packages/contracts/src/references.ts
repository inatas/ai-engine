import { atPath, collectionPaths, itemKey } from './authoring.js';
import type { DraftDocument, Target } from './index.js';
export interface Reference { target: Target; path: (string | number)[] }
const rows = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function references(definition: DraftDocument): Reference[] {
  const result: Reference[] = [];
  const entityCollections = ['characters', 'factions', 'locations'] as const;
  const entityType = (key: string): Target['collection'] => entityCollections.find(kind => rows(atPath(definition, collectionPaths[kind])).some(v => itemKey(v, kind) === key)) ?? 'characters';
  const add = (collection: Target['collection'], key: unknown, path: (string | number)[]) => {
    if (typeof key === 'string' && key) result.push({ target: { collection, key }, path });
  };
  const entities = (value: unknown, path: (string | number)[], chars = false) => rows(value).forEach((key, index) => add(chars ? 'characters' : entityType(String(key)), key, [...path, index]));
  const audience = (value: unknown, path: (string | number)[]) => { if (value !== 'public') entities(value, path, true); };
  const operand = (value: unknown, path: (string | number)[]) => { const row = object(value); if (Object.hasOwn(row, 'field')) add('fields', row.field, [...path, 'field']); };
  const condition = (value: unknown, path: (string | number)[], depth = 0) => {
    if (depth > 48) return;
    const row = object(value);
    for (const key of ['all', 'any']) rows(row[key]).forEach((c, index) => condition(c, [...path, key, index], depth + 1));
    if (row.not) condition(row.not, [...path, 'not'], depth + 1);
    operand(row.left, [...path, 'left']); operand(row.right, [...path, 'right']);
  };
  const effects = (value: unknown, path: (string | number)[]) => rows(value).forEach((raw, index) => {
    const row = object(raw), p = [...path, index];
    for (const key of ['field', 'from_field', 'to_field']) add('fields', row[key], [...p, key]);
    operand(row.value, [...p, 'value']); operand(row.amount, [...p, 'amount']);
  });
  const declarations = (value: unknown, path: (string | number)[]) => { const row = object(value); if (row.type === 'entity_ref') entities(row.allowed_entity_ids, [...path, 'allowed_entity_ids']); };
  rows(atPath(definition, ['entities', 'characters'])).forEach((raw, index) => {
    const row = object(raw), p = ['entities', 'characters', index];
    add('factions', row.faction_id, [...p, 'faction_id']);
    rows(row.relationships).forEach((r, i) => add('characters', object(r).target_id, [...p, 'relationships', i, 'target_id']));
  });
  add('characters', atPath(definition, ['player', 'character_id']), ['player', 'character_id']);
  rows(definition.state_schema).forEach((raw, index) => {
    const row = object(raw), p = ['state_schema', index];
    if (typeof row.owner_id === 'string') add(entityType(row.owner_id), row.owner_id, [...p, 'owner_id']);
    declarations(row, p); audience(row.visibility, [...p, 'visibility']);
    if (row.type === 'entity_ref') {
      const value = atPath(definition, ['initial_state', 'values', String(row.key)]);
      if (typeof value === 'string') add(entityType(value), value, ['initial_state', 'values', String(row.key)]);
    }
  });
  for (const key of Object.keys(object(atPath(definition, ['initial_state', 'values'])))) add('fields', key, ['initial_state', 'values', key]);
  rows(atPath(definition, ['initial_state', 'memories'])).forEach((raw, index) => audience(object(raw).audience, ['initial_state', 'memories', index, 'audience']));
  for (const collection of ['actions', 'events', 'objectives']) rows(definition[collection]).forEach((raw, index) => {
    const row = object(raw), p = [collection, index];
    audience(row.visibility, [...p, 'visibility']); condition(row.conditions, [...p, 'conditions']); effects(row.effects, [...p, 'effects']);
    entities(row.allowed_actor_ids, [...p, 'allowed_actor_ids'], true);
    for (const [key, declaration] of Object.entries(object(row.parameters))) declarations(declaration, [...p, 'parameters', key]);
  });
  entities(atPath(definition, ['simulation', 'npc_order']), ['simulation', 'npc_order'], true);
  for (const [id, candidates] of Object.entries(object(atPath(definition, ['simulation', 'npc_actions'])))) {
    add('characters', id, ['simulation', 'npc_actions', id]);
    rows(candidates).forEach((raw, index) => {
      const row = object(raw), p = ['simulation', 'npc_actions', id, index];
      add('actions', row.action_id, [...p, 'action_id']);
      const action = rows(definition.actions).find(a => object(a).id === row.action_id);
      for (const [key, value] of Object.entries(object(row.parameters))) if (atPath(action, ['parameters', key, 'type']) === 'entity_ref' && typeof value === 'string') add(entityType(value), value, [...p, 'parameters', key]);
    });
  }
  return result;
}
export function danglingReferences(definition: DraftDocument): Reference[] {
  return references(definition).filter(reference => !rows(atPath(definition, collectionPaths[reference.target.collection])).some(value => itemKey(value, reference.target.collection) === reference.target.key));
}
