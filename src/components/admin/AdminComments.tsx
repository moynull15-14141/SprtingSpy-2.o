/**
 * SportingSpy Admin Comment Moderation Console (PHASE U).
 *
 * A paginated, filterable moderation queue backed by /api/moderation/comments.
 * Editorial staff (Admin, Editor) approve, reject, mark as spam, soft-delete
 * and restore reader comments. Comment text is always rendered as plain text
 * (never interpreted as HTML). Every action is authorized on the server.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Button } from '../ui/Button';
import type { CommentStatus } from '../../types';

type Filter = '' | CommentStatus | 'deleted';

interface ModArticle { id: string; title: string; status: string; slug: string; sportSlug: string }
interface ModComment {
  id: string; articleId: string; userId: string; userName: string; userRole: string | null;
  content: string; createdAt: string; status: CommentStatus;
  moderatedBy?: string | null; moderatedAt?: string | null; moderationNote?: string | null; deletedAt?: string | null;
  article: ModArticle | null;
}
interface PageData { items: ModComment[]; total: number; pending: number; page: number; totalPages: number }

const FILTERS: [Filter, string][] = [['', 'All'], ['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['spam', 'Spam'], ['deleted', 'Deleted']];
const STATUS_BADGE: Record<CommentStatus, string> = {
  approved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  rejected: 'bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300',
  spam: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300',
};

export const AdminComments: React.FC = () => {
  const { apiCall } = useApp();
  const [filter, setFilter] = useState<Filter>('');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const loadGeneration = useRef(0);

  const load = async (f = filter, p = page, q = search) => {
    const generation = ++loadGeneration.current;
    setLoading(true); setError(null);
    const params = new URLSearchParams();
    if (f) params.set('status', f);
    if (q) params.set('q', q);
    params.set('page', String(p));
    const res = await apiCall<PageData>(`/api/moderation/comments?${params.toString()}`);
    if (generation !== loadGeneration.current) return;
    setLoading(false);
    if (res.data) {
      if (p > res.data.totalPages && p > 1) { setPage(Math.max(1, res.data.totalPages)); return; }
      setData(res.data);
    } else setError(res.error || 'Comments could not be loaded.');
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(filter, page, search); }, [filter, page, search]);

  const act = async (path: string, body?: unknown, successMsg = 'Comment updated.') => {
    setActionError(null); setBusy(true);
    const res = await apiCall(path, { method: body === undefined ? 'POST' : 'PATCH', body: body ?? {} });
    setBusy(false);
    if (res.data) { setNotice(successMsg); await load(); }
    else setActionError(res.error || 'The action could not be completed.');
  };
  const setStatus = (c: ModComment, status: CommentStatus) => act(`/api/moderation/comments/${c.id}`, { status }, `Comment marked ${status}.`);
  const softDelete = (c: ModComment) => { if (confirm('Soft-delete this comment? It is hidden from the public but kept for the record.')) void act(`/api/moderation/comments/${c.id}/delete`, undefined, 'Comment soft-deleted.'); };
  const restore = (c: ModComment) => act(`/api/moderation/comments/${c.id}/restore`, undefined, 'Comment restored.');

  return (
    <div className="space-y-6">
      <div className="border-b border-stone-200 pb-4 dark:border-stone-800">
        <h2 className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">
          Reader Discussion Moderation {data && data.pending > 0 && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 align-middle font-sans text-xs font-bold text-amber-800 dark:bg-amber-900/60 dark:text-amber-300">{data.pending} pending</span>}
        </h2>
        <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">Review community submissions to maintain verified, civil sports discourse. Only approved comments on published articles appear publicly.</p>
      </div>

      {notice && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">{notice}</p>}
      {actionError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">{actionError}</p>}

      <div className="flex flex-wrap items-center gap-2 text-xs" role="group" aria-label="Filter comments">
        {FILTERS.map(([value, label]) => (
          <button key={label} type="button" aria-pressed={filter === value} onClick={() => { setFilter(value); setPage(1); }} className={`rounded-lg px-3 py-1.5 font-medium ${filter === value ? 'bg-amber-700 text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-300'}`}>{label}</button>
        ))}
        <form onSubmit={(e) => { e.preventDefault(); setPage(1); setSearch(query.trim()); }} className="ml-auto flex items-center gap-1">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search text or author" maxLength={100} className="w-44 rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs dark:border-stone-700 dark:bg-stone-950" />
          <Button type="submit" size="sm" variant="outline">Search</Button>
          {search && <button type="button" onClick={() => { setQuery(''); setSearch(''); setPage(1); }} className="text-stone-500 underline">Clear</button>}
        </form>
      </div>

      {error ? (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">{error} <button type="button" onClick={() => void load()} className="ml-2 font-semibold underline">Retry</button></div>
      ) : !data ? (
        <p className="rounded-xl border border-stone-200 p-6 text-center text-sm text-stone-500 dark:border-stone-800 dark:text-stone-400">Loading comments…</p>
      ) : data.items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-300 p-8 text-center dark:border-stone-700">
          <p className="font-semibold text-stone-800 dark:text-stone-200">{filter || search ? 'No comments in this view.' : 'No comments yet.'}</p>
          <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">Reader comments appear here for moderation as soon as they are submitted.</p>
        </div>
      ) : (
        <ul className={`space-y-3 ${loading ? 'opacity-60' : ''}`}>
          {data.items.map((c) => (
            <li key={c.id} className={`rounded-xl border p-4 ${c.deletedAt ? 'border-stone-300 bg-stone-100/60 dark:border-stone-700 dark:bg-stone-900/40' : 'border-stone-200 dark:border-stone-800'}`}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-stone-900 dark:text-stone-100">{c.userName}</span>
                <span className="text-[10px] uppercase text-stone-500 dark:text-stone-400">{c.userRole || 'Reader'}</span>
                <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_BADGE[c.status]}`}>{c.status}</span>
                {c.deletedAt && <span className="rounded bg-stone-300 px-2 py-0.5 text-[10px] font-bold uppercase text-stone-700 dark:bg-stone-700 dark:text-stone-200">deleted</span>}
                <span className="ml-auto text-[11px] tabular-nums text-stone-500 dark:text-stone-400">{new Date(c.createdAt).toLocaleString()}</span>
              </div>
              <p className="whitespace-pre-wrap break-words text-sm text-stone-700 dark:text-stone-300">{c.content}</p>
              <p className="mt-2 text-[11px] text-stone-500 dark:text-stone-400">
                On: {c.article ? <span className="font-medium">{c.article.title}</span> : <span className="italic">article unavailable ({c.articleId})</span>}
                {c.article && c.article.status !== 'published' && <span className="ml-1 text-amber-700 dark:text-amber-400">(article not published)</span>}
                {c.moderationNote && <span className="ml-2 italic">Note: {c.moderationNote}</span>}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {c.deletedAt ? (
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void restore(c)}>Restore</Button>
                ) : (
                  <>
                    {c.status !== 'approved' && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void setStatus(c, 'approved')}>Approve</Button>}
                    {c.status !== 'rejected' && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void setStatus(c, 'rejected')}>Reject</Button>}
                    {c.status !== 'spam' && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void setStatus(c, 'spam')}>Spam</Button>}
                    <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void softDelete(c)} className="text-rose-700 dark:text-rose-400">Delete</Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {data && data.totalPages > 1 && (
        <nav aria-label="Comment pages" className="flex items-center justify-between text-xs">
          <Button type="button" size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>← Newer</Button>
          <span className="text-stone-500 dark:text-stone-400">Page {data.page} of {data.totalPages}</span>
          <Button type="button" size="sm" variant="outline" disabled={page >= data.totalPages || loading} onClick={() => setPage((p) => p + 1)}>Older →</Button>
        </nav>
      )}
    </div>
  );
};
