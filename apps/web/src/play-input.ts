import type { Parameter, Scalar } from '@ai-engine/contracts';

export function actionInputProblems(parameters: Record<string, Parameter>, values: Record<string, Scalar>): Record<string, string> {
  return Object.fromEntries(Object.entries(parameters).flatMap(([key, parameter]) => {
    const value = values[key];
    if (value === undefined) return [[key, '请填写或选择此项']];
    if (parameter.type === 'integer' && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < parameter.min || value > parameter.max)) return [[key, `请输入 ${parameter.min}～${parameter.max} 的整数`]];
    if (parameter.type === 'boolean' && typeof value !== 'boolean') return [[key, '请选择是或否']];
    if (parameter.type === 'string' && typeof value !== 'string') return [[key, '请输入文本']];
    if (parameter.type === 'entity_ref' && (typeof value !== 'string' || !parameter.allowed_entity_ids.includes(value))) return [[key, '请选择此行动允许的对象']];
    return [];
  }));
}
