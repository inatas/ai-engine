import React from 'react';
import { Alert, Button, Card, Checkbox, Collapse, Empty, Input, Select, Space, Tag, Tabs, Typography } from 'antd';
import { applyProposal, atPath, canonicalJson, collectionPaths, danglingReferences, draftWithinLimits, draftShapeProblems, itemKey, proposalChanges, proposalGroups, sameValue,
  singletonCollections, type DraftDocument, type DraftSummary, type DraftView, type GenerationInput, type GenerationResult,
  type OutlineProposal, type ReleaseSummary, type ReleaseView, type Target, type Validation, type UserSummary } from '@ai-engine/contracts';
import { api, RequestError } from './identity.js';
import { WorldPanel, type WorldView } from './world-panel.js';
import { DomainEditor, labels } from './domain-editor.js';
import { acknowledgeSave, candidateMatches, editWorkspace, openWorkspace, travelWorkspace, type WorkspaceState } from './workspace-state.js';

type Template = { template_id: string; name: string; description: string };
const collections = Object.keys(labels) as Target['collection'][];
const sections = collections.filter(value => value !== 'player');
async function digest(value: unknown) { const bytes = new TextEncoder().encode(canonicalJson(value));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
function download(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const element = document.createElement('a'); element.href = url; element.download = name.replace(/[^\p{L}\p{N}_-]/gu, '_') + '.json'; element.click(); URL.revokeObjectURL(url);
}
function issueSection(path: string): Target['collection'] {
  const parts = path.split('/').slice(1);
  return collections.find(collection => collectionPaths[collection].every((key, index) => parts[index] === key)) ?? 'metadata';
}
export function Workshop({ user, onPlay }: { user: UserSummary | null; onPlay: () => void }) {
  const [drafts, setDrafts] = React.useState<DraftSummary[]>([]), [releases, setReleases] = React.useState<ReleaseSummary[]>([]), [templates, setTemplates] = React.useState<Template[]>([]);
  const [workspace, setWorkspace] = React.useState<WorkspaceState | null>(null), ref = React.useRef<WorkspaceState | null>(null);
  const activeOwner = React.useRef<string | null>(null); activeOwner.current = user?.user_id ?? null;
  const [section, setSection] = React.useState<Target['collection']>('metadata'), [mode, setMode] = React.useState('manual');
  const [name, setName] = React.useState('我的新世界'), [template, setTemplate] = React.useState<string>('blank');
  const [feedback, setFeedback] = React.useState<{ type: 'error' | 'success' | 'info'; text: string } | null>(null), [busy, setBusy] = React.useState(false);
  const [validation, setValidation] = React.useState<{ value: Validation; version: number } | null>(null);
  const [blockedPaths, setBlockedPaths] = React.useState<string[]>([]), [focusPath, setFocusPath] = React.useState<string | null>(null);
  const [rawInputs, setRawInputs] = React.useState<Record<string, string>>({});
  const [instruction, setInstruction] = React.useState(''), [candidate, setCandidate] = React.useState<GenerationResult | null>(null);
  const [outline, setOutline] = React.useState<OutlineProposal | null>(null), [proposal, setProposal] = React.useState<GenerationResult['candidate'] | null>(null);
  const [generationId, setGenerationId] = React.useState(''), generationRef = React.useRef(''), abort = React.useRef<AbortController | null>(null);
  const [localCandidateVersion, setLocalCandidateVersion] = React.useState(-1);
  const [generating, setGenerating] = React.useState(false), [scopeMode, setScopeMode] = React.useState<'extend' | 'revise'>('extend');
  const [targets, setTargets] = React.useState<Target[]>([]), [selectedGroups, setSelectedGroups] = React.useState<string[]>([]);
  const [candidateSection, setCandidateSection] = React.useState<Target['collection']>('characters'), [candidateRaw, setCandidateRaw] = React.useState<Record<string, string>>({});
  const [world, setWorld] = React.useState<WorldView | null>(null), [worldSource, setWorldSource] = React.useState<number>(-1), [debug, setDebug] = React.useState<unknown>(null);
  const savePending = React.useRef<{ snapshot: WorkspaceState; requestId: string } | null>(null), retryRequests = React.useRef(new Map<string, string>());
  const fileInput = React.useRef<HTMLInputElement>(null);
  const update = (next: WorkspaceState | null) => { ref.current = next; setWorkspace(next); };
  const dirty = workspace !== null && (!sameValue(workspace.document, workspace.savedDocument) || Object.keys(rawInputs).length > 0);
  const own = !!user && workspace?.owner === user.user_id;
  const assertOwn = () => { if (!ref.current || ref.current.owner !== activeOwner.current) throw new Error('请登录原账号后继续此草稿'); return ref.current; };
  const report = (error: unknown) => setFeedback({ type: 'error', text: error instanceof Error ? error.message : '操作失败，请重试' });
  const run = async (work: () => Promise<void>) => { setBusy(true); setFeedback(null); try { await work(); } catch (error) { report(error); } finally { setBusy(false); } };
  const cancel = () => { generationRef.current = ''; setGenerationId(''); abort.current?.abort(); abort.current = null; setGenerating(false); };
  const refreshLists = async () => {
    if (!activeOwner.current) return;
    const owner = activeOwner.current;
    const [ds, rs, ts] = await Promise.all([api<DraftSummary[]>('drafts?limit=100'), api<ReleaseSummary[]>('releases?limit=100'), api<Template[]>('templates?limit=100')]);
    if (activeOwner.current === owner) { setDrafts(ds); setReleases(rs); setTemplates(ts); }
  };
  React.useEffect(() => { cancel(); setDrafts([]); setReleases([]); setTemplates([]); setWorld(null); setDebug(null);
    if (user) void refreshLists().catch(report); return () => { generationRef.current = ''; abort.current?.abort(); };
  }, [user?.user_id]);
  React.useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => { if (dirty || candidate) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', leave); return () => window.removeEventListener('beforeunload', leave);
  }, [dirty, candidate]);
  React.useEffect(() => {
    if (!focusPath) return;
    const nodes = [...document.querySelectorAll<HTMLElement>('[data-definition-path]')];
    const target = nodes.find(node => focusPath === node.dataset.definitionPath || focusPath.startsWith(node.dataset.definitionPath + '/')) ?? document.getElementById('domain-content');
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (target) { target.setAttribute('tabindex', '-1'); target.focus({ preventScroll: true }); }
    setFocusPath(null);
  }, [section, focusPath]);
  const jump = (path: string) => { setSection(issueSection(path)); setMode('manual'); setFocusPath(path); };
  const replace = (draft: DraftView) => {
    if (!activeOwner.current) return;
    cancel(); update(openWorkspace(activeOwner.current, draft, crypto.randomUUID())); setValidation(null); setRawInputs({}); setCandidateRaw({});
    setCandidate(null); setProposal(null); setOutline(null); setInstruction(''); setWorld(null); setDebug(null); setSection('metadata'); savePending.current = null;
    const blank = Array.isArray(atPath(draft.document, ['entities', 'characters'])) && (atPath(draft.document, ['entities', 'characters']) as unknown[]).length === 0;
    setScopeMode(blank ? 'revise' : 'extend'); setTargets(blank ? singletonCollections.map(collection => ({ collection: collection as Target['collection'], key: null })) : []);
  };
  const canReplace = () => !dirty && !candidate || window.confirm('离开会丢失未保存编辑和候选。确认继续？');
  const business = async <T,>(path: string, body: Record<string, unknown>, method = 'POST'): Promise<T> => {
    const owner = activeOwner.current; if (!owner) throw new Error('请先登录');
    const key = canonicalJson({ owner, path, method, body });
    const request_id = retryRequests.current.get(key) ?? crypto.randomUUID(); retryRequests.current.set(key, request_id);
    try { const result = await api<T>(path, method, { ...body, request_id }); retryRequests.current.delete(key); return result; }
    catch (error) { if (error instanceof RequestError && error.status < 500 && error.code !== 'identity_changed') retryRequests.current.delete(key); throw error; }
  };
  const save = async (): Promise<WorkspaceState> => {
    const current = assertOwn();
    if (Object.keys(rawInputs).length) throw new Error('请先完成或修复一行属性声明，再保存');
    if (sameValue(current.document, current.savedDocument) && !savePending.current) return current;
    const pending = savePending.current ?? { snapshot: current, requestId: crypto.randomUUID() }; savePending.current = pending;
    if (pending.snapshot.workspaceId !== current.workspaceId) throw new Error('保存来源已经变化');
    try {
      const saved = await api<DraftView>(`drafts/${current.draft.draft_id}`, 'PUT', { document: pending.snapshot.document,
        expected_revision: pending.snapshot.draft.revision, request_id: pending.requestId });
      const latest = assertOwn(); update(acknowledgeSave(latest, pending.snapshot, saved)); savePending.current = null;
      await refreshLists(); return ref.current!;
    } catch (error) { if (error instanceof RequestError && error.status < 500 && error.code !== 'identity_changed') savePending.current = null; throw error; }
  };
  const savedAction = async (operation: 'validate' | 'preview' | 'releases' | 'export', fullExport = false) => {
    const saved = await save();
    if (!sameValue(saved.document, saved.savedDocument)) throw new Error('保存期间又有修改，请再次保存后执行');
    const revision = saved.draft.revision, id = saved.draft.draft_id, version = saved.contentVersion, workspaceId = saved.workspaceId;
    if (operation === 'validate') {
      const value = await api<Validation>(`drafts/${id}/validate`, 'POST', { expected_revision: revision });
      if (ref.current?.workspaceId === workspaceId) setValidation({ value, version });
      setFeedback({ type: value.valid ? 'success' : 'info', text: value.valid ? '校验通过，可以试玩与定稿。' : `有 ${value.issues.length} 项需要完善。` });
    } else if (operation === 'export') {
      const value = await api<Validation & { document: DraftDocument }>(`drafts/${id}/export?expected_revision=${revision}`);
      if (fullExport && !value.valid) throw new Error('尚未通过校验，请使用“导出草稿”保存未完成内容');
      download(saved.draft.name, fullExport ? value.document : value);
    } else if (operation === 'preview') {
      const result = await business<WorldView>(`drafts/${id}/preview`, { expected_revision: revision });
      if (ref.current?.workspaceId === workspaceId) { setWorld(result); setWorldSource(version); setDebug(null); }
    } else {
      const result = await business<ReleaseSummary>(`drafts/${id}/releases`, { expected_revision: revision });
      await refreshLists(); setFeedback({ type: 'success', text: `已定稿“${result.name}”，来源修订 ${result.source_revision}。` });
    }
  };
  const changeDocument = (document: DraftDocument, historyKey?: string) => { const current = assertOwn(); update(editWorkspace(current, document, historyKey)); };
  const touchProposal = (editingCandidate = false) => { const current = assertOwn();
    update({ ...current, proposalVersion: current.proposalVersion + 1 });
    if (editingCandidate) setLocalCandidateVersion(current.proposalVersion + 1);
  };
  const generate = async (stage: GenerationInput['stage']) => {
    const current = assertOwn();
    if (Object.keys(rawInputs).length || Object.keys(candidateRaw).length) throw new Error('请先完成或修复一行属性声明');
    const id = crypto.randomUUID(), controller = new AbortController(); abort.current = controller; generationRef.current = id; setGenerationId(id); setGenerating(true);
    const submittedProposal = stage === 'detail' ? outline : stage === 'outline' ? outline : proposal?.kind === 'detail' ? proposal : null;
    const input: GenerationInput = { generation_id: id, expected_revision: current.draft.revision, workspace_id: current.workspaceId,
      content_version: current.contentVersion, proposal_version: current.proposalVersion, stage, instruction, document: current.document,
      proposal: submittedProposal, edit_scope: { mode: scopeMode, targets: scopeMode === 'extend' ? [] : targets } };
    try {
      const result = await api<GenerationResult>(`drafts/${current.draft.draft_id}/generate`, 'POST', input, controller.signal);
      const [documentDigest, proposalDigest] = await Promise.all([digest(input.document), digest(input.proposal)]);
      if (generationRef.current !== id || !ref.current || activeOwner.current !== current.owner || !candidateMatches(ref.current, result, id) ||
        result.source.document_digest !== documentDigest || result.source.proposal_digest !== proposalDigest) {
        setFeedback({ type: 'info', text: '生成期间内容或账号已变化，此次结果已丢弃，描述与编辑保留。' }); return;
      }
      setCandidate(result); setProposal(result.candidate); setCandidateRaw({}); setLocalCandidateVersion(result.source.proposal_version);
      if (result.candidate.kind === 'outline') setOutline(result.candidate);
      else setSelectedGroups(result.candidate.groups.map(group => group.group_id));
    } catch (error) { if (!controller.signal.aborted) throw error; }
    finally { if (generationRef.current === id) { setGenerating(false); abort.current = null; } }
  };
  const fresh = own && workspace && candidate && candidateMatches({ ...workspace, proposalVersion: candidate.source.proposal_version }, candidate, generationId) && workspace.proposalVersion === localCandidateVersion;
  const adopt = () => {
    const current = assertOwn(); if (!candidate || !fresh || proposal?.kind !== 'detail') throw new Error('候选已过期，请重新生成');
    if (Object.keys(candidateRaw).length) throw new Error('请先修复候选属性声明');
    const next = applyProposal(current.document, proposal, selectedGroups);
    const oldShape = new Set(draftShapeProblems(current.document).map(canonicalJson));
    if (draftShapeProblems(next).some(issue => !oldShape.has(canonicalJson(issue)))) throw new Error('候选包含新增的未知字段或错误类型，请先修复');
    const previousMissing = new Set(danglingReferences(current.document).map(r => canonicalJson(r)));
    const introduced = danglingReferences(next).filter(r => !previousMissing.has(canonicalJson(r)));
    if (introduced.length) throw new Error('所选改动产生缺失引用，请同时选择关联组或修复候选');
    changeDocument(next); setCandidate(null); setProposal(null); setCandidateRaw({}); setFeedback({ type: 'success', text: '已加入工作副本，可一次撤销；请保存。' });
  };
  const scopeOptions = collections.flatMap(collection => {
    if (singletonCollections.includes(collection)) return [{ value: canonicalJson({ collection, key: null }), label: labels[collection] }];
    const values = atPath(proposal?.kind === 'detail' ? proposal.document : workspace?.document, collectionPaths[collection]);
    return Array.isArray(values) ? [...values.flatMap(value => { const key = itemKey(value, collection); return key ? [{ value: canonicalJson({ collection, key }), label: `${labels[collection]}：${String((value as Record<string, unknown>).name ?? (value as Record<string, unknown>).label ?? key)}` }] : []; }),
      { value: canonicalJson({ collection, key: null }), label: `${labels[collection]}：排序` }] : [];
  });
  if (!user) return workspace ? <Alert type="warning" message="登录已失效，未保存内容保留在此页；登录原账号后继续。" /> : null;
  if (workspace && !own) return <Alert type="warning" message="此页仍保留原账号的未保存工作区。" description="登录原账号可继续；清空后可使用当前账号。" action={<Button danger onClick={() => { if (window.confirm('确认清空原账号的本地工作区？')) { cancel(); update(null); setCandidate(null); setRawInputs({}); } }}>清空本地工作区</Button>} />;
  return <Space direction="vertical" size="large" style={{ width: '100%' }}>
    {feedback && <Alert type={feedback.type} message={feedback.text} showIcon closable onClose={() => setFeedback(null)} />}
    <Card title="我的创作" extra={<Button disabled={busy} onClick={() => void run(refreshLists)}>刷新</Button>}>
      <Space wrap><Input aria-label="新剧本名" value={name} maxLength={120} onChange={e => setName(e.target.value)} />
        <Select aria-label="创建来源" value={template} style={{ minWidth: 190 }} onChange={setTemplate} options={[{ value: 'blank', label: '从空白开始' }, ...templates.map(t => ({ value: t.template_id, label: `模板：${t.name}` }))]} />
        <Button type="primary" disabled={busy || !name.trim()} onClick={() => { if (canReplace()) void run(async () => {
          replace(await business<DraftView>('drafts', { name, source: template === 'blank' ? { type: 'blank' } : { type: 'template', template_id: template } })); await refreshLists();
        }); }}>创建剧本</Button><Button disabled={busy} onClick={() => fileInput.current?.click()}>导入文件</Button>
        <input hidden type="file" accept=".json,application/json" ref={fileInput} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (!file || !canReplace()) return;
          void run(async () => { if (file.size > 2097152) throw new Error('文件超过 2 MiB'); const parsed: unknown = JSON.parse(await file.text());
            const document = parsed && typeof parsed === 'object' && Object.hasOwn(parsed, 'document') ? (parsed as { document: unknown }).document : parsed;
            if (!draftWithinLimits(document)) throw new Error('文件内容过深或过大'); replace(await business<DraftView>('drafts/import', { document })); await refreshLists(); });
        }} /></Space>
      <div className="draft-grid">{drafts.map(draft => <Button key={draft.draft_id} disabled={busy} onClick={() => { if (canReplace()) void run(async () => replace(await api<DraftView>(`drafts/${draft.draft_id}`))); }}>{draft.name} · 修订 {draft.revision}</Button>)}</div>
    </Card>
    {workspace && <Card title={<Space wrap><span>{String(atPath(workspace.document, ['metadata', 'name']) || workspace.draft.name)}</span><Tag color={dirty ? 'gold' : 'green'}>{dirty ? '有未保存修改' : '已保存'}</Tag><Tag>修订 {workspace.draft.revision}</Tag></Space>}>
      <Space wrap className="workspace-toolbar"><Button type="primary" loading={busy} onClick={() => void run(async () => { await save(); setFeedback({ type: 'success', text: sameValue(ref.current?.document, ref.current?.savedDocument) ? '已保存。' : '已保存请求时的版本，后续修改仍待保存。' }); })}>{savePending.current ? '重试原保存' : '保存'}</Button>
        <Button disabled={!workspace.past.length} onClick={() => update(travelWorkspace(assertOwn(), 'undo'))}>撤销</Button><Button disabled={!workspace.future.length} onClick={() => update(travelWorkspace(assertOwn(), 'redo'))}>重做</Button>
        <Button disabled={busy} onClick={() => void run(() => savedAction('validate'))}>保存并校验</Button><Button disabled={busy} onClick={() => void run(() => savedAction('preview'))}>保存并试玩</Button><Button disabled={busy} onClick={() => void run(() => savedAction('releases'))}>保存并定稿</Button>
        <Button disabled={busy} onClick={() => void run(() => savedAction('export', true))}>导出剧本</Button><Button disabled={busy} onClick={() => void run(() => savedAction('export'))}>导出草稿</Button>
      </Space>
      <Tabs activeKey={mode} onChange={setMode} items={[{ key: 'manual', label: '手动创作' }, { key: 'ai', label: '描述你的世界' }]} />
      {mode === 'ai' && <Card size="small" title="AI 创作候选 · 采纳后再保存">
        <Input.TextArea aria-label="世界描述" value={instruction} autoSize={{ minRows: 3, maxRows: 10 }} placeholder="描述世界、角色和冲突，可一次提出多项内容" onChange={e => { setInstruction(e.target.value); touchProposal(); }} />
        <ControlLabel label="此次范围"><Select value={scopeMode} options={[{ value: 'extend', label: '增量扩展：保留已有内容' }, { value: 'revise', label: '补全 / 改写选定内容' }]} onChange={value => { setScopeMode(value); touchProposal(); }} />
          {scopeMode === 'revise' && <Select mode="multiple" style={{ width: '100%' }} placeholder="明确选择可以改写的内容" options={scopeOptions} value={targets.map(t => canonicalJson(t))} onChange={values => { setTargets(values.map(v => JSON.parse(v) as Target)); touchProposal(); }} />}</ControlLabel>
        <Space wrap><Button disabled={generating || !instruction.trim()} onClick={() => void run(() => generate('outline'))}>生成 / 调整大纲</Button><Button disabled={generating || !outline || !instruction.trim()} onClick={() => void run(() => generate('detail'))}>生成细则</Button><Button disabled={generating || !instruction.trim()} onClick={() => void run(() => generate('revise'))}>继续描述并生成细则</Button>
          {generating && <Button onClick={cancel}>取消生成</Button>}</Space>
        <Typography.Paragraph type="secondary">候选仅保留在当前页面。生成不会自动保存；失败后不会自动重试。</Typography.Paragraph>
        {outline && <OutlineEditor outline={outline} onChange={next => { setOutline(next); setProposal(next); touchProposal(); }} />}
        {candidate && <><Alert type={fresh ? 'info' : 'warning'} message={fresh ? '候选与当前工作区匹配' : '候选已过期，可保留查看或重新生成'} />
          {candidate.assumptions.length > 0 && <Typography.Paragraph>补足假设：{candidate.assumptions.join('；')}</Typography.Paragraph>}
          {candidate.questions.length > 0 && <Typography.Paragraph>需要决定：{candidate.questions.join('；')}</Typography.Paragraph>}
          <Typography.Text type="secondary">供应方报告用量：输入 {candidate.usage.input_tokens ?? '未提供'} / 输出 {candidate.usage.output_tokens ?? '未提供'}</Typography.Text></>}
        {proposal?.kind === 'detail' && <><Alert type={proposal.validation.valid ? 'success' : 'warning'} message={proposal.validation.valid ? '候选通过完整定义校验' : `候选仍需完善：${proposal.validation.issues.length} 项问题`} />
          <Checkbox.Group value={selectedGroups} onChange={values => setSelectedGroups(values as string[])} options={proposal.groups.map(g => ({ value: g.group_id, label: `${g.label}（${g.change_ids.length} 项）` }))} />
          <Collapse items={[{ key: 'changes', label: `新增 / 修改 / 删除 · ${proposal.changes.length} 项`, children: proposal.changes.map(c => <div key={c.change_id}><Tag>{c.operation}</Tag>{labels[c.target.collection]} {c.target.key}</div>) },
            { key: 'edit', label: '编辑候选详情', children: <><Select value={candidateSection} onChange={setCandidateSection} options={sections.map(value => ({ value, label: labels[value] }))} />
              <DomainEditor document={proposal.document} section={candidateSection} rawInputs={candidateRaw} rawChange={(key, value) => { setCandidateRaw(current => { const next = { ...current }; if (value === null) delete next[key]; else next[key] = value; return next; }); touchProposal(true); }} change={document => {
                try { const changes = proposalChanges(assertOwn().document, document), groups = proposalGroups(changes);
                  setProposal({ kind: 'detail', document, changes, groups, validation: { valid: false, issues: [{ severity: 'error', definition_path: '/', message: '手动编辑后的候选尚未校验' }] } }); setSelectedGroups(groups.map(g => g.group_id)); touchProposal(true);
                } catch (error) { report(error); }
              }} /></> }] } />
          <Space wrap><Button type="primary" disabled={!fresh || !selectedGroups.length || !!Object.keys(candidateRaw).length} onClick={() => { try { adopt(); } catch (error) { report(error); } }}>加入所选关联组</Button><Button onClick={() => { setCandidate(null); setProposal(null); setCandidateRaw({}); touchProposal(); }}>拒绝候选</Button></Space></>}
      </Card>}
      {validation && <Card size="small" title={validation.version === workspace.contentVersion ? '校验结果' : '校验结果已过期，请重新校验'}>
        {validation.value.valid ? <Alert type="success" message="定义有效" /> : validation.value.issues.map((issue, index) => <Button type="link" key={index} onClick={() => jump(issue.definition_path)}>{labels[issueSection(issue.definition_path)]}：{issue.message}</Button>)}
      </Card>}
      {blockedPaths.length > 0 && <Alert type="warning" message="此内容仍被引用，解除引用后才能删除" description={<Space wrap>{blockedPaths.map(path => <Button type="link" key={path} onClick={() => jump(path)}>跳转：{labels[issueSection(path)]}</Button>)}</Space>} closable onClose={() => setBlockedPaths([])} />}
      <div className="editor-workspace"><nav className="editor-nav">{sections.map(value => <Button key={value} type={section === value ? 'primary' : 'text'} onClick={() => setSection(value)}>{labels[value]}</Button>)}</nav>
        <div id="domain-content"><Typography.Title level={4}>{labels[section]}</Typography.Title><DomainEditor document={workspace.document} change={changeDocument} section={section} blockedReferences={setBlockedPaths} rawInputs={rawInputs} rawChange={(key, value) => {
          setRawInputs(current => { const next = { ...current }; if (value === null) delete next[key]; else next[key] = value; return next; });
          const current = assertOwn(); update({ ...current, contentVersion: current.contentVersion + 1 });
        }} /></div></div>
    </Card>}
    {world && <Card title={`作者试玩 · ${world.name}`} extra={<Button onClick={() => void run(async () => setDebug(await api(`world-sessions/${world.session_id}/debug`)))}>查看内部轨迹</Button>}>
      {world.mode === 'preview' && workspace && worldSource !== workspace.contentVersion && <Alert type="warning" message="草稿已变化，此试玩仍运行原快照。请保存并重新试玩以更新。" />}
      <WorldPanel key={world.session_id} world={world} busy={busy} turn={(action_id, parameters) => void run(async () => {
        const result = await business<WorldView>(`world-sessions/${world.session_id}/turns`, { action_id, parameters, expected_revision: world.revision }); setWorld(result); setDebug(null); await refreshLists();
      })} />{debug !== null && <pre className="debug-view">{JSON.stringify(debug, null, 2)}</pre>}
    </Card>}
    <Card title="我的定稿">{releases.length === 0 ? <Empty description="还没有定稿" /> : releases.map(release => <Space key={release.release_id} wrap className="release-row"><Typography.Text>{release.name} · 来源修订 {release.source_revision}</Typography.Text>
      <Button disabled={busy} onClick={() => { if (canReplace()) void run(async () => { replace(await business<DraftView>('drafts', { name: release.name + ' 副本', source: { type: 'release', release_id: release.release_id } })); await refreshLists(); }); }}>复制编辑</Button>
      <Button onClick={onPlay}>前往游玩</Button>
      <Button disabled={busy} onClick={() => void run(async () => download(release.name, (await api<ReleaseView>(`releases/${release.release_id}`)).definition))}>导出定稿</Button></Space>)}</Card>
  </Space>;
}
function ControlLabel({ label, children }: { label: string; children: React.ReactNode }) { return <div className="editor-control"><span>{label}</span>{children}</div>; }
function OutlineEditor({ outline, onChange }: { outline: OutlineProposal; onChange: (value: OutlineProposal) => void }) {
  const names = { premise: '世界前提', player: '玩家身份', characters: '角色群', conflicts: '冲突', event_directions: '事件方向', gameplay: '玩法', ending_directions: '结束方向' };
  return <Collapse items={[{ key: 'outline', label: '大纲 · 可以微调后细化', children: Object.entries(names).map(([key, label]) => {
    const value = outline[key as keyof OutlineProposal];
    return <ControlLabel key={key} label={label}><Input.TextArea value={Array.isArray(value) ? value.join('\n') : String(value)} autoSize={{ minRows: 1, maxRows: 6 }}
      onChange={e => onChange({ ...outline, [key]: Array.isArray(value) ? e.target.value.split('\n') : e.target.value })} /></ControlLabel>;
  }) }]} />;
}
