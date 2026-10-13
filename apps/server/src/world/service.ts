import { checkpointSchema, createWorldSchema, turnInputSchema, saveGameSchema, restoreSaveSchema, CURRENT_SCHEMA_VERSION, draftWithinLimits,
  type Checkpoint, type Scenario, type World } from '@ai-engine/contracts';
import { advanceWorld, initializeWorld, playerView, RuleError, validateWorld } from '@ai-engine/engine';
import type { PrismaClient, Prisma, WorldSession } from '../generated/prisma/client.js';
import { ApiError } from '../auth/errors.js';
import { asJson, businessWrite, conflict, revisionNumber, unavailable, canonical } from '../content/transactions.js';
import { loadTemplate, page, parseInput } from '../content/service.js';

function core(payload: Checkpoint): World {
  return { schemaVersion: CURRENT_SCHEMA_VERSION, scenario_snapshot: payload.scenario_snapshot,
    turn: payload.turn, status: payload.status, values: payload.values, fired_events: payload.fired_events,
    terminal_objective_id: payload.terminal_objective_id,
    turns: payload.turns.map(({ turn, decisions }) => ({ turn, decisions })) };
}
function knowledge(world: World): Record<string, string[]> {
  return Object.fromEntries(world.scenario_snapshot.entities.characters.map(character => {
    const knows = (audience: 'public' | string[]) => audience === 'public' || audience.includes(character.id);
    return [character.id, [
      ...world.scenario_snapshot.initial_state.memories.filter(m => knows(m.audience)).map(m => `initial:${m.id}`),
      ...world.turns.flatMap(t => t.decisions.flatMap((d, index) => d.accepted && knows(d.audience) ? [`turn:${t.turn}:${index}`] : [])),
    ]];
  }));
}
export function decodeCheckpoint(payload: unknown, columnVersion: bigint): Checkpoint {
  const version = payload && typeof payload === 'object' ? (payload as { schemaVersion?: unknown }).schemaVersion : undefined;
  if (!Number.isSafeInteger(version) || typeof version !== 'number' || version < 1 || columnVersion < 1n) {
    throw new ApiError(422, 'checkpoint_version_unsupported', '此存档已无法使用，请开始新游戏');
  }
  if (BigInt(version) !== columnVersion) throw new ApiError(500, 'checkpoint_invalid', '存档读取失败');
  if (version !== CURRENT_SCHEMA_VERSION) throw new ApiError(422, 'checkpoint_version_unsupported', '此存档已无法使用，请开始新游戏');
  if (!draftWithinLimits((payload as { scenario_snapshot?: unknown }).scenario_snapshot)) {
    throw new ApiError(500, 'checkpoint_invalid', '存档读取失败');
  }
  const parsed = checkpointSchema.safeParse(payload);
  if (!parsed.success || !validateWorld(core(parsed.data)) || parsed.data.scenario_id !== parsed.data.scenario_snapshot.metadata.id) {
    throw new ApiError(500, 'checkpoint_invalid', '存档读取失败');
  }
  const value = parsed.data;
  if (canonical(knowledge(core(value))) !== canonical(value.known_records) || value.turns.some(t => {
    const first = t.decisions[0];
    return first?.actor_id !== value.scenario_snapshot.player.character_id || first.id !== t.input.action_id || !first.accepted;
  })) throw new ApiError(500, 'checkpoint_invalid', '存档读取失败');
  try {
    let replay = initializeWorld(value.scenario_snapshot);
    for (const turn of value.turns) replay = advanceWorld(replay, turn.input.action_id, turn.input.parameters);
    if (canonical(replay) !== canonical(core(value))) throw new Error('checkpoint differs from its recorded inputs');
  } catch { throw new ApiError(500, 'checkpoint_invalid', '存档读取失败'); }
  return value;
}
export class WorldService {
  constructor(private database: PrismaClient) {}
  private view(row: WorldSession, payload: Checkpoint) {
    return { ...playerView(core(payload)), session_id: row.id, mode: row.mode, revision: revisionNumber(row.revision) };
  }
  async owned(owner: string, id: string) {
    const row = await this.database.worldSession.findFirst({ where: { id, ownerUserId: owner } });
    if (!row) unavailable();
    return row;
  }
  decode(row: WorldSession): Checkpoint {
    const payload = decodeCheckpoint(row.payload, row.schemaVersion);
    if (row.turn !== BigInt(payload.turn) || row.status !== payload.status || row.name !== payload.scenario_snapshot.metadata.name || !['preview', 'play'].includes(row.mode)) {
      throw new ApiError(500, 'checkpoint_invalid', '世界读取失败');
    }
    return payload;
  }
  async initialize(tx: Prisma.TransactionClient, owner: string, definition: Scenario, mode: 'preview' | 'play', source?: unknown) {
    const world = initializeWorld(definition);
    const payload: Checkpoint = { ...world, scenario_id: definition.metadata.id, known_records: knowledge(world), turns: [] };
    const row = await tx.worldSession.create({ data: { ownerUserId: owner, mode, name: definition.metadata.name,
      schemaVersion: BigInt(CURRENT_SCHEMA_VERSION), turn: 0n, status: 'active', payload: asJson(payload) } });
    return { ...this.view(row, payload), ...(source === undefined ? {} : { source }) };
  }
  async create(owner: string, body: unknown) {
    const input = parseInput(createWorldSchema, body);
    if ('template_id' in input) {
      const definition = await loadTemplate(input.template_id);
      return businessWrite(this.database, owner, 'world-create', `template:${input.template_id}`, input.request_id, input,
        tx => this.initialize(tx, owner, definition, 'play'));
    }
    const release = await this.database.scenarioRelease.findFirst({ where: { id: input.release_id, ownerUserId: owner } });
    if (!release) unavailable();
    return businessWrite(this.database, owner, 'world-create', release.id, input.request_id, input,
      tx => this.initialize(tx, owner, release.definition as unknown as Scenario, 'play'));
  }
  async list(owner: string, query: { offset?: string; limit?: string; mode?: string }) {
    const mode = query.mode ?? 'play';
    if (!['play', 'preview'].includes(mode)) throw new ApiError(422, 'invalid_request', '模式无效');
    const rows = await this.database.worldSession.findMany({ where: { ownerUserId: owner, mode }, ...page(query), orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      select: { id: true, name: true, mode: true, turn: true, revision: true, status: true, schemaVersion: true, updatedAt: true } });
    return rows.map(row => ({ session_id: row.id, name: row.name, mode: row.mode, turn: revisionNumber(row.turn),
      revision: revisionNumber(row.revision), status: row.status, schemaVersion: revisionNumber(row.schemaVersion),
      loadable: row.schemaVersion === BigInt(CURRENT_SCHEMA_VERSION), updated_at: row.updatedAt.toISOString() }));
  }
  async get(owner: string, id: string) { const row = await this.owned(owner, id); return this.view(row, this.decode(row)); }
  async debug(owner: string, id: string) {
    const row = await this.owned(owner, id), payload = this.decode(row);
    if (row.mode !== 'preview') throw new ApiError(403, 'operation_forbidden', '只有作者试玩可以查看内部轨迹');
    return { session_id: id, revision: revisionNumber(row.revision), payload };
  }
  async turn(owner: string, id: string, body: unknown) {
    const input = parseInput(turnInputSchema, body);
    this.decode(await this.owned(owner, id));
    return businessWrite(this.database, owner, 'world-turn', id, input.request_id, input, async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${canonical(['world', owner, id])}, 0))`;
      const row = await tx.worldSession.findFirst({ where: { id, ownerUserId: owner } });
      if (!row) unavailable();
      const previous = this.decode(row);
      if (row.revision !== BigInt(input.expected_revision)) conflict(row.revision);
      if (previous.status !== 'active') throw new ApiError(409, 'session_finished', '游戏已经结束');
      if (row.revision >= BigInt(Number.MAX_SAFE_INTEGER)) conflict(row.revision);
      let next: World;
      try { next = advanceWorld(core(previous), input.action_id, input.parameters); }
      catch (error) {
        if (!(error instanceof RuleError)) throw error;
        throw new ApiError(422, 'action_rejected', '当前行动无法执行，请检查参数或选择其他行动');
      }
      const payload: Checkpoint = { ...next, scenario_id: previous.scenario_id, known_records: knowledge(next),
        turns: [...previous.turns, { ...next.turns.at(-1)!, session_id: id, request_id: input.request_id,
          input: { action_id: input.action_id, parameters: input.parameters } }] };
      const changed = await tx.worldSession.updateMany({ where: { id, ownerUserId: owner, revision: BigInt(input.expected_revision) }, data: { payload: asJson(payload), revision: { increment: 1 },
        turn: BigInt(next.turn), status: next.status } });
      if (changed.count !== 1) conflict(row.revision);
      const updated = await tx.worldSession.findUniqueOrThrow({ where: { id } });
      return this.view(updated, payload);
    });
  }
  async save(owner: string, id: string, body: unknown) {
    const input = parseInput(saveGameSchema, body);
    this.decode(await this.owned(owner, id));
    return businessWrite(this.database, owner, 'world-save', id, input.request_id, input, async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${canonical(['world', owner, id])}, 0))`;
      const row = await tx.worldSession.findFirst({ where: { id, ownerUserId: owner } });
      if (!row) unavailable();
      const payload = this.decode(row);
      if (row.mode !== 'play') throw new ApiError(403, 'operation_forbidden', '试玩不能创建正式检查点');
      if (row.revision !== BigInt(input.expected_revision)) conflict(row.revision);
      const saved = await tx.saveGame.create({ data: { ownerUserId: owner, sourceSessionId: id, name: input.name,
        scenarioName: payload.scenario_snapshot.metadata.name, schemaVersion: row.schemaVersion, turn: row.turn, status: row.status, checkpoint: asJson(payload) } });
      return this.saveSummary(saved);
    });
  }
  private saveSummary(row: Pick<import('../generated/prisma/client.js').SaveGame, 'id' | 'name' | 'scenarioName' | 'schemaVersion' | 'turn' | 'status' | 'createdAt'>) {
    return { save_id: row.id, name: row.name, scenario_name: row.scenarioName, schemaVersion: revisionNumber(row.schemaVersion),
      turn: revisionNumber(row.turn), status: row.status, created_at: row.createdAt.toISOString(),
      loadable: row.schemaVersion === BigInt(CURRENT_SCHEMA_VERSION) };
  }
  async saves(owner: string, query: { offset?: string; limit?: string }) {
    const rows = await this.database.saveGame.findMany({ where: { ownerUserId: owner }, ...page(query), orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      select: { id: true, name: true, scenarioName: true, schemaVersion: true, turn: true, status: true, createdAt: true } });
    return rows.map(row => this.saveSummary(row));
  }
  private async ownedSave(owner: string, id: string) {
    const row = await this.database.saveGame.findFirst({ where: { id, ownerUserId: owner } });
    if (!row) unavailable();
    return row;
  }
  private decodeSave(row: import('../generated/prisma/client.js').SaveGame) {
    const payload = decodeCheckpoint(row.checkpoint, row.schemaVersion);
    if (row.turn !== BigInt(payload.turn) || row.status !== payload.status || row.scenarioName !== payload.scenario_snapshot.metadata.name) throw new ApiError(500, 'checkpoint_invalid', '检查点读取失败');
    return payload;
  }
  async getSave(owner: string, id: string) {
    const row = await this.ownedSave(owner, id), payload = this.decodeSave(row);
    return { ...playerView(core(payload)), ...this.saveSummary(row) };
  }
  async restore(owner: string, id: string, body: unknown) {
    const input = parseInput(restoreSaveSchema, body), saved = await this.ownedSave(owner, id);
    this.decodeSave(saved);
    return businessWrite(this.database, owner, 'save-restore', id, input.request_id, input, async tx => {
      const payload = this.decodeSave(saved);
      const row = await tx.worldSession.create({ data: { ownerUserId: owner, mode: 'play', name: saved.scenarioName, schemaVersion: saved.schemaVersion,
        turn: saved.turn, status: saved.status, payload: asJson(payload) } });
      return this.view(row, payload);
    });
  }
}
