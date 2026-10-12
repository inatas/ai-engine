import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';
export function createDatabase(connectionString = process.env.DATABASE_URL ?? 'postgresql://ai_engine:ai_engine_local@127.0.0.1:55432/ai_engine') {
  if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) throw new Error('正式环境必须设置 DATABASE_URL');
  const schema = new URL(connectionString).searchParams.get('schema') ?? 'public';
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema }) });
}
