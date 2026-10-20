/**
 * SportingSpy Admin — Reader (public-user) management (PHASE U, Admin only).
 *
 * A paginated, searchable list of reader accounts backed by /api/readers,
 * deliberately separate from the staff Users desk. Admins can view a reader's
 * registration details and comment history and can suspend, ban or reactivate
 * an account (with a reason). Suspending/banning revokes sessions immediately
 * (enforced on the server). Only safe fields are ever returned — never password
 * hashes or tokens.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Button } from '../ui/Button';
import type { UserStatus } from '../../types';

type Filter = '' | 'active' | 'suspended' | 'banned' | 'unverified';

interface Reader {
  id: string; name: string; email: string; role: string; avatar: string; status: UserStatus;
  joinedAt: string; updatedAt?: string | null; emailVerifiedAt?: string | null;
  statusReason?: string | null; statusUpdatedAt?: string | null; statusUpdatedBy?: string | null;
}
interface ReaderComment { id: string; articleId: string; content: string; status: string; createdAt: string; deletedAt?: string | null; articleTitle: string | null }
interface ListPage { items: Reader[]; total: number; counts: Record<string, number>; page: number; totalPages: number }

const FILTERS: [Filter, string][] = [['', 'All'], ['active', 'Active'], ['suspended', 'Suspended'], ['banned', 'Banned'], ['unverified', 'Unverified']];
const STATUS_BADGE: Record<UserStatus, string> = {
  active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  inactive: 'bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300',
  suspended: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  banned: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300',
};

export const AdminReaders: React.FC = () => {
  const { apiCall } = useApp();
  const [filter, setFilter] = useState<Filter>('');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ reader: Reader; comments: ReaderComment[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const loadGeneration = useRef(0);

  const load = async (f = filter, p = page, q = search) => {
    const generation = ++loadGeneration.current;
    setLoading(true); setError(null);
    const params = new URLSearchParams();
    if (f && f !== 'unverified') params.set('status', f);
    if (f === 'unverified') params.set('status', 'unverified');
    if (q) params.set('q', q);
    params.set('page', String(p));
    const res = await apiCall<ListPage>(`/api/readers?${params.toString()}`);
    if (generation !== loadGeneration.current) return;
    setLoading(false);
    if (res.data) {
      if (p > res.data.totalPages && p > 1) { setPage(Math.max(1, res.data.totalPages)); return; }
      setData(res.data);
    } else setError(res.error || 'Readers could not be loaded.');
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(filter, page, search); }, [filter, page, search]);

  const openReader = async (r: Reader) => {
    if (openId === r.id) { setOpenId(null); setDetail(null); return; }
    setOpenId(r.id); setDetail(null);
    const res = await apiCall<{ reader: Reader; comments: ReaderComment[] }>(`/api/readers/${r.id}`);
    if (res.data) setDetail(res.data); else setActionError(res.error || 'Reader details could not be loaded.');
  };

  const changeStatus = async (r: Reader, status: 'active' | 'suspended' | 'banned') => {
    let reason = '';
    if (status !== 'active') {
      const entered = window.prompt(`Reason for ${status === 'banned' ? 'banning' : 'suspending'} ${r.name} (shown to admins only):`, r.statusReason || '');
      if (entered === null) return; // cancelled
      reason = entered.trim();
      if (!reason) { setActionError('A reason is required to suspend or ban.'); return; }
    } else if (!confirm(`Reactivate ${r.name}? They will be able to sign in again.`)) {
      return;
    }
    setActionError(null); setBusy(true);
    const res = await apiCall<Reader>(`/api/readers/${r.id}/status`, { method: 'POST', body: { status, ...(status === 'active' ? {} : { reason }) } });
    setBusy(false);
    if (res.data) {
      setNotice(status === 'active' ? `${r.name} reactivated.` : `${r.name} ${status}.`);
      if (openId === r.id) setDetail((d) => d ? { ...d, reader: res.data! } : d);
      await load();
    } else setActionError(res.error || 'The status could not be changed.');
  };

  // PHASE U: manual e-mail verification by an Admin (used while no e-mail
  // provider is configured, so readers cannot self-verify via a link).
  const verifyReader = async (r: Reader, verified: boolean) => {
    if (!verified && !confirm(`Mark ${r.name} as unverified? They will need to verify again before commenting.`)) return;
    setActionError(null); setBusy(true);
    const res = await apiCall<Reader>(`/api/readers/${r.id}/verify`, { method: 'POST', body: { verified } });
    setBusy(false);
    if (res.data) {
      setNotice(verified ? `${r.name} marked verified.` : `${r.name} marked unverified.`);
      if (openId === r.id) setDetail((d) => d ? { ...d, reader: res.data! } : d);
      await load();
    } else setActionError(res.error || 'Verification could not be updated.');
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-stone-200 pb-4 dark:border-stone-800">
        <h2 className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">Reader Accounts</h2>
        <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">Public reader accounts, separate from staff users. Suspend or ban an account to block sign-in and revoke its sessions at once.</p>
      </div>

      {notice && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">{notice}</p>}
      {actionError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">{actionError}</p>}

      <div className="flex flex-wrap items-center gap-2 text-xs" role="group" aria-label="Filter readers">
        {FILTERS.map(([value, label]) => (
          <button key={label} type="button" aria-pressed={filter === value} onClick={() => { setFilter(value); setPage(1); setOpenId(null); }} className={`rounded-lg px-3 py-1.5 font-medium ${filter === value ? 'bg-amber-700 text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-300'}`}>
            {label}{data && data.counts && value && value !== 'unverified' && data.counts[value] ? ` (${data.counts[value]})` : ''}
          </button>
        ))}
        <form onSubmit={(e) => { e.preventDefault(); setPage(1); setSearch(query.trim()); }} className="ml-auto flex items-center gap-1">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search email or name" maxLength={100} className="w-44 rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs dark:border-stone-700 dark:bg-stone-950" />
          <Button type="submit" size="sm" variant="outline">Search</Button>
          {search && <button type="button" onClick={() => { setQuery(''); setSearch(''); setPage(1); }} className="text-stone-500 underline">Clear</button>}
        </form>
      </div>

      {error ? (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">{error} <button type="button" onClick={() => void load()} className="ml-2 font-semibold underline">Retry</button></div>
      ) : !data ? (
        <p className="rounded-xl border border-stone-200 p-6 text-center text-sm text-stone-500 dark:border-stone-800 dark:text-stone-400">Loading readers…</p>
      ) : data.items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-300 p-8 text-center dark:border-stone-700">
          <p className="font-semibold text-stone-800 dark:text-stone-200">{filter || search ? 'No readers in this view.' : 'No reader accounts yet.'}</p>
          <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">Reader accounts appear here once public registration is enabled and used.</p>
        </div>
      ) : (
        <ul className={`divide-y divide-stone-200 rounded-xl border border-stone-200 dark:divide-stone-800 dark:border-stone-800 ${loading ? 'opacity-60' : ''}`}>
          {data.items.map((r) => {
            const open = openId === r.id;
            return (
              <li key={r.id}>
                <button type="button" aria-expanded={open} onClick={() => void openReader(r)} className="flex w-full min-w-0 flex-col gap-1 p-4 text-left hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500 sm:flex-row sm:items-center sm:gap-3 dark:hover:bg-stone-900/40">
                  <span className="flex shrink-0 items-center gap-2">
                    <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_BADGE[r.status]}`}>{r.status}</span>
                    {!r.emailVerifiedAt && <span className="rounded bg-stone-200 px-2 py-0.5 text-[10px] font-bold uppercase text-stone-600 dark:bg-stone-800 dark:text-stone-300">unverified</span>}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-stone-900 dark:text-stone-100">{r.name}</span>
                  <span className="min-w-0 truncate text-xs text-stone-500 dark:text-stone-400">{r.email} · joined {new Date(r.joinedAt).toLocaleDateString()}</span>
                </button>
                {open && (
                  <div className="space-y-3 border-t border-stone-100 bg-stone-50/60 p-4 text-sm dark:border-stone-800 dark:bg-stone-900/30">
                    {!detail || detail.reader.id !== r.id ? (
                      <p className="text-xs text-stone-500 dark:text-stone-400">Loading reader…</p>
                    ) : (
                      <>
                        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                          <dt className="font-semibold text-stone-500 dark:text-stone-400">Email</dt><dd className="break-all">{detail.reader.email}</dd>
                          <dt className="font-semibold text-stone-500 dark:text-stone-400">Verified</dt><dd>{detail.reader.emailVerifiedAt ? new Date(detail.reader.emailVerifiedAt).toLocaleString() : 'Not verified'}</dd>
                          <dt className="font-semibold text-stone-500 dark:text-stone-400">Joined</dt><dd>{new Date(detail.reader.joinedAt).toLocaleString()}</dd>
                          {detail.reader.statusReason && (<><dt className="font-semibold text-stone-500 dark:text-stone-400">Status reason</dt><dd className="break-words">{detail.reader.statusReason}</dd></>)}
                        </dl>
                        <div className="flex flex-wrap gap-2">
                          {!detail.reader.emailVerifiedAt
                            ? <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void verifyReader(detail.reader, true)}>Verify e-mail</Button>
                            : <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void verifyReader(detail.reader, false)}>Mark unverified</Button>}
                          {detail.reader.status !== 'active' && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void changeStatus(detail.reader, 'active')}>Reactivate</Button>}
                          {detail.reader.status !== 'suspended' && detail.reader.status !== 'banned' && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void changeStatus(detail.reader, 'suspended')}>Suspend</Button>}
                          {detail.reader.status !== 'banned' && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void changeStatus(detail.reader, 'banned')} className="text-rose-700 dark:text-rose-400">Ban</Button>}
                        </div>
                        <div>
                          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">Comment history ({detail.comments.length})</p>
                          {detail.comments.length === 0 ? (
                            <p className="text-xs text-stone-500 dark:text-stone-400">No comments.</p>
                          ) : (
                            <ul className="space-y-1">
                              {detail.comments.map((c) => (
                                <li key={c.id} className="rounded border border-stone-200 bg-white p-2 text-xs dark:border-stone-800 dark:bg-stone-950">
                                  <span className="mr-2 font-semibold uppercase text-stone-500 dark:text-stone-400">{c.deletedAt ? 'deleted' : c.status}</span>
                                  <span className="break-words">{c.content}</span>
                                  <span className="mt-0.5 block text-[10px] text-stone-400">{c.articleTitle || c.articleId} · {new Date(c.createdAt).toLocaleDateString()}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {data && data.totalPages > 1 && (
        <nav aria-label="Reader pages" className="flex items-center justify-between text-xs">
          <Button type="button" size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>← Newer</Button>
          <span className="text-stone-500 dark:text-stone-400">Page {data.page} of {data.totalPages}</span>
          <Button type="button" size="sm" variant="outline" disabled={page >= data.totalPages || loading} onClick={() => setPage((p) => p + 1)}>Older →</Button>
        </nav>
      )}
    </div>
  );
};
