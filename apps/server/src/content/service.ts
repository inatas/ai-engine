import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createDraftSchema, importDraftSchema, saveDraftSchema, atRevisionSchema, createAtRevisionSchema,
  draftWithinLimits, emptyScenario, type DraftView, type ReleaseView, type Validation, type Scenario } from '@ai-engine/contracts';
import { validateScenario } from '@ai-engine/engine';
import type { PrismaClient, ScenarioDraft, ScenarioRelease } from '../generated/prisma/client.js';
import { ApiError } from '../auth/errors.js';
import { asJson, businessWrite, conflict, lockDraft, revisionNumber, unavailable } from './transactions.js';
import type { WorldService } from '../world/service.js';

const templateFiles = new Map([['ming-crisis', 'ming-crisis.json'], ['station-repair', 'station-repair.json']]);
export async function loadTemplate(id: string): Promise<Scenario> {
  const filename = templateFiles.get(id);
  if (!filename) unavailable();
  const value: unknown = JSON.parse(await readFile(fileURLToPath(new URL(`../../../../scenarios/${filename}`, import.meta.url)), 'utf8'));
  const result = validateScenario(value);
  if (!result.definition) throw new ApiError(500, 'internal_error', '模板无效');
  return result.definition;
}
export function parseInput<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: unknown[] } } }, body: unknown): T {
  if (!draftWithinLimits(body)) throw new ApiError(422, 'invalid_request', '内容过深、过大或包含保留属性');
  const result = schema.safeParse(body);
  if (!result.success) throw new ApiError(422, 'invalid_request', '输入不符合要求', undefined, result.error.issues);
  return result.data;
}
export function definitionValidation(document: unknown): Validation {
  const result = validateScenario(document);
  return { valid: result.valid, issues: result.issues };
}
function draftView(row: ScenarioDraft): DraftView {
  return { draft_id: row.id, name: row.name, revision: revisionNumber(row.revision), updated_at: row.updatedAt.toISOString(),
    document: row.document as Record<string, unknown> };
}
function releaseView(row: ScenarioRelease): ReleaseView {
  return { release_id: row.id, name: row.name, source_revision: revisionNumber(row.sourceRevision), created_at: row.createdAt.toISOString(),
    definition: row.definition as unknown as Scenario };
}
export function page(query: { offset?: string; limit?: string }) {
  const offset = query.offset === undefined ? 0 : Number(query.offset), limit = query.limit === undefined ? 20 : Number(query.limit);
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new ApiError(422, 'invalid_request', '分页参数无效');
  }
  return { skip: offset, take: limit };
}
export class ContentService {
  constructor(private database: PrismaClient, private worlds: WorldService) {}
  async templates(query: { offset?: string; limit?: string }) {
    const { skip, take } = page(query);
    return Promise.all([...templateFiles.keys()].slice(skip, skip + take).map(async template_id => {
      const definition = await loadTemplate(template_id);
      return { template_id, name: definition.metadata.name, description: definition.metadata.description };
    }));
  }
  async ownedDraft(owner: string, id: string) {
    const row = await this.database.scenarioDraft.findFirst({ where: { id, ownerUserId: owner } });
    if (!row) unavailable();
    return row;
  }
  async ownedRelease(owner: string, id: string) {
    const row = await this.database.scenarioRelease.findFirst({ where: { id, ownerUserId: owner } });
    if (!row) unavailable();
    return row;
  }
  async drafts(owner: string, query: { offset?: string; limit?: string }) {
    const rows = await this.database.scenarioDraft.findMany({ where: { ownerUserId: owner }, ...page(query), orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }] });
    return rows.map(row => { const { document: _document, ...summary } = draftView(row); return summary; });
  }
  async getDraft(owner: string, id: string) { return draftView(await this.ownedDraft(owner, id)); }
  async create(owner: string, body: unknown) {
    const input = parseInput(createDraftSchema, body);
    const source = input.source.type === 'release' ? (await this.ownedRelease(owner, input.source.release_id)).definition :
      input.source.type === 'template' ? await loadTemplate(input.source.template_id) : null;
    return businessWrite(this.database, owner, 'draft-create', '', input.request_id, input, async tx => {
      const document = source ? { ...(source as unknown as Scenario), metadata: { ...(source as unknown as Scenario).metadata, name: input.name } } : emptyScenario(input.name, randomUUID());
      return draftView(await tx.scenarioDraft.create({ data: { ownerUserId: owner, name: input.name, document: asJson(document) } }));
    });
  }
  async import(owner: string, body: unknown) {
    const input = parseInput(importDraftSchema, body);
    return businessWrite(this.database, owner, 'draft-import', '', input.request_id, input, async tx => {
      const metadata = input.document.metadata as { name?: unknown } | undefined;
      const name = typeof metadata?.name === 'string' && metadata.name.trim() ? metadata.name.slice(0, 120) : '导入草稿';
      const row = await tx.scenarioDraft.create({ data: { ownerUserId: owner, name, document: asJson(input.document) } });
      return { ...draftView(row), ...definitionValidation(input.document) };
    });
  }
  async save(owner: string, id: string, body: unknown) {
    const input = parseInput(saveDraftSchema, body);
    await this.ownedDraft(owner, id);
    return businessWrite(this.database, owner, 'draft-save', id, input.request_id, input, async tx => {
      const previous = await lockDraft(tx, owner, id);
      if (previous.revision !== BigInt(input.expected_revision)) conflict(previous.revision);
      if (previous.revision >= BigInt(Number.MAX_SAFE_INTEGER)) throw new ApiError(409, 'revision_conflict', '修订达到上限');
      const metadata = input.document.metadata as { name?: unknown } | undefined;
      const updated = await tx.scenarioDraft.updateMany({ where: { id, ownerUserId: owner, revision: BigInt(input.expected_revision) }, data: { document: asJson(input.document), revision: { increment: 1 },
        ...(typeof metadata?.name === 'string' && metadata.name.trim() ? { name: metadata.name.slice(0, 120) } : {}) } });
      if (updated.count !== 1) conflict(previous.revision);
      return draftView(await tx.scenarioDraft.findUniqueOrThrow({ where: { id } }));
    });
  }
  async validate(owner: string, id: string, body: unknown) {
    const input = parseInput(atRevisionSchema, body), row = await this.ownedDraft(owner, id);
    if (row.revision !== BigInt(input.expected_revision)) conflict(row.revision);
    return definitionValidation(row.document);
  }
  async export(owner: string, id: string, revision: string | undefined) {
    return this.database.$transaction(async tx => {
      const row = await lockDraft(tx, owner, id);
      const input = parseInput(atRevisionSchema, { expected_revision: revision === undefined ? -1 : Number(revision) });
      if (row.revision !== BigInt(input.expected_revision)) conflict(row.revision);
      return { document: row.document, ...definitionValidation(row.document) };
    });
  }
  async publish(owner: string, id: string, body: unknown) {
    const input = parseInput(createAtRevisionSchema, body);
    await this.ownedDraft(owner, id);
    return businessWrite(this.database, owner, 'draft-release', id, input.request_id, input, async tx => {
      const draft = await lockDraft(tx, owner, id);
      if (draft.revision !== BigInt(input.expected_revision)) conflict(draft.revision);
      const result = validateScenario(draft.document);
      if (!result.definition) throw new ApiError(422, 'invalid_definition', '请先修复剧本问题', undefined, result.issues);
      const row = await tx.scenarioRelease.create({ data: { ownerUserId: owner, sourceDraftId: id, sourceRevision: draft.revision,
        name: result.definition.metadata.name, definition: asJson(result.definition) } });
      return releaseView(row);
    });
  }
  async preview(owner: string, id: string, body: unknown) {
    const input = parseInput(createAtRevisionSchema, body);
    await this.ownedDraft(owner, id);
    return businessWrite(this.database, owner, 'draft-preview', id, input.request_id, input, async tx => {
      const draft = await lockDraft(tx, owner, id);
      if (draft.revision !== BigInt(input.expected_revision)) conflict(draft.revision);
      const result = validateScenario(draft.document);
      if (!result.definition) throw new ApiError(422, 'invalid_definition', '请先修复剧本问题', undefined, result.issues);
      return this.worlds.initialize(tx, owner, result.definition, 'preview', { draft_id: id, revision: input.expected_revision });
    });
  }
  async releases(owner: string, query: { offset?: string; limit?: string }) {
    const rows = await this.database.scenarioRelease.findMany({ where: { ownerUserId: owner }, ...page(query), orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] });
    return rows.map(row => { const { definition: _definition, ...summary } = releaseView(row); return summary; });
  }
  async getRelease(owner: string, id: string) { return releaseView(await this.ownedRelease(owner, id)); }
}
