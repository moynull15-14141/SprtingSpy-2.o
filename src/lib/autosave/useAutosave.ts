'use client';

/**
 * CMS autosave (PHASE AUTOSAVE). Persists an editor's form state to a
 * server-side working copy (/api/drafts) — never to the live item.
 *
 *   change → wait until typing pauses (2 s), never longer than 15 s → PUT
 *
 * - One request in flight; changes made meanwhile are sent right after.
 * - Saves immediately when the tab is hidden or closed, and when the editor
 *   unmounts (CMS navigation); `flush()` lets the editor save on demand.
 * - Each PUT carries the draft revision it is based on: a retry of an
 *   already-applied save is answered idempotently, a newer draft from someone
 *   else is a conflict that stops autosave until the user decides.
 * - Failures keep the editor state, store it in the local safety buffer and
 *   retry with backoff (and when the browser comes back online).
 * - The browser/CMS navigation warning appears only when the latest state has
 *   not reached the server AND cannot be sent reliably now.
 *
 * Usage: call `start({ entityId, baseVersion, draft? })` whenever the editor
 * opens an item (after setting the form), `applied()` after a successful
 * manual Save, `stop()` when the editor closes without saving.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AUTOSAVE_TIMING, stableJson, type DraftKind, type DraftWithPayload } from '../drafts';
import { bufferKey, removeBuffer, writeBuffer } from './buffer';

export type AutosaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'retrying' | 'error' | 'conflict';

export interface AutosaveStart {
  entityId: string | null;
  /** Version of the live item the form was loaded from (null for new content). */
  baseVersion: string | null;
  /** Continue an existing working copy (its id/revision). */
  draft?: { id: string; revision: number; updatedAt?: string } | null;
  /** The form holds state that is not on the server yet (e.g. from the local buffer): save it soon. */
  unsynced?: boolean;
}

interface Options<P> {
  kind: DraftKind;
  userId: string;
  /** False while the editor is read-only or a recovery decision is pending. */
  enabled: boolean;
  title: string;
  payload: P;
  /** New content only: whether the form holds meaningful input yet. */
  meaningful: boolean;
}

