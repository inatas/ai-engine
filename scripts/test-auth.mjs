import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDatabase } from '../apps/server/dist/database.js';

const envPath = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);
// Every run owns a separate PostgreSQL schema, including rate limits and fault-injection objects.
const schema = `auth_test_${randomUUID().replaceAll('-', '')}`;
const connection = new URL(process.env.DATABASE_URL ?? 'postgresql://ai_engine:ai_engine_local@127.0.0.1:55432/ai_engine');
const admin = createDatabase(connection.toString());
connection.searchParams.set('schema', schema);
const env = { ...process.env, DATABASE_URL: connection.toString() };
const pnpm = process.env.npm_execpath;
if (!pnpm) throw new Error('请通过 pnpm test:auth 执行');
try {
  execFileSync(process.execPath, [pnpm, '--filter', '@ai-engine/server', 'db:push'], { env, stdio: 'inherit' });
  execFileSync(process.execPath, [pnpm, 'exec', 'vitest', 'run', '--config', 'vitest.auth.config.ts'], { env, stdio: 'inherit' });
} finally {
  if (!/^auth_test_[a-f0-9]{32}$/.test(schema)) throw new Error('测试 schema 不合法');
  await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.$disconnect();
}
