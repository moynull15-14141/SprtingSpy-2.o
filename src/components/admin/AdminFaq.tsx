/**
 * FAQ desk (PHASE H). Admin and Editor create, edit, order, publish,
 * unpublish and archive questions; only Admins can delete permanently.
 * Only published entries appear on the public /faq/ page.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Button } from '../ui/Button';
import { FAQ_STATUSES, type FaqEntry, type FaqStatus } from '../../lib/faq';

const STATUS_BADGE: Record<FaqStatus, string> = {
  published: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  draft: 'bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300',
  archived: 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300',
};
const field = 'w-full rounded-lg border border-stone-300 bg-white p-2 text-sm dark:border-stone-700 dark:bg-stone-950';
type Draft = { id: string | null; question: string; answer: string; status: FaqStatus; displayOrder: number };
const EMPTY: Draft = { id: null, question: '', answer: '', status: 'draft', displayOrder: 0 };

export const AdminFaq: React.FC = () => {
  const { apiCall, currentUser } = useApp();
  const [items, setItems] = useState<FaqEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<FaqStatus | ''>('');
  const isAdmin = currentUser.role === 'Admin';

  const load = async () => {
    setLoadError(null);
    const res = await apiCall<FaqEntry[]>('/api/faq');
    if (res.data) setItems(res.data);
    else setLoadError(res.error || 'The FAQ could not be loaded.');
  };
  // apiCall is not memoised by the site context, so load once on mount (and after each change).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, []);

  const say = (message: string) => { setNotice(message); setTimeout(() => setNotice(null), 5000); };
  const visible = useMemo(() => (items ?? []).filter((f) => !filter || f.status === filter), [items, filter]);
  const counts = useMemo(() => Object.fromEntries(FAQ_STATUSES.map((s) => [s, (items ?? []).filter((f) => f.status === s).length])) as Record<FaqStatus, number>, [items]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft || busy) return;
    setFormError(null);
    if (draft.question.trim().length < 5) { setFormError('Write a question of at least 5 characters.'); return; }
    if (draft.answer.trim().length < 2) { setFormError('Write an answer.'); return; }
    setBusy(true);
    if (!Number.isInteger(draft.displayOrder) || draft.displayOrder < 0 || draft.displayOrder > 10000) { setFormError('Display order must be a whole number from 0 to 10000.'); setBusy(false); return; }
    const body = { question: draft.question, answer: draft.answer, status: draft.status, displayOrder: draft.displayOrder };
    const res = draft.id ? await apiCall<FaqEntry>(`/api/faq/${draft.id}`, { method: 'PUT', body }) : await apiCall<FaqEntry>('/api/faq', { method: 'POST', body });
    setBusy(false);
    if (!res.data) { setFormError(res.error || 'The entry was not saved.'); return; }
    say(`${draft.id ? 'Saved' : 'Created'} “${res.data.question}” (${res.data.status}).`);
    setDraft(null);
    await load();
  };

  const update = async (entry: FaqEntry, body: Partial<Pick<FaqEntry, 'status' | 'displayOrder'>>, message: string) => {
    setActionError(null);
    setBusy(true);
    const res = await apiCall<FaqEntry>(`/api/faq/${entry.id}`, { method: 'PUT', body });
    setBusy(false);
    if (res.data) { say(message); await load(); }
    else setActionError(res.error || 'The question could not be updated.');
  };

  /** Swaps display order with the neighbour in the full (unfiltered) order. */
  const move = async (entry: FaqEntry, direction: -1 | 1) => {
    if (!items) return;
    const index = items.findIndex((f) => f.id === entry.id);
    const other = items[index + direction];
    if (!other) return;
    setBusy(true);
    setActionError(null);
    const ordered = [...items];
    [ordered[index], ordered[index + direction]] = [other, entry];
    const result = await apiCall('/api/faq/reorder', { method: 'POST', body: { ids: ordered.map((f) => f.id) } });
    setBusy(false);
    if (result.data) say('Order updated.');
    else setActionError(result.error || 'The question order could not be updated.');
    await load();
  };

  const remove = async (entry: FaqEntry) => {
    if (!confirm(`Permanently delete “${entry.question}”? This cannot be undone. Archive it instead to keep a copy.`)) return;
    setBusy(true);
    setActionError(null);
    const res = await apiCall(`/api/faq/${entry.id}`, { method: 'DELETE' });
    setBusy(false);
    if (res.data) { say('Entry deleted.'); await load(); }
    else setActionError(res.error || 'The question could not be deleted.');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border-b border-stone-200 pb-4 sm:flex-row sm:items-center sm:justify-between dark:border-stone-800">
        <div>
          <h2 className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">Frequently Asked Questions</h2>
          <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">Published questions appear on the public <a href="/faq/" target="_blank" rel="noopener noreferrer" className="font-semibold underline">/faq/</a> page in this order. Answers are plain text; leave a blank line between paragraphs.</p>
        </div>
        {!draft && <Button size="sm" disabled={busy || items === null || !!loadError} onClick={() => { setFormError(null); setDraft({ ...EMPTY, displayOrder: Math.min(10000, Math.max(-1, ...(items ?? []).map((f) => f.displayOrder)) + 1) }); }}>+ New question</Button>}
      </div>

      {notice && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">{notice}</div>}
      {actionError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">{actionError}</p>}

      {draft && (
        <form onSubmit={save} className="space-y-4 rounded-xl border border-stone-200 bg-stone-50 p-5 dark:border-stone-800 dark:bg-stone-900/60" aria-labelledby="faq-form-heading">
          <h3 id="faq-form-heading" className="font-serif text-base font-bold text-stone-900 dark:text-stone-100">{draft.id ? 'Edit question' : 'New question'}</h3>
          {formError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">{formError}</p>}
          <div>
            <div className="mb-1 flex justify-between gap-2"><label htmlFor="faq-question" className="text-xs font-semibold text-stone-700 dark:text-stone-300">Question *</label><span className="text-[11px] tabular-nums text-stone-500 dark:text-stone-400">{draft.question.length} / 300</span></div>
            <input id="faq-question" type="text" required minLength={5} maxLength={300} value={draft.question} onChange={(e) => setDraft({ ...draft, question: e.target.value })} className={field} placeholder="e.g. Where can I watch the French Open?" />
          </div>
          <div>
            <div className="mb-1 flex justify-between gap-2"><label htmlFor="faq-answer" className="text-xs font-semibold text-stone-700 dark:text-stone-300">Answer *</label><span className="text-[11px] tabular-nums text-stone-500 dark:text-stone-400">{draft.answer.length} / 5000</span></div>
            <textarea id="faq-answer" required rows={6} maxLength={5000} value={draft.answer} onChange={(e) => setDraft({ ...draft, answer: e.target.value })} className={field} placeholder="Plain text. Separate paragraphs with a blank line." />
          </div>
          <div className="max-w-xs">
            <label htmlFor="faq-order" className="mb-1 block text-xs font-semibold text-stone-700 dark:text-stone-300">Display order</label>
            <input id="faq-order" type="number" required min={0} max={10000} step={1} value={draft.displayOrder} onChange={(e) => setDraft({ ...draft, displayOrder: Number(e.target.value) })} className={field} />
            <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">Lower numbers appear first. Use the arrows to move questions by position.</p>
          </div>
          <div className="max-w-xs">
            <label htmlFor="faq-status" className="mb-1 block text-xs font-semibold text-stone-700 dark:text-stone-300">Status</label>
            <select id="faq-status" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as FaqStatus })} className={field}>
              <option value="draft">Draft (not public)</option>
              <option value="published">Published (visible on /faq/)</option>
              <option value="archived">Archived (not public)</option>
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { setDraft(null); setFormError(null); }}>Cancel</Button>
            <Button type="submit" size="sm" isLoading={busy}>{draft.id ? 'Save changes' : 'Create question'}</Button>
          </div>
        </form>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs" role="group" aria-label="Filter by status">
        {([['', 'All', items?.length ?? 0], ...FAQ_STATUSES.map((s) => [s, s[0].toUpperCase() + s.slice(1), counts[s] ?? 0])] as [FaqStatus | '', string, number][]).map(([value, label, count]) => (
          <button key={label} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} className={`rounded-lg px-3 py-1.5 font-medium ${filter === value ? 'bg-amber-700 text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-300'}`}>{label} ({count})</button>
        ))}
      </div>

      {loadError ? (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          {loadError} <button type="button" onClick={() => void load()} className="ml-2 font-semibold underline">Retry</button>
        </div>
      ) : items === null ? (
        <p className="rounded-xl border border-stone-200 p-6 text-center text-sm text-stone-500 dark:border-stone-800 dark:text-stone-400" aria-live="polite">Loading questions…</p>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-300 p-8 text-center dark:border-stone-700">
          <p className="font-semibold text-stone-800 dark:text-stone-200">{items.length ? 'No questions with this status.' : 'No questions yet.'}</p>
          {!items.length && <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">Create the first question; it stays private until you publish it.</p>}
        </div>
      ) : (
        <ol className="space-y-2" aria-label="FAQ entries in display order">
          {visible.map((f) => {
            const index = items.findIndex((x) => x.id === f.id);
            return (
              <li key={f.id} className="flex flex-col gap-3 rounded-xl border border-stone-200 p-4 dark:border-stone-800 md:flex-row md:items-start">
                <div className="flex shrink-0 gap-1 md:flex-col">
                  <button type="button" aria-label={`Move “${f.question}” up`} disabled={busy || index === 0} onClick={() => void move(f, -1)} className="inline-flex h-8 w-8 items-center justify-center rounded border border-stone-300 disabled:opacity-40 dark:border-stone-700"><ArrowUp size={14} aria-hidden="true" /></button>
                  <button type="button" aria-label={`Move “${f.question}” down`} disabled={busy || index === items.length - 1} onClick={() => void move(f, 1)} className="inline-flex h-8 w-8 items-center justify-center rounded border border-stone-300 disabled:opacity-40 dark:border-stone-700"><ArrowDown size={14} aria-hidden="true" /></button>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_BADGE[f.status]}`}>{f.status}</span>
                    <span className="text-[11px] tabular-nums text-stone-500 dark:text-stone-400">#{index + 1} · updated {new Date(f.updatedAt).toLocaleDateString()} by {f.updatedBy}</span>
                  </div>
                  <p className="mt-1 break-words font-semibold text-stone-900 dark:text-stone-100">{f.question}</p>
                  <p className="mt-1 line-clamp-2 whitespace-pre-line break-words text-xs text-stone-600 dark:text-stone-400">{f.answer}</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2 text-xs md:justify-end">
                  <button type="button" disabled={busy} onClick={() => { setFormError(null); setDraft({ id: f.id, question: f.question, answer: f.answer, status: f.status, displayOrder: f.displayOrder }); }} className="font-semibold text-amber-700 hover:underline dark:text-amber-400">Edit</button>
                  {f.status === 'published'
                    ? <button type="button" disabled={busy} onClick={() => void update(f, { status: 'draft' }, 'Unpublished; the question is no longer public.')} className="font-semibold text-stone-700 hover:underline dark:text-stone-300">Unpublish</button>
                    : <button type="button" disabled={busy} onClick={() => void update(f, { status: 'published' }, 'Published on /faq/.')} className="font-semibold text-emerald-700 hover:underline dark:text-emerald-400">Publish</button>}
                  {f.status !== 'archived' && <button type="button" disabled={busy} onClick={() => void update(f, { status: 'archived' }, 'Archived; the question is no longer public.')} className="font-semibold text-purple-700 hover:underline dark:text-purple-300">Archive</button>}
                  {isAdmin && <button type="button" disabled={busy} onClick={() => void remove(f)} className="text-rose-600 hover:underline dark:text-rose-400">Delete</button>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
};
