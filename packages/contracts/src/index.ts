import { z } from 'zod';
export * from './authoring.js';
export * from './references.js';
export * from './partial-shape.js';
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
export interface Issue { severity: 'error'; definition_path: string; message: string; object_id?: string }
export interface Change { field: string; before: Scalar; after: Scalar }
export interface Decision {
  kind: 'action' | 'event' | 'objective';
  id: string; actor_id: string | null; accepted: boolean; reason: string;
  audience: Audience; changes: Change[];
}
export interface TurnRecord { turn: number; decisions: Decision[] }
export interface PlayerTurn {
  turn: number;
  decisions: { kind: Decision['kind']; id: string; name: string; actor_id: string | null; actor_name: string | null; changes: Change[] }[];
}
export interface PlayerView {
  scenario_id: string; name: string; turn: number; status: 'active' | 'success' | 'failure'; opening: string;
  fields: { key: string; label: string; type: Field['type']; value: Scalar; unit: string | null }[];
  memories: { id: string; text: string }[];
  records: PlayerTurn[]; history: PlayerTurn[]; entities: { id: string; name: string }[];
  ending: { id: string; name: string; outcome: 'success' | 'failure' } | null;
  actions: { id: string; name: string; description: string; parameters: Record<string, Parameter> }[];
}
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

export const checkpointSchema = worldSchema.extend({
  scenario_id: id, known_records: z.record(id, z.array(z.string().min(1))),
  turns: z.array(worldSchema.shape.turns.element.extend({
    session_id: requestIdText(), request_id: requestIdText(),
    input: z.strictObject({ action_id: id, parameters: z.record(id, scalarSchema) }),
  })),
});
function requestIdText() { return z.string().min(1).max(120); }
export type Checkpoint = z.infer<typeof checkpointSchema>;

