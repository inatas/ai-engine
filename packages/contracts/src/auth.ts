import { z } from 'zod';

export const credentialsSchema = z.strictObject({
  username: z.string().regex(/^[A-Za-z0-9_]{3,32}$/).transform(value => value.toLowerCase()),
  password: z.string().refine(value => {
    const length = [...value].length;
    // Four bytes at most per Unicode code point; 128 code points fit 512 UTF-8 bytes.
    // Reject unpaired surrogates so the application never hashes a rewritten string.
    return length >= 6 && length <= 128 && [...value].every(character => !/^[\uD800-\uDFFF]$/.test(character));
  }, '密码须为 6–128 个 Unicode 字符'),
});
export const userSummarySchema = z.strictObject({ user_id: z.string(), username: z.string() });
export type UserSummary = z.infer<typeof userSummarySchema>;
export interface IdentityChange { previous: UserSummary | null; current: UserSummary | null }
