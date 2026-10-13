import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const path = new URL('../.env', import.meta.url);
let content = readFileSync(existsSync(path) ? path : new URL('../.env.example', import.meta.url), 'utf8');
if (!/^AUTH_ORIGIN=/m.test(content)) content += '\nAUTH_ORIGIN=http://127.0.0.1:5173\n';
for (const name of ['MODEL_API_URL', 'MODEL_API_KEY', 'MODEL_NAME']) {
  if (!new RegExp(`^${name}=`, 'm').test(content)) content += `\n${name}=\n`;
}
if (!/^CSRF_SECRET=.+$/m.test(content)) {
  const entry = `CSRF_SECRET=${randomBytes(32).toString('base64url')}`;
  content = /^CSRF_SECRET=.*$/m.test(content) ? content.replace(/^CSRF_SECRET=.*$/m, entry) : `${content}\n${entry}\n`;
}
writeFileSync(path, content);
console.log('本地配置已准备，随机密钥仅保存到忽略提交的 .env；重复执行保留已有密钥。');
