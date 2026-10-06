'use client';

/**
 * Unsaved Work (PHASE AUTOSAVE): working copies the user can continue —
 * their own new content plus shared working copies of items they may edit —
 * and unsynced work kept only on this device. "Continue editing" opens the
 * right editor; "Discard" removes the working copy (confirmed). The saved
 * content itself is never changed here.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../../context/AppContext';
import { discardDraft, listDrafts, requestOpenDraft } from '../../../lib/autosave/api';
import { bufferKey, listBuffers, removeBuffer } from '../../../lib/autosave/buffer';
import { DRAFT_KIND_LABEL, type DraftKind, type DraftSummary } from '../../../lib/drafts';
import type { AdminTab } from '../AdminLayout';
import { ago } from './AutosaveUI';

const TAB: Record<DraftKind, AdminTab> = { article: 'articles', event: 'events', edition: 'events', page: 'pages' };

interface Row { key: string; kind: DraftKind; entityId: string | null; draftId: string; revision: number; title: string; savedAt: number; ownerName: string | null; stale: boolean; deviceOnly: boolean }

export function UnsavedWorkPanel({ setActiveTab }: { setActiveTab: (tab: AdminTab) => void }) {
  const { currentUser } = useApp();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const res = await listDrafts();
    const server: DraftSummary[] = res?.drafts ?? [];
    const out: Row[] = server.map((d) => ({
      key: d.id, kind: d.kind, entityId: d.entityId, draftId: d.id, revision: d.revision, title: d.title, savedAt: Date.parse(d.updatedAt),
      ownerName: d.ownerId === currentUser.id ? null : d.ownerName, stale: !!d.stale, deviceOnly: false,
    }));
    // Changes that never reached the server (kept on this device).
    for (const b of listBuffers(currentUser.id)) {
      const match = out.find((r) => (b.entityId ? r.kind === b.kind && r.entityId === b.entityId : r.draftId === b.draftId));
      if (match) { if (b.savedAt > match.savedAt) { match.savedAt = b.savedAt; match.title = b.title; match.deviceOnly = true; } continue; }
      out.push({ key: `local:${b.draftId}`, kind: b.kind, entityId: b.entityId, draftId: b.draftId, revision: b.revision, title: b.title, savedAt: b.savedAt, ownerName: null, stale: false, deviceOnly: true });
    }
    out.sort((a, b) => b.savedAt - a.savedAt);
    setRows(out);
  }, [currentUser.id]);
  // Load now, and once more shortly after: an editor that was just left sends its last changes as it closes.
  useEffect(() => { void load(); const t = setTimeout(() => void load(), 2000); return () => clearTimeout(t); }, [load]);

  if (!rows || !rows.length) return null;

  const open = (r: Row) => {
    requestOpenDraft({ kind: r.kind, entityId: r.entityId, draftId: r.draftId, local: r.deviceOnly });
    setActiveTab(TAB[r.kind]);
  };
  const discard = async (r: Row) => {
    if (!window.confirm(`Discard the unsaved work on "${r.title}"? The saved content itself is not changed.`)) return;
    setError('');
    if (!r.key.startsWith('local:') && !(await discardDraft(r.draftId, r.revision))) { setError('That working copy changed meanwhile, so it was kept.'); await load(); return; }
    removeBuffer(bufferKey(currentUser.id, r.kind, r.entityId, r.draftId));
    await load();
  };

  return (
    <section aria-labelledby="unsaved-work-title" data-testid="unsaved-work" className="rounded-xl border border-sky-200 bg-sky-50/60 p-4 dark:border-sky-900 dark:bg-sky-950/30">
      <h3 id="unsaved-work-title" className="font-serif text-base font-bold text-stone-900 dark:text-stone-100">Unsaved work</h3>
      <p className="mt-0.5 text-xs text-stone-600 dark:text-stone-400">Autosaved changes that have not been saved or published yet. The live site shows the last saved version.</p>
      {error && <p role="alert" className="mt-2 text-xs text-rose-700 dark:text-rose-300">{error}</p>}
      <ul className="mt-3 divide-y divide-sky-100 dark:divide-sky-900/60">
        {rows.map((r) => (
          <li key={r.key} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
            <div className="min-w-0">
              <p className="truncate font-semibold text-stone-900 dark:text-stone-100">{r.title}</p>
              <p className="text-stone-500 dark:text-stone-400">
                {DRAFT_KIND_LABEL[r.kind]}{r.entityId ? '' : ' · new'} · Last saved {ago(r.savedAt)}{r.ownerName ? ` by ${r.ownerName}` : ''}
                {r.deviceOnly && ' · on this device only'}
                {r.stale && ' · the saved version changed since'}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button type="button" onClick={() => open(r)} className="rounded-lg bg-amber-700 px-3 py-1.5 font-semibold text-white hover:bg-amber-800">Continue editing</button>
              <button type="button" onClick={() => void discard(r)} className="rounded-lg border border-stone-300 px-3 py-1.5 font-semibold hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800">Discard</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
