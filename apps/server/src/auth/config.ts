import { isIP } from 'node:net';

export interface AuthConfig { origin: string; secret: Buffer; secure: boolean; trustedProxyIps: string[] }
export function authConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const origin = env.AUTH_ORIGIN;
  if (!origin) throw new Error('必须配置 AUTH_ORIGIN');
  const url = new URL(origin);
  if (url.origin !== origin || url.username || url.password) throw new Error('AUTH_ORIGIN 必须是精确来源');
  const secure = url.protocol === 'https:';
  if (env.NODE_ENV === 'production' ? !secure : !secure &&
    !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) {
    throw new Error('生产必须 HTTPS，开发 HTTP 仅限回环来源');
  }
  const encoded = env.CSRF_SECRET ?? '';
  const secret = Buffer.from(encoded, 'base64url');
  if (!/^[A-Za-z0-9_-]+$/.test(encoded) || secret.length < 32 || secret.toString('base64url') !== encoded) {
    throw new Error('CSRF_SECRET 必须是至少 32 字节随机密钥的 base64url 编码');
  }
  const trustedProxyIps = (env.TRUSTED_PROXY_IPS ?? '').split(',').filter(Boolean);
  if (trustedProxyIps.some(ip => !isIP(ip))) throw new Error('可信代理只接受明确 IP');
  return { origin, secret, secure, trustedProxyIps };
}
