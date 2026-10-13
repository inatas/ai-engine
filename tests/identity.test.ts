import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
function reply(data: unknown, status = 200) {
  return new Response(JSON.stringify(status === 200 ? { data } : { error: { code: 'unauthenticated', message: '请登录' } }),
    { status, headers: { 'Content-Type': 'application/json' } });
}
async function fixture() {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('BroadcastChannel', undefined);
  return import('../apps/web/src/identity.js');
}
it('迟到的匿名 me 响应不会覆盖后完成的登录身份', async () => {
  let resolveMe!: (response: Response) => void;
  const delayedMe = new Promise<Response>(resolve => { resolveMe = resolve; });
  vi.stubGlobal('fetch', vi.fn((url: string) => url.endsWith('/me') ? delayedMe : Promise.resolve(
    url.endsWith('/csrf') ? reply({ csrf_token: 'anonymous' }) : reply({ user_id: 'one', username: 'captain', csrf_token: 'session' }))));
  const identity = await fixture();
  const refreshing = identity.refreshIdentity();
  await identity.submitCredentials('login', { username: 'captain', password: 'mock-only-not-a-credential' });
  resolveMe(reply(null, 401));
  expect(await refreshing).toEqual({ user_id: 'one', username: 'captain' });
});
it('退出由服务端确认后发身份事件；失败不报告成功，不写浏览器存储', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(reply({ csrf_token: 'anonymous' }))
    .mockResolvedValueOnce(reply({ user_id: 'one', username: 'captain', csrf_token: 'session' }))
    .mockRejectedValueOnce(new Error('network lost')).mockResolvedValueOnce(reply({ logged_out: true }));
  vi.stubGlobal('fetch', fetcher);
  const identity = await fixture();
  const changes: unknown[] = [];
  window.addEventListener(identity.identityEvent, event => changes.push((event as CustomEvent).detail.current));
  await identity.submitCredentials('login', { username: 'captain', password: 'mock-only-not-a-credential' });
  await expect(identity.logout()).rejects.toThrow('network lost');
  expect(changes).toEqual([{ user_id: 'one', username: 'captain' }]);
  await identity.logout();
  expect(changes).toEqual([{ user_id: 'one', username: 'captain' }, null]);
  expect(fetcher.mock.calls[2]![1].headers['X-CSRF-Token']).toBe('session');
});
it('刷新检测到另一账号后，迟到的私人业务响应被丢弃', async () => {
  let finish!: (response: Response) => void;
  const delayed = new Promise<Response>(resolve => { finish = resolve; });
  let username = 'one';
  const fetcher = vi.fn((url: string) => url.endsWith('/drafts/private') ? delayed : Promise.resolve(url.endsWith('/me') ? reply({ user_id: username, username }) : reply({ csrf_token: 'test-token' })));
  vi.stubGlobal('fetch', fetcher);
  const identity = await fixture(); await identity.refreshIdentity();
  const pending = identity.api('drafts/private'); username = 'two'; await identity.refreshIdentity();
  finish(reply({ document: 'private-to-one' })); await expect(pending).rejects.toMatchObject({ code: 'identity_changed' });
});
