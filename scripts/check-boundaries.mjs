import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const forbidden = new Set([
  'process', 'global', 'globalThis', 'window', 'self', 'document', 'navigator',
  'fetch', 'WebSocket', 'XMLHttpRequest', 'localStorage', 'sessionStorage',
  'Date', 'Math', 'performance', 'crypto', 'setTimeout', 'setInterval',
  'setImmediate', 'queueMicrotask', 'eval', 'Function', 'require', 'console',
  'Reflect', 'Proxy',
  'module', 'exports',
]);
const portable = p => p.replaceAll('\\', '/');
const packageRoots = ['contracts', 'engine'].map(name => path.join(root, 'packages', name));
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const p = path.join(directory, entry.name);
    return entry.isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}
export function inspectSource(source, filename, options) {
  const node = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const errors = [];
  const pkg = packageRoots.find(p => filename.startsWith(p + path.sep));
  if (!pkg) return errors;
  const name = path.basename(pkg);
  const report = (n, message) => {
    const pos = node.getLineAndCharacterOfPosition(n.getStart(node));
    errors.push({ line: pos.line + 1, column: pos.character + 1, message });
  };
  for (const diagnostic of node.parseDiagnostics) {
    const pos = node.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    errors.push({ line: pos.line + 1, column: pos.character + 1, message: '源码语法错误' });
  }
  function checkImport(n, specifier) {
    if (!ts.isStringLiteral(specifier)) { report(n, '非静态导入被禁止'); return; }
    const spec = specifier.text;
    const permitted = name === 'engine' ? '@ai-engine/contracts' : 'zod';
    if (!spec.startsWith('.') && spec !== permitted) report(n, '非白名单导入：' + spec);
    const resolved = ts.resolveModuleName(spec, filename, options, ts.sys).resolvedModule;
    if (!resolved) { report(n, '无法解析依赖：' + spec); return; }
    const target = fs.realpathSync(resolved.resolvedFileName);
    if (spec.startsWith('.')) {
      if (!target.startsWith(pkg + path.sep + 'src' + path.sep)) report(n, '跨包或非生产源码导入');
    } else if (spec === '@ai-engine/contracts') {
      if (!target.startsWith(path.join(root, 'packages', 'contracts') + path.sep)) report(n, '契约导入解析到非白名单目标');
    } else if (spec === 'zod' && !portable(target).includes('/node_modules/zod/')) report(n, 'Zod 导入解析到非白名单目标');
  }
  function visit(n) {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) {
      if (n.moduleSpecifier) checkImport(n, n.moduleSpecifier);
    }
    if (ts.isImportTypeNode(n)) {
      if (ts.isLiteralTypeNode(n.argument)) checkImport(n, n.argument.literal);
      else report(n, '禁止非静态类型导入');
    }
    if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference)) report(n, '禁止 require 风格导入');
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) report(n, '禁止动态导入');
    if (ts.isIdentifier(n) && forbidden.has(n.text)) report(n, '禁止外部或不确定 API：' + n.text);
    if (ts.isPropertyAccessExpression(n) && ['constructor', '__proto__'].includes(n.name.text)) report(n, '禁止反射构造器访问');
    if (ts.isElementAccessExpression(n) && ts.isStringLiteral(n.argumentExpression) && ['constructor', '__proto__'].includes(n.argumentExpression.text)) report(n, '禁止反射构造器访问');
    ts.forEachChild(n, visit);
  }
  if (/eslint-disable|@ts-ignore|@ts-nocheck/.test(source)) errors.push({ line: 1, column: 1, message: '禁止绕过边界或类型检查' });
  visit(node);
  return errors;
}
export function checkBoundaries() {
  const errors = [];
  const manifest = p => JSON.parse(fs.readFileSync(p, 'utf8'));
  for (const pkg of packageRoots) {
    const config = ts.readConfigFile(path.join(pkg, 'tsconfig.json'), ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, pkg);
    if (parsed.options.types?.length || parsed.options.lib?.some(lib => lib.includes('dom'))) errors.push(pkg + ': 禁止 Node/DOM/测试全局类型');
    const p = manifest(path.join(pkg, 'package.json'));
    const allowed = path.basename(pkg) === 'engine' ? ['@ai-engine/contracts'] : ['zod'];
    for (const name of Object.keys({ ...p.dependencies, ...p.optionalDependencies, ...p.peerDependencies })) {
      if (!allowed.includes(name)) errors.push(pkg + ': 非白名单依赖 ' + name);
    }
    // Inspect the approved dependency's manifest too; new indirect dependencies require review.
    const external = manifest(path.join(root, 'packages/contracts/node_modules/zod/package.json'));
    if (Object.keys({ ...external.dependencies, ...external.optionalDependencies, ...external.peerDependencies }).length) errors.push('Zod 新增传递依赖，需要批准');
    for (const file of files(path.join(pkg, 'src'))) {
      for (const error of inspectSource(fs.readFileSync(file, 'utf8'), file, parsed.options)) errors.push(portable(path.relative(root, file)) + ':' + error.line + ' ' + error.message);
    }
  }
  return errors;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = checkBoundaries();
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log('核心依赖、路径解析、传递依赖与 API 边界检查通过');
}
