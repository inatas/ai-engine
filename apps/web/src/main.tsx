import React from 'react';
import '@ant-design/v5-patch-for-react-19';
import { createRoot } from 'react-dom/client';
import { Alert, Button, Card, ConfigProvider, Form, Input, Layout, Space, Tabs, Tag, Typography } from 'antd';
import { credentialsSchema, type IdentityChange, type UserSummary } from '@ai-engine/contracts';
import { identityEvent, logout, refreshIdentity, RequestError, submitCredentials } from './identity.js';
import zhCN from 'antd/locale/zh_CN';
import 'antd/dist/reset.css';
import './style.css';
import { Workshop } from './workshop.js';
import { Play } from './play.js';

function App() {
  const [status, setStatus] = React.useState('正在连接');
  const [user, setUser] = React.useState<UserSummary | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [mode, setMode] = React.useState<'login' | 'register'>('login');
  const [view, setView] = React.useState('play'), [creatorOpened, setCreatorOpened] = React.useState(false);
  const openCreate = () => { setCreatorOpened(true); setView('create'); };
  React.useEffect(() => { setView('play'); }, [user?.user_id]);
  const [feedback, setFeedback] = React.useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [form] = Form.useForm<{ username: string; password: string }>();
  const report = (error: unknown) => setFeedback({ type: 'error', text: error instanceof RequestError
    ? `${error.message}${error.retryAfter ? `（请在 ${error.retryAfter} 秒后重试）` : ''}` : '连接失败，请检查服务后重试' });
  const refresh = async () => {
    setLoading(true);
    try { setUser(await refreshIdentity()); }
    catch (error) { report(error); }
    finally { setLoading(false); }
  };
  React.useEffect(() => {
    void refresh();
    const onChange = (event: Event) => setUser((event as CustomEvent<IdentityChange>).detail.current);
    const onFocus = () => { void refreshIdentity().then(setUser).catch(report); };
    window.addEventListener(identityEvent, onChange);
    window.addEventListener('focus', onFocus);
    return () => { window.removeEventListener(identityEvent, onChange); window.removeEventListener('focus', onFocus); };
  }, []);
  const submit = async (values: { username: string; password: string }) => {
    const parsed = credentialsSchema.safeParse(values);
    if (!parsed.success) { setFeedback({ type: 'error', text: '用户名须为 3–32 个字母、数字或下划线；密码须为 15–128 个 Unicode 字符。' }); return; }
    setBusy(true); setFeedback(null);
    try {
      const result = await submitCredentials(mode, values);
      form.setFieldValue('password', '');
      if (mode === 'register') {
        setMode('login');
        setFeedback({ type: 'success', text: '注册成功，请输入密码登录。' });
      } else {
        setUser({ user_id: result.user_id, username: result.username });
        setFeedback({ type: 'success', text: '登录成功。' });
      }
    } catch (error) { report(error); }
    finally { setBusy(false); }
  };
  const signOut = async () => {
    setBusy(true); setFeedback(null);
    try { await logout(); setUser(null); form.resetFields(); setFeedback({ type: 'success', text: '已退出登录。' }); }
    catch (error) { report(error); }
    finally { setBusy(false); }
  };
  React.useEffect(() => {
    let alive = true;
    fetch('/api/health').then(r => {
      if (!r.ok) throw new Error('服务连接失败');
      return r.json() as Promise<{ data: { status: string } }>;
    }).then(result => { if (alive) setStatus(result.data.status === 'ok' ? '服务已连接' : '服务不可用'); })
      .catch(() => { if (alive) setStatus('服务未连接'); });
    return () => { alive = false; };
  }, []);
  return <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#315f4d', borderRadius: 10 } }}>
    <Layout className="workshop">
      <Layout.Header><Typography.Title level={3}>AI Engine</Typography.Title><Space wrap><Tag>{status}</Tag>{user && <><Typography.Text>{user.username}</Typography.Text><Button onClick={() => { void signOut(); }} loading={busy}>退出登录</Button></>}</Space></Layout.Header>
      <Layout.Content>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div><Typography.Title>{user && view === 'create' ? '创作你的剧本' : '进入故事，开始你的冒险'}</Typography.Title>
            <Typography.Paragraph>{user && view === 'create' ? '定义世界与角色，编辑、生成并试玩你的故事。' : '选择一个剧本开始游玩，随时保存进度，继续你的故事。'}</Typography.Paragraph></div>
          {!user && <Card className="identity-card" title={mode === 'login' ? '登录后开始游玩' : '创建账号'} loading={loading}>
            {feedback && <Alert type={feedback.type} showIcon message={feedback.text} role="status" style={{ marginBottom: 20 }} />}
            <Form form={form} layout="vertical" onFinish={values => { void submit(values); }} disabled={busy} requiredMark={false}>
                <Form.Item label="用户名" name="username" rules={[{ required: true, message: '请输入用户名' }]}>
                  <Input autoComplete="username" maxLength={32} placeholder="3–32 个字母、数字或下划线" />
                </Form.Item>
                <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }]}>
                  <Input.Password autoComplete={mode === 'register' ? 'new-password' : 'current-password'} placeholder="15–128 个字符，支持空格和中文" />
                </Form.Item>
                <Space wrap><Button type="primary" htmlType="submit" loading={busy}>{mode === 'login' ? '登录' : '注册'}</Button>
                  <Button onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setFeedback(null); form.setFieldValue('password', ''); }}>
                    {mode === 'login' ? '创建账号' : '已有账号，去登录'}
                  </Button><Button type="text" onClick={() => { setFeedback(null); void refresh(); }}>刷新登录状态</Button></Space>
              </Form>
          </Card>}
          {user && <Tabs activeKey={view} onChange={value => { if (value === 'create') openCreate(); else setView('play'); }} items={[{ key: 'play', label: '玩剧本' }, { key: 'create', label: '创作' }]} />}
          <div hidden={!user || view !== 'play'}><Play key={user?.user_id ?? 'anonymous'} user={user} active={view === 'play'} onCreate={openCreate} /></div>
          {creatorOpened && <div hidden={view !== 'create'}><Workshop user={user} onPlay={() => setView('play')} /></div>}
        </Space>
      </Layout.Content>
    </Layout>
  </ConfigProvider>;
}
createRoot(document.getElementById('root')!).render(<App />);
