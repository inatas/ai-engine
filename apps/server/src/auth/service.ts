import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { hash, verify, argon2id } from 'argon2';
import { parseCookie, stringifySetCookie } from 'cookie';
import type { Request, Response } from 'express';
import { credentialsSchema, type UserSummary } from '@ai-engine/contracts';
import type { PrismaClient, AuthSession } from '../generated/prisma/client.js';
import type { AuthConfig } from './config.js';
import { ApiError } from './errors.js';

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;
const sessionCookie = 'ai_engine_session';
const anonymousCookie = 'ai_engine_anonymous';
const argonOptions = { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
const commonPasswords = new Set(readFileSync(new URL('../../resources/common-passwords.txt', import.meta.url), 'utf8').split(/\r?\n/));
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');
const tokenValid = (value: string | undefined): value is string => !!value && /^[A-Za-z0-9_-]{43}$/.test(value);
const matches = (left: string, right: string) => {
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};
export interface Principal extends UserSummary { auth_session_id: string }
interface ActiveSession { record: AuthSession; principal: Principal; token: string }
export type AuthRequest = Request & { principal?: Principal; authSession?: ActiveSession | null };

export class AuthService {
  private dummyHash = '';
  constructor(readonly database: PrismaClient, readonly config: AuthConfig) {}

  async initialize() {
    this.dummyHash = await hash(newToken(), argonOptions);
    await this.database.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(711002)`;
      const keyHash = digest(this.config.secret);
      const current = await tx.authSecurityState.findUnique({ where: { id: 'csrf-key' } });
      if (current && current.csrfSecretHash !== keyHash) {
        await tx.authSession.updateMany({ where: { revokedAt: null }, data: { revokedAt: new Date() } });
        await tx.anonymousAuthContext.deleteMany();
      }
      await tx.authSecurityState.upsert({ where: { id: 'csrf-key' },
        create: { id: 'csrf-key', csrfSecretHash: keyHash }, update: { csrfSecretHash: keyHash } });
    });
  }

  private csrf(type: 'session' | 'anonymous', token: string) {
    return createHmac('sha256', this.config.secret).update(`${type}:${token}`).digest('base64url');
  }
  private cookie(response: Response, name: string, value: string, maxAge: number) {
    response.append('Set-Cookie', stringifySetCookie({ name, value, httpOnly: true, sameSite: 'lax',
      secure: this.config.secure, path: '/', maxAge }));
  }
  private cookies(request: Request) { return parseCookie(request.headers.cookie ?? ''); }

  async session(request: AuthRequest): Promise<ActiveSession | null> {
    if (request.authSession !== undefined) return request.authSession;
    request.authSession = null;
    const token = this.cookies(request)[sessionCookie];
    if (!tokenValid(token)) return null;
    const now = new Date();
    const record = await this.database.authSession.findUnique({ where: { tokenHash: digest(token) }, include: { user: true } });
    if (!record || record.revokedAt || record.expiresAt <= now || now.getTime() - record.lastSeenAt.getTime() >= day ||
      !matches(record.csrfHash, digest(this.csrf('session', token)))) return null;
    if (now.getTime() - record.lastSeenAt.getTime() >= 5 * minute) {
      // Compare the read timestamp as well: concurrent requests cannot move lastSeenAt backwards.
      const updated = await this.database.authSession.updateMany({ where: {
        id: record.id, revokedAt: null, lastSeenAt: record.lastSeenAt, expiresAt: { gt: now },
      }, data: { lastSeenAt: now } });
      if (!updated.count) {
        const latest = await this.database.authSession.findUnique({ where: { id: record.id } });
        if (!latest || latest.revokedAt || latest.expiresAt <= now || now.getTime() - latest.lastSeenAt.getTime() >= day) return null;
      }
    }
    request.authSession = { record, token, principal: {
      user_id: record.user.id, username: record.user.username, auth_session_id: record.id,
    } };
    return request.authSession;
  }
  async requirePrincipal(request: AuthRequest) {
    const active = await this.session(request);
    if (!active) throw new ApiError(401, 'unauthenticated', '请先登录');
    request.principal = active.principal;
    return active.principal;
  }

  async protectMutation(request: AuthRequest) {
    if (request.headers.origin !== this.config.origin) throw new ApiError(403, 'csrf_failed', '请求来源或安全令牌无效，请刷新页面');
    const supplied = request.headers['x-csrf-token'];
    if (typeof supplied !== 'string' || supplied.length !== 43) throw new ApiError(403, 'csrf_failed', '请求来源或安全令牌无效，请刷新页面');
    const active = await this.session(request);
    if (active) {
      if (matches(active.record.csrfHash, digest(supplied))) return;
    } else {
      const token = this.cookies(request)[anonymousCookie];
      if (tokenValid(token)) {
        const record = await this.database.anonymousAuthContext.findUnique({ where: { tokenHash: digest(token) } });
        if (record && record.expiresAt > new Date() && matches(record.csrfHash, digest(supplied)) &&
          matches(record.csrfHash, digest(this.csrf('anonymous', token)))) return;
      }
    }
    throw new ApiError(403, 'csrf_failed', '请求来源或安全令牌无效，请刷新页面');
  }

  async limit(request: Request, operation: 'csrf' | 'register' | 'login', username?: string) {
    const ip = request.ip ?? request.socket.remoteAddress ?? 'unknown';
    const rules = operation === 'csrf' ? [{ key: `csrf:ip:${digest(ip)}`, ms: minute, max: 60 }]
      : operation === 'register' ? [{ key: `register:ip:${digest(ip)}`, ms: hour, max: 10 }]
      : [{ key: `login:ip:${digest(ip)}`, ms: 15 * minute, max: 30 },
        ...(username ? [{ key: `login:user:${digest(username)}`, ms: 15 * minute, max: 10 }] : [])];
    rules.sort((a, b) => a.key.localeCompare(b.key));
    const retryAfter = await this.database.$transaction(async tx => {
      const now = new Date();
      const records: { key: string; attempts: Date[]; expiresAt: Date }[] = [];
      let retry = 0;
      for (const rule of rules) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${rule.key}))`;
        const row = await tx.authRateLimit.findUnique({ where: { key: rule.key } });
        const attempts = (row?.attempts ?? []).filter(value => value.getTime() > now.getTime() - rule.ms);
        if (attempts.length >= rule.max) retry = Math.max(retry, Math.ceil((attempts[0]!.getTime() + rule.ms - now.getTime()) / 1000));
        records.push({ key: rule.key, attempts: [...attempts, now], expiresAt: new Date(now.getTime() + rule.ms) });
      }
      if (!retry) for (const row of records) await tx.authRateLimit.upsert({ where: { key: row.key }, create: row, update: row });
      return retry;
    });
    if (retryAfter) throw new ApiError(429, 'rate_limited', '请求过于频繁，请稍后重试', retryAfter);
  }

  async csrfContext(request: AuthRequest, response: Response) {
    await this.limit(request, 'csrf');
    const active = await this.session(request);
    if (active) return { csrf_token: this.csrf('session', active.token) };
    const token = this.cookies(request)[anonymousCookie];
    if (tokenValid(token)) {
      const record = await this.database.anonymousAuthContext.findUnique({ where: { tokenHash: digest(token) } });
      if (record && record.expiresAt > new Date() && matches(record.csrfHash, digest(this.csrf('anonymous', token)))) {
        return { csrf_token: this.csrf('anonymous', token) };
      }
    }
    const next = newToken();
    const csrf = this.csrf('anonymous', next);
    await this.database.anonymousAuthContext.create({ data: {
      tokenHash: digest(next), csrfHash: digest(csrf), expiresAt: new Date(Date.now() + 30 * minute),
    } });
    this.cookie(response, anonymousCookie, next, 30 * 60);
    this.cookie(response, sessionCookie, '', 0);
    return { csrf_token: csrf };
  }

  private credentials(body: unknown) {
    const result = credentialsSchema.safeParse(body);
    if (!result.success || Buffer.byteLength(result.data.password, 'utf8') > 512) {
      throw new ApiError(422, 'invalid_request', '用户名须为 3–32 个字母、数字或下划线，密码须为 6–128 个 Unicode 字符');
    }
    return result.data;
  }
  async register(request: Request, body: unknown) {
    await this.limit(request, 'register');
    const { username, password } = this.credentials(body);
    if (commonPasswords.has(password)) throw new ApiError(422, 'invalid_request', '此密码过于常见，请换一个更长且独特的密码');
    const passwordHash = await hash(password, argonOptions);
    try {
      const user = await this.database.user.create({ data: { username, passwordHash } });
      return { user_id: user.id, username: user.username };
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ApiError(409, 'username_unavailable', '用户名已被使用');
      throw error;
    }
  }
  async login(request: AuthRequest, response: Response, body: unknown) {
    // Invalid requests consume the IP quota too; only valid normalized usernames get a username bucket.
    const parsed = credentialsSchema.safeParse(body);
    await this.limit(request, 'login', parsed.success ? parsed.data.username : undefined);
    const { username, password } = this.credentials(body);
    const user = await this.database.user.findUnique({ where: { username } });
    const valid = await verify(user?.passwordHash ?? this.dummyHash, password);
    if (!user || !valid) throw new ApiError(401, 'invalid_credentials', '用户名或密码错误');
    const token = newToken();
    const csrf = this.csrf('session', token);
    const current = await this.session(request);
    const anonymous = this.cookies(request)[anonymousCookie];
    await this.database.$transaction(async tx => {
      if (current) {
        const revoked = await tx.authSession.updateMany({ where: { id: current.record.id, revokedAt: null }, data: { revokedAt: new Date() } });
        if (!revoked.count) throw new ApiError(409, 'auth_context_changed', '登录状态已改变，请刷新后重试');
      } else if (tokenValid(anonymous)) {
        const consumed = await tx.anonymousAuthContext.deleteMany({ where: { tokenHash: digest(anonymous), expiresAt: { gt: new Date() } } });
        if (!consumed.count) throw new ApiError(409, 'auth_context_changed', '登录状态已改变，请刷新后重试');
      } else throw new ApiError(403, 'csrf_failed', '请刷新后重试');
      const now = new Date();
      await tx.authSession.create({ data: { userId: user.id, tokenHash: digest(token), csrfHash: digest(csrf),
        createdAt: now, lastSeenAt: now, expiresAt: new Date(now.getTime() + 7 * day) } });
    });
    this.cookie(response, sessionCookie, token, 7 * 24 * 60 * 60);
    this.cookie(response, anonymousCookie, '', 0);
    return { user_id: user.id, username: user.username, csrf_token: csrf };
  }
  async logout(request: AuthRequest, response: Response, body: unknown) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) {
      throw new ApiError(422, 'invalid_request', '退出请求须为空对象');
    }
    const principal = await this.requirePrincipal(request);
    await this.database.authSession.updateMany({ where: { id: principal.auth_session_id, revokedAt: null }, data: { revokedAt: new Date() } });
    this.cookie(response, sessionCookie, '', 0);
    this.cookie(response, anonymousCookie, '', 0);
    return { logged_out: true };
  }
}
