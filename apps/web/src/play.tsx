import React from 'react';
import { Alert, Button, Card, Empty, Input, Space, Tabs, Tag, Typography } from 'antd';
import { canonicalJson, type PlayerView, type ReleaseSummary, type UserSummary } from '@ai-engine/contracts';
import { api, RequestError } from './identity.js';
import { WorldPanel, type WorldView } from './world-panel.js';

type Template = { template_id: string; name: string; description: string };
type SessionSummary = { session_id: string; name: string; turn: number; status: string; loadable: boolean };
type SaveSummary = { save_id: string; name: string; scenario_name: string; turn: number; status: string; loadable: boolean };
type SaveView = SaveSummary & PlayerView;
const statusLabel = (status: string) => ({ active: '进行中', success: '成功', failure: '失败' })[status] ?? status;

export function Play({ user, active, onCreate }: { user: UserSummary | null; active: boolean; onCreate: () => void }) {
  const [templates, setTemplates] = React.useState<Template[]>([]), [releases, setReleases] = React.useState<ReleaseSummary[]>([]);
  const [sessions, setSessions] = React.useState<SessionSummary[]>([]), [saves, setSaves] = React.useState<SaveSummary[]>([]);
  const [world, setWorld] = React.useState<WorldView | null>(null), [saveView, setSaveView] = React.useState<SaveView | null>(null);
  const [tab, setTab] = React.useState('library'), [saveName, setSaveName] = React.useState('');
  const [busy, setBusy] = React.useState(false), [loaded, setLoaded] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const retryRequests = React.useRef(new Map<string, string>());
  const report = (error: unknown) => setFeedback({ type: 'error', text: error instanceof Error ? error.message : '操作失败，请重试' });
  const run = async (work: () => Promise<void>) => { setBusy(true); setFeedback(null); try { await work(); } catch (error) { report(error); } finally { setBusy(false); } };
  const refresh = async () => {
    const [ts, rs, ws, ss] = await Promise.all([api<Template[]>('templates?limit=100'), api<ReleaseSummary[]>('releases?limit=100'),
      api<SessionSummary[]>('world-sessions?limit=100'), api<SaveSummary[]>('saves?limit=100')]);
    setTemplates(ts); setReleases(rs); setSessions(ws); setSaves(ss); setLoaded(true);
  };
  React.useEffect(() => { if (user && active) void run(refresh); }, [user?.user_id, active]);
  const business = async <T,>(path: string, body: Record<string, unknown>): Promise<T> => {
    if (!user) throw new Error('请先登录');
    const key = canonicalJson({ owner: user.user_id, path, body });
    const request_id = retryRequests.current.get(key) ?? crypto.randomUUID(); retryRequests.current.set(key, request_id);
    try { const result = await api<T>(path, 'POST', { ...body, request_id }); retryRequests.current.delete(key); return result; }
    catch (error) { if (error instanceof RequestError && error.status < 500 && error.code !== 'identity_changed') retryRequests.current.delete(key); throw error; }
  };
  const start = (source: { template_id: string } | { release_id: string }) => void run(async () => {
    setWorld(await business<WorldView>('world-sessions', source)); setSaveName(''); setSaveView(null); await refresh();
  });
  if (!user) return null;
  return <Space direction="vertical" size="large" style={{ width: '100%' }}>
    {feedback && <Alert type={feedback.type} message={feedback.text} showIcon closable onClose={() => setFeedback(null)} />}
    {world ? <Card className="game-panel" title={world.name} extra={<Button disabled={busy} onClick={() => { setWorld(null); setTab('sessions'); }}>返回游戏列表</Button>}>
      <WorldPanel key={world.session_id} world={world} busy={busy} turn={(action_id, parameters) => void run(async () => {
        setWorld(await business<WorldView>(`world-sessions/${world.session_id}/turns`, { action_id, parameters, expected_revision: world.revision })); await refresh();
      })} />
      <div className="game-save"><Typography.Text type="secondary">每回合自动保存进度。手动存档保留当前回合，读档会创建独立分支。</Typography.Text>
        <Space wrap><Input aria-label="存档名称" maxLength={120} placeholder="存档名称（可留空）" value={saveName} onChange={e => setSaveName(e.target.value)} />
          <Button type="primary" disabled={busy} onClick={() => void run(async () => {
            await business(`world-sessions/${world.session_id}/saves`, { name: saveName.trim() || `${world.name} · 回合 ${world.turn}`, expected_revision: world.revision });
            await refresh(); setFeedback({ type: 'success', text: '游戏已存档，可在存档记录中读档。' });
          })}>保存游戏</Button><Button disabled={busy} onClick={() => { setWorld(null); setTab('saves'); }}>查看存档</Button></Space>
      </div>
    </Card> : <>
      <Tabs activeKey={tab} onChange={value => { setTab(value); setSaveView(null); }} items={[{ key: 'library', label: '开始游戏' }, { key: 'sessions', label: '继续游戏' }, { key: 'saves', label: '存档记录' }]} tabBarExtraContent={<Button disabled={busy} onClick={() => void run(refresh)}>刷新</Button>} />
      {tab === 'library' && <>
        <Card title="选择剧本" loading={!loaded && busy}>
          <Typography.Paragraph type="secondary">选一个故事，直接开始。每次开局都有独立的游戏进度。</Typography.Paragraph>
          <div className="scenario-grid">{templates.map(template => <Card key={template.template_id} size="small" title={template.name}>
            <Tag>内置剧本</Tag><Typography.Paragraph>{template.description}</Typography.Paragraph>
            <Button type="primary" disabled={busy} onClick={() => start({ template_id: template.template_id })}>开始游玩</Button>
          </Card>)}{releases.map(release => <Card key={release.release_id} size="small" title={release.name}>
            <Tag>我的定稿</Tag><Typography.Paragraph>独立运行这份剧本，不影响创作草稿。</Typography.Paragraph>
            <Button type="primary" disabled={busy} onClick={() => start({ release_id: release.release_id })}>开始游玩</Button>
          </Card>)}</div>
          {loaded && !templates.length && !releases.length && <Empty description="暂时没有可玩的剧本" />}
        </Card>
        <Typography.Paragraph type="secondary">想写自己的故事？<Button type="link" onClick={onCreate}>进入创作</Button></Typography.Paragraph>
      </>}
      {tab === 'sessions' && <Card title="我的游戏" loading={!loaded && busy}>
        {loaded && !sessions.length ? <Empty description="还没有游戏，先选择一个剧本开始" /> : sessions.map(session => <div key={session.session_id} className="game-list-row">
          <div><Typography.Text strong>{session.name}</Typography.Text><div className="game-summary">回合 {session.turn} · {statusLabel(session.status)}</div></div>
          <Button type="primary" disabled={busy || !session.loadable} onClick={() => void run(async () => { setWorld(await api<WorldView>(`world-sessions/${session.session_id}`)); setSaveName(''); })}>{session.loadable ? '继续游戏' : '存档版本不可用'}</Button>
        </div>)}
      </Card>}
      {tab === 'saves' && <Card title="我的存档" loading={!loaded && busy}>
        <Typography.Paragraph type="secondary">读档从保存时的回合继续，原游戏和原存档都会保留。</Typography.Paragraph>
        {loaded && !saves.length ? <Empty description="还没有手动存档，进入游戏后可以保存" /> : saves.map(save => <div key={save.save_id} className="game-list-row">
          <div><Typography.Text strong>{save.name}</Typography.Text><div className="game-summary">{save.scenario_name} · 回合 {save.turn} · {statusLabel(save.status)}</div></div>
          <Space wrap><Button disabled={busy || !save.loadable} onClick={() => void run(async () => setSaveView(await api<SaveView>(`saves/${save.save_id}`)))}>查看记录</Button>
            <Button type="primary" disabled={busy || !save.loadable} onClick={() => void run(async () => { setWorld(await business<WorldView>(`saves/${save.save_id}/restore`, {})); setSaveName(''); setSaveView(null); await refresh(); })}>{save.loadable ? '读取存档' : '存档版本不可用'}</Button></Space>
        </div>)}
        {saveView && <Card size="small" title={`${saveView.name} · 保存时的游戏记录`}><WorldPanel key={saveView.save_id} world={saveView} busy={false} /></Card>}
      </Card>}
    </>}
  </Space>;
}
