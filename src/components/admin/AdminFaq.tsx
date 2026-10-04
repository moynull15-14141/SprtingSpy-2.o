/**
 * FAQ & Reader Questions desk (PHASE H; E5; PHASE R v2.2).
 *
 * Editors choose a CONTEXT — an Article, an Event Edition, an Event or a
 * Sport-level guide (or the optional site-wide /faq/ page) — and add, edit,
 * delete, reorder and publish that page's questions. Only published entries
 * are public, and publishing is always an explicit editor action.
 *
 * Quality diagnostics (duplicates, repetitive or outdated questions,
 * contradictions, irrelevant or unsupported answers, missing useful
 * questions) and suggestions (from stored facts; optionally AI) help the
 * editor. Accepting a suggestion creates a DRAFT — nothing is published
 * automatically, and suggestions never invent facts.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Button } from '../ui/Button';
import { FAQ_STATUSES, faqContextOf, type FaqEntry, type FaqStatus } from '../../lib/faq';

const STATUS_BADGE: Record<FaqStatus, string> = {
  published: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  draft: 'bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300',
  archived: 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300',
};
const SOURCE_LABEL: Record<string, string> = { editor: 'Editor', 'ai-suggestion': 'AI suggestion', 'data-suggestion': 'From stored facts' };
const field = 'w-full rounded-lg border border-stone-300 bg-white p-2 text-sm dark:border-stone-700 dark:bg-stone-950';
type Draft = { id: string | null; question: string; answer: string; status: FaqStatus; context: string; source?: string };
interface Issue { kind: string; severity: 'warning' | 'info'; entryId: string | null; message: string }
interface Diagnostics { context: { kind: string; id: string | null; label: string }; schema: { enabled: boolean; ok: boolean; reasons: string[] }; issues: Issue[] }
interface Suggestion { question: string; answer: string; source: 'data-suggestion' | 'ai-suggestion'; basis: string }

const contextKeyOf = (f: FaqEntry) => { const c = faqContextOf(f); return c.kind === 'site' ? 'site' : `${c.kind}:${c.id}`; };
const contextBody = (key: string) => {
  const [kind, id] = key === 'site' ? ['site', null] : [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
  return { articleId: kind === 'article' ? id : null, editionId: kind === 'edition' ? id : null, eventId: kind === 'event' ? id : null, sportId: kind === 'sport' ? id : null };
};

export const AdminFaq: React.FC = () => {
  const { apiCall, events, sports, editions, articles } = useApp();
  // The chosen page is remembered for this browser session (a convenience only).
  const [context, setContextState] = useState<string>(() => { try { return sessionStorage.getItem('cms-faq-context') || ''; } catch { return ''; } });
  const setContext = (key: string) => { setContextState(key); try { sessionStorage.setItem('cms-faq-context', key); } catch { /* ignore */ } };
  const [articleFilter, setArticleFilter] = useState('');
  const [items, setItems] = useState<FaqEntry[] | null>(null);
  const [allCounts, setAllCounts] = useState<Record<string, number>>({});
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<FaqStatus | ''>('');

  const sportName = useMemo(() => new Map(sports.map((s) => [s.slug, s.name])), [sports]);
  const contextOptions = useMemo(() => {
    const opts: { key: string; label: string; group: string }[] = [];
    for (const s of [...sports].sort((a, b) => a.name.localeCompare(b.name))) opts.push({ key: `sport:${s.id}`, label: `${s.name} (sport guide)`, group: 'Sports' });
    for (const e of [...events].sort((a, b) => a.name.localeCompare(b.name))) opts.push({ key: `event:${e.id}`, label: `${sportName.get(e.sportSlug) || e.sportSlug} · ${e.name}`, group: 'Events' });
    for (const ed of [...editions].sort((a, b) => a.title.localeCompare(b.title))) opts.push({ key: `edition:${ed.id}`, label: `${sportName.get(ed.sportSlug) || ed.sportSlug} · ${ed.title}`, group: 'Event editions' });
    const q = articleFilter.trim().toLowerCase();
    for (const a of articles.filter((x) => !q || x.title.toLowerCase().includes(q)).slice(0, 200)) opts.push({ key: `article:${a.id}`, label: `${a.title} (${a.articleType}, ${a.status})`, group: 'Articles' });
    return opts;
  }, [sports, events, editions, articles, articleFilter, sportName]);
  const labelFor = (key: string) => (key === 'site' ? 'Site-wide /faq/ page' : contextOptions.find((o) => o.key === key)?.label ?? (diagnostics?.context.label || key));

  const say = (message: string) => { setNotice(message); setTimeout(() => setNotice(null), 6000); };

  const loadCounts = async () => {
    const res = await apiCall<FaqEntry[]>('/api/faq');
    if (!res.data) { setLoadError(res.error || 'The FAQ could not be loaded.'); return; }
    {
      const counts: Record<string, number> = {};
      for (const f of res.data) counts[contextKeyOf(f)] = (counts[contextKeyOf(f)] || 0) + 1;
      setAllCounts(counts);
    }
  };

  const load = async (key = context) => {
    if (!key) return;
    setLoadError(null);
    const [list, diag] = await Promise.all([
      apiCall<FaqEntry[]>(`/api/faq?context=${encodeURIComponent(key)}`),
      apiCall<Diagnostics>(`/api/faq/diagnostics?context=${encodeURIComponent(key)}`),
    ]);
    if (list.data) setItems(list.data); else setLoadError(list.error || 'The FAQ could not be loaded.');
    if (diag.data) setDiagnostics(diag.data);
    if (list.data) void loadCounts();
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void loadCounts(); }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setItems(null); setDiagnostics(null); setSuggestions(null); setAiNote(null); setDraft(null); if (context) void load(context); }, [context]);

  const visible = useMemo(() => (items ?? []).filter((f) => !filter || f.status === filter), [items, filter]);
  const counts = useMemo(() => Object.fromEntries(FAQ_STATUSES.map((s) => [s, (items ?? []).filter((f) => f.status === s).length])) as Record<FaqStatus, number>, [items]);
  const issuesFor = (id: string) => (diagnostics?.issues ?? []).filter((i) => i.entryId === id);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft || busy) return;
    setFormError(null);
    if (draft.question.trim().length < 5) { setFormError('Write a question of at least 5 characters.'); return; }
    if (draft.answer.trim().length < 2) { setFormError('Write an answer.'); return; }
    setBusy(true);
    const body: Record<string, unknown> = { question: draft.question, answer: draft.answer, status: draft.status, ...contextBody(draft.context) };
    if (!draft.id && draft.source && draft.source !== 'editor') body.source = draft.source;
    const res = draft.id ? await apiCall<FaqEntry>(`/api/faq/${draft.id}`, { method: 'PUT', body }) : await apiCall<FaqEntry>('/api/faq', { method: 'POST', body });
    setBusy(false);
    if (!res.data) { setFormError(res.error || 'The entry was not saved.'); return; }
    say(`${draft.id ? 'Saved' : 'Created'} “${res.data.question}” (${res.data.status}).${res.data.source !== 'editor' && res.data.status === 'draft' ? ' Suggestions are saved as drafts: review the facts, then publish.' : ''}`);
    if (draft.context !== context) setContext(draft.context);
    setDraft(null);
    setSuggestions((list) => list?.filter((s) => s.question !== draft.question) ?? null);
    await load(draft.context);
  };

  const update = async (entry: FaqEntry, body: Partial<Pick<FaqEntry, 'status'>>, message: string) => {
    setActionError(null);
    setBusy(true);
    const res = await apiCall<FaqEntry>(`/api/faq/${entry.id}`, { method: 'PUT', body });
    setBusy(false);
    if (res.data) { say(message); await load(); } else setActionError(res.error || 'The question could not be updated.');
  };

  /** Swaps the entry with its neighbour within this context. */
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
    if (result.data) say('Order updated.'); else setActionError(result.error || 'The question order could not be updated.');
    await load();
  };

  const remove = async (entry: FaqEntry) => {
    if (!confirm(`Permanently delete “${entry.question}”? This cannot be undone. Archive it instead to keep a copy.`)) return;
    setBusy(true);
    setActionError(null);
    const res = await apiCall(`/api/faq/${entry.id}`, { method: 'DELETE' });
    setBusy(false);
    if (res.data) { say('Entry deleted.'); await load(); } else setActionError(res.error || 'The question could not be deleted.');
  };

  const suggest = async (ai: boolean) => {
    setBusy(true);
    setAiNote(null);
    const res = await apiCall<{ suggestions: Suggestion[]; ai: { requested: boolean; ok?: boolean; error?: string } }>('/api/faq/suggestions', { method: 'POST', body: { context, ai } });
    setBusy(false);
    if (res.data) {
      setSuggestions(res.data.suggestions);
      if (res.data.ai.requested && !res.data.ai.ok) setAiNote(res.data.ai.error || 'AI suggestions are not available.');
    } else setActionError(res.error || 'Suggestions could not be loaded.');
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-stone-200 pb-4 dark:border-stone-800">
        <h2 className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">FAQ &amp; Reader Questions</h2>
        <p className="mt-1 max-w-3xl text-xs text-stone-500 dark:text-stone-400">
          Questions belong to one page: an article, an event edition, an event or a sport guide. Only <strong>published</strong> questions appear on that page, in the order shown here.
          Suggestions are saved as drafts and must be checked and published by an editor. Answers are plain text; leave a blank line between paragraphs.
        </p>
      </div>

      <div className="grid gap-3 rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-[#121417] lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">Page (context)
          <select value={context} onChange={(e) => setContext(e.target.value)} className={`${field} mt-1`} data-testid="faq-context">
            <option value="">Choose a page…</option>
            {['Sports', 'Events', 'Event editions', 'Articles'].map((group) => (
              <optgroup key={group} label={group}>
                {contextOptions.filter((o) => o.group === group).map((o) => <option key={o.key} value={o.key}>{o.label}{allCounts[o.key] ? ` — ${allCounts[o.key]} question(s)` : ''}</option>)}
              </optgroup>
            ))}
            <optgroup label="Site-wide (optional /faq/ page, off at launch)"><option value="site">Site-wide /faq/ page{allCounts.site ? ` — ${allCounts.site} question(s)` : ''}</option></optgroup>
          </select>
        </label>
        <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">Find an article
          <input value={articleFilter} onChange={(e) => setArticleFilter(e.target.value)} placeholder="Filter articles by title" className={`${field} mt-1`} />
        </label>
      </div>

      {notice && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">{notice}</div>}
      {actionError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">{actionError}</p>}

      {!context && loadError && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          {loadError} <button type="button" onClick={() => { setLoadError(null); void loadCounts(); }} className="ml-2 font-semibold underline">Retry</button>
        </div>
      )}
      {!context ? (
        <p className="rounded-xl border border-dashed border-stone-300 p-8 text-center text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">Choose the page whose questions you want to manage.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-serif text-lg font-bold text-stone-900 dark:text-stone-100">{labelFor(context)}</h3>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void suggest(false)}>Suggest from stored facts</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void suggest(true)}>Suggest with AI</Button>
              {!draft && <Button size="sm" disabled={busy || items === null} onClick={() => { setFormError(null); setDraft({ id: null, question: '', answer: '', status: 'draft', context }); }}>+ New question</Button>}
            </div>
          </div>

          {diagnostics && (
            <section aria-labelledby="faq-quality-heading" className="rounded-xl border border-stone-200 p-4 text-xs dark:border-stone-800">
              <h4 id="faq-quality-heading" className="font-bold uppercase tracking-wider text-stone-700 dark:text-stone-200">Quality checks</h4>
              <p className="mt-1 text-stone-600 dark:text-stone-400">
                FAQPage structured data: {diagnostics.schema.enabled ? (diagnostics.schema.ok ? <strong className="text-emerald-700 dark:text-emerald-400">on{diagnostics.schema.reasons.length ? ` — some questions are left out: ${diagnostics.schema.reasons.join(' ')}` : ' — every published question validates'}</strong> : <strong className="text-amber-700 dark:text-amber-400">on, but not output: {diagnostics.schema.reasons.filter((r) => !r.includes('turned off')).join(' ')}</strong>) : <strong>off</strong>}
                {context !== 'site' && ' (switch it in the page’s own settings).'}
              </p>
              {diagnostics.issues.length === 0 ? <p className="mt-2 text-emerald-700 dark:text-emerald-400">No problems found.</p> : (
                <ul className="mt-2 space-y-1">
                  {diagnostics.issues.map((i, n) => <li key={n} className={i.severity === 'warning' ? 'text-amber-800 dark:text-amber-300' : 'text-stone-600 dark:text-stone-400'}><span className="font-semibold uppercase">{i.kind}</span> — {i.message}</li>)}
                </ul>
              )}
            </section>
          )}

          {suggestions && (
            <section aria-labelledby="faq-suggestions-heading" className="rounded-xl border border-sky-200 bg-sky-50/50 p-4 text-xs dark:border-sky-900 dark:bg-sky-950/20">
              <h4 id="faq-suggestions-heading" className="font-bold uppercase tracking-wider text-sky-900 dark:text-sky-200">Suggestions (not saved)</h4>
              {aiNote && <p className="mt-1 text-amber-800 dark:text-amber-300">{aiNote}</p>}
              {suggestions.length === 0 ? <p className="mt-2">No new suggestions: the stored facts are already covered.</p> : (
                <ul className="mt-2 space-y-3">
                  {suggestions.map((sug) => (
                    <li key={sug.question} className="rounded-lg border border-sky-200 bg-white p-3 dark:border-sky-900 dark:bg-stone-950">
                      <p className="font-semibold">{sug.question}</p>
                      <p className="mt-1 whitespace-pre-line text-stone-600 dark:text-stone-400">{sug.answer || <em>No answer drafted — research needed.</em>}</p>
                      <p className="mt-1 text-[11px] text-stone-500">{SOURCE_LABEL[sug.source]} · basis: {sug.basis}</p>
                      <Button size="sm" variant="outline" className="mt-2" onClick={() => { setFormError(null); setDraft({ id: null, question: sug.question, answer: sug.answer, status: 'draft', context, source: sug.source }); }}>Review &amp; add as draft</Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {draft && (
            <form onSubmit={save} className="space-y-4 rounded-xl border border-stone-200 bg-stone-50 p-5 dark:border-stone-800 dark:bg-stone-900/60" aria-labelledby="faq-form-heading">
              <h4 id="faq-form-heading" className="font-serif text-base font-bold text-stone-900 dark:text-stone-100">{draft.id ? 'Edit question' : draft.source && draft.source !== 'editor' ? 'Review suggestion' : 'New question'}</h4>
              {draft.source && draft.source !== 'editor' && <p className="text-xs text-amber-800 dark:text-amber-300">Check every fact against the official source before publishing. This entry is saved as a draft.</p>}
              {formError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">{formError}</p>}
              <div>
                <div className="mb-1 flex justify-between gap-2"><label htmlFor="faq-question" className="text-xs font-semibold text-stone-700 dark:text-stone-300">Question *</label><span className="text-[11px] tabular-nums text-stone-500 dark:text-stone-400">{draft.question.length} / 300</span></div>
                <input id="faq-question" type="text" required minLength={5} maxLength={300} value={draft.question} onChange={(e) => setDraft({ ...draft, question: e.target.value })} className={field} placeholder="e.g. Where can I watch the French Open?" />
              </div>
              <div>
                <div className="mb-1 flex justify-between gap-2"><label htmlFor="faq-answer" className="text-xs font-semibold text-stone-700 dark:text-stone-300">Answer *</label><span className="text-[11px] tabular-nums text-stone-500 dark:text-stone-400">{draft.answer.length} / 5000</span></div>
                <textarea id="faq-answer" required rows={6} maxLength={5000} value={draft.answer} onChange={(e) => setDraft({ ...draft, answer: e.target.value })} className={field} placeholder="Plain text. Separate paragraphs with a blank line." />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">Page
                  <select value={draft.context} onChange={(e) => setDraft({ ...draft, context: e.target.value })} className={`${field} mt-1`}>
                    <option value={context}>{labelFor(context)}</option>
                    {contextOptions.filter((o) => o.key !== context).map((o) => <option key={o.key} value={o.key}>{o.group}: {o.label}</option>)}
                    {context !== 'site' && <option value="site">Site-wide /faq/ page</option>}
                  </select>
                </label>
                <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">Status
                  <select id="faq-status" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as FaqStatus })} className={`${field} mt-1`} disabled={!draft.id && !!draft.source && draft.source !== 'editor'}>
                    <option value="draft">Draft (not public)</option>
                    <option value="published">Published (visible on the page)</option>
                    <option value="archived">Archived (not public)</option>
                  </select>
                </label>
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
              {loadError} <button type="button" onClick={() => { setLoadError(null); void load(); }} className="ml-2 font-semibold underline">Retry</button>
            </div>
          ) : items === null ? (
            <p className="rounded-xl border border-stone-200 p-6 text-center text-sm text-stone-500 dark:border-stone-800 dark:text-stone-400" aria-live="polite">Loading questions…</p>
          ) : visible.length === 0 ? (
            <div className="rounded-xl border border-dashed border-stone-300 p-8 text-center dark:border-stone-700">
              <p className="font-semibold text-stone-800 dark:text-stone-200">{items.length ? 'No questions with this status.' : 'No questions for this page yet.'}</p>
            </div>
          ) : (
            <ol className="space-y-2" aria-label="FAQ entries in display order">
              {visible.map((f) => {
                const index = items.findIndex((x) => x.id === f.id);
                const issues = issuesFor(f.id);
                return (
                  <li key={f.id} data-faq-id={f.id} className="flex flex-col gap-3 rounded-xl border border-stone-200 p-4 dark:border-stone-800 md:flex-row md:items-start">
                    <div className="flex shrink-0 gap-1 md:flex-col">
                      <button type="button" aria-label={`Move “${f.question}” up`} disabled={busy || index === 0} onClick={() => void move(f, -1)} className="inline-flex h-8 w-8 items-center justify-center rounded border border-stone-300 disabled:opacity-40 dark:border-stone-700"><ArrowUp size={14} aria-hidden="true" /></button>
                      <button type="button" aria-label={`Move “${f.question}” down`} disabled={busy || index === items.length - 1} onClick={() => void move(f, 1)} className="inline-flex h-8 w-8 items-center justify-center rounded border border-stone-300 disabled:opacity-40 dark:border-stone-700"><ArrowDown size={14} aria-hidden="true" /></button>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_BADGE[f.status]}`}>{f.status}</span>
                        {f.source !== 'editor' && <span className="rounded bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-800 dark:bg-sky-950 dark:text-sky-300">{SOURCE_LABEL[f.source] ?? f.source}</span>}
                        <span className="text-[11px] tabular-nums text-stone-500 dark:text-stone-400">#{index + 1} · updated {new Date(f.updatedAt).toLocaleDateString()} by {f.updatedBy}{f.approvedBy ? ` · published by ${f.approvedBy}` : ''}</span>
                      </div>
                      <p className="mt-1 break-words font-semibold text-stone-900 dark:text-stone-100">{f.question}</p>
                      <p className="mt-1 line-clamp-2 whitespace-pre-line break-words text-xs text-stone-600 dark:text-stone-400">{f.answer}</p>
                      {issues.length > 0 && <ul className="mt-2 space-y-0.5 text-[11px]">{issues.map((i, n) => <li key={n} className={i.severity === 'warning' ? 'text-amber-800 dark:text-amber-300' : 'text-stone-500'}>⚠ {i.message}</li>)}</ul>}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2 text-xs md:justify-end">
                      <button type="button" disabled={busy} onClick={() => { setFormError(null); setDraft({ id: f.id, question: f.question, answer: f.answer, status: f.status, context: contextKeyOf(f) }); }} className="font-semibold text-amber-700 hover:underline dark:text-amber-400">Edit</button>
                      {f.status === 'published'
                        ? <button type="button" disabled={busy} onClick={() => void update(f, { status: 'draft' }, 'Unpublished; the question is no longer public.')} className="font-semibold text-stone-700 hover:underline dark:text-stone-300">Unpublish</button>
                        : <button type="button" disabled={busy} onClick={() => { if (f.source !== 'editor' && !confirm('This entry came from a suggestion. Have you checked every fact against the official source?')) return; void update(f, { status: 'published' }, 'Published on the page.'); }} className="font-semibold text-emerald-700 hover:underline dark:text-emerald-400">Publish</button>}
                      {f.status !== 'archived' && <button type="button" disabled={busy} onClick={() => void update(f, { status: 'archived' }, 'Archived; the question is no longer public.')} className="font-semibold text-purple-700 hover:underline dark:text-purple-300">Archive</button>}
                      <button type="button" disabled={busy} onClick={() => void remove(f)} className="text-rose-600 hover:underline dark:text-rose-400">Delete</button>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}
    </div>
  );
};
