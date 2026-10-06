'use client';

/**
 * Finding recoverable work when an editor opens (PHASE AUTOSAVE): the shared
 * server working copy of the item, or newer unsynced state kept on this
 * device. The editor shows the saved item until the user chooses.
 */

import type { DraftKind } from '../drafts';
import type { AutosaveStart } from './useAutosave';
import { bufferKey, readBuffer, removeBuffer } from './buffer';
import { fetchDraft, fetchDraftFor } from './api';

export interface Recoverable<P> {
  source: 'server' | 'device';
  savedAt: number;
  ownerName: string | null;
  stale: boolean;
  title: string;
  payload: P;
  /** Pass to autosave.start() when the user continues. */
  start: AutosaveStart;
  serverDraft: { id: string; revision: number } | null;
  localKey: string | null;
}

/** Existing item: its working copy (server) or newer unsynced device state. */
export async function findRecoverable<P>(kind: DraftKind, userId: string, entityId: string): Promise<{ currentVersion: string | null; recoverable: Recoverable<P> | null }> {
  const res = await fetchDraftFor<P>(kind, entityId);
  const currentVersion = res?.currentVersion ?? null;
  const server = res?.draft ?? null;
  const localKey = bufferKey(userId, kind, entityId, '');
  const local = readBuffer<P>(localKey);
  const serverAt = server ? Date.parse(server.updatedAt) : 0;
  if (local && local.savedAt > serverAt) {
    return {
      currentVersion,
      recoverable: {
        source: 'device', savedAt: local.savedAt, ownerName: null, title: local.title, payload: local.payload,
        stale: !!local.baseVersion && !!currentVersion && local.baseVersion !== currentVersion,
        start: { entityId, baseVersion: local.baseVersion ?? currentVersion, draft: server ? { id: server.id, revision: server.revision } : local.revision > 0 ? { id: local.draftId, revision: local.revision } : null, unsynced: true },
        serverDraft: server ? { id: server.id, revision: server.revision } : null, localKey,
      },
    };
  }
  if (server) {
    return {
      currentVersion,
      recoverable: {
        source: 'server', savedAt: serverAt, ownerName: server.ownerId === userId ? null : server.ownerName, title: server.title, payload: server.payload,
        stale: !!server.baseVersion && !!currentVersion && server.baseVersion !== currentVersion,
        start: { entityId, baseVersion: server.baseVersion ?? currentVersion, draft: { id: server.id, revision: server.revision, updatedAt: server.updatedAt } },
        serverDraft: { id: server.id, revision: server.revision }, localKey: local ? localKey : null,
      },
    };
  }
  return { currentVersion, recoverable: null };
}

/** New content from the Unsaved Work list: a server draft (by id) or a device-only buffer. */
export async function loadNewDraft<P>(kind: DraftKind, userId: string, draftId: string): Promise<{ title: string; payload: P; start: AutosaveStart } | null> {
  const local = readBuffer<P>(bufferKey(userId, kind, null, draftId));
  const res = await fetchDraft<P>(draftId);
  const server = res?.draft ?? null;
  if (local && (!server || local.savedAt > Date.parse(server.updatedAt))) {
    return { title: local.title, payload: local.payload, start: { entityId: null, baseVersion: null, draft: server ? { id: server.id, revision: server.revision } : { id: draftId, revision: 0 }, unsynced: true } };
  }
  if (server) return { title: server.title, payload: server.payload, start: { entityId: null, baseVersion: null, draft: { id: server.id, revision: server.revision, updatedAt: server.updatedAt } } };
  return null;
}

export const forgetLocal = (key: string | null) => { if (key) removeBuffer(key); };

/** Plain text of a rich-text document (enough to tell whether new content is meaningful). */
export function docHasText(doc: unknown): boolean {
  const walk = (n: unknown): boolean => {
    if (!n || typeof n !== 'object') return false;
    const node = n as { text?: unknown; content?: unknown[]; type?: string };
    if (typeof node.text === 'string' && node.text.trim()) return true;
    if (node.type === 'image' || node.type === 'mediaGroup' || node.type === 'table' || node.type === 'embed') return true;
    return Array.isArray(node.content) && node.content.some(walk);
  };
  return walk(doc);
}
