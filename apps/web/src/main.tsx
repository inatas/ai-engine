import React from 'react';
import { createRoot } from 'react-dom/client';
import { Alert, Button, Card, ConfigProvider, Form, Input, Layout, Space, Tag, Typography } from 'antd';
import { credentialsSchema, type IdentityChange, type UserSummary } from '@ai-engine/contracts';
import { identityEvent, logout, refreshIdentity, RequestError, submitCredentials } from './identity.js';
import zhCN from 'antd/locale/zh_CN';
import 'antd/dist/reset.css';
import './style.css';

function App() {
  const [status, setStatus] = React.useState('正在连接');
  const [user, setUser] = React.useState<UserSummary | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [mode, setMode] = React.useState<'login' | 'register'>('login');
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
      <Layout.Header><Typography.Title level={3}>世界工坊</Typography.Title><Tag>{status}</Tag></Layout.Header>
      <Layout.Content>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div><Typography.Title>从规则开始，构建你的世界</Typography.Title>
            <Typography.Paragraph>定义角色、局势和行动，让同一套引擎运行不同的故事。</Typography.Paragraph></div>
          <Card className="identity-card" title={user ? '当前账号' : mode === 'login' ? '登录世界工坊' : '创建账号'} loading={loading}>
            {feedback && <Alert type={feedback.type} showIcon message={feedback.text} role="status" style={{ marginBottom: 20 }} />}
            {user ? <Space wrap><Typography.Text>已登录：<strong>{user.username}</strong></Typography.Text>
              <Button onClick={() => { void signOut(); }} loading={busy}>退出登录</Button></Space>
              : <Form form={form} layout="vertical" onFinish={values => { void submit(values); }} disabled={busy} requiredMark={false}>
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
              </Form>}
          </Card>
          <Alert type="info" showIcon message="账号功能已开放" description="可以注册、登录并在刷新后保持身份。剧本编辑和个人存档正在后续开发中。" />
          <div className="cards">
            <Card title="大明末年危局"><p>调拨军饷，在十二回合的危局中保住北京。</p><Tag>规则验证示例</Tag></Card>
            <Card title="空间站维修"><p>分配能源，由工程师修复受损的空间站。</p><Tag>通用性验证示例</Tag></Card>
          </div>
        </Space>
      </Layout.Content>
    </Layout>
  </ConfigProvider>;
}
createRoot(document.getElementById('root')!).render(<App />);
