import React from 'react';
import { Alert, Button, Card, Collapse, Empty, Input, InputNumber, Select, Space, Tag, Typography } from 'antd';
import type { Scalar, PlayerView, PlayerTurn } from '@ai-engine/contracts';
import { actionInputProblems } from './play-input.js';

export type WorldView = PlayerView & { session_id: string; mode: 'play' | 'preview'; revision: number };
export function WorldPanel({ world, busy, turn }: { world: PlayerView; busy: boolean; turn?: (id: string, parameters: Record<string, Scalar>) => void }) {
  const [values, setValues] = React.useState<Record<string, Record<string, Scalar>>>({});
  const [submitted, setSubmitted] = React.useState<Record<string, boolean>>({});
  const scope = React.useId();
  const entityNames = new Map(world.entities.map(entity => [entity.id, entity.name]));
  const fieldTypes = new Map(world.fields.map(field => [field.key, field.type]));
  const displayValue = (field: string, value: Scalar) => fieldTypes.get(field) === 'entity_ref' ? entityNames.get(String(value)) || String(value)
    : typeof value === 'boolean' ? value ? '是' : '否' : value === '' ? '空文本' : String(value);
  const recordContent = (record: PlayerTurn) => <div className="turn-record">{record.decisions.length ? record.decisions.map((decision, index) => <div className="decision-row" key={index}>
    <Typography.Text strong>{({ action: '行动', event: '事件', objective: '结局' })[decision.kind]} · {decision.name}</Typography.Text>
    {decision.actor_name && <Typography.Text type="secondary">{decision.actor_name}</Typography.Text>}
    <Space wrap>{decision.changes.map((change, i) => <Tag key={i}>{world.fields.find(field => field.key === change.field)!.label}：{displayValue(change.field, change.before)} → {displayValue(change.field, change.after)}</Tag>)}</Space>
  </div>) : <Typography.Text type="secondary">本回合没有可见变化</Typography.Text>}</div>;
  const latest = world.history.at(-1);
  return <Space direction="vertical" style={{ width: '100%' }}><Typography.Paragraph>{world.opening}</Typography.Paragraph><Tag>回合 {world.turn} · {world.status === 'active' ? '进行中' : world.status === 'success' ? '成功' : '失败'}</Tag>
    {world.status !== 'active' && <Alert showIcon type={world.status === 'success' ? 'success' : 'warning'} message={world.ending?.name || (world.status === 'success' ? '故事已成功结束' : '故事已结束')} description="本局已结束，不再执行行动。下方保留完整游戏记录。" />}
    <Space wrap>{world.fields.map(field => <Tag key={field.key}>{field.label}：{displayValue(field.key, field.value)} {field.unit}</Tag>)}</Space>
    {world.memories.map(memory => <Typography.Paragraph key={memory.id}>{memory.text}</Typography.Paragraph>)}
    {latest && <Card size="small" title={`第 ${latest.turn} 回合 · 已发生的事`}>{recordContent(latest)}</Card>}
    {turn && world.status === 'active' && world.actions.map(action => <Card size="small" key={action.id} title={action.name}><Typography.Paragraph>{action.description}</Typography.Paragraph>
      {Object.entries(action.parameters).map(([key, parameter]) => {
        const value = values[action.id]?.[key], inputId = `parameter-${scope}-${action.id}-${key}`, label = `${action.name} · ${key}`;
        const change = (next: Scalar | undefined) => setValues(previous => { const updated = { ...previous[action.id] }; if (next === undefined) delete updated[key]; else updated[key] = next; return { ...previous, [action.id]: updated }; });
        const problem = actionInputProblems(action.parameters, values[action.id] ?? {})[key];
        return <div className="editor-control" key={key}><label htmlFor={inputId}>{key}{parameter.type === 'integer' ? `（${parameter.min}～${parameter.max}）` : ''}</label>
          {parameter.type === 'boolean' ? <Select id={inputId} aria-label={label} value={typeof value === 'boolean' ? String(value) : undefined} placeholder="请选择是或否" options={[{ value: 'true', label: '是' }, { value: 'false', label: '否' }]} onChange={next => change(next === 'true')} />
            : parameter.type === 'integer' ? <InputNumber id={inputId} aria-label={label} min={parameter.min} max={parameter.max} changeOnBlur={false} value={typeof value === 'number' ? value : null} onChange={next => change(next ?? undefined)} />
              : parameter.type === 'entity_ref' ? <Select<string | undefined> id={inputId} aria-label={label} value={typeof value === 'string' ? value : undefined} placeholder="请选择对象" options={parameter.allowed_entity_ids.map(id => { const name = entityNames.get(id) || id; const duplicate = world.entities.filter(entity => entity.name === name).length > 1; return { value: id, label: duplicate ? `${name} · ${id.slice(-6)}` : name }; })} onChange={change} />
                : <Space wrap><Input id={inputId} aria-label={label} value={typeof value === 'string' ? value : ''} onChange={e => change(e.target.value)} /><Button onClick={() => change('')}>使用空文本</Button></Space>}
          {submitted[action.id] && problem && <Typography.Text type="danger" role="alert">{problem}</Typography.Text>}
        </div>;
      })}<Button type="primary" disabled={busy} onClick={() => { setSubmitted(previous => ({ ...previous, [action.id]: true })); const parameters = values[action.id] ?? {}; if (!Object.keys(actionInputProblems(action.parameters, parameters)).length) turn(action.id, parameters); }}>执行</Button></Card>)}
    <Collapse items={[{ key: 'history', label: `游戏记录 · ${world.history.length} 回合`, children: world.history.length ? [...world.history].reverse().map(record => <section className="history-turn" key={record.turn}><Typography.Title level={5}>第 {record.turn} 回合</Typography.Title>{recordContent(record)}</section>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="开始行动后会记录每个回合" /> }]} />
  </Space>;
}
