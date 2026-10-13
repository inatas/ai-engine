import { sameValue, type DraftDocument, type DraftView, type GenerationResult } from '@ai-engine/contracts';

export interface WorkspaceState {
  owner: string; draft: DraftView; document: DraftDocument; savedDocument: DraftDocument;
  workspaceId: string; contentVersion: number; proposalVersion: number;
  past: DraftDocument[]; future: DraftDocument[];
  lastEditKey: string | null;
}
export function openWorkspace(owner: string, draft: DraftView, workspaceId: string): WorkspaceState {
  return { owner, draft, document: draft.document, savedDocument: draft.document, workspaceId, contentVersion: 0, proposalVersion: 0, past: [], future: [], lastEditKey: null };
}
export function editWorkspace(state: WorkspaceState, document: DraftDocument, historyKey?: string): WorkspaceState {
  if (sameValue(state.document, document)) return historyKey === undefined && state.lastEditKey ? { ...state, lastEditKey: null } : state;
  return { ...state, document, contentVersion: state.contentVersion + 1,
    past: historyKey && state.lastEditKey === historyKey ? state.past : [...state.past.slice(-99), state.document], future: [], lastEditKey: historyKey ?? null };
}
export function travelWorkspace(state: WorkspaceState, direction: 'undo' | 'redo'): WorkspaceState {
  const from = direction === 'undo' ? state.past : state.future;
  const document = from.at(-1); if (!document) return state;
  return { ...state, document, contentVersion: state.contentVersion + 1, lastEditKey: null,
    past: direction === 'undo' ? state.past.slice(0, -1) : [...state.past, state.document],
    future: direction === 'undo' ? [...state.future, state.document] : state.future.slice(0, -1) };
}
export function acknowledgeSave(state: WorkspaceState, snapshot: WorkspaceState, saved: DraftView): WorkspaceState {
  if (state.owner !== snapshot.owner || state.workspaceId !== snapshot.workspaceId || state.draft.draft_id !== saved.draft_id) return state;
  return { ...state, draft: saved, savedDocument: snapshot.document };
}
export function candidateMatches(state: WorkspaceState, candidate: GenerationResult, generationId: string): boolean {
  const source = candidate.source;
  return source.generation_id === generationId && source.draft_id === state.draft.draft_id && source.workspace_id === state.workspaceId &&
    source.expected_revision === state.draft.revision && source.content_version === state.contentVersion && source.proposal_version === state.proposalVersion;
}
export function writePath(document: DraftDocument, path: (string | number)[], value: unknown): DraftDocument {
  if (path.length === 0) return structuredClone(value) as DraftDocument;
  const result = structuredClone(document); let parent: Record<string | number, unknown> = result;
  for (const [i, key] of path.slice(0, -1).entries()) {
    const next = parent[key];
    const expectsArray = typeof path[i + 1] === 'number';
    if (!next || typeof next !== 'object' || Array.isArray(next) !== expectsArray) parent[key] = expectsArray ? [] : {};
    parent = parent[key] as Record<string | number, unknown>;
  }
  parent[path.at(-1)!] = value; return result;
}
