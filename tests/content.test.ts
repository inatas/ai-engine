import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { emptyScenario, type Scenario, type GenerationInput } from '@ai-engine/contracts';
import { createDatabase } from '../apps/server/src/database.js';
import { ContentService } from '../apps/server/src/content/service.js';
import { WorldService } from '../apps/server/src/world/service.js';
import { GenerationService, type AuthorModelConfig, type ModelCall } from '../apps/server/src/content/generation.js';
import { asJson, digest } from '../apps/server/src/content/transactions.js';
import { ApiError } from '../apps/server/src/auth/errors.js';
import { createApp } from '../apps/server/src/app.js';

const schema = new URL(process.env.DATABASE_URL!).searchParams.get('schema');
if (!schema || !/^auth_test_[a-f0-9]{32}$/.test(schema)) throw new Error('业务测试必须使用隔离 schema');
const database = createDatabase(), worlds = new WorldService(database), content = new ContentService(database, worlds);
let owner = '', other = '';
function definition(): Scenario {
  const result = emptyScenario('夜间值班', 'night_watch');
  result.entities.characters = ['player', 'npc'].map(id => ({ id, name: id, description: '', personality: [], goals: [], faction_id: null, relationships: [] }));
  result.player.character_id = 'player';
  result.state_schema = [{ key: 'energy', label: '能源', type: 'integer', min: 0, max: 10, unit: '点', owner_id: null, visibility: 'public' },
    { key: 'secret', label: '内部密码', type: 'string', owner_id: 'npc', visibility: ['npc'] }];
  result.initial_state.values = { energy: 0, secret: 'not-player-visible' };
  result.initial_state.memories = [{ id: 'memory', text: 'private-npc-memory', audience: ['npc'] }];
  result.actions = [{ id: 'wait', name: '等待', description: '', parameters: {}, allowed_actor_ids: ['player'], conditions: { all: [] }, effects: [], visibility: 'public' }];
  result.events = [{ id: 'first', name: '第一夜', conditions: { operator: 'eq', left: { turn: true }, right: { literal: 1 } }, effects: [{ type: 'add', field: 'energy', value: { literal: 1 } }], repeatable: false, visibility: 'public' }];
  result.objectives = [{ id: 'end', name: '值班结束', outcome: 'success', priority: 0, conditions: { operator: 'gte', left: { turn: true }, right: { literal: 3 } }, visibility: 'public' }];
  return result;
}
async function readyDraft() { return content.import(owner, { document: definition(), request_id: randomUUID() }); }
async function play() {
  const draft = await readyDraft(), release = await content.publish(owner, draft.draft_id, { expected_revision: 0, request_id: randomUUID() });
  return worlds.create(owner, { release_id: release.release_id, request_id: randomUUID() });
}
beforeEach(async () => {
  await database.authorGenerationLease.deleteMany(); await database.authorGenerationRate.deleteMany();
  await database.processedRequest.deleteMany(); await database.saveGame.deleteMany(); await database.worldSession.deleteMany();
  await database.scenarioRelease.deleteMany(); await database.scenarioDraft.deleteMany(); await database.authSession.deleteMany(); await database.user.deleteMany();
  owner = (await database.user.create({ data: { username: 'owner', passwordHash: 'unused-in-direct-service-tests' } })).id;
  other = (await database.user.create({ data: { username: 'other', passwordHash: 'unused-in-direct-service-tests' } })).id;
});
afterAll(() => database.$disconnect());
describe('创作事务与归属', () => {
  it('内置剧本直接开局不创建创作对象，去重与私人存档权限仍有效', async () => {
    const body = { template_id: 'station-repair', request_id: 'direct-play' };
    const [a, b] = await Promise.all([worlds.create(owner, body), worlds.create(owner, body)]);
    expect(a.session_id).toBe(b.session_id); expect(a.mode).toBe('play');
    expect(await database.worldSession.count()).toBe(1);
    expect(await database.scenarioDraft.count()).toBe(0); expect(await database.scenarioRelease.count()).toBe(0);
    const saved = await worlds.save(owner, a.session_id, { name: '直接游玩存档', expected_revision: 0, request_id: 'save-template' });
    const restored = await worlds.restore(owner, saved.save_id, { request_id: 'load-template' });
    expect(restored.session_id).not.toBe(a.session_id); expect(restored.turn).toBe(0);
    await expect(worlds.get(other, a.session_id)).rejects.toMatchObject({ status: 404 });
    await expect(worlds.restore(other, saved.save_id, { request_id: 'other' })).rejects.toMatchObject({ status: 404 });
    await expect(worlds.create(owner, { template_id: 'unknown-template', request_id: 'invalid-template' })).rejects.toMatchObject({ status: 404 });
    await expect(worlds.create(owner, { template_id: '../station-repair', request_id: 'invalid-path' })).rejects.toMatchObject({ status: 422 });
    await expect(worlds.create(owner, { ...body, release_id: 'ambiguous' })).rejects.toMatchObject({ status: 422 });
  });
  it('并发重复创建只产生一个对象，同键不同正文冲突；空白和错误子结构可保存', async () => {
    const body = { name: '未完成', source: { type: 'blank' }, request_id: 'same' };
    const [a, b] = await Promise.all([content.create(owner, body), content.create(owner, body)]);
    expect(a.draft_id).toBe(b.draft_id); expect(await database.scenarioDraft.count()).toBe(1);
    await expect(content.create(owner, { ...body, name: 'different' })).rejects.toMatchObject({ status: 409, code: 'request_conflict' });
    expect((await content.validate(owner, a.draft_id, { expected_revision: 0 })).valid).toBe(false);
    const saved = await content.save(owner, a.draft_id, { document: { world: 42 }, expected_revision: 0, request_id: 'save' });
    expect(saved.document).toEqual({ world: 42 }); expect(saved.revision).toBe(1);
    await expect(content.import(owner, { document: { owner_user_id: other }, request_id: 'bad' })).rejects.toMatchObject({ status: 422 });
  });
  it('两个账号私有列表隔离，非本人读写、试玩、定稿和来源复制都是 404', async () => {
    const draft = await readyDraft(), release = await content.publish(owner, draft.draft_id, { expected_revision: 0, request_id: 'publish' });
    expect(await content.drafts(other, {})).toEqual([]); expect(await content.releases(other, {})).toEqual([]);
    for (const call of [() => content.getDraft(other, draft.draft_id), () => content.save(other, draft.draft_id, { document: definition(), expected_revision: 0, request_id: 'bad' }),
      () => content.preview(other, draft.draft_id, { expected_revision: 0, request_id: 'bad' }), () => content.publish(other, draft.draft_id, { expected_revision: 0, request_id: 'bad' }),
      () => content.create(other, { name: 'copy', source: { type: 'release', release_id: release.release_id }, request_id: 'bad' }), () => content.getRelease(other, release.release_id)]) {
      await expect(call()).rejects.toMatchObject({ status: 404, code: 'object_unavailable' });
    }
  });
  it('同修订保存竞争仅一个提交，重复原请求返回原确认；定稿保持原快照', async () => {
    const draft = await readyDraft(), release = await content.publish(owner, draft.draft_id, { expected_revision: 0, request_id: 'publish' });
    const document = definition(); document.narrative.opening = 'new opening';
    const body = { document, expected_revision: 0, request_id: 'save-one' };
    const results = await Promise.allSettled([content.save(owner, draft.draft_id, body), content.save(owner, draft.draft_id, { ...body, request_id: 'save-two' })]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const successful = results[0]!.status === 'fulfilled' ? body : { ...body, request_id: 'save-two' };
    expect((await content.save(owner, draft.draft_id, successful)).revision).toBe(1);
    expect((await content.getRelease(owner, release.release_id)).definition.narrative.opening).toBe('');
    const world = await worlds.create(owner, { release_id: release.release_id, request_id: 'new-game' }); expect(world.opening).toBe('');
  });
});
describe('世界、检查点和失败原子性', () => {
  it('preview 可调试但不能保存，play 严格过滤私有知识并拒绝 debug', async () => {
    const draft = await readyDraft(), preview = await content.preview(owner, draft.draft_id, { expected_revision: 0, request_id: 'preview' });
    expect(JSON.stringify(await worlds.debug(owner, preview.session_id))).toContain('private-npc-memory');
    await expect(worlds.save(owner, preview.session_id, { name: 'bad', expected_revision: 0, request_id: 'bad' })).rejects.toMatchObject({ status: 403 });
    const world = await play(); expect(JSON.stringify(world)).not.toMatch(/not-player-visible|private-npc-memory|scenario_snapshot|known_records/);
    await expect(worlds.debug(owner, world.session_id)).rejects.toMatchObject({ status: 403 });
    await expect(worlds.get(other, world.session_id)).rejects.toMatchObject({ status: 404 });
  });
  it('回合竞争仅一个提交，网络重试不重复事件；终局拒绝新动作', async () => {
    const world = await play(), body = { action_id: 'wait', parameters: {}, expected_revision: 0, request_id: 'turn-a' };
    const results = await Promise.allSettled([worlds.turn(owner, world.session_id, body), worlds.turn(owner, world.session_id, { ...body, request_id: 'turn-b' })]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const accepted = results[0]!.status === 'fulfilled' ? body : { ...body, request_id: 'turn-b' };
    expect((await worlds.turn(owner, world.session_id, accepted)).turn).toBe(1);
    for (let revision = 1; revision <= 2; revision++) await worlds.turn(owner, world.session_id, { ...body, expected_revision: revision, request_id: `next-${revision}` });
    const terminal = await worlds.get(owner, world.session_id); expect(terminal.status).toBe('success'); expect(terminal.fields[0]!.value).toBe(1);
    await expect(worlds.turn(owner, world.session_id, { ...body, expected_revision: 3, request_id: 'after-end' })).rejects.toMatchObject({ code: 'session_finished' });
  });
  it('检查点恢复为新分支并保持历史来源、一次性事件和父世界，重复请求只创建一个分支', async () => {
    const world = await play(); await worlds.turn(owner, world.session_id, { action_id: 'wait', parameters: {}, expected_revision: 0, request_id: 'turn' });
    const saved = await worlds.save(owner, world.session_id, { name: '第一夜备份', expected_revision: 1, request_id: 'save' });
    expect((await worlds.getSave(owner, saved.save_id)).name).toBe('第一夜备份');
    expect(JSON.stringify(await worlds.getSave(owner, saved.save_id))).not.toMatch(/scenario_snapshot|known_records|private-npc-memory/);
    const savedView = await worlds.getSave(owner, saved.save_id);
    expect(savedView.history[0]!.decisions.find(d => d.id === 'first')!.name).toBe('第一夜');
    const [a, b] = await Promise.all([worlds.restore(owner, saved.save_id, { request_id: 'restore' }), worlds.restore(owner, saved.save_id, { request_id: 'restore' })]);
    expect(a.session_id).toBe(b.session_id); expect(a.session_id).not.toBe(world.session_id); expect(a.revision).toBe(0); expect(a.turn).toBe(1);
    expect(a.history).toEqual(savedView.history); expect(a.entities).toEqual(savedView.entities); expect(a.ending).toEqual(savedView.ending);
    await worlds.turn(owner, a.session_id, { action_id: 'wait', parameters: {}, expected_revision: 0, request_id: 'branch-turn' });
    const payload = (await database.worldSession.findUniqueOrThrow({ where: { id: a.session_id } })).payload as unknown as { turns: { session_id: string }[] };
    expect(payload.turns.map(t => t.session_id)).toEqual([world.session_id, a.session_id]); expect((await worlds.get(owner, world.session_id)).turn).toBe(1);
    await expect(worlds.restore(other, saved.save_id, { request_id: 'bad' })).rejects.toMatchObject({ status: 404 });
  });
  it('保存和回合竞争遵守来源修订，检查点不提高会话修订', async () => {
    const world = await play();
    const results = await Promise.allSettled([worlds.save(owner, world.session_id, { name: 'race', expected_revision: 0, request_id: 'save-race' }),
      worlds.turn(owner, world.session_id, { action_id: 'wait', parameters: {}, expected_revision: 0, request_id: 'turn-race' })]);
    expect(results[1]!.status).toBe('fulfilled'); expect((await worlds.get(owner, world.session_id)).revision).toBe(1);
    if (results[0]!.status === 'fulfilled') expect(results[0]!.value.turn).toBe(0);
    else expect(results[0]!.reason).toMatchObject({ code: 'revision_conflict' });
  });
  it('即使原请求已成功，版本或载荷损坏也不能绕过门禁；越权在完整性前返回 404', async () => {
    const world = await play(), input = { action_id: 'wait', parameters: {}, expected_revision: 0, request_id: 'turn' };
    await worlds.turn(owner, world.session_id, input);
    const original = await database.worldSession.findUniqueOrThrow({ where: { id: world.session_id } });
    await database.worldSession.update({ where: { id: world.session_id }, data: { schemaVersion: 2n, payload: asJson({ ...(original.payload as object), schemaVersion: 2 }) } });
    await expect(worlds.turn(owner, world.session_id, input)).rejects.toMatchObject({ code: 'checkpoint_version_unsupported' });
    await expect(worlds.get(other, world.session_id)).rejects.toMatchObject({ code: 'object_unavailable' });
    await database.worldSession.update({ where: { id: world.session_id }, data: { schemaVersion: 1n, payload: asJson({ ...(original.payload as object), known_records: {} }) } });
    await expect(worlds.get(owner, world.session_id)).rejects.toMatchObject({ code: 'checkpoint_invalid' });
  });
  it('账本插入故障回滚回合、事件和概要，原请求可在修复后重试', async () => {
    const world = await play(), input = { action_id: 'wait', parameters: {}, expected_revision: 0, request_id: 'fail-ledger' };
    await database.$executeRawUnsafe(`CREATE FUNCTION "${schema}".fail_business_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."requestId"='fail-ledger' THEN RAISE EXCEPTION 'test ledger failure'; END IF; RETURN NEW; END $$`);
    await database.$executeRawUnsafe(`CREATE TRIGGER fail_business_ledger BEFORE INSERT ON "${schema}"."ProcessedRequest" FOR EACH ROW EXECUTE FUNCTION "${schema}".fail_business_ledger()`);
    try { await expect(worlds.turn(owner, world.session_id, input)).rejects.toThrow(); expect((await worlds.get(owner, world.session_id)).turn).toBe(0);
      expect(await database.processedRequest.count({ where: { requestId: input.request_id } })).toBe(0);
    } finally { await database.$executeRawUnsafe(`DROP TRIGGER fail_business_ledger ON "${schema}"."ProcessedRequest"`); await database.$executeRawUnsafe(`DROP FUNCTION "${schema}".fail_business_ledger()`); }
    expect((await worlds.turn(owner, world.session_id, input)).turn).toBe(1);
  });
});
const modelConfig: AuthorModelConfig = { url: 'https://model.invalid/v1/chat/completions', key: 'test-only-not-a-credential', model: 'test-model',
  timeoutMs: 10000, contextTokens: 1000000, outputTokens: 100, maxResponseBytes: 1048576, globalConcurrency: 1, callsPerMinute: 10 };
function generationInput(document: Scenario): GenerationInput {
  return { generation_id: randomUUID(), expected_revision: 0, workspace_id: 'workspace', content_version: 2, proposal_version: 1,
    stage: 'outline', instruction: '构建夜间值班故事', document: document as unknown as Record<string, unknown>, proposal: null, edit_scope: { mode: 'extend', targets: [] } };
}
const output = { candidate: { kind: 'outline', premise: '值班', player: '值班员', characters: [], conflicts: [], event_directions: [], gameplay: [], ending_directions: [] }, assumptions: [], questions: [] };
describe('模型契约与跨进程额度（供应方使用显式测试替身）', () => {
  it('无配置及越权不调用模型；生成不保存内容，绑定摘要与真实报告用量', async () => {
    const draft = await readyDraft(); let count = 0;
    const call: ModelCall = async () => { count++; return { value: output, inputTokens: 123, outputTokens: 45 }; };
    const missing = new GenerationService(database, content, () => null, call), configured = new GenerationService(database, content, () => modelConfig, call), input = generationInput(definition());
    await expect(missing.generate(owner, draft.draft_id, input, new AbortController().signal, async () => {})).rejects.toMatchObject({ code: 'generation_unavailable' });
    await expect(configured.generate(other, draft.draft_id, input, new AbortController().signal, async () => {})).rejects.toMatchObject({ status: 404 }); expect(count).toBe(0);
    const result = await configured.generate(owner, draft.draft_id, input, new AbortController().signal, async () => {});
    expect(result.source.document_digest).toBe(digest(input.document)); expect(result.usage).toEqual({ input_tokens: 123, output_tokens: 45 });
    expect((await content.getDraft(owner, draft.draft_id)).revision).toBe(0); expect(await database.worldSession.count()).toBe(0); expect(await database.authorGenerationLease.count()).toBe(0);
  });
  it('两个应用实例共享账号和全局并发门禁，完成后释放；并发保存使候选过期', async () => {
    const draft = await readyDraft(), otherDraft = await content.import(other, { document: definition(), request_id: 'other' });
    let release!: () => void, started!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { started = resolve; });
    let count = 0; const call: ModelCall = async () => { count++; started(); await wait; return { value: output, inputTokens: null, outputTokens: null }; };
    const a = new GenerationService(database, content, () => modelConfig, call), b = new GenerationService(database, content, () => modelConfig, call), input = generationInput(definition());
    const pending = a.generate(owner, draft.draft_id, input, new AbortController().signal, async () => {}); await ready;
    await expect(b.generate(owner, draft.draft_id, input, new AbortController().signal, async () => {})).rejects.toMatchObject({ code: 'generation_busy' });
    await expect(b.generate(other, otherDraft.draft_id, input, new AbortController().signal, async () => {})).rejects.toMatchObject({ code: 'generation_limited' }); expect(count).toBe(1);
    await content.save(owner, draft.draft_id, { document: definition(), expected_revision: 0, request_id: 'while-model' }); release();
    await expect(pending).rejects.toMatchObject({ code: 'revision_conflict' }); expect(await database.authorGenerationLease.count()).toBe(0);
  });
  it('非法输出、响应前身份失效、超时均不产生候选或对象；频率超额不调用模型', async () => {
    const draft = await readyDraft(), input = generationInput(definition()), signal = new AbortController().signal;
    const bad = new GenerationService(database, content, () => modelConfig, async () => ({ value: { script: 'bad' }, inputTokens: null, outputTokens: null }));
    await expect(bad.generate(owner, draft.draft_id, input, signal, async () => {})).rejects.toMatchObject({ code: 'invalid_model_output' });
    const good = new GenerationService(database, content, () => modelConfig, async () => ({ value: output, inputTokens: null, outputTokens: null }));
    await expect(good.generate(owner, draft.draft_id, input, signal, async () => { throw new ApiError(401, 'unauthenticated', 'expired'); })).rejects.toMatchObject({ code: 'unauthenticated' });
    const timeout = new GenerationService(database, content, () => ({ ...modelConfig, timeoutMs: 50 }), async (_config, _input, signal) => {
      await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); throw new Error('unreachable');
    });
    await expect(timeout.generate(owner, draft.draft_id, input, signal, async () => {})).rejects.toMatchObject({ code: 'generation_timeout' });
    let calls = 0;
    const limited = new GenerationService(database, content, () => ({ ...modelConfig, callsPerMinute: 3 }), async () => { calls++; return { value: output, inputTokens: null, outputTokens: null }; });
    await expect(limited.generate(owner, draft.draft_id, input, signal, async () => {})).rejects.toMatchObject({ code: 'generation_limited' }); expect(calls).toBe(0);
    expect(await database.authorGenerationLease.count()).toBe(0); expect((await content.getDraft(owner, draft.draft_id)).revision).toBe(0);
  });
});
it('真实 HTTP 创作路由依赖身份和 Origin / CSRF，私有请求不会绕过认证', async () => {
  const config = { origin: 'http://127.0.0.1:5173', secret: randomBytes(32), secure: false, trustedProxyIps: [] };
  const app = await createApp(database, config); await app.listen(0, '127.0.0.1');
  try {
    const url = await app.getUrl();
    expect((await fetch(`${url}/api/drafts`)).status).toBe(401);
    expect((await fetch(`${url}/api/drafts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'bad', source: { type: 'blank' }, request_id: 'bad' }) })).status).toBe(403);
    const csrfResponse = await fetch(`${url}/api/auth/csrf`), cookie = csrfResponse.headers.getSetCookie()[0]!.split(';')[0]!;
    const csrf = (await csrfResponse.json() as { data: { csrf_token: string } }).data.csrf_token;
    expect((await fetch(`${url}/api/drafts`, { method: 'POST', headers: { Cookie: cookie, Origin: config.origin, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'bad', source: { type: 'blank' }, request_id: 'bad' }) })).status).toBe(401);
  } finally { await app.close(); }
});
