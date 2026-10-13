import { createHash } from 'node:crypto';
import { canonicalJson } from '@ai-engine/contracts';
import type { PrismaClient, Prisma } from '../generated/prisma/client.js';
import { ApiError } from '../auth/errors.js';

export const canonical = canonicalJson;
export const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
export const asJson = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export function revisionNumber(value: bigint): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new ApiError(500, 'internal_error', '数据修订无效');
  return number;
}
export function conflict(revision: bigint): never {
  throw new ApiError(409, 'revision_conflict', '内容已经变化，请重新读取后再操作', undefined, [{ revision: revisionNumber(revision) }]);
}
export function unavailable(): never { throw new ApiError(404, 'object_unavailable', '此对象不可用'); }
export async function lockDraft(tx: Prisma.TransactionClient, owner: string, id: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${canonical(['draft', owner, id])}, 0))`;
  const draft = await tx.scenarioDraft.findFirst({ where: { id, ownerUserId: owner } });
  if (!draft) unavailable();
  return draft;
}
export async function businessWrite<T>(database: PrismaClient, owner: string, operation: string, source: string,
  requestId: string, input: unknown, run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return database.$transaction(async tx => {
    const key = { ownerUserId: owner, operation, sourceId: source, requestId };
    const hash = digest(input);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${canonical(key)}, 0))`;
    const previous = await tx.processedRequest.findUnique({ where: { ownerUserId_operation_sourceId_requestId: key } });
    if (previous) {
      if (previous.inputHash !== hash) throw new ApiError(409, 'request_conflict', '请求标识已用于不同内容');
      return previous.result as T;
    }
    const result = await run(tx);
    await tx.processedRequest.create({ data: { ...key, inputHash: hash, result: asJson(result) } });
    return result;
  });
}
