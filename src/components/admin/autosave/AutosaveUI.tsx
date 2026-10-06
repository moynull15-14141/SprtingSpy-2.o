'use client';

/**
 * Autosave UI (PHASE AUTOSAVE): the small status chip next to an editor's
 * save controls, the recovery banner shown when an editor opens an item with
 * unsaved work, and the warning shown when a save was refused because the
 * live item changed. Non-blocking: nothing here is a modal.
 */

import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, Loader2, RotateCcw } from 'lucide-react';
import type { Autosave } from '../../../lib/autosave/useAutosave';
import { STALE_VERSION_MESSAGE } from '../../../lib/drafts';

export function ago(ms: number | null, now = Date.now()): string {
  if (!ms) return '';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s} seconds ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'} ago`;
  return new Date(ms).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

/** Re-renders periodically so "saved … ago" stays current. */
function useNow(intervalMs = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), intervalMs); return () => clearInterval(t); }, [intervalMs]);
  return now;
}

const chip = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium';

export function AutosaveStatus({ autosave, onLoadNewer }: { autosave: Autosave; onLoadNewer?: () => void }) {
  const now = useNow();
  const { state, message, lastSavedAt } = autosave;
  if (state === 'idle') return null;
  if (state === 'pending') return <span role="status" data-autosave="pending" className={`${chip} text-stone-500 dark:text-stone-400`}><span aria-hidden="true">●</span> Unsaved changes</span>;
  if (state === 'saving') return <span role="status" data-autosave="saving" className={`${chip} text-stone-500 dark:text-stone-400`}><Loader2 size={11} className="animate-spin" aria-hidden="true" /> Saving…</span>;
  if (state === 'saved') return <span role="status" data-autosave="saved" className={`${chip} text-emerald-700 dark:text-emerald-400`} title="Your work is saved as a private working copy. Use Save or Publish to update the live content."><Check size={11} aria-hidden="true" /> Saved {ago(lastSavedAt, now)}</span>;
  if (state === 'conflict') {
    return (
      <span role="alert" data-autosave="conflict" className={`${chip} flex-wrap bg-amber-50 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200`}>
        <AlertTriangle size={11} aria-hidden="true" /> {message}
        {onLoadNewer && <button type="button" className="font-semibold underline" onClick={onLoadNewer}>Load newer draft</button>}
        <button type="button" className="font-semibold underline" onClick={() => { if (window.confirm('Replace the newer working copy with what is in your editor now?')) autosave.keepMine(); }}>Keep mine</button>
      </span>
    );
  }
  return (
    <span role="alert" data-autosave={state} className={`${chip} bg-rose-50 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200`}>
      <AlertTriangle size={11} aria-hidden="true" /> {message || 'Save failed — retrying…'}
      <button type="button" className="inline-flex items-center gap-0.5 font-semibold underline" onClick={autosave.retry}><RotateCcw size={10} aria-hidden="true" /> Retry</button>
    </span>
  );
}

export interface RecoveryOffer {
  source: 'server' | 'device';
  savedAt: number;
  ownerName?: string | null;
  /** The live item changed since this working copy started. */
  stale?: boolean;
}

export function DraftRecoveryBanner({ offer, onContinue, onDiscard, busy }: { offer: RecoveryOffer; onContinue: () => void; onDiscard: () => void; busy?: boolean }) {
  const now = useNow();
  return (
    <div role="alert" data-testid="draft-recovery" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
      <p className="font-semibold">Unsaved work found · saved {ago(offer.savedAt, now)}{offer.ownerName ? ` by ${offer.ownerName}` : ''}</p>
      <p className="mt-1 text-xs">
        {offer.source === 'device'
          ? 'These changes were kept on this device because they had not reached the server yet.'
          : 'A working copy was autosaved but not yet saved to the content itself.'}{' '}
        The editor below shows the last saved version until you choose.
      </p>
      {offer.stale && <p className="mt-1 text-xs font-semibold">{STALE_VERSION_MESSAGE}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={onContinue} className="rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-50">Continue Draft</button>
        <button type="button" disabled={busy} onClick={onDiscard} className="rounded-lg border border-amber-400 px-3 py-1.5 text-xs font-semibold hover:bg-amber-100 disabled:opacity-50 dark:hover:bg-amber-900/50">Discard Draft</button>
      </div>
    </div>
  );
}

/** Shown when a manual save was refused because the live item changed (409 stale_version). */
export function StaleSaveWarning({ onApplyAnyway, onDismiss }: { onApplyAnyway: () => void; onDismiss: () => void }) {
  return (
    <div role="alert" data-testid="stale-save" className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-100">
      <p className="font-semibold">{STALE_VERSION_MESSAGE}</p>
      <p className="mt-1 text-xs">Nothing was overwritten. Open the item again in another tab to see the newer version, or apply your changes on top of it.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => { if (window.confirm('Apply your changes and replace the newer version?')) onApplyAnyway(); }} className="rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-800">Apply my changes anyway</button>
        <button type="button" onClick={onDismiss} className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-semibold hover:bg-rose-100 dark:hover:bg-rose-900/50">Keep editing</button>
      </div>
    </div>
  );
}
