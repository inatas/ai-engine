import type { IdentityChange, UserSummary } from '@ai-engine/contracts';

let csrf: string | null = null;
let current: UserSummary | null = null;
let identityRevision = 0;
export const identityEvent = 'ai-engine:identity-change';
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('ai-engine-identity');
export class RequestError extends Error {
  constructor(public status: number, public code: string, message: string, public retryAfter?: number) { super(message); }
}
async function request<T>(path: string, body?: unknown): Promise<T> {
  const revision = identityRevision;
  const response = await fetch(`/api/auth/${path}`, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf ?? '' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json() as { data?: T; error?: { code: string; message: string } };
  if (!response.ok) {
    if (revision === identityRevision) {
      if (result.error?.code === 'unauthenticated' && path !== 'me') changed(null);
      if (response.status === 403 || result.error?.code === 'auth_context_changed') csrf = null;
    }
    throw new RequestError(response.status, result.error?.code ?? 'internal_error', result.error?.message ?? '请求失败',
      Number(response.headers.get('Retry-After')) || undefined);
  }
  return result.data!;
}
function changed(next: UserSummary | null) {
  const previous = current;
  current = next;
  if (previous?.user_id !== next?.user_id) {
    window.dispatchEvent(new CustomEvent<IdentityChange>(identityEvent, { detail: { previous, current } }));
  }
}
async function initializeCsrf() {
  const revision = identityRevision;
  const result = await request<{ csrf_token: string }>('csrf');
  if (revision === identityRevision) csrf = result.csrf_token;
}
export async function refreshIdentity(): Promise<UserSummary | null> {
  const revision = identityRevision;
  let user: UserSummary | null;
  try { user = await request<UserSummary>('me'); }
  catch (error) { if (!(error instanceof RequestError) || error.status !== 401) throw error; user = null; }
  if (revision !== identityRevision) return current;
  changed(user);
  await initializeCsrf();
  return revision === identityRevision ? user : current;
}
export async function submitCredentials(mode: 'login' | 'register', values: { username: string; password: string }) {
  if (mode === 'login') identityRevision++;
  if (!csrf) await initializeCsrf();
  const result = await request<UserSummary & { csrf_token?: string }>(mode, values);
  if (mode === 'login') {
    csrf = result.csrf_token!;
    changed({ user_id: result.user_id, username: result.username });
    channel?.postMessage('changed');
  }
  return result;
}
export async function logout() {
  identityRevision++;
  if (!csrf) await initializeCsrf();
  await request('logout', {});
  csrf = null;
  changed(null);
  channel?.postMessage('changed');
  // Logout already succeeded even when a later initialization is rate limited.
}
channel?.addEventListener('message', () => { identityRevision++; csrf = null; void refreshIdentity().catch(() => changed(null)); });
