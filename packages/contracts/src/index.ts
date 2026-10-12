import { z } from 'zod';
export { credentialsSchema, userSummarySchema } from './auth.js';
export type { UserSummary, IdentityChange } from './auth.js';

export const safeInteger = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const id = z.string().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/).refine(value => !['__proto__', 'constructor', 'prototype'].includes(value), '保留标识不可使用');
const text = z.string();
export const scalarSchema = z.union([safeInteger, z.boolean(), text]);
export const audienceSchema = z.union([z.literal('public'), z.array(id).min(1)]);
const integer = z.strictObject({ type: z.literal('integer'), min: safeInteger, max: safeInteger });
const boolean = z.strictObject({ type: z.literal('boolean') });
const string = z.strictObject({ type: z.literal('string') });
const entity = z.strictObject({ type: z.literal('entity_ref'), allowed_entity_ids: z.array(id).min(1) });
export const parameterSchema = z.discriminatedUnion('type', [integer, boolean, string, entity]);
const fieldBase = { key: id, label: text, owner_id: id.nullable(), visibility: audienceSchema };
export const fieldSchema = z.discriminatedUnion('type', [
  integer.extend({ ...fieldBase, unit: text.nullable() }),
  boolean.extend(fieldBase), string.extend(fieldBase), entity.extend(fieldBase),
]);
export const operandSchema = z.union([
  z.strictObject({ literal: scalarSchema }), z.strictObject({ field: id }),
  z.strictObject({ parameter: id }), z.strictObject({ turn: z.literal(true) }),
]);
export type Scalar = z.infer<typeof scalarSchema>;
export type Operand = z.infer<typeof operandSchema>;
export type Condition = { all: Condition[] } | { any: Condition[] } | { not: Condition } |
  { operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte'; left: Operand; right: Operand };
export const conditionSchema: z.ZodType<Condition> = z.lazy(() => z.union([
  z.strictObject({ all: z.array(conditionSchema) }),
  z.strictObject({ any: z.array(conditionSchema) }),
  z.strictObject({ not: conditionSchema }),
  z.strictObject({ operator: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte']), left: operandSchema, right: operandSchema }),
]));
export const effectSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('add'), field: id, value: operandSchema }),
  z.strictObject({ type: z.literal('set'), field: id, value: operandSchema }),
  z.strictObject({ type: z.literal('transfer'), from_field: id, to_field: id, amount: operandSchema }),
]);
export const actionSchema = z.strictObject({
  id, name: text, description: text, allowed_actor_ids: z.array(id).min(1),
  parameters: z.record(id, parameterSchema), conditions: conditionSchema,
  effects: z.array(effectSchema), visibility: audienceSchema,
});
const character = z.strictObject({
  id, name: text, description: text, faction_id: id.nullable(), personality: z.array(text),
  goals: z.array(text), relationships: z.array(z.strictObject({ target_id: id, description: text })),
});
const memory = z.strictObject({ id, text, audience: audienceSchema });
export const scenarioSchema = z.strictObject({
  metadata: z.strictObject({ id, name: z.string().min(1), description: text }),
  world: z.strictObject({ background: text, start_time: text, turn_unit: text, constraints: z.array(text) }),
  entities: z.strictObject({
    characters: z.array(character).min(1),
    factions: z.array(z.strictObject({ id, name: text, description: text, goals: z.array(text) })),
    locations: z.array(z.strictObject({ id, name: text, description: text })),
  }),
  player: z.strictObject({ character_id: id }),
  state_schema: z.array(fieldSchema),
  initial_state: z.strictObject({ values: z.record(id, scalarSchema), memories: z.array(memory) }),
  actions: z.array(actionSchema).min(1),
  simulation: z.strictObject({
    npc_order: z.array(id),
    npc_actions: z.record(id, z.array(z.strictObject({ action_id: id, parameters: z.record(id, scalarSchema) }))),
    memory_recent_turns: safeInteger.nonnegative(),
  }),
  events: z.array(z.strictObject({
    id, name: text, conditions: conditionSchema, effects: z.array(effectSchema),
    repeatable: z.boolean(), visibility: audienceSchema,
  })),
  objectives: z.array(z.strictObject({
    id, name: text, outcome: z.enum(['success', 'failure']), priority: safeInteger,
    conditions: conditionSchema, visibility: audienceSchema,
  })).min(1),
  narrative: z.strictObject({ opening: text, style: text, perspective: text }),
});
// Drafts may be incomplete; platform identity and world payloads are never DSL fields.
export const draftSchema = z.record(z.string(), z.unknown()).superRefine((value, ctx) => {
  const allowed = new Set(Object.keys(scenarioSchema.shape));
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) ctx.addIssue({ code: 'custom', path: [key], message: '未知剧本顶层字段' });
  }
});
export type Scenario = z.infer<typeof scenarioSchema>;
export type Field = z.infer<typeof fieldSchema>;
export type Parameter = z.infer<typeof parameterSchema>;
export type Effect = z.infer<typeof effectSchema>;
export type Action = z.infer<typeof actionSchema>;
export type Audience = z.infer<typeof audienceSchema>;
export interface Issue { severity: 'error'; definition_path: string; message: string }
export interface Change { field: string; before: Scalar; after: Scalar }
export interface Decision {
  kind: 'action' | 'event' | 'objective';
  id: string; actor_id: string | null; accepted: boolean; reason: string;
  audience: Audience; changes: Change[];
}
export interface TurnRecord { turn: number; decisions: Decision[] }
export interface World {
  schemaVersion: 1; scenario_snapshot: Scenario; turn: number;
  status: 'active' | 'success' | 'failure'; values: Record<string, Scalar>;
  fired_events: string[]; terminal_objective_id: string | null; turns: TurnRecord[];
}
export const CURRENT_SCHEMA_VERSION = 1;
export const worldSchema = z.strictObject({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION), scenario_snapshot: scenarioSchema,
  turn: safeInteger.nonnegative(), status: z.enum(['active', 'success', 'failure']),
  values: z.record(id, scalarSchema), fired_events: z.array(id), terminal_objective_id: id.nullable(),
  turns: z.array(z.strictObject({
    turn: safeInteger.positive(),
    decisions: z.array(z.strictObject({
      kind: z.enum(['action', 'event', 'objective']), id, actor_id: id.nullable(),
      accepted: z.boolean(), reason: text, audience: audienceSchema,
      changes: z.array(z.strictObject({ field: id, before: scalarSchema, after: scalarSchema })),
    })),
  })),
});
