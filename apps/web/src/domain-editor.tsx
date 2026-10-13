import React from 'react';
import { Alert, Button, Card, Collapse, Input, InputNumber, Modal, Select, Space, Switch, Tabs, Typography } from 'antd';
import { atPath, itemKey, references, fieldSchema, type DraftDocument, type Condition, type Target } from '@ai-engine/contracts';
import { writePath } from './workspace-state.js';
import { parseShorthand, formatShorthand } from './state-shorthand.js';

type Path = (string | number)[];
type ObjectValue = Record<string, unknown>;
export const labels: Record<Target['collection'], string> = { metadata: '剧本资料', world: '世界背景', player: '玩家', narrative: '开场与叙事', simulation: '自主行为',
  characters: '角色 / NPC', factions: '阵营', locations: '地点', fields: '状态', memories: '记忆', actions: '行动', events: '事件', objectives: '结局' };
const defaults: Record<string, () => unknown> = {
  characters: () => ({ id: makeId(), name: '新角色', description: '', faction_id: null, personality: [], goals: [], relationships: [] }),
  factions: () => ({ id: makeId(), name: '新阵营', description: '', goals: [] }), locations: () => ({ id: makeId(), name: '新地点', description: '' }),
  memories: () => ({ id: makeId(), text: '', audience: 'public' }),
  actions: () => ({ id: makeId(), name: '新行动', description: '', allowed_actor_ids: [], parameters: {}, conditions: { all: [] }, effects: [], visibility: 'public' }),
  events: () => ({ id: makeId(), name: '新事件', conditions: { all: [] }, effects: [], repeatable: false, visibility: 'public' }),
  objectives: () => ({ id: makeId(), name: '新结局', outcome: 'success', priority: 0, conditions: { all: [] }, visibility: 'public' }),
};
export function makeId() { return `item_${crypto.randomUUID().replaceAll('-', '')}`; }
interface Context { document: DraftDocument; change: (document: DraftDocument, historyKey?: string) => void; disabled?: boolean;
  rawInputs?: Record<string, string>; rawChange?: (key: string, value: string | null) => void;
  blockedReferences?: (paths: string[]) => void }
