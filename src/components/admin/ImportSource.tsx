'use client';

/**
 * Marks articles that were imported from the old WordPress site: a badge in
 * the Articles list and a note at the top of the editor. Read-only; it shows
 * the original post ID, title and address so an editor can compare.
 */

import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { IMPORT_SOURCE_LABELS, type ImportSourceName } from '../../lib/editorialWorkflow';

export interface ImportRecord { source: string; sourceId: string; sourceTitle: string; sourceUrl: string; importedAt?: string }

const label = (source: string) => IMPORT_SOURCE_LABELS[source as ImportSourceName] ?? 'Imported';
const badgeClass = 'inline-block rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200';

/** Articles list: "WordPress Import · WP #1163", plus the original title when it has since been changed. */
export function ImportSourceBadge({ record, currentTitle }: { record?: ImportRecord | null; currentTitle: string }) {
  if (!record) return null;
  const retitled = !!record.sourceTitle && record.sourceTitle !== currentTitle;
  return (
    <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-stone-600 dark:text-stone-300" data-testid="import-badge" title={`Original title: ${record.sourceTitle || currentTitle}${record.sourceUrl ? `\nOld address: ${record.sourceUrl}` : ''}`}>
      <span className={badgeClass}>{label(record.source)}</span>
      <span className="font-mono">WP #{record.sourceId}</span>
      {retitled && <span className="min-w-0 truncate">Original title: {record.sourceTitle}</span>}
    </p>
  );
}

/** Editor: where this article came from. Shows nothing for an article written in the CMS. */
export function ImportSourceNote({ articleId }: { articleId: string | null }) {
  const { apiCall } = useApp();
  const [record, setRecord] = useState<ImportRecord | null>(null);
  useEffect(() => {
    setRecord(null);
    if (!articleId) return;
    let current = true;
    void apiCall<{ importSource: ImportRecord | null }>(`/api/articles/${encodeURIComponent(articleId)}/import-source`).then((res) => { if (current) setRecord(res.data?.importSource ?? null); });
    return () => { current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleId]);
  if (!record) return null;
  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-[11px] text-indigo-950 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-100" data-testid="import-note">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={badgeClass}>{label(record.source)}</span>
        <span>Original post ID <span className="font-mono font-semibold">{record.sourceId}</span></span>
        {record.importedAt && <span>· imported {new Date(record.importedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
      </p>
      {record.sourceTitle && <p className="mt-1">Original title: <span className="font-semibold">{record.sourceTitle}</span></p>}
      {record.sourceUrl && <p className="mt-0.5">Old address: <span className="font-mono">{record.sourceUrl}</span></p>}
      <p className="mt-1 text-indigo-900/80 dark:text-indigo-200/80">Imported content stays a draft until it has been reviewed and approved.</p>
    </div>
  );
}
