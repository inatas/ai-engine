import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDatabase } from './database.js';
import { createApp } from './app.js';

const envPath = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);
const database = createDatabase();
const app = await createApp(database);
app.enableShutdownHooks();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void database.$disconnect(); });
await app.listen(Number(process.env.PORT ?? 3000), '127.0.0.1');
console.info('本地 API 已就绪');
