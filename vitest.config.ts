import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: { '@ai-engine/contracts': fileURLToPath(new URL('./packages/contracts/src/index.ts', import.meta.url)) } },
  test: { include: ['tests/**/*.test.ts'], exclude: ['tests/auth.test.ts'], testTimeout: 30000 },
});
