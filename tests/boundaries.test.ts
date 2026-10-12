import { expect, it } from 'vitest';
import ts from 'typescript';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
// The build checker and ESLint use the same AST inspection.
// @ts-expect-error Script has no generated declarations.
import { inspectSource, checkBoundaries } from '../scripts/check-boundaries.mjs';
const filename = path.resolve('packages/engine/src/boundary-fixture.ts');
const config = ts.readConfigFile('packages/engine/tsconfig.json', ts.sys.readFile);
const options = ts.parseJsonConfigFileContent(config.config, ts.sys, path.resolve('packages/engine')).options;
const cases = [
  "import fs from 'node:fs';",
  "import type { INestApplication } from '@nestjs/common';",
  "export * from '../../contracts/src/index.js';",
  "import '../../contracts/src/index.js';",
  "import('node:fs');",
  "const load = import; load('node:fs');",
  "require('fs');",
  "import fs = require('node:fs');",
  "type Hidden = import('node:fs').Stats;",
  "fetch('https://example.com');",
  "globalThis['fetch']('https://example.com');",
  "const g = globalThis; g.fetch('https://example.com');",
  "const { fetch: f } = globalThis; f('https://example.com');",
  "const { random } = Math; random();",
  "new Date();",
  "process.env.SECRET;",
  "window.localStorage;",
  "setTimeout(() => {}, 1);",
  "eval('1');",
  "const F = Function; new F('return 1');",
  "({}).constructor.constructor('return process')();",
  "// eslint-disable-next-line\nfetch('x');",
];
for (const source of cases) it('边界拒绝 ' + source.slice(0, 50), () => {
  expect(inspectSource(source, filename, options).length).toBeGreaterThan(0);
});
it('合法契约公开入口与局部引用可解析', () => {
  expect(inspectSource("import type { World } from '@ai-engine/contracts'; import { validateWorld } from './validate.js';", filename, options)).toEqual([]);
});
it('别名解析到应用层拒绝', () => {
  const aliasOptions = { ...options, baseUrl: path.resolve('.'), paths: { '@escape': ['apps/server/src/main.ts'] } };
  expect(inspectSource("import '@escape';", filename, aliasOptions).length).toBeGreaterThan(0);
});
it('中间契约包无法绕过 CI，违规时检查进程失败', () => {
  const fixture = path.resolve('packages/contracts/src/boundary-test-only.ts');
  try {
    fs.writeFileSync(fixture, "export * from '../../../apps/server/src/main.js';");
    expect(checkBoundaries().length).toBeGreaterThan(0);
    const result = spawnSync(process.execPath, ['scripts/check-boundaries.mjs'], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('跨包');
  } finally { fs.rmSync(fixture, { force: true }); }
  expect(checkBoundaries()).toEqual([]);
});
