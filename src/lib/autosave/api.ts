'use client';

/**
 * Drafts API helpers for the CMS (PHASE AUTOSAVE). Plain fetches: autosave
 * lookups must not raise the global error toasts or sign the CMS out.
 */

import type { DraftKind, DraftSummary, DraftWithPayload } from '../drafts';

const csrf = (): Record<string, string> => {
  const token = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1];
  return token ? { 'x-csrf-token': decodeURIComponent(token) } : {};
};

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
    return res.ok ? ((await res.json()) as T) : null;
  } catch { return null; }
}

/** The shared working copy of an existing item (if any) and the item's current version. */
export const fetchDraftFor = <P = Record<string, unknown>>(kind: DraftKind, entityId: string) =>
  getJson<{ draft: DraftWithPayload<P> | null; currentVersion: string | null }>(`/api/drafts/for/${kind}/${encodeURIComponent(entityId)}`);

export const fetchDraft = <P = Record<string, unknown>>(id: string) =>
  getJson<{ draft: DraftWithPayload<P>; currentVersion: string | null }>(`/api/drafts/${encodeURIComponent(id)}`);

export const listDrafts = () => getJson<{ drafts: DraftSummary[] }>('/api/drafts');

/** Audit: the user chose Continue Draft. */
export function markRecovered(id: string): void {
  void fetch(`/api/drafts/${encodeURIComponent(id)}/recovered`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', ...csrf() }, body: '{}' }).catch(() => undefined);
}

export async function discardDraft(id: string, revision: number): Promise<boolean> {
  try {
    const res = await fetch(`/api/drafts/${encodeURIComponent(id)}?revision=${revision}`, { method: 'DELETE', credentials: 'include', headers: csrf() });
    return res.ok;
  } catch { return false; }
}

/**
 * "Continue editing" from the Unsaved Work list: the target module reads this
 * once when it mounts and opens the draft.
 */
export interface OpenDraftRequest { kind: DraftKind; draftId: string | null; entityId: string | null; local?: boolean }
let pending: OpenDraftRequest | null = null;
export const requestOpenDraft = (r: OpenDraftRequest) => { pending = r; };
export function takeOpenDraft(kinds: DraftKind[]): OpenDraftRequest | null {
  if (!pending || !kinds.includes(pending.kind)) return null;
  const r = pending; pending = null; return r;
}