const KEEPALIVE_LIMIT = 60_000; // browsers cap keepalive bodies at 64 KB
const newDraftId = () => `draft-${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const csrfHeader = (): Record<string, string> => {
  const token = typeof document !== 'undefined' ? document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] : undefined;
  return token ? { 'x-csrf-token': decodeURIComponent(token) } : {};
};

interface Session {
  active: boolean;
  entityId: string | null;
  draftId: string;
  revision: number;
  baseVersion: string | null;
  synced: string;
  adoptNext: boolean;
  inFlight: Promise<boolean> | null;
  again: boolean;
  firstDirty: number;
  attempts: number;
  halted: boolean;
  /** Until then, changes without user input are the editor settling (e.g. rich-text normalisation), not edits. */
  settleUntil: number;
  userInput: boolean;
}
const SETTLE_MS = 1500;
const idleSession = (): Session => ({ active: false, entityId: null, draftId: newDraftId(), revision: 0, baseVersion: null, synced: '', adoptNext: false, inFlight: null, again: false, firstDirty: 0, attempts: 0, halted: false, settleUntil: 0, userInput: false });

export function useAutosave<P extends object>({ kind, userId, enabled, title, payload, meaningful }: Options<P>) {
  const serialized = useMemo(() => JSON.stringify({ title, payload }), [title, payload]);
  const latest = useRef({ title, payload, serialized, enabled, meaningful });
  latest.current = { title, payload, serialized, enabled, meaningful };
  const session = useRef<Session>(idleSession());
  const timers = useRef<{ debounce?: ReturnType<typeof setTimeout>; retry?: ReturnType<typeof setTimeout> }>({});
  const [state, setState] = useState<AutosaveState>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState<DraftWithPayload | null>(null);
  const flushRef = useRef<(o?: { keepalive?: boolean }) => Promise<boolean>>(async () => true);

  const keyOf = (s: Session) => bufferKey(userId, kind, s.entityId, s.draftId);
  const clearTimers = () => { clearTimeout(timers.current.debounce); clearTimeout(timers.current.retry); };
  const unsyncedNow = () => {
    const s = session.current, cur = latest.current;
    return s.active && cur.enabled && cur.serialized !== s.synced && (s.revision > 0 || cur.meaningful);
  };

  const flush = useCallback(async (o: { keepalive?: boolean } = {}): Promise<boolean> => {
    const s = session.current, cur = latest.current;
    if (!s.active || s.halted || !cur.enabled) return !unsyncedNow();
    if (cur.serialized === s.synced || (s.revision === 0 && !cur.meaningful)) return true;
    if (s.inFlight) { s.again = true; return s.inFlight; }
    clearTimeout(timers.current.debounce);
    const sent = cur.serialized;
    const body = JSON.stringify({ kind, entityId: s.entityId, revision: s.revision, title: cur.title.slice(0, 300), payload: cur.payload, baseVersion: s.baseVersion });
    setState('saving');
    const retryLater = (msg: string, afterMs?: number) => {
      s.attempts++;
      setState('retrying');
      setMessage(msg);
      clearTimeout(timers.current.retry);
      timers.current.retry = setTimeout(() => { void flushRef.current(); }, afterMs ?? Math.min(AUTOSAVE_TIMING.retryBaseMs * 2 ** (s.attempts - 1), AUTOSAVE_TIMING.retryMaxMs));
      return false;
    };
    const run = (async (): Promise<boolean> => {
      let res: Response;
      try {
        res = await fetch(`/api/drafts/${encodeURIComponent(s.draftId)}`, {
          method: 'PUT', credentials: 'include', cache: 'no-store',
          headers: { 'Content-Type': 'application/json', ...csrfHeader() }, body,
          keepalive: !!o.keepalive && body.length < KEEPALIVE_LIMIT,
        });
      } catch {
        return session.current === s ? retryLater('Save failed — retrying…') : false;
      }
      const json = await res.json().catch(() => ({} as Record<string, any>));
      if (session.current !== s) return false; // the editor moved on; the request still saved that item
      if (res.ok) {
        s.revision = json.draft.revision;
        s.synced = sent;
        s.firstDirty = 0;
        s.attempts = 0;
        if (latest.current.serialized === sent) removeBuffer(keyOf(s));
        setLastSavedAt(Date.parse(json.draft.updatedAt) || Date.now());
        setState('saved');
        setMessage(null);
        return true;
      }
      if (res.status === 409) {
        if (json.code === 'draft_gone') { s.draftId = newDraftId(); s.revision = 0; s.again = true; return false; } // recreate it: never lose the user's work
        if (json.draft && json.draft.title === JSON.parse(sent).title && stableJson(json.draft.payload) === stableJson(JSON.parse(sent).payload)) { s.revision = json.draft.revision; s.synced = sent; setState('saved'); return true; }
        s.halted = true;
        setConflict(json.draft ?? null);
        setState('conflict');
        setMessage(json.error || 'This draft was changed in another window or by another editor.');
        return false;
      }
      if (res.status === 401) return retryLater('Signed out — your latest changes are kept on this device. Sign in again to keep autosaving.', 15_000);
      if (res.status === 429) return retryLater('Save failed — retrying…', (Number(res.headers.get('Retry-After')) || 10) * 1000);
      if (res.status >= 500) return retryLater('Save failed — retrying…');
      // 400/403/404/413: retrying the same request cannot succeed.
      s.halted = true;
      setState('error');
      setMessage(`${json.error || `Autosave unavailable (HTTP ${res.status}).`} Use Save to keep your changes.`);
      return false;
    })();
    s.inFlight = run;
    let ok = false;
    try { ok = await run; } finally { if (session.current === s) s.inFlight = null; }
    if (session.current === s && s.again) { s.again = false; void flushRef.current(); }
    return ok;
  }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps
  flushRef.current = flush;

  // Schedule saves as the form changes.
  useEffect(() => {
    const s = session.current;
    if (!s.active || s.halted) return;
    if (s.adoptNext) { s.adoptNext = false; s.synced = serialized; return; } // the form was just loaded: nothing new yet
    // Right after loading, the editor may re-emit its content (normalised); without user input that is not an edit.
    if (!s.userInput && Date.now() < s.settleUntil) { s.synced = serialized; return; }
    if (!enabled || serialized === s.synced || (s.revision === 0 && !meaningful)) return;
    writeBuffer(keyOf(s), { draftId: s.draftId, kind, entityId: s.entityId, revision: s.revision, baseVersion: s.baseVersion, title, payload: payload as Record<string, unknown>, savedAt: Date.now() });
    setState((prev) => (prev === 'saving' || prev === 'retrying' ? prev : 'pending'));
    if (!s.firstDirty) s.firstDirty = Date.now();
    const wait = Math.max(0, Math.min(AUTOSAVE_TIMING.debounceMs, s.firstDirty + AUTOSAVE_TIMING.maxWaitMs - Date.now()));
    clearTimeout(timers.current.debounce);
    timers.current.debounce = setTimeout(() => { void flushRef.current(); }, wait);
  }, [serialized, enabled, meaningful]); // eslint-disable-line react-hooks/exhaustive-deps

  // Page lifecycle: save when hidden/closed; warn only when the state cannot be sent reliably.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') void flushRef.current({ keepalive: true }); };
    const onPageHide = () => { void flushRef.current({ keepalive: true }); };
    const onOnline = () => { if (session.current.active && !session.current.halted) void flushRef.current(); };
    const atRisk = () => {
      if (!unsyncedNow()) return false;
      const body = JSON.stringify(latest.current.payload).length;
      return session.current.halted || session.current.attempts > 0 || body >= KEEPALIVE_LIMIT;
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!unsyncedNow()) return;
      void flushRef.current({ keepalive: true });
      if (atRisk()) { e.preventDefault(); e.returnValue = ''; }
    };
    // CMS navigation unmounts the editor (which saves); confirm only when saving is failing.
    const onClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest('a,button');
      if (!target || !atRisk()) return;
      const leaving = target.tagName === 'A' || !!target.closest('[data-admin-shell] nav');
      if (leaving && !window.confirm('Your latest changes have not reached the server yet. They are kept on this device and can be recovered. Leave anyway?')) { e.preventDefault(); e.stopPropagation(); }
    };
    // Any real input marks the session as edited (so a change right after opening is never mistaken for settling).
    const onInput = () => { if (session.current.active) session.current.userInput = true; };
    const inputEvents = ['keydown', 'beforeinput', 'paste', 'drop', 'change'] as const;
    inputEvents.forEach((t) => document.addEventListener(t, onInput, true));
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('online', onOnline);
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      inputEvents.forEach((t) => document.removeEventListener(t, onInput, true));
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Leaving the editor (CMS menu, another module): send what is pending.
  useEffect(() => () => { clearTimers(); void flushRef.current({ keepalive: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Begin autosaving the item the form now shows. */
  const start = useCallback((opts: AutosaveStart) => {
    clearTimers();
    session.current = {
      ...idleSession(), active: true, entityId: opts.entityId, baseVersion: opts.baseVersion,
      draftId: opts.draft?.id ?? newDraftId(), revision: opts.draft?.revision ?? 0, adoptNext: !opts.unsynced,
      settleUntil: opts.unsynced ? 0 : Date.now() + SETTLE_MS,
    };
    setConflict(null);
    setMessage(null);
    setState(opts.draft ? 'saved' : 'idle');
    setLastSavedAt(opts.draft?.updatedAt ? Date.parse(opts.draft.updatedAt) : null);
  }, []);

  /** Editor closed without saving: send pending changes, keep the working copy for recovery. */
  const stop = useCallback(async () => {
    // Wait briefly for the last save; if the network is slow the local buffer still holds it.
    await Promise.race([flushRef.current(), new Promise((r) => setTimeout(r, 3000))]);
    clearTimers();
    session.current = idleSession();
    setState('idle');
  }, []);

  /** Detach without saving (after a confirmed discard, before the form is cleared). */
  const end = useCallback(() => {
    clearTimers();
    session.current = idleSession();
    setConflict(null);
    setMessage(null);
    setState('idle');
  }, []);

  /** After a successful manual Save: the working copy has been applied, so remove it. */
  const applied = useCallback(async () => {
    const s = session.current;
    clearTimers();
    if (s.inFlight) await s.inFlight.catch(() => false);
    removeBuffer(keyOf(s));
    if (s.revision > 0) {
      await fetch(`/api/drafts/${encodeURIComponent(s.draftId)}?applied=1&revision=${s.revision}`, { method: 'DELETE', credentials: 'include', headers: csrfHeader() }).catch(() => undefined);
    }
    session.current = idleSession();
    setState('idle');
    setLastSavedAt(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Discard this working copy (the caller confirms first). Returns false if someone changed it meanwhile. */
  const discard = useCallback(async (draft?: { id: string; revision: number }) => {
    const s = session.current;
    const id = draft?.id ?? s.draftId, revision = draft?.revision ?? s.revision;
    clearTimers();
    removeBuffer(bufferKey(userId, kind, s.entityId, id));
    if (revision > 0) {
      const res = await fetch(`/api/drafts/${encodeURIComponent(id)}?revision=${revision}`, { method: 'DELETE', credentials: 'include', headers: csrfHeader() }).catch(() => null);
      if (!res || !res.ok) return false;
    }
    if (!draft || draft.id === s.draftId) { s.draftId = newDraftId(); s.revision = 0; s.halted = false; setConflict(null); setState('idle'); setLastSavedAt(null); }
    return true;
  }, [kind, userId]);

  /** Conflict: overwrite the newer draft with this editor's state (explicit user choice). */
  const keepMine = useCallback(() => {
    const s = session.current;
    if (conflict) s.revision = conflict.revision;
    s.halted = false;
    s.synced = '';
    setConflict(null);
    void flushRef.current();
  }, [conflict]);

  /** Retry now (after an error, or when the user asks). */
  const retry = useCallback(() => {
    const s = session.current;
    s.halted = false;
    clearTimeout(timers.current.retry);
    void flushRef.current();
  }, []);

  return {
    state, message, lastSavedAt, conflict,
    start, stop, end, flush, applied, discard, keepMine, retry,
    /** Version of the live item this editor started from (send as X-Expected-Version). */
    baseVersion: () => session.current.baseVersion,
    setBaseVersion: (v: string | null) => { session.current.baseVersion = v; },
    draftRef: () => ({ id: session.current.draftId, revision: session.current.revision }),
  };
}

export type Autosave = ReturnType<typeof useAutosave>;
