/**
 * CMS workspace restore: after a page refresh the CMS returns to the same desk (URL hash,
 * e.g. /admin/#articles) and reopens the editor that was open, through the same
 * "Continue editing" handoff as Unsaved Work. The open editor is remembered per browser
 * tab (sessionStorage) and per user; every storage failure is ignored (the CMS then simply
 * opens the Dashboard, as before).
 */
import type { DraftKind } from '../drafts';

const OPEN_EDITOR_KEY = 'cms-open-editor';

export interface OpenEditorRecord { userId: string; kind: DraftKind; entityId: string | null; draftId: string }

/** The desk (AdminTab id) that hosts each editor kind. */
export const DESK_FOR_KIND: Record<DraftKind, string> = { article: 'articles', event: 'events', edition: 'events', page: 'pages' };

export function rememberOpenEditor(record: OpenEditorRecord): void {
  try {
    const value = JSON.stringify(record);
    if (sessionStorage.getItem(OPEN_EDITOR_KEY) !== value) sessionStorage.setItem(OPEN_EDITOR_KEY, value);
  } catch { /* storage unavailable: nothing to restore later */ }
}

/** Forget the open editor of this kind (closed, saved-and-closed, or its desk was left). */
export function forgetOpenEditor(kind: DraftKind, userId: string): void {
  try {
    const current = readOpenEditor(userId);
    if (current?.kind === kind) sessionStorage.removeItem(OPEN_EDITOR_KEY);
  } catch { /* ignore */ }
}

export function readOpenEditor(userId: string): OpenEditorRecord | null {
  try {
    const raw = sessionStorage.getItem(OPEN_EDITOR_KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as Partial<OpenEditorRecord>;
    if (r.userId !== userId || !r.kind || !(r.kind in DESK_FOR_KIND) || typeof r.draftId !== 'string') return null;
    if (r.entityId !== null && typeof r.entityId !== 'string') return null;
    return { userId: r.userId, kind: r.kind, entityId: r.entityId ?? null, draftId: r.draftId };
  } catch { return null; }
}

/** The desk named in the URL hash ("#articles"), if it is one of the desks this user may open. */
export function deskFromHash(hash: string, allowed: readonly string[]): string | null {
  const id = decodeURIComponent(hash.replace(/^#\/?/, '')).trim();
  return id && allowed.includes(id) ? id : null;
}

/** Small per-tab UI choices (e.g. Events vs Editions sub-tab) that should survive a refresh. */
export function readTabState<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try { const v = sessionStorage.getItem(`cms-ui:${key}`); return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback; } catch { return fallback; }
}
export function writeTabState(key: string, value: string): void {
  try { sessionStorage.setItem(`cms-ui:${key}`, value); } catch { /* ignore */ }
}