type IdentifierRequest = (message: string, initial: string, used: string[]) => Promise<string | null>;
const Editing = React.createContext<(Context & { requestIdentifier: IdentifierRequest; confirmEdit: (message: string) => Promise<boolean> }) | null>(null);
const typeLabels: Record<string, string> = { integer: '整数', boolean: '布尔', string: '文本', entity_ref: '实体引用' };
const useEditing = () => React.useContext(Editing)!;
function object(value: unknown): ObjectValue { return value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {}; }
function list(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function Control({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="editor-control"><span>{label}</span><div>{children}</div></label>;
}
function Text({ path, label, multiline = false }: { path: Path; label: string; multiline?: boolean }) {
  const { document, change } = useEditing(), value = atPath(document, path);
  const props = { value: typeof value === 'string' ? value : '', onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => change(writePath(document, path, e.target.value), '/' + path.join('/')), onBlur: () => change(document) };
  return <Control label={label}>{multiline ? <Input.TextArea {...props} autoSize={{ minRows: 2, maxRows: 10 }} /> : <Input {...props} />}
    {value !== undefined && typeof value !== 'string' && <Typography.Text type="danger">原值类型错误，输入新值以修复</Typography.Text>}</Control>;
}
function NumberField({ path, label }: { path: Path; label: string }) {
  const { document, change } = useEditing(); const value = atPath(document, path);
  return <Control label={label}><InputNumber stringMode={false} value={typeof value === 'number' ? value : null} precision={0}
    min={Number.MIN_SAFE_INTEGER} max={Number.MAX_SAFE_INTEGER} onChange={next => { if (next !== null) change(writePath(document, path, next)); }} /></Control>;
}
function Toggle({ path, label }: { path: Path; label: string }) {
  const { document, change } = useEditing();
  return <Control label={label}><Switch checked={atPath(document, path) === true} onChange={value => change(writePath(document, path, value))} /></Control>;
}
function Choose({ path, label, options, multiple = false, nullable = false }: { path: Path; label: string; options: { value: string; label: string }[]; multiple?: boolean; nullable?: boolean }) {
  const { document, change } = useEditing(); const value = atPath(document, path);
  const selected = multiple ? list(value).filter((v): v is string => typeof v === 'string') : typeof value === 'string' ? [value] : [];
  const available = [...selected.filter(v => !options.some(o => o.value === v)).map(v => ({ value: v, label: `缺失或不可用：${v}`, disabled: true })), ...options];
  return <Control label={label}><Select<string | string[] | undefined> showSearch optionFilterProp="label" style={{ width: '100%' }} allowClear={nullable}
    {...(multiple ? { mode: 'multiple' as const, value: list(value) as string[] } : { value: typeof value === 'string' ? value : undefined })}
    options={available} onChange={next => change(writePath(document, path, next ?? null))} /></Control>;
}
function entityOptions(document: DraftDocument, kind = 'all') {
  const entities = object(document.entities);
  return (kind === 'all' ? [...list(entities.characters), ...list(entities.factions), ...list(entities.locations)] : list(entities[kind]))
    .flatMap(value => { const row = object(value); return typeof row.id === 'string' ? [{ value: row.id, label: `${String(row.name || '未命名')} · ${row.id.slice(-6)}` }] : []; });
}
function AudienceEditor({ path }: { path: Path }) {
  const { document, change } = useEditing(), value = atPath(document, path);
  return <Control label="谁可以知道"><Select value={value === 'public' ? 'public' : 'selected'} options={[{ value: 'public', label: '公开' }, { value: 'selected', label: '指定角色' }]}
    onChange={next => change(writePath(document, path, next === 'public' ? 'public' : []))} />
    {value !== 'public' && <Choose path={path} label="受众角色" options={entityOptions(document, 'characters')} multiple />}</Control>;
}
function UnknownFields({ path, known }: { path: Path; known: string[] }) {
  const { document, change } = useEditing(), value = object(atPath(document, path));
  return <>{Object.keys(value).filter(key => !known.includes(key)).map(key => <Alert key={key} type="error" message={`不支持的字段：${key}`} action={<Button danger size="small" onClick={() => {
    const next = { ...value }; delete next[key]; change(writePath(document, path, next));
  }}>移除字段</Button>} />)}</>;
}
function ListEditor({ path, label, create, render, beforeDelete, hideAdd = false, filter, disableAdd = false }: { path: Path; label: string; create: () => unknown;
  render: (path: Path, value: unknown, index: number) => React.ReactNode; beforeDelete?: (index: number) => boolean; hideAdd?: boolean; filter?: (value: unknown) => boolean; disableAdd?: boolean }) {
  const { document, change } = useEditing(), raw = atPath(document, path), values = list(raw);
  const identified = path.length === 1 && ['actions', 'events', 'objectives'].includes(String(path[0])) || path.length === 2 &&
    (path[0] === 'entities' && ['characters', 'factions', 'locations'].includes(String(path[1])) || path[0] === 'initial_state' && path[1] === 'memories');
  const update = (next: unknown[]) => change(writePath(document, path, next));
  return <Space direction="vertical" style={{ width: '100%' }}>
    {raw !== undefined && !Array.isArray(raw) && <Alert type="error" message="原列表结构错误" action={<Button onClick={() => update([])}>清空并修复列表</Button>} />}
    {values.map((value, index) => filter && !filter(value) ? null : <Card size="small" data-definition-path={'/' + [...path, index].join('/')} key={`${String(object(value).id ?? object(value).key ?? '')}:${index}`} title={String(object(value).name ?? object(value).label ?? `${label} ${index + 1}`)} extra={<Space>
      <Button size="small" onClick={() => update([...values, identified ? { ...structuredClone(object(value)), id: makeId(), ...(typeof object(value).name === 'string' ? { name: String(object(value).name) + ' 副本' } : {}) } : structuredClone(value)])}>复制</Button>
      <Button size="small" disabled={index === 0} onClick={() => { const next = [...values]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; update(next); }}>上移</Button>
      <Button size="small" disabled={index === values.length - 1} onClick={() => { const next = [...values]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; update(next); }}>下移</Button>
      <Button size="small" danger onClick={() => { if (!beforeDelete || beforeDelete(index)) update(values.filter((_, i) => i !== index)); }}>删除</Button>
    </Space>}>
      {identified ? <IdentityRepair path={[...path, index]} values={values} /> : null}
      {render([...path, index], value, index)}</Card>)}
    {!hideAdd && <Button disabled={disableAdd || raw !== undefined && !Array.isArray(raw)} onClick={() => update([...values, create()])}>添加{label}</Button>}
  </Space>;
}
function TextList({ path, label }: { path: Path; label: string }) {
  return <ListEditor path={path} label={label} create={() => ''} render={p => <Text path={p} label={label} multiline />} />;
}
function IdentityRepair({ path, values }: { path: Path; values: unknown[] }) {
  const { document, change, confirmEdit } = useEditing(), value = atPath(document, [...path, 'id']);
  const candidates = path[0] === 'entities' ? ['characters', 'factions', 'locations'].flatMap(kind => list(object(document.entities)[kind])) : values;
  const valid = typeof value === 'string' && /^[a-zA-Z0-9_-]{1,120}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value) && candidates.filter(v => object(v).id === value).length === 1;
  if (valid) return null;
  return <Alert type="warning" message="标识缺失、非法或重复，需要显式修复" action={<Button onClick={async () => {
    if (await confirmEdit('重新生成此条目的标识？已有引用不会自动改绑，请根据校验问题明确选择目标。此修复可撤销。')) change(writePath(document, [...path, 'id'], makeId()));
  }}>重新生成标识</Button>} />;
}
function ScalarControl({ value, change, type, options = [], nonnegative = false }: { value: unknown; change: (value: unknown) => void; type: string; options?: { value: string; label: string }[]; nonnegative?: boolean }) {
  if (type === 'boolean') return <Select<string | undefined> value={typeof value === 'boolean' ? String(value) : undefined} placeholder="明确选择布尔初值" options={[{ value: 'true', label: 'true' }, { value: 'false', label: 'false' }]} onChange={next => { if (next !== undefined) change(next === 'true'); }} />;
  if (type === 'integer') return <InputNumber precision={0} min={nonnegative ? 0 : Number.MIN_SAFE_INTEGER} max={Number.MAX_SAFE_INTEGER} value={typeof value === 'number' ? value : null} onChange={next => { if (next !== null) change(next); }} />;
  if (type === 'entity_ref') return <Select value={typeof value === 'string' ? value : undefined} options={options} style={{ width: '100%' }} onChange={change} />;
  return <Input value={typeof value === 'string' ? value : ''} onChange={e => change(e.target.value)} />;
}
function OperandEditor({ path, parameters = {}, allowTurn = true, numericOnly = false, expectedType, allowedEntities, nonnegative = false }: { path: Path; parameters?: ObjectValue; allowTurn?: boolean; numericOnly?: boolean; expectedType?: string | undefined; allowedEntities?: unknown[] | undefined; nonnegative?: boolean }) {
  const { document, change } = useEditing(), value = object(atPath(document, path));
  const requiredType = numericOnly ? 'integer' : expectedType;
  const parameterKeys = Object.keys(parameters).filter(key => !requiredType || object(parameters[key]).type === requiredType);
  const kind = Object.hasOwn(value, 'field') ? 'field' : Object.hasOwn(value, 'parameter') ? 'parameter' : Object.hasOwn(value, 'turn') ? 'turn' : 'literal';
  const literalType = typeof value.literal === 'boolean' ? 'boolean' : typeof value.literal === 'number' ? 'integer' : 'string';
  return <Space direction="vertical" className="operand">
    <Select value={kind} options={[{ value: 'literal', label: '常量' }, { value: 'field', label: '状态' }, ...(parameterKeys.length ? [{ value: 'parameter', label: '行动参数' }] : []), ...(allowTurn ? [{ value: 'turn', label: '当前回合' }] : [])]}
      onChange={next => change(writePath(document, path, next === 'literal' ? { literal: requiredType === 'boolean' ? false : requiredType === 'string' || requiredType === 'entity_ref' ? '' : 0 } : next === 'turn' ? { turn: true } : { [next]: '' }))} />
    {kind === 'literal' ? <Space wrap><Select value={literalType} options={['integer', 'boolean', 'string'].map((type, i) => ({ value: type, label: ['整数', '布尔', '文本'][i] })).filter(option => !requiredType || option.value === (requiredType === 'entity_ref' ? 'string' : requiredType))}
      onChange={type => change(writePath(document, path, { literal: type === 'integer' ? 0 : type === 'boolean' ? false : '' }))} />
      <ScalarControl type={requiredType ?? literalType} value={value.literal} nonnegative={nonnegative} options={entityOptions(document).filter(e => !allowedEntities || allowedEntities.includes(e.value))} change={literal => change(writePath(document, path, { literal }))} />
      {!requiredType && literalType === 'string' && <Select<string | undefined> value={entityOptions(document).some(e => e.value === value.literal) ? String(value.literal) : undefined} placeholder="选择实体常量" options={entityOptions(document)} onChange={literal => { if (literal) change(writePath(document, path, { literal })); }} />}</Space>
      : kind === 'field' ? <Choose path={[...path, 'field']} label="状态" options={list(document.state_schema).filter(v => !requiredType || object(v).type === requiredType).map(v => ({ value: String(object(v).key), label: `${String(object(v).label)} · ${typeLabels[String(object(v).type)] ?? '类型待修复'}` }))} />
        : kind === 'parameter' ? <Choose path={[...path, 'parameter']} label="参数" options={parameterKeys.map(key => ({ value: key, label: key }))} /> : null}
    <UnknownFields path={path} known={[kind]} />
  </Space>;
}
export function ConditionEditor({ path, parameters = {}, depth = 0 }: { path: Path; parameters?: ObjectValue; depth?: number }) {
  const { document, change, confirmEdit } = useEditing(), value = object(atPath(document, path));
  const kind = 'all' in value ? 'all' : 'any' in value ? 'any' : 'not' in value ? 'not' : 'compare';
  if (depth > 40) return <Alert type="error" message="条件过深，请减少嵌套" />;
  return <div className="condition"><Select value={kind} options={[{ value: 'all', label: '全部满足（空列表 = 无条件）' }, { value: 'any', label: '任一满足（空列表 = 永不触发）' }, { value: 'not', label: '不满足' }, { value: 'compare', label: '比较' }]}
    onChange={async next => {
      if (next === kind || !await confirmEdit('确认转换条件节点？比较将替换原子结构，取反会包住当前节点，全部／任一转换保留原有子项。本次可撤销。')) return;
      change(writePath(document, path, next === 'compare' ? { operator: 'eq', left: { turn: true }, right: { literal: 1 } } : next === 'not' ? { not: value as Condition } : { [next]: kind === 'all' || kind === 'any' ? list(value[kind]) : [value] }));
    }} />
    {kind === 'all' || kind === 'any' ? <ListEditor path={[...path, kind]} label="条件" create={() => ({ operator: 'eq', left: { turn: true }, right: { literal: 1 } })}
      render={p => <ConditionEditor path={p} parameters={parameters} depth={depth + 1} />} /> : kind === 'not' ? <ConditionEditor path={[...path, 'not']} parameters={parameters} depth={depth + 1} />
      : <div className="comparison"><OperandEditor path={[...path, 'left']} parameters={parameters} numericOnly={value.operator !== 'eq' && value.operator !== 'ne'} />
        <Choose path={[...path, 'operator']} label="比较方式" options={['eq', 'ne', 'gt', 'gte', 'lt', 'lte'].map((v, i) => ({ value: v, label: ['等于', '不等于', '大于', '大于等于', '小于', '小于等于'][i]! }))} />
        <OperandEditor path={[...path, 'right']} parameters={parameters} numericOnly={value.operator !== 'eq' && value.operator !== 'ne'} /></div>}
    <UnknownFields path={path} known={kind === 'all' || kind === 'any' ? [kind] : kind === 'not' ? ['not'] : ['operator', 'left', 'right']} />
  </div>;
}
function Effects({ path, parameters = {} }: { path: Path; parameters?: ObjectValue }) {
  const { document, change } = useEditing(); const options = list(document.state_schema).map(v => ({ value: String(object(v).key), label: String(object(v).label) }));
  return <ListEditor path={path} label="后果" create={() => ({ type: 'add', field: '', value: { literal: 1 } })} render={(p, raw) => {
    const value = object(raw), type = value.type;
    return <><Control label="执行方式"><Select value={typeof type === 'string' ? type : undefined} options={[{ value: 'add', label: '增加 / 减少' }, { value: 'set', label: '设为' }, { value: 'transfer', label: '转移资源' }]}
      onChange={next => change(writePath(document, p, next === 'transfer' ? { type: next, from_field: '', to_field: '', amount: { literal: 1 } } : { type: next, field: '', value: { literal: 1 } }))} /></Control>
      {type === 'transfer' ? <><Choose path={[...p, 'from_field']} label="来源" options={options.filter(o => object(list(document.state_schema).find(f => object(f).key === o.value)).type === 'integer')} /><Choose path={[...p, 'to_field']} label="目标" options={options.filter(o => {
        const field = object(list(document.state_schema).find(f => object(f).key === o.value)), from = object(list(document.state_schema).find(f => object(f).key === value.from_field));
        return field.type === 'integer' && field.unit === from.unit && o.value !== value.from_field;
      })} /><OperandEditor path={[...p, 'amount']} parameters={parameters} allowTurn={false} numericOnly nonnegative /></>
        : <><Choose path={[...p, 'field']} label="状态" options={type === 'add' ? options.filter(o => object(list(document.state_schema).find(f => object(f).key === o.value)).type === 'integer') : options} /><OperandEditor path={[...p, 'value']} parameters={parameters} allowTurn={false} numericOnly={type === 'add'}
          expectedType={type === 'set' ? String(object(list(document.state_schema).find(f => object(f).key === value.field)).type || '') || undefined : undefined}
          allowedEntities={type === 'set' && object(list(document.state_schema).find(f => object(f).key === value.field)).type === 'entity_ref' ? list(object(list(document.state_schema).find(f => object(f).key === value.field)).allowed_entity_ids) : undefined} /></>}
      <UnknownFields path={p} known={type === 'transfer' ? ['type', 'from_field', 'to_field', 'amount'] : ['type', 'field', 'value']} /></>;
  }} />;
}
function ParameterDefinition({ path }: { path: Path }) {
  const { document, change } = useEditing(), value = object(atPath(document, path)), type = value.type;
  return <><Control label="类型"><Select value={typeof type === 'string' ? type : undefined} options={['integer', 'boolean', 'string', 'entity_ref'].map((v, i) => ({ value: v, label: ['整数', '布尔', '文本', '实体引用'][i]! }))}
    onChange={next => change(writePath(document, path, next === 'integer' ? { type: next, min: 0, max: 100 } : next === 'entity_ref' ? { type: next, allowed_entity_ids: [] } : { type: next }))} /></Control>
    {type === 'integer' && <><NumberField path={[...path, 'min']} label="最小值" /><NumberField path={[...path, 'max']} label="最大值" /></>}
    {type === 'entity_ref' && <Choose path={[...path, 'allowed_entity_ids']} label="允许的实体" options={entityOptions(document)} multiple />}
    <UnknownFields path={path} known={type === 'integer' ? ['type', 'min', 'max'] : type === 'entity_ref' ? ['type', 'allowed_entity_ids'] : ['type']} /></>;
}
function Parameters({ path }: { path: Path }) {
  const { document, change, blockedReferences, requestIdentifier } = useEditing(), values = object(atPath(document, path)); const [key, setKey] = React.useState('');
  return <Space direction="vertical" style={{ width: '100%' }}>{Object.keys(values).map(name => <Card size="small" key={name} title={`参数 ${name}`} extra={<Button danger size="small" onClick={() => {
    const actionPath = path.slice(0, -1), action = object(atPath(document, actionPath)), uses: string[] = [];
    const visit = (value: unknown, at: Path) => { if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
      if (key === 'parameter' && child === name) uses.push('/' + [...at, key].join('/')); visit(child, [...at, key]);
    } };
    visit(action.conditions, [...actionPath, 'conditions']); visit(action.effects, [...actionPath, 'effects']);
    for (const [id, candidates] of Object.entries(object(atPath(document, ['simulation', 'npc_actions'])))) list(candidates).forEach((raw, i) => {
      if (object(raw).action_id === action.id && Object.hasOwn(object(object(raw).parameters), name)) uses.push(`/simulation/npc_actions/${id}/${i}/parameters/${name}`);
    });
    if (uses.length) { if (blockedReferences) blockedReferences(uses); else window.alert('请先解除参数引用：\n' + uses.join('\n')); return; }
    const next = { ...values }; delete next[name]; change(writePath(document, path, next));
  }}>删除</Button>}>
    {(!/^[a-zA-Z0-9_-]{1,120}$/.test(name) || ['__proto__', 'constructor', 'prototype'].includes(name)) && <Alert type="warning" message="参数标识非法" action={<Button onClick={async () => {
      const replacement = await requestIdentifier('填写合法唯一的参数标识。既有条件、后果和 NPC 参数引用不会自动替换，需逐项修复。', '', Object.keys(values));
      if (replacement === null) return;
      const next = { ...values }; delete next[name]; next[replacement] = values[name]; change(writePath(document, path, next));
    }}>修复参数标识</Button>} />}
    <ParameterDefinition path={[...path, name]} /></Card>)}
    <Space wrap><Input value={key} placeholder="参数标识" onChange={e => setKey(e.target.value)} /><Button disabled={!/^[a-zA-Z0-9_-]{1,120}$/.test(key) || Object.hasOwn(values, key) || ['__proto__', 'constructor', 'prototype'].includes(key)}
      onClick={() => { change(writePath(document, path, { ...values, [key]: { type: 'integer', min: 0, max: 100 } })); setKey(''); }}>添加参数</Button></Space></Space>;
}
function StateEditor({ index }: { index: number }) {
  const { document, change, rawInputs = {}, rawChange, confirmEdit } = useEditing(), path: Path = ['state_schema', index], field = object(atPath(document, path)), key = String(field.key ?? '');
  const type = String(field.type), values = object(atPath(document, ['initial_state', 'values']));
  const entities = ['characters', 'factions', 'locations'].flatMap(kind => list(atPath(document, ['entities', kind])).map(row => ({ id: String(object(row).id), name: String(object(row).name), character: kind === 'characters' })));
  const parsed = fieldSchema.safeParse(field), rawKey = `field:${key}`, raw = rawInputs[rawKey];
  const shorthand = raw ?? (parsed.success && values[key] !== undefined ? formatShorthand(parsed.data, values[key] as string | number | boolean) : '');
  let issue = '';
  if (raw !== undefined) try { parseShorthand(raw, key, typeof field.owner_id === 'string' ? field.owner_id : null, entities); }
  catch (error) { issue = (error as Error).message; }
  return <><Control label="一行属性声明"><Input value={shorthand} placeholder="体力 = 8 [0..10] 点 @公开" onChange={e => rawChange?.(rawKey, e.target.value)} onBlur={() => {
    if (raw === undefined || issue) return;
    const next = parseShorthand(raw, key, typeof field.owner_id === 'string' ? field.owner_id : null, entities);
    change(writePath(writePath(document, path, next.declaration), ['initial_state', 'values', key], next.value)); rawChange?.(rawKey, null);
  }} /></Control>{issue && <Alert type="error" message={issue} action={<Button onClick={() => rawChange?.(rawKey, null)}>放弃本次简写</Button>} />}
  <Collapse items={[{ key: 'advanced', label: '高级属性设置', children: <><Text path={[...path, 'label']} label="名称" /><Typography.Text type="secondary">标识：{key}</Typography.Text>
    <Control label="类型"><Select value={type} options={['integer', 'boolean', 'string', 'entity_ref'].map((v, i) => ({ value: v, label: ['整数', '布尔', '文本', '实体引用'][i]! }))} onChange={async next => {
      const uses = references(document).filter(r => r.target.collection === 'fields' && r.target.key === key).map(r => '/' + r.path.join('/'));
      if (!await confirmEdit('转换属性类型后需要重新选择初值；已有条件、效果与引用会保留并重新校验。\n' + uses.join('\n'))) return;
      const declaration = { key, label: field.label, owner_id: field.owner_id, visibility: field.visibility, type: next,
        ...(next === 'integer' ? { min: 0, max: 100, unit: null } : next === 'entity_ref' ? { allowed_entity_ids: [] } : {}) };
      const initial = { ...values }; delete initial[key];
      change(writePath(writePath(document, path, declaration), ['initial_state', 'values'], initial));
    }} /></Control>
    <Choose path={[...path, 'owner_id']} label="归属实体" options={entityOptions(document)} nullable />
    {type === 'integer' && <><NumberField path={[...path, 'min']} label="最小值" /><NumberField path={[...path, 'max']} label="最大值" />
      <Control label="单位"><Input value={typeof field.unit === 'string' ? field.unit : ''} onChange={e => change(writePath(document, [...path, 'unit'], e.target.value || null))} /></Control></>}
    {type === 'entity_ref' && <Choose path={[...path, 'allowed_entity_ids']} label="允许的实体" options={entityOptions(document)} multiple />}
    <Control label="初始值"><ScalarControl type={type} value={values[key]} options={entityOptions(document).filter(e => list(field.allowed_entity_ids).includes(e.value))}
      change={value => change(writePath(document, ['initial_state', 'values', key], value))} /></Control><AudienceEditor path={[...path, 'visibility']} />
    <UnknownFields path={path} known={['key', 'label', 'type', 'owner_id', 'visibility', ...(type === 'integer' ? ['min', 'max', 'unit'] : type === 'entity_ref' ? ['allowed_entity_ids'] : [])]} /></> }]} /></>;
}
function CharacterEditor({ path }: { path: Path }) {
  const { document, change, blockedReferences } = useEditing(), row = object(atPath(document, path)), id = String(row.id);
  const chars = entityOptions(document, 'characters');
  const items = [
    { key: 'setting', label: '设定', children: <><Text path={[...path, 'name']} label="姓名" /><Text path={[...path, 'description']} label="设定" multiline /><Choose path={[...path, 'faction_id']} label="阵营" options={entityOptions(document, 'factions')} nullable /></> },
    { key: 'personality', label: '性格', children: <><TextList path={[...path, 'personality']} label="性格" /><TextList path={[...path, 'goals']} label="目标" /></> },
    { key: 'relationships', label: '关系', children: <ListEditor path={[...path, 'relationships']} label="关系" create={() => ({ target_id: '', description: '' })}
      render={p => <><Choose path={[...p, 'target_id']} label="对象" options={chars} /><Text path={[...p, 'description']} label="关系说明" multiline /><UnknownFields path={p} known={['target_id', 'description']} /></>} /> },
    { key: 'state', label: '状态', children: <StateList ownerId={id} /> },
    { key: 'memory', label: '记忆', children: <ListEditor path={['initial_state', 'memories']} label="记忆" create={() => ({ id: makeId(), text: '', audience: [id] })}
      filter={value => object(value).audience === 'public' || list(object(value).audience).includes(id)} render={p => <><Text path={[...p, 'text']} label="记忆" multiline /><AudienceEditor path={[...p, 'audience']} /></>} /> },
    { key: 'actions', label: '行动', children: <ListEditor path={['actions']} label="行动" create={() => ({ ...object(defaults.actions!()), allowed_actor_ids: [id] })}
      filter={value => list(object(value).allowed_actor_ids).includes(id)} beforeDelete={index => canDelete(document, ['actions'], index, 'actions', blockedReferences)} render={p => <RuleEditor path={p} kind="actions" />} /> },
    { key: 'behavior', label: '行为', children: <NpcBehavior id={id} /> },
  ];
  return <><Typography.Text type="secondary">标识：{id}</Typography.Text><Tabs items={items} />
    <UnknownFields path={path} known={['id', 'name', 'description', 'faction_id', 'personality', 'goals', 'relationships']} />
    {typeof row.id !== 'string' && <Button onClick={() => change(writePath(document, [...path, 'id'], makeId()))}>修复缺失标识</Button>}</>;
}
function NpcBehavior({ id }: { id: string }) {
  const { document, change } = useEditing(), order = list(atPath(document, ['simulation', 'npc_order']));
  const enabled = order.includes(id), actions = list(document.actions).filter(a => list(object(a).allowed_actor_ids).includes(id));
  const isPlayer = atPath(document, ['player', 'character_id']) === id;
  return <><Control label="启用自主行为"><Switch disabled={isPlayer && !enabled} checked={enabled} onChange={next => {
    let changed = writePath(document, ['simulation', 'npc_order'], next ? [...order, id] : order.filter(value => value !== id));
    const configs = { ...object(atPath(document, ['simulation', 'npc_actions'])) };
    if (next) configs[id] ??= []; else delete configs[id];
    changed = writePath(changed, ['simulation', 'npc_actions'], configs); change(changed);
  }} /></Control>
    <ListEditor path={['simulation', 'npc_actions', id]} label="候选行动" disableAdd={!enabled || isPlayer} create={() => ({ action_id: '', parameters: {} })} render={(p, raw) => {
      const candidate = object(raw), action = actions.find(a => object(a).id === candidate.action_id);
      return <><Choose path={[...p, 'action_id']} label="行动" options={actions.map(a => ({ value: String(object(a).id), label: String(object(a).name) }))} />
        {Object.entries(object(object(action).parameters)).map(([key, declaration]) => <Control key={key} label={key}><ScalarControl type={String(object(declaration).type)} value={atPath(document, [...p, 'parameters', key])}
          options={entityOptions(document).filter(e => list(object(declaration).allowed_entity_ids).includes(e.value))} change={value => change(writePath(document, [...p, 'parameters', key], value))} /></Control>)}
        <UnknownFields path={[...p, 'parameters']} known={Object.keys(object(object(action).parameters))} /><UnknownFields path={p} known={['action_id', 'parameters']} /></>;
    }} /><Typography.Paragraph type="secondary">{isPlayer ? '玩家由你控制，不能启用自主行为。' : '启用后按候选顺序尝试第一个合法行动。关闭会清除候选配置，可撤销恢复。'}</Typography.Paragraph></>;
}
function RuleEditor({ path, kind }: { path: Path; kind: 'actions' | 'events' | 'objectives' }) {
  const { document } = useEditing(), row = object(atPath(document, path)), parameters = object(row.parameters);
  return <><Text path={[...path, 'name']} label="名称" /><Typography.Text type="secondary">标识：{String(row.id)}</Typography.Text>
    {kind === 'actions' && <><Text path={[...path, 'description']} label="行动说明" multiline /><Choose path={[...path, 'allowed_actor_ids']} label="谁可以执行" options={entityOptions(document, 'characters')} multiple /></>}
    {kind === 'objectives' && <><Choose path={[...path, 'outcome']} label="结束方式" options={[{ value: 'success', label: '成功' }, { value: 'failure', label: '失败' }]} /><NumberField path={[...path, 'priority']} label="优先级（越小越先）" /></>}
    {kind === 'events' && <Toggle path={[...path, 'repeatable']} label="可重复触发" />}
    <Collapse items={[
      ...(kind === 'actions' ? [{ key: 'parameters', label: `输入参数 · ${Object.keys(parameters).length}`, children: <Parameters path={[...path, 'parameters']} /> }] : []),
      { key: 'conditions', label: `当条件满足${'all' in object(row.conditions) && list(object(row.conditions).all).length === 0 ? ' · 无条件' : ''}`, children: <ConditionEditor path={[...path, 'conditions']} parameters={parameters} /> },
      ...(kind !== 'objectives' ? [{ key: 'effects', label: `依次执行后果 · ${list(row.effects).length}`, children: <Effects path={[...path, 'effects']} parameters={parameters} /> }] : []),
    ]} /><AudienceEditor path={[...path, 'visibility']} />
    <UnknownFields path={path} known={['id', 'name', 'conditions', 'visibility', ...(kind === 'actions' ? ['description', 'allowed_actor_ids', 'parameters', 'effects'] : kind === 'events' ? ['repeatable', 'effects'] : ['outcome', 'priority'])]} /></>;
}
export function DomainEditor({ document, change, section, disabled, rawInputs, rawChange, blockedReferences }: Context & { section: Target['collection'] }) {
  const [confirmation, confirmationHolder] = Modal.useModal();
  const confirmEdit = (message: string) => new Promise<boolean>(resolve => confirmation.confirm({ title: '确认编辑', content: <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{message}</Typography.Paragraph>,
    okText: '确认', cancelText: '取消', onOk: () => resolve(true), onCancel: () => resolve(false) }));
  const [identifier, setIdentifier] = React.useState<{ message: string; value: string; used: string[]; resolve: (value: string | null) => void } | null>(null);
  const requestIdentifier: IdentifierRequest = (message, initial, used) => new Promise(resolve => setIdentifier({ message, value: initial, used, resolve }));
  const identifierValid = identifier !== null && /^[a-zA-Z0-9_-]{1,120}$/.test(identifier.value) && !['__proto__', 'constructor', 'prototype'].includes(identifier.value) && !identifier.used.includes(identifier.value);
  const finishIdentifier = (value: string | null) => { identifier?.resolve(value); setIdentifier(null); };
  const paths: Record<string, Path> = { characters: ['entities', 'characters'], factions: ['entities', 'factions'], locations: ['entities', 'locations'], fields: ['state_schema'], memories: ['initial_state', 'memories'], actions: ['actions'], events: ['events'], objectives: ['objectives'] };
  const path = paths[section];
  const content = section === 'metadata' ? <><Text path={['metadata', 'name']} label="剧本名" /><Text path={['metadata', 'description']} label="简介" multiline />
    <Typography.Text type="secondary">剧本标识：{String(object(document.metadata).id ?? '缺失')}</Typography.Text><IdentityRepair path={['metadata']} values={[document.metadata]} />
    <Choose path={['player', 'character_id']} label="玩家角色" options={entityOptions(document, 'characters')} /><UnknownFields path={['metadata']} known={['id', 'name', 'description']} /><UnknownFields path={['player']} known={['character_id']} /></>
    : section === 'world' ? <><Text path={['world', 'background']} label="世界背景" multiline /><Text path={['world', 'start_time']} label="开始时间" /><Text path={['world', 'turn_unit']} label="一回合代表" /><TextList path={['world', 'constraints']} label="描述约束" /><UnknownFields path={['world']} known={['background', 'start_time', 'turn_unit', 'constraints']} /></>
      : section === 'narrative' ? <><Text path={['narrative', 'opening']} label="开场" multiline /><Text path={['narrative', 'style']} label="风格" /><Text path={['narrative', 'perspective']} label="视角" /><UnknownFields path={['narrative']} known={['opening', 'style', 'perspective']} /></>
        : section === 'simulation' ? <><NumberField path={['simulation', 'memory_recent_turns']} label="最近记忆回合" /><ListEditor path={['simulation', 'npc_order']} label="自主角色顺序" create={() => ''} render={p => <Choose path={p} label="角色" options={entityOptions(document, 'characters').filter(c => c.value !== object(document.player).character_id)} />} />
          {entityOptions(document, 'characters').map(char => <Card key={char.value} title={char.label}><NpcBehavior id={char.value} /></Card>)}<UnknownFields path={['simulation']} known={['memory_recent_turns', 'npc_order', 'npc_actions']} /></>
          : section === 'fields' ? <StateList />
            : path ? <ListEditor path={path} label={labels[section]} create={defaults[section]!} render={(p, raw) => section === 'characters' ? <CharacterEditor path={p} />
              : section === 'memories' ? <><Text path={[...p, 'text']} label="记忆内容" multiline /><AudienceEditor path={[...p, 'audience']} /><UnknownFields path={p} known={['id', 'text', 'audience']} /></>
                : ['actions', 'events', 'objectives'].includes(section) ? <RuleEditor path={p} kind={section as 'actions' | 'events' | 'objectives'} />
                  : <><Text path={[...p, 'name']} label="名称" /><Text path={[...p, 'description']} label="说明" multiline />{section === 'factions' && <TextList path={[...p, 'goals']} label="目标" />}<UnknownFields path={p} known={['id', 'name', 'description', ...(section === 'factions' ? ['goals'] : [])]} /></>}
              beforeDelete={index => canDelete(document, path, index, section, blockedReferences)} /> : null;
  return <Editing.Provider value={{ document, change, requestIdentifier, confirmEdit, ...(disabled === undefined ? {} : { disabled }), ...(rawInputs ? { rawInputs } : {}), ...(rawChange ? { rawChange } : {}), ...(blockedReferences ? { blockedReferences } : {}) }}><fieldset disabled={disabled} className="domain-editor">
    <UnknownFields path={[]} known={['metadata', 'world', 'entities', 'state_schema', 'initial_state', 'player', 'actions', 'events', 'objectives', 'simulation', 'narrative']} />
    {section === 'characters' && <UnknownFields path={['entities']} known={['characters', 'factions', 'locations']} />}
    {section === 'fields' && <><UnknownFields path={['initial_state']} known={['values', 'memories']} /><UnknownFields path={['initial_state', 'values']} known={list(document.state_schema).flatMap(f => typeof object(f).key === 'string' ? [String(object(f).key)] : [])} /></>}
    {section === 'simulation' && <UnknownFields path={['simulation', 'npc_actions']} known={list(object(document.simulation).npc_order).filter((id): id is string => typeof id === 'string')} />}
    {content}</fieldset><Modal open={identifier !== null} title="填写新的标识" okText="确认" cancelText="取消" okButtonProps={{ disabled: !identifierValid }} onCancel={() => finishIdentifier(null)} onOk={() => { if (identifierValid) finishIdentifier(identifier!.value); }}>
      <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{identifier?.message}</Typography.Paragraph>
      <Input aria-label="新的标识" value={identifier?.value ?? ''} maxLength={120} onChange={e => setIdentifier(current => current ? { ...current, value: e.target.value } : null)}
        onPressEnter={() => { if (identifierValid) finishIdentifier(identifier!.value); }} />
      {!identifierValid && <Typography.Paragraph type="danger">使用 1–120 个字母、数字、下划线或连字符，不能重复或使用保留名称。</Typography.Paragraph>}
    </Modal>{confirmationHolder}</Editing.Provider>;
}
function canDelete(document: DraftDocument, path: Path, index: number, section: Target['collection'], blockedReferences?: (paths: string[]) => void): boolean {
  const key = itemKey(list(atPath(document, path))[index], section); if (!key) return true;
  const uses = references(document).filter(reference => reference.target.collection === section && reference.target.key === key &&
    !(path.every((part, i) => reference.path[i] === part) && reference.path[path.length] === index));
  if (uses.length) { const paths = uses.map(r => '/' + r.path.join('/')); if (blockedReferences) blockedReferences(paths); else window.alert('此对象仍被引用，请先解除引用：\n' + paths.join('\n')); return false; }
  return true;
}
function StateList({ ownerId }: { ownerId?: string }) {
  const { document, change, blockedReferences, rawChange, requestIdentifier } = useEditing(); const [key, setKey] = React.useState('');
  const fields = list(document.state_schema);
  return <><Space wrap><Input value={key} onChange={e => setKey(e.target.value)} placeholder="新状态标识（如 energy）" /><Button disabled={!/^[a-zA-Z0-9_-]{1,120}$/.test(key) || fields.some(f => object(f).key === key) || ['__proto__', 'constructor', 'prototype'].includes(key)} onClick={() => {
    const field = { key, label: key, type: 'integer', min: 0, max: 100, unit: null, owner_id: ownerId ?? null, visibility: ownerId ? [ownerId] : 'public' };
    change(writePath(writePath(document, ['state_schema'], [...fields, field]), ['initial_state', 'values', key], 0)); setKey('');
  }}>添加状态</Button></Space>
  {document.state_schema !== undefined && !Array.isArray(document.state_schema) && <Alert type="error" message="状态列表结构错误" action={<Button onClick={() => change(writePath(document, ['state_schema'], []))}>清空并修复状态列表</Button>} />}
  {fields.map((field, index) => ownerId && object(field).owner_id !== ownerId ? null : <Card size="small" data-definition-path={`/state_schema/${index}`} key={String(object(field).key) + index} title={String(object(field).label ?? '待修复属性')} extra={<Space wrap>
    <Button size="small" onClick={async () => {
      const oldKey = String(object(field).key), newKey = await requestIdentifier('填写副本的新状态标识。引用目标保持不变，声明与初值将一起复制。', oldKey.length <= 115 ? `${oldKey}_copy` : 'copied_field', fields.map(f => String(object(f).key)));
      if (newKey === null) return;
      const initial = object(atPath(document, ['initial_state', 'values']));
      let next = writePath(document, ['state_schema'], [...fields, { ...structuredClone(object(field)), key: newKey, label: String(object(field).label ?? '属性') + ' 副本' }]);
      if (Object.hasOwn(initial, oldKey)) next = writePath(next, ['initial_state', 'values', newKey], initial[oldKey]);
      change(next);
    }}>复制</Button>
    <Button size="small" disabled={index === 0} onClick={() => { const next = [...fields]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; change(writePath(document, ['state_schema'], next)); }}>上移</Button>
    <Button size="small" disabled={index === fields.length - 1} onClick={() => { const next = [...fields]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; change(writePath(document, ['state_schema'], next)); }}>下移</Button>
    <Button danger size="small" onClick={() => {
    const key = String(object(field).key);
    const uses = references(document).filter(r => r.target.collection === 'fields' && r.target.key === key && !(r.path[0] === 'initial_state' && r.path[1] === 'values' && r.path[2] === key));
    if (uses.length) { const paths = uses.map(r => '/' + r.path.join('/')); if (blockedReferences) blockedReferences(paths); else window.alert('请先解除状态引用：\n' + paths.join('\n')); return; }
    const values = { ...object(atPath(document, ['initial_state', 'values'])) }; delete values[key];
    change(writePath(writePath(document, ['state_schema'], fields.filter((_, i) => i !== index)), ['initial_state', 'values'], values));
    rawChange?.(`field:${key}`, null);
  }}>删除</Button></Space>}>
    {(!fieldSchema.safeParse(field).success && (typeof object(field).key !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(String(object(field).key)) || ['__proto__', 'constructor', 'prototype'].includes(String(object(field).key)) || fields.filter(f => object(f).key === object(field).key).length > 1)) && <Alert type="warning" message="状态标识缺失、非法或重复" action={<Button onClick={async () => {
      const oldKey = String(object(field).key), uses = references(document).filter(r => r.target.collection === 'fields' && r.target.key === oldKey).map(r => '/' + r.path.join('/'));
      const newKey = await requestIdentifier('填写合法唯一的状态标识。原初值和以下引用保留，需明确修复，本次可撤销。\n' + uses.join('\n'), '', fields.map(f => String(object(f).key)));
      if (newKey === null) return;
      change(writePath(document, ['state_schema', index, 'key'], newKey));
    }}>修复状态标识</Button>} />}
    <StateEditor index={index} /></Card>)}</>;
}
