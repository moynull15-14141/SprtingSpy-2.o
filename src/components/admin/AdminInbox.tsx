/**
 * Contact inbox (PHASE H). Messages sent through the public contact form.
 * Admin and Editor read and triage them; only Admins delete. Message text is
 * shown as plain text (never interpreted as HTML). No e-mail is sent by the
 * site — replies use the staff member's own mail client.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Button } from '../ui/Button';
import type { ContactMessage, ContactStatus } from '../../lib/contact';

type Filter = '' | 'unread' | ContactStatus;
interface Page { items: ContactMessage[]; total: number; unread: number; page: number; totalPages: number }
const FILTERS: [Filter, string][] = [['', 'All'], ['unread', 'Unread'], ['open', 'Open'], ['resolved', 'Resolved'], ['spam', 'Spam']];
const STATUS_BADGE: Record<ContactStatus, string> = {
  open: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  resolved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  spam: 'bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300',
};

export const AdminInbox: React.FC = () => {
  const { apiCall, currentUser } = useApp();
  const [filter, setFilter] = useState<Filter>('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const loadGeneration = useRef(0);

  const load = async (f = filter, p = page) => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    setError(null);
    const query = f === 'unread' ? '?unread=1' : f ? `?status=${f}` : '?';
    const res = await apiCall<Page>(`/api/contact-messages${query}&page=${p}`);
    if (generation !== loadGeneration.current) return;
    setLoading(false);
    if (res.data) {
      if (p > res.data.totalPages && p > 1) { setPage(Math.max(1, res.data.totalPages)); return; }
      setData(res.data);
    }
    else setError(res.error || 'Messages could not be loaded.');
  };
  // apiCall is not memoised by the site context; reload only when the view changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(filter, page); }, [filter, page]);

  const patch = async (m: ContactMessage, body: { status?: ContactStatus; read?: boolean }) => {
    setActionError(null);
    setBusy(true);
    const res = await apiCall<ContactMessage>(`/api/contact-messages/${m.id}`, { method: 'PUT', body });
    setBusy(false);
    if (res.data) {
      setNotice(body.status ? `Message marked ${body.status}.` : body.read ? 'Message marked read.' : 'Message marked unread.');
      await load();
    } else setActionError(res.error || 'The message could not be updated.');
  };

  const toggleOpen = async (m: ContactMessage) => {
    const next = openId === m.id ? null : m.id;
    setOpenId(next);
    if (next && !m.readAt) await patch(m, { read: true });
  };

  const remove = async (m: ContactMessage) => {
    if (!confirm(`Permanently delete the message from ${m.name}? This cannot be undone.`)) return;
    setBusy(true);
    setActionError(null);
    const res = await apiCall(`/api/contact-messages/${m.id}`, { method: 'DELETE' });
    setBusy(false);
    if (res.data) { setOpenId(null); setNotice('Message deleted.'); await load(); }
    else setActionError(res.error || 'The message could not be deleted.');
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-stone-200 pb-4 dark:border-stone-800">
        <h2 className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">Contact Inbox {data && data.unread > 0 && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 align-middle font-sans text-xs font-bold text-amber-800 dark:bg-amber-900/60 dark:text-amber-300">{data.unread} unread</span>}</h2>
        <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">Messages from the public contact form. The site stores them here only — it does not send e-mail. Reply from your own mail client.</p>
      </div>

      {notice && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">{notice}</p>}
      {actionError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">{actionError}</p>}

      <div className="flex flex-wrap items-center gap-2 text-xs" role="group" aria-label="Filter messages">
        {FILTERS.map(([value, label]) => (
          <button key={label} type="button" aria-pressed={filter === value} onClick={() => { setFilter(value); setPage(1); setOpenId(null); }} className={`rounded-lg px-3 py-1.5 font-medium ${filter === value ? 'bg-amber-700 text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-300'}`}>{label}</button>
        ))}
        <span className="ml-auto text-stone-500 dark:text-stone-400" aria-live="polite">{loading ? 'Loading…' : data ? `${data.total} message${data.total === 1 ? '' : 's'}` : ''}</span>
      </div>

      {error ? (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          {error} <button type="button" onClick={() => void load()} className="ml-2 font-semibold underline">Retry</button>
        </div>
      ) : !data ? (
        <p className="rounded-xl border border-stone-200 p-6 text-center text-sm text-stone-500 dark:border-stone-800 dark:text-stone-400">Loading messages…</p>
      ) : data.items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-300 p-8 text-center dark:border-stone-700">
          <p className="font-semibold text-stone-800 dark:text-stone-200">{filter ? 'No messages in this view.' : 'No messages yet.'}</p>
          <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">New contact-form messages appear here as soon as they are sent.</p>
        </div>
      ) : (
        <ul className={`divide-y divide-stone-200 rounded-xl border border-stone-200 dark:divide-stone-800 dark:border-stone-800 ${loading ? 'opacity-60' : ''}`}>
          {data.items.map((m) => {
            const open = openId === m.id;
            return (
              <li key={m.id}>
                <button type="button" disabled={busy || loading} aria-expanded={open} aria-controls={`msg-${m.id}`} onClick={() => void toggleOpen(m)} className="flex w-full min-w-0 flex-col gap-1 p-4 text-left hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500 sm:flex-row sm:items-center sm:gap-3 dark:hover:bg-stone-900/40">
                  <span className="flex shrink-0 items-center gap-2">
                    {!m.readAt && <span className="h-2 w-2 rounded-full bg-amber-600" aria-label="Unread" role="img" />}
                    <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_BADGE[m.status]}`}>{m.status}</span>
                  </span>
                  <span className={`min-w-0 flex-1 truncate text-sm ${m.readAt ? 'text-stone-700 dark:text-stone-300' : 'font-bold text-stone-900 dark:text-stone-100'}`}>{m.subject}</span>
                  <span className="min-w-0 truncate text-xs text-stone-500 dark:text-stone-400">{m.name} · {new Date(m.createdAt).toLocaleString()}</span>
                </button>
                  <div id={`msg-${m.id}`} hidden={!open} className="space-y-3 border-t border-stone-100 bg-stone-50/60 p-4 text-sm dark:border-stone-800 dark:bg-stone-900/30">
                    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                      <dt className="font-semibold text-stone-500 dark:text-stone-400">From</dt><dd className="break-words">{m.name}</dd>
                      <dt className="font-semibold text-stone-500 dark:text-stone-400">Email</dt><dd className="break-all">{m.email}</dd>
                      <dt className="font-semibold text-stone-500 dark:text-stone-400">Received</dt><dd>{new Date(m.createdAt).toLocaleString()}</dd>
                    </dl>
                    <p className="whitespace-pre-wrap break-words rounded-lg border border-stone-200 bg-white p-3 text-stone-800 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-200">{m.message}</p>
                    <div className="flex flex-wrap gap-2">
                      <a href={`mailto:${encodeURIComponent(m.email).replace(/%40/g, '@')}?subject=${encodeURIComponent(`Re: ${m.subject}`)}`} className="inline-flex items-center rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800">Reply by e-mail</a>
                      {m.status !== 'resolved' && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void patch(m, { status: 'resolved' })}>Mark resolved</Button>}
                      {m.status !== 'open' && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void patch(m, { status: 'open' })}>Reopen</Button>}
                      {m.status !== 'spam' && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void patch(m, { status: 'spam' })}>Mark as spam</Button>}
                      <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void patch(m, { read: false })}>Mark unread</Button>
                      {currentUser.role === 'Admin' && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void remove(m)} className="text-rose-700 dark:text-rose-400">Delete</Button>}
                    </div>
                  </div>
              </li>
            );
          })}
        </ul>
      )}

      {data && data.totalPages > 1 && (
        <nav aria-label="Message pages" className="flex items-center justify-between text-xs">
          <Button type="button" size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>← Newer</Button>
          <span className="text-stone-500 dark:text-stone-400">Page {data.page} of {data.totalPages}</span>
          <Button type="button" size="sm" variant="outline" disabled={page >= data.totalPages || loading} onClick={() => setPage((p) => p + 1)}>Older →</Button>
        </nav>
      )}
    </div>
  );
};
