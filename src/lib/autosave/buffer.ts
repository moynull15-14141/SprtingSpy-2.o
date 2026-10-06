/**
 * Local safety buffer for autosave (PHASE AUTOSAVE). Holds only the latest
 * editor state that has NOT yet reached the server (network down, session
 * expired, tab closed mid-save). The server-side working copy (EditorDraft)
 * is the real draft; an entry here is removed as soon as the server confirms
 * that state, and every entry is removed on logout. No credentials are stored.
 *
 * Storage can be unavailable (private windows, blocked site data); every
 * access is wrapped so the editor keeps working without it.
 */

import type { DraftKind } from '../drafts';

const PREFIX = 'sportingspy_draftbuf:';

export interface BufferEntry<P = Record<string, unknown>> {
  draftId: string;
  kind: DraftKind;
  entityId: string | null;
  revision: number;
  baseVersion: string | null;
  title: string;
  payload: P;
  /** When this unsynced state was captured (ms). */
  savedAt: number;
}

export const bufferKey = (userId: string, kind: DraftKind, entityId: string | null, draftId: string) =>
  `${PREFIX}${userId}:${kind}:${entityId ?? `new:${draftId}`}`;

export function writeBuffer(key: string, entry: BufferEntry): void {
  try { localStorage.setItem(key, JSON.stringify(entry)); } catch { /* storage full or blocked: the server copy still applies */ }
}

export function readBuffer<P = Record<string, unknown>>(key: string): BufferEntry<P> | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as BufferEntry<P>) : null;
  } catch { return null; }
}

export function removeBuffer(key: string): void {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

/** Unsynced entries of one user (for the Unsaved Work list). */
export function listBuffers(userId: string): BufferEntry[] {
  const out: BufferEntry[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(`${PREFIX}${userId}:`)) continue;
      const entry = readBuffer(key);
      if (entry) out.push(entry);
    }
  } catch { /* ignore */ }
  return out;
}

/** Removes every unsynced buffer (explicit logout). */
export function clearDraftBuffers(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith(PREFIX)) keys.push(k); }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}
