import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDatabase } from './database.js';
const db = createDatabase();
const username = 'transaction-probe-' + randomUUID();
const marker = new Error('intentional rollback');
try {
  await db.$queryRaw`SELECT 1`;
  await assert.rejects(db.$transaction(async tx => {
    await tx.user.create({ data: { username, passwordHash: 'not-a-login-hash' } });
    throw marker;
  }), error => error === marker);
  assert.equal(await db.user.count({ where: { username } }), 0);
  // Commit and read a JSONB draft, then remove only this probe's data.
  const user = await db.user.create({ data: { username, passwordHash: 'not-a-login-hash' } });
  try {
    const draft = await db.$transaction(tx => tx.scenarioDraft.create({
      data: { ownerUserId: user.id, name: 'database-probe', document: { metadata: { name: '事务验证' } } },
    }));
    const stored = await db.scenarioDraft.findFirstOrThrow({ where: { id: draft.id, ownerUserId: user.id } });
    assert.deepEqual(stored.document, { metadata: { name: '事务验证' } });
    assert.equal(stored.revision, 0n);
  } finally { await db.user.delete({ where: { id: user.id } }); }
  console.log('PostgreSQL 连接、Prisma 事务回滚与 JSONB 持久化验证通过');
} finally { await db.$disconnect(); }
