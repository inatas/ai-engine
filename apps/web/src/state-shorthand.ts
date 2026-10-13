import type { Audience, Field, Scalar } from '@ai-engine/contracts';

export interface NamedEntity { id: string; name: string; character?: boolean }
export function parseShorthand(input: string, key: string, owner: string | null, entities: NamedEntity[]): { declaration: Field; value: Scalar } {
  const match = /^\s*(.+?)\s*=\s*(.+?)\s+@(公开|私有|受众\(([^)]*)\))\s*$/.exec(input);
  if (!match) throw new Error('格式示例：体力 = 8 [0..10] 点 @公开');
  const label = match[1]!.trim(), body = match[2]!.trim();
  const resolve = (name: string, character = false) => {
    const rows = entities.filter(e => (!character || e.character) && (e.id === name.trim() || e.name === name.trim()));
    if (rows.length !== 1) throw new Error(`实体“${name}”不存在或重名，请使用明确标识`);
    return rows[0]!.id;
  };
  let visibility: Audience = 'public';
  if (match[3] === '私有') {
    if (!owner || !entities.some(e => e.id === owner && e.character)) throw new Error('私有属性需要归属角色；全局属性请明确受众');
    visibility = [owner];
  } else if (match[4] !== undefined) {
    visibility = match[4].split('|').map(name => resolve(name, true));
    if (!visibility.length || new Set(visibility).size !== visibility.length) throw new Error('受众必须为非空且不重复的角色');
  }
  const base = { key, label, owner_id: owner, visibility };
  const integer = /^(-?\d+)\s*\[(-?\d+)\.\.(-?\d+)\]\s*([^@]*)$/.exec(body);
  if (integer) {
    const [value, min, max] = integer.slice(1, 4).map(Number);
    if (![value, min, max].every(Number.isSafeInteger) || min! > max! || value! < min! || value! > max!) throw new Error('初值和范围须为安全整数，且初值在范围内');
    return { declaration: { ...base, type: 'integer', min: min!, max: max!, unit: integer[4]!.trim() || null }, value: value! };
  }
  if (body === 'true' || body === 'false') return { declaration: { ...base, type: 'boolean' }, value: body === 'true' };
  if (/^"(?:[^"\\]|\\.)*"$/.test(body)) {
    let value: unknown; try { value = JSON.parse(body); } catch { throw new Error('文本须用合法双引号包裹'); }
    if (typeof value === 'string') return { declaration: { ...base, type: 'string' }, value };
  }
  const reference = /^ref\(([^)]+)\)\s*\{([^}]+)\}$/.exec(body);
  if (reference) {
    const value = resolve(reference[1]!), allowed = reference[2]!.split('|').map(name => resolve(name));
    if (!allowed.includes(value) || new Set(allowed).size !== allowed.length) throw new Error('初始实体须在不重复的候选列表中');
    return { declaration: { ...base, type: 'entity_ref', allowed_entity_ids: allowed }, value };
  }
  throw new Error('仅支持带范围的整数、true/false、双引号文本或 ref(实体) {候选|候选}');
}
export function formatShorthand(field: Field, value: Scalar): string {
  const audience = field.visibility === 'public' ? '公开' : field.visibility.length === 1 && field.visibility[0] === field.owner_id ? '私有' : `受众(${field.visibility.join('|')})`;
  const body = field.type === 'integer' ? `${value} [${field.min}..${field.max}] ${field.unit ?? ''}`
    : field.type === 'entity_ref' ? `ref(${value}) {${field.allowed_entity_ids.join('|')}}` : JSON.stringify(value);
  return `${field.label} = ${body.trim()} @${audience}`;
}
