import tseslint from 'typescript-eslint';
import ts from 'typescript';
import path from 'node:path';
import { inspectSource } from './scripts/check-boundaries.mjs';
export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'coverage/**'] },
  {
    files: ['packages/*/src/**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    plugins: {
      boundaries: { rules: {
        pure: {
          meta: { type: 'problem', schema: [] },
          create(context) {
            return { Program() {
              const file = context.filename;
              const configFile = ts.findConfigFile(path.dirname(file), ts.sys.fileExists);
              if (!configFile) throw new Error('核心源码缺少 tsconfig');
              const pkg = path.dirname(configFile);
              const config = ts.readConfigFile(configFile, ts.sys.readFile);
              const options = ts.parseJsonConfigFileContent(config.config, ts.sys, pkg).options;
              for (const error of inspectSource(context.sourceCode.text, file, options)) {
                context.report({ loc: { line: error.line, column: error.column - 1 }, message: error.message });
              }
            }};
          },
        },
      }},
    },
    rules: { 'boundaries/pure': 'error' },
  },
);
