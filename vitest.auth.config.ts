import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: { '@ai-engine/contracts': fileURLToPath(new URL('./packages/contracts/src/index.ts', import.meta.url)) } },
  esbuild: { tsconfigRaw: { compilerOptions: { experimentalDecorators: true } } },
  test: { include: ['tests/auth.test.ts'], testTimeout: 30000, hookTimeout: 30000, fileParallelism: false },
});
