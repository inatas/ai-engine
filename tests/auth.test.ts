import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { credentialsSchema } from '../packages/contracts/src/auth.js';
import { createApp } from '../apps/server/src/app.js';
import { createDatabase } from '../apps/server/src/database.js';
import { authConfig, type AuthConfig } from '../apps/server/src/auth/config.js';
import { AuthService } from '../apps/server/src/auth/service.js';

const database = createDatabase();
const baseConfig: AuthConfig = { origin: 'http://127.0.0.1:5173', secret: randomBytes(32), secure: false,
  trustedProxyIps: ['127.0.0.1', '::1'] };
const apps: Awaited<ReturnType<typeof createApp>>[] = [];
let baseUrl = '';
let clientIndex = 0;
const password = '远航 检验清风世界 31415926';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const schema = new URL(process.env.DATABASE_URL!).searchParams.get('schema')!;
if (!/^auth_test_[a-f0-9]{32}$/.test(schema)) throw new Error('鉴权测试必须使用隔离 schema');

async function start(config = baseConfig) {
  const app = await createApp(database, config);
  await app.listen(0, '127.0.0.1');
  apps.push(app);
  return await app.getUrl();
}
class Browser {
  cookies = new Map<string, string>();
  csrf = '';
  ip = `198.51.100.${++clientIndex}`;
  constructor(public url = baseUrl, public origin = baseConfig.origin) {}
  get cookieHeader() { return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '); }
  async call(path: string, body?: unknown, headers: Record<string, string> = {}) {
    const response = await fetch(`${this.url}/api/auth/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Cookie: this.cookieHeader, 'X-Forwarded-For': this.ip, ...(body === undefined ? {} : {
        'Content-Type': 'application/json', Origin: this.origin, 'X-CSRF-Token': this.csrf,
      }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const split = pair!.indexOf('=');
      const name = pair!.slice(0, split), value = pair!.slice(split + 1);
      if (value) this.cookies.set(name, value); else this.cookies.delete(name);
    }
    return { response, body: await response.json() as {
      data?: { user_id?: string; username?: string; csrf_token?: string; logged_out?: boolean };
      error?: { code: string; message: string; details: unknown[] };
    } };
  }
  async initialize() { const result = await this.call('csrf'); expect(result.response.status).toBe(200); this.csrf = result.body.data!.csrf_token!; }
  async register(username = 'captain', inputPassword = password) {
    return this.call('register', { username, password: inputPassword });
  }
  async login(username = 'captain', inputPassword = password) {
    const result = await this.call('login', { username, password: inputPassword });
    if (result.response.ok) this.csrf = result.body.data!.csrf_token!;
    return result;
  }
}
async function loggedIn() {
  const client = new Browser();
  await client.initialize();
  expect((await client.register()).response.status).toBe(201);
  expect((await client.login()).response.status).toBe(200);
  return client;
}
beforeEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  await database.authSession.deleteMany();
  await database.user.deleteMany();
  await database.anonymousAuthContext.deleteMany();
  await database.authRateLimit.deleteMany();
  baseUrl = await start();
});
afterAll(async () => { for (const app of apps) await app.close(); await database.$disconnect(); });

describe('配置和输入政策', () => {
  it('缺失密钥、非规范来源、非 HTTPS 生产、泛化代理配置拒绝启动', () => {
    const env = { AUTH_ORIGIN: baseConfig.origin, CSRF_SECRET: baseConfig.secret.toString('base64url') };
    expect(authConfig(env).secure).toBe(false);
    expect(() => authConfig({ ...env, CSRF_SECRET: '' })).toThrow();
    expect(() => authConfig({ ...env, CSRF_SECRET: 'short' })).toThrow();
    expect(() => authConfig({ ...env, AUTH_ORIGIN: `${env.AUTH_ORIGIN}/` })).toThrow();
    expect(() => authConfig({ ...env, AUTH_ORIGIN: 'http://example.com' })).toThrow();
    expect(() => authConfig({ ...env, NODE_ENV: 'production' })).toThrow();
    expect(() => authConfig({ ...env, TRUSTED_PROXY_IPS: '*' })).toThrow();
    expect(authConfig({ ...env, NODE_ENV: 'production', AUTH_ORIGIN: 'https://world.example' }).secure).toBe(true);
  });
  it('密码按码点计数，不修剪、不截断，不接受单独代理项或身份字段', () => {
    const parse = (value: string) => credentialsSchema.safeParse({ username: 'Abc', password: value });
    expect(parse('🌍'.repeat(15)).success).toBe(true);
    expect(parse('🌍'.repeat(128)).success).toBe(true);
    expect(parse('🌍'.repeat(129)).success).toBe(false);
    expect(parse('🌍'.repeat(14)).success).toBe(false);
    expect(parse(' '.repeat(15)).success).toBe(true);
    expect(parse(' '.repeat(14) + '\ud800').success).toBe(false);
    expect(credentialsSchema.safeParse({ username: ' abc', password }).success).toBe(false);
    expect(credentialsSchema.safeParse({ username: 'abc', password, owner_user_id: 'other' }).success).toBe(false);
  });
});
describe('真实注册与登录', () => {
  it('用户名规范化且注册不自动登录，并发唯一约束只建立一个账号', async () => {
    const a = new Browser(), b = new Browser();
    await a.initialize(); await b.initialize();
    const results = await Promise.all([a.register('Captain'), b.register('CAPTAIN')]);
    expect(results.map(r => r.response.status).sort()).toEqual([201, 409]);
    expect(await database.user.count()).toBe(1);
    expect((await database.user.findFirst())!.username).toBe('captain');
    expect((await a.call('me')).response.status).toBe(401);
    expect(a.cookies.has('ai_engine_session')).toBe(false);
  });
  it('密码真实 Argon2id、参数正确、独立盐，保留空格和 Unicode', async () => {
    const a = new Browser(); await a.initialize();
    const spaced = ` ${password} `;
    expect((await a.register('first', spaced)).response.ok).toBe(true);
    expect((await a.register('second', spaced)).response.ok).toBe(true);
    const users = await database.user.findMany();
    expect(users[0]!.passwordHash).toMatch(/^\$argon2id\$v=19\$/);
    expect(new Set(users[0]!.passwordHash.split('$')[3]!.split(','))).toEqual(new Set(['m=19456', 't=2', 'p=1']));
    expect(users[0]!.passwordHash).not.toBe(users[1]!.passwordHash);
    expect((await a.login('first', password)).response.status).toBe(401);
    expect((await a.login('FIRST', spaced)).body.data!.username).toBe('first');
  });
  it('拒绝本地常见密码清单中的有效长度密码，不建立账号', async () => {
    const common = readFileSync(new URL('../apps/server/resources/common-passwords.txt', import.meta.url), 'utf8')
      .split(/\r?\n/).find(value => [...value].length >= 15 && [...value].length <= 128)!;
    expect(common).toBeTruthy();
    const a = new Browser(); await a.initialize();
    expect((await a.register('weakpass', common)).body.error!.code).toBe('invalid_request');
    expect(await database.user.count()).toBe(0);
  });
  it('未知账号和错误密码统一失败；伪造 owner／user_id 拒绝', async () => {
    const a = new Browser(); await a.initialize(); await a.register();
    const wrong = await a.login('captain', `${password}错误`), unknown = await a.login('unknown', password);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.response.status).toBe(401);
    expect((await a.call('login', { username: 'captain', password, user_id: 'forged' })).response.status).toBe(422);
    expect((await a.call('register', { username: 'other', password, owner_user_id: 'forged' })).response.status).toBe(422);
    expect(await database.authSession.count()).toBe(0);
  });
  it('只在 Cookie 返回认证令牌，数据／数据库／日志不泄露凭据', async () => {
    const log = vi.spyOn(console, 'error');
    try {
      const a = new Browser(); await a.initialize(); await a.register();
      const login = await a.login();
      const cookies = login.response.headers.getSetCookie();
      expect(cookies.find(value => value.startsWith('ai_engine_session='))).toMatch(/HttpOnly; SameSite=Lax/i);
      expect(cookies.join('')).toContain('Path=/');
      expect(cookies.join('')).not.toMatch(/Domain=|Secure/);
      const token = a.cookies.get('ai_engine_session')!;
      const stored = (await database.authSession.findFirst())!;
      expect(stored.tokenHash).toBe(sha(token));
      expect(JSON.stringify(stored)).not.toContain(token);
      const me = await a.call('me');
      expect(Object.keys(me.body.data!).sort()).toEqual(['user_id', 'username']);
      expect(JSON.stringify(me.body)).not.toContain(token);
      expect(me.response.headers.get('cache-control')).toBe('no-store');
      expect(JSON.stringify(log.mock.calls)).not.toContain(password);
      expect(JSON.stringify(log.mock.calls)).not.toContain(token);
    } finally { log.mockRestore(); }
  });
  it('HTTPS 配置的两个 Cookie 均为 Secure，禁止脚本读取', async () => {
    const a = new Browser(await start({ ...baseConfig, secure: true, origin: 'https://world.example' }), 'https://world.example');
    const result = await a.call('csrf');
    expect(result.response.headers.getSetCookie().every(value => value.includes('Secure') && value.includes('HttpOnly'))).toBe(true);
  });
});
describe('会话与 CSRF 生命周期', () => {
  it('刷新 CSRF 可重建内存令牌；重登录轮换当前会话，多设备退出互不影响', async () => {
    const a = await loggedIn(), b = new Browser();
    await b.initialize(); expect((await b.login()).response.ok).toBe(true);
    const oldCookie = a.cookieHeader, oldCsrf = a.csrf;
    expect((await a.call('csrf')).body.data!.csrf_token).toBe(oldCsrf);
    expect((await a.login()).response.ok).toBe(true);
    expect(a.csrf).not.toBe(oldCsrf);
    expect((await a.call('me', undefined, { Cookie: oldCookie })).response.status).toBe(401);
    expect((await a.call('logout', {}, { 'X-CSRF-Token': oldCsrf })).response.status).toBe(403);
    expect((await a.call('logout', {})).response.status).toBe(200);
    expect((await a.call('me')).response.status).toBe(401);
    expect((await b.call('me')).response.status).toBe(200);
  });
  it('缺失／跨站 Origin、缺失／错误 CSRF 和匿名修改私有对象均拒绝', async () => {
    const a = new Browser(); await a.initialize();
    const credentials = { username: 'captain', password };
    for (const headers of [{ Origin: '' }, { Origin: 'https://evil.example' }, { 'X-CSRF-Token': '' }, { 'X-CSRF-Token': 'x'.repeat(43) }]) {
      expect((await a.call('register', credentials, headers)).response.status).toBe(403);
    }
    expect((await a.call('logout', {})).response.status).toBe(401);
    await a.register();
    const anonymousCsrf = a.csrf, anonymousCookie = a.cookieHeader;
    await a.login();
    expect((await a.call('logout', {}, { 'X-CSRF-Token': anonymousCsrf })).response.status).toBe(403);
    expect((await a.call('login', credentials, { Cookie: anonymousCookie, 'X-CSRF-Token': anonymousCsrf })).response.status).toBe(403);
  });
  it('并发登录同一匿名上下文只发出一个可用会话', async () => {
    const a = new Browser(); await a.initialize(); await a.register();
    const originalCookie = a.cookieHeader, originalCsrf = a.csrf;
    const results = await Promise.all([a.call('login', { username: 'captain', password }, { Cookie: originalCookie, 'X-CSRF-Token': originalCsrf }),
      a.call('login', { username: 'captain', password }, { Cookie: originalCookie, 'X-CSRF-Token': originalCsrf })]);
    expect(results.filter(result => result.response.ok)).toHaveLength(1);
    expect(results.find(result => !result.response.ok)!.response.status).toBe(409);
    expect(await database.authSession.count()).toBe(1);
  });
  it('绝对和空闲过期均拒绝；五分钟节流更新 lastSeenAt', async () => {
    const a = await loggedIn();
    const id = (await database.authSession.findFirst())!.id;
    const initial = (await database.authSession.findUnique({ where: { id } }))!.lastSeenAt;
    await a.call('me');
    expect((await database.authSession.findUnique({ where: { id } }))!.lastSeenAt).toEqual(initial);
    await database.authSession.update({ where: { id }, data: { lastSeenAt: new Date(Date.now() - 6 * 60_000) } });
    expect((await a.call('me')).response.ok).toBe(true);
    expect(Date.now() - (await database.authSession.findUnique({ where: { id } }))!.lastSeenAt.getTime()).toBeLessThan(5000);
    await database.authSession.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1) } });
    expect((await a.call('me')).response.status).toBe(401);
    await database.authSession.update({ where: { id }, data: { expiresAt: new Date(Date.now() + 86400000), lastSeenAt: new Date(Date.now() - 86400001) } });
    expect((await a.call('me')).response.status).toBe(401);
  });
  it('匿名过期不可注册；初始化创建新的安全上下文', async () => {
    const a = new Browser(); await a.initialize();
    const old = a.csrf;
    await database.anonymousAuthContext.updateMany({ data: { expiresAt: new Date(Date.now() - 1) } });
    expect((await a.register()).response.status).toBe(403);
    await a.initialize(); expect(a.csrf).not.toBe(old);
    expect((await a.register()).response.status).toBe(201);
  });
  it('重建应用保留有效登录；密钥轮换同步撤销认证和匿名上下文', async () => {
    const a = await loggedIn(), anon = new Browser(); await anon.initialize();
    a.url = await start();
    expect((await a.call('me')).response.status).toBe(200);
    expect((await a.call('csrf')).body.data!.csrf_token).toBe(a.csrf);
    const next = await start({ ...baseConfig, secret: randomBytes(32) });
    a.url = next; anon.url = next;
    expect((await a.call('me')).response.status).toBe(401);
    expect((await anon.register('other')).response.status).toBe(403);
    expect(await database.anonymousAuthContext.count()).toBe(0);
    expect(await database.authSession.count({ where: { revokedAt: null } })).toBe(0);
  });
  it('篡改／未知 Cookie 不获得身份，退出未知字段拒绝', async () => {
    const a = await loggedIn();
    expect((await a.call('me', undefined, { Cookie: `ai_engine_session=${randomBytes(32).toString('base64url')}` })).response.status).toBe(401);
    expect((await a.call('me', undefined, { Cookie: 'ai_engine_session=user_id:captain' })).response.status).toBe(401);
    expect((await a.call('logout', { user_id: 'other' })).response.status).toBe(422);
    expect((await a.call('me')).response.status).toBe(200);
  });
});
describe('持久化限流、故障与响应', () => {
  it('未知账号用户名窗口第 11 次拒绝且重启仍生效，超时后恢复', async () => {
    const a = new Browser(); await a.initialize();
    for (let i = 0; i < 10; i++) expect((await a.login('unknown')).response.status).toBe(401);
    const blocked = await a.login('UNKNOWN');
    expect(blocked.response.status).toBe(429);
    expect(Number(blocked.response.headers.get('retry-after'))).toBeGreaterThan(0);
    a.url = await start();
    expect((await a.login('unknown')).response.status).toBe(429);
    await database.authRateLimit.updateMany({ data: { attempts: [new Date(Date.now() - 16 * 60_000)] } });
    expect((await a.login('unknown')).response.status).toBe(401);
  });
  it('不同用户名仍受 IP 30 次窗口限制；并发用户名计数不能丢失', async () => {
    const a = new Browser(); await a.initialize();
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => {
      const b = new Browser(); b.cookies = new Map(a.cookies); b.csrf = a.csrf;
      return b.login('parallel');
    }));
    expect(results.filter(result => result.response.status === 401)).toHaveLength(10);
    expect(results.filter(result => result.response.status === 429)).toHaveLength(2);
    for (let i = 0; i < 30; i++) expect((await a.login(`unknown_${i}`)).response.status).toBe(401);
    expect((await a.login('lastunknown')).response.status).toBe(429);
  });
  it('注册第 11 次和 CSRF 初始化第 61 次拒绝', async () => {
    const a = new Browser(); await a.initialize();
    for (let i = 0; i < 10; i++) expect((await a.register('invalid', 'short')).response.status).toBe(422);
    expect((await a.register()).response.status).toBe(429);
    for (let i = 0; i < 59; i++) expect((await a.call('csrf')).response.status).toBe(200);
    expect((await a.call('csrf')).response.status).toBe(429);
  });
  it('默认直接 IP 不信任伪造转发头', async () => {
    const url = await start({ ...baseConfig, trustedProxyIps: [] });
    const clients = [new Browser(url), new Browser(url)];
    await clients[0]!.initialize(); await clients[1]!.initialize();
    for (let i = 0; i < 10; i++) expect((await clients[i % 2]!.register('invalid', 'short')).response.status).toBe(422);
    expect((await new Browser(url).call('csrf')).response.status).toBe(200);
    expect((await clients[1]!.register()).response.status).toBe(429);
  });
  it('注册写失败不建立账号；登录写失败回滚匿名消费且不发 Cookie，可重试', async () => {
    const a = new Browser(); await a.initialize();
    await database.$executeRawUnsafe(`CREATE FUNCTION "${schema}".reject_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$`);
    try {
      await database.$executeRawUnsafe(`CREATE TRIGGER reject_user BEFORE INSERT ON "${schema}"."User" FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_write()`);
      try { expect((await a.register()).response.status).toBe(500); expect(await database.user.count()).toBe(0); }
      finally { await database.$executeRawUnsafe(`DROP TRIGGER reject_user ON "${schema}"."User"`); }
      await a.register();
      await database.$executeRawUnsafe(`CREATE TRIGGER reject_session BEFORE INSERT ON "${schema}"."AuthSession" FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_write()`);
      try {
        const result = await a.login();
        expect(result.response.status).toBe(500);
        expect(result.response.headers.getSetCookie()).toEqual([]);
        expect(await database.authSession.count()).toBe(0);
        expect(await database.anonymousAuthContext.count()).toBe(1);
      } finally { await database.$executeRawUnsafe(`DROP TRIGGER reject_session ON "${schema}"."AuthSession"`); }
      expect((await a.login()).response.status).toBe(200);
    } finally { await database.$executeRawUnsafe(`DROP FUNCTION "${schema}".reject_write()`); }
  });
  it('非法 JSON、超大正文和未知路径返回经过过滤的错误', async () => {
    const a = new Browser(); await a.initialize();
    const headers = { Cookie: a.cookieHeader, Origin: a.origin, 'X-CSRF-Token': a.csrf, 'Content-Type': 'application/json' };
    const invalid = await fetch(`${baseUrl}/api/auth/register`, { method: 'POST', headers, body: '{"password":' });
    expect(invalid.status).toBe(400); expect((await invalid.json()).error.code).toBe('invalid_json');
    const huge = await fetch(`${baseUrl}/api/auth/register`, { method: 'POST', headers, body: JSON.stringify({ username: 'abc', password: 'x'.repeat(2 * 1024 * 1024) }) });
    expect(huge.status).toBe(413);
    expect((await fetch(`${baseUrl}/api/auth/no-such-route`)).status).toBe(404);
  });
});