export type DraftDocument = Record<string, unknown>;
export const requestIdSchema = z.string().min(1).max(120);
export const revisionSchema = safeInteger.nonnegative();
export const createDraftSchema = z.strictObject({
  name: z.string().min(1).max(120), request_id: requestIdSchema,
  source: z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('blank') }),
    z.strictObject({ type: z.literal('template'), template_id: requestIdSchema }),
    z.strictObject({ type: z.literal('release'), release_id: requestIdSchema }),
  ]),
});
export const saveDraftSchema = z.strictObject({ 'document': draftSchema, expected_revision: revisionSchema, request_id: requestIdSchema });
export const importDraftSchema = z.strictObject({ 'document': draftSchema, request_id: requestIdSchema });
export const atRevisionSchema = z.strictObject({ expected_revision: revisionSchema });
export const createAtRevisionSchema = atRevisionSchema.extend({ request_id: requestIdSchema });
export const createWorldSchema = z.union([
  z.strictObject({ release_id: requestIdSchema, request_id: requestIdSchema }),
  z.strictObject({ template_id: id, request_id: requestIdSchema }),
]);
export const turnInputSchema = z.strictObject({ action_id: id, parameters: z.record(id, scalarSchema), expected_revision: revisionSchema, request_id: requestIdSchema });
export const saveGameSchema = createAtRevisionSchema.extend({ name: z.string().min(1).max(120) });
export const restoreSaveSchema = z.strictObject({ request_id: requestIdSchema });
export interface DraftSummary { draft_id: string; name: string; revision: number; updated_at: string }
export interface DraftView extends DraftSummary { 'document': DraftDocument }
export interface ReleaseSummary { release_id: string; name: string; source_revision: number; created_at: string }
export interface ReleaseView extends ReleaseSummary { definition: Scenario }
export interface Validation { valid: boolean; issues: Issue[] }
export const collectionSchema = z.enum(['metadata', 'world', 'player', 'narrative', 'simulation', 'characters', 'factions', 'locations', 'fields', 'memories', 'actions', 'events', 'objectives']);
export const targetSchema = z.strictObject({ collection: collectionSchema, key: id.nullable() });
export type Target = z.infer<typeof targetSchema>;
export const outlineSchema = z.strictObject({
  kind: z.literal('outline'), premise: text, player: text, characters: z.array(text), conflicts: z.array(text),
  event_directions: z.array(text), gameplay: z.array(text), ending_directions: z.array(text),
});
export type OutlineProposal = z.infer<typeof outlineSchema>;
export interface ProposalChange { change_id: string; target: Target; operation: 'add' | 'update' | 'delete' | 'reorder'; before: unknown; after: unknown }
export interface ProposalGroup { group_id: string; label: string; change_ids: string[]; requires: string[] }
export interface DetailProposal { kind: 'detail'; 'document': DraftDocument; changes: ProposalChange[]; groups: ProposalGroup[]; validation: Validation }
const detailSchema = z.strictObject({ kind: z.literal('detail'), 'document': draftSchema,
  changes: z.array(z.strictObject({ change_id: id, target: targetSchema, operation: z.enum(['add', 'update', 'delete', 'reorder']), before: z.unknown(), after: z.unknown() })),
  groups: z.array(z.strictObject({ group_id: id, label: text, change_ids: z.array(id), requires: z.array(id) })),
  validation: z.strictObject({ valid: z.boolean(), issues: z.array(z.strictObject({ severity: z.literal('error'), definition_path: text, message: text, object_id: id.optional() })) }),
});
export const generationInputSchema = z.strictObject({
  generation_id: requestIdSchema, expected_revision: revisionSchema, workspace_id: requestIdSchema,
  content_version: revisionSchema, proposal_version: revisionSchema, stage: z.enum(['outline', 'detail', 'revise']),
  instruction: z.string().refine(value => value.trim().length > 0 && [...value].length <= 8000, '描述需要 1–8000 个字符'),
  'document': draftSchema, proposal: z.union([outlineSchema, detailSchema]).nullable(),
  edit_scope: z.strictObject({ mode: z.enum(['extend', 'revise']), targets: z.array(targetSchema) }),
}).superRefine((value, context) => {
  if (value.stage === 'detail' && value.proposal?.kind !== 'outline' || value.stage === 'outline' && value.proposal?.kind === 'detail' ||
    value.stage === 'revise' && value.proposal?.kind === 'outline') context.addIssue({ code: 'custom', message: '生成阶段与候选类型不匹配' });
  if (value.edit_scope.mode === 'extend' ? value.edit_scope.targets.length !== 0 : value.edit_scope.targets.length === 0) {
    context.addIssue({ code: 'custom', message: '请选择此次改写范围' });
  }
});
export type GenerationInput = z.infer<typeof generationInputSchema>;
export interface GenerationResult {
  source: Pick<GenerationInput, 'generation_id' | 'expected_revision' | 'workspace_id' | 'content_version' | 'proposal_version'> & {
    draft_id: string; document_digest: string; proposal_digest: string;
  };
  candidate_id: string; candidate: OutlineProposal | DetailProposal; assumptions: string[]; questions: string[];
  usage: { input_tokens: number | null; output_tokens: number | null };
}
export function emptyScenario(name: string, scenarioId: string): Scenario {
  return { metadata: { id: scenarioId, name, description: '' }, world: { background: '', start_time: '', turn_unit: '', constraints: [] },
    entities: { characters: [], factions: [], locations: [] }, player: { character_id: '' }, state_schema: [],
    initial_state: { values: {}, memories: [] }, actions: [], simulation: { npc_order: [], npc_actions: {}, memory_recent_turns: 5 },
    events: [], objectives: [], narrative: { opening: '', style: '', perspective: '' } };
}
export function draftWithinLimits(input: unknown): boolean {
  const pending = [{ value: input, depth: 0 }]; let nodes = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (++nodes > 20000 || item.depth > 48) return false;
    if (item.value && typeof item.value === 'object') {
      for (const [key, value] of Object.entries(item.value)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) return false;
        pending.push({ value, depth: item.depth + 1 });
      }
    }
  }
  return true;
}
