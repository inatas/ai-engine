import { z } from 'zod';
import { scenarioSchema, draftWithinLimits } from './index.js';
import { atPath } from './authoring.js';

interface ShapeProblem { path: (string | number)[]; message: string }
type SchemaNode = Record<string, unknown>;
let specification: SchemaNode | undefined;
// Derive known types and property names from the authoritative DSL; missing required content is allowed in drafts.
export function draftShapeProblems(definition: unknown): ShapeProblem[] {
  if (!draftWithinLimits(definition)) return [{ path: [], message: '定义过深或过大' }];
  specification ??= z.toJSONSchema(scenarioSchema) as SchemaNode;
  const visit = (node: SchemaNode, value: unknown, path: (string | number)[]): ShapeProblem[] => {
    if (typeof node.$ref === 'string') {
      const target = atPath(specification, node.$ref.replace(/^#\//, '').split('/').map(part => part.replaceAll('~1', '/').replaceAll('~0', '~')));
      if (!target || typeof target !== 'object') throw new Error('DSL schema 引用不可解析');
      return visit(target as SchemaNode, value, path);
    }
    if (Array.isArray(node.anyOf) || Array.isArray(node.oneOf)) {
      const branches = (node.anyOf ?? node.oneOf) as SchemaNode[];
      const problems = branches.map(branch => visit(branch, value, path));
      if (problems.some(items => items.length === 0)) return [];
      return [{ path, message: '节点类型、字段或分支不符合 DSL' }];
    }
    const fail = (message: string): ShapeProblem[] => [{ path, message }];
    if (Object.hasOwn(node, 'const') && value !== node.const || Array.isArray(node.enum) && !node.enum.includes(value)) return fail('不支持的枚举值');
    if (node.type === 'object') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('应为对象');
      const properties = node.properties as Record<string, SchemaNode> | undefined;
      return Object.entries(value).flatMap(([key, child]) => {
        const schema = properties?.[key];
        if (schema) return visit(schema, child, [...path, key]);
        if (node.additionalProperties === false) return [{ path: [...path, key], message: '不支持的字段' }];
        if (node.additionalProperties && typeof node.additionalProperties === 'object') return visit(node.additionalProperties as SchemaNode, child, [...path, key]);
        return [];
      });
    }
    if (node.type === 'array') {
      if (!Array.isArray(value)) return fail('应为列表');
      return node.items && typeof node.items === 'object' ? value.flatMap((child, index) => visit(node.items as SchemaNode, child, [...path, index])) : [];
    }
    if (node.type === 'integer' && (typeof value !== 'number' || !Number.isSafeInteger(value))) return fail('应为安全整数');
    if (node.type === 'string' && typeof value !== 'string' || node.type === 'boolean' && typeof value !== 'boolean' || node.type === 'null' && value !== null) return fail('字段类型不符合 DSL');
    return [];
  };
  return visit(specification, definition, []);
}
