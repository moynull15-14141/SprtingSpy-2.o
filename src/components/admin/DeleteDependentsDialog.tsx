'use client';
import { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Button } from '../ui/Button';
import { SportGroupPicker } from './SportGroupPicker';

export type DeleteKind = 'event' | 'edition' | 'sport' | 'group';
type Action = 'unpublish' | 'delete';
interface Plan {
  kind: DeleteKind; id: string; name: string; path: string;
  expect: Record<string, string[]>;
  removed: { key: string; title: string; items: { id: string; label: string; note?: string }[] }[];
  detached: { key: string; title: string; items: { id: string; label: string }[] }[];
  articles: { id: string; title: string; status: string; slug: string; path: string; newPath: string | null; needsChoice: boolean; faqCount: number }[];
  keptNote: string;
  moveTargets?: { slug: string; name: string; isVisible: boolean }[];
}
interface Result { kept: number; unpublished: number; deleted: number; faqsDeleted: number; removed: Record<string, number>; movedTo: string | null }

const BASE: Record<DeleteKind, string> = { event: '/api/events', edition: '/api/editions', sport: '/api/sports', group: '/api/disciplines' };
const STATUS_STYLE: Record<string, string> = {
  published: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
  scheduled: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-300',
};
const badge = (status: string) => <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${STATUS_STYLE[status] ?? 'bg-stone-200 text-stone-800 dark:bg-stone-800 dark:text-stone-200'}`}>{status}</span>;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const openLink = (id: string) => <a href={`/admin/preview/${id}/`} target="_blank" rel="noreferrer" className="shrink-0 text-xs font-semibold text-amber-700 hover:underline dark:text-amber-400">Open</a>;

/**
 * The Delete dialog of an Event, Edition, Sport or Group: lists everything
 * linked to it and deletes in one step. Private articles are always kept;
 * published and scheduled ones need a choice when their address changes.
 */
export function DeleteDependentsDialog({ kind, id, onClose, onDeleted }: { kind: DeleteKind; id: string; onClose: () => void; onDeleted: (message: string) => void }) {
  const { apiCall, refreshData, disciplines } = useApp();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [actions, setActions] = useState<Record<string, Action>>({});
  const [moveTo, setMoveTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const base = BASE[kind];

  useEffect(() => {
    let active = true;
    setPlan(null); setLoadError(''); setError(''); setActions({});
    void apiCall<Plan>(`${base}/${encodeURIComponent(id)}/delete-plan`).then((r) => {
      if (!active) return;
      if (r.data) setPlan(r.data); else setLoadError(r.error || 'The linked content could not be loaded.');
    });
    return () => { active = false; };
  }, [id, kind, reloadKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const published = plan?.articles.filter((a) => a.needsChoice) ?? [];
  const privateOnes = plan?.articles.filter((a) => !a.needsChoice) ?? [];
  const keptCount = (plan?.articles ?? []).filter((a) => actions[a.id] !== 'delete').length;
  const missingChoice = published.some((a) => !actions[a.id]);
  const needsTarget = kind === 'sport' && keptCount > 0;
  const missingTarget = needsTarget && !moveTo;
  const noTarget = kind === 'sport' && !!plan && !plan.moveTargets?.length && keptCount > 0;
  const setAll = (action: Action) => setActions(Object.fromEntries(published.map((a) => [a.id, action])));
  const newPath = (a: Plan['articles'][number]) => a.newPath ?? (moveTo ? `/${moveTo.split('/')[0]}/${a.slug}/` : null);

  async function confirm() {
    if (!plan || busy || missingChoice || missingTarget) return;
    setBusy(true); setError('');
    try {
      const r = await apiCall<Result>(`${base}/${encodeURIComponent(id)}/delete`, { method: 'POST', body: { expect: plan.expect, publishedActions: actions, ...(needsTarget ? { moveTo } : {}) } });
      if (!r.data) { setError(r.error || 'Nothing was deleted.'); return; }
      await refreshData();
      const d = r.data;
      const parts = [
        ...Object.entries(d.removed ?? {}).filter(([, v]) => v).map(([k, v]) => `${plural(v, k.replace(/s$/, ''))} deleted`),
        d.kept ? `${plural(d.kept, 'article')} kept${d.movedTo ? ` in ${d.movedTo}` : ''}` : '',
        d.unpublished ? `${plural(d.unpublished, 'article')} unpublished and kept as drafts${d.movedTo ? ` in ${d.movedTo}` : ''}` : '',
        d.deleted ? `${plural(d.deleted, 'article')} deleted` : '',
        d.faqsDeleted ? `${plural(d.faqsDeleted, 'FAQ entry', 'FAQ entries')} deleted` : '',
      ].filter(Boolean);
      onDeleted(`Deleted ${kind} "${plan.name}".${parts.length ? ` ${parts.join(', ')}.` : ''}`);
    } finally { setBusy(false); }
  }

  const section = 'mt-4 border-t border-stone-200 pt-3 dark:border-stone-800';
  const nothingLinked = plan && !plan.removed.length && !plan.detached.length && !plan.articles.length;
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="delete-dialog-heading" data-testid="delete-dialog" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="max-h-[88vh] w-full max-w-2xl overflow-auto rounded-xl bg-white p-5 text-sm shadow-2xl dark:bg-stone-950">
        <h3 id="delete-dialog-heading" className="font-serif text-lg font-bold">Delete {kind}{plan ? ` "${plan.name}"` : ''}?</h3>
        {!plan && !loadError && <p className="mt-3 text-xs text-stone-500" role="status">Checking what is linked to this {kind}…</p>}
        {loadError && <p role="alert" className="mt-3 rounded border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">{loadError}</p>}
        {plan && <>
          <p className="mt-1 text-xs text-stone-500"><span className="font-mono">{plan.path}</span> stops working. Review what happens to the linked content below.</p>
          {nothingLinked && <p className="mt-4 text-xs">Nothing else is linked to this {kind}.</p>}

          {plan.removed.map((group) => <section key={group.key} className={section} aria-label={group.title} data-testid={`dd-removed-${group.key}`}>
            <h4 className="font-semibold">{group.title} — deleted with the {kind} ({group.items.length})</h4>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">{group.items.map((item) => <li key={item.id} className="break-words">{item.label}{item.note && <span className="text-stone-500"> ({item.note})</span>}</li>)}</ul></section>)}

          {plan.detached.map((group) => <section key={group.key} className={section} aria-label={group.title} data-testid={`dd-detached-${group.key}`}>
            <h4 className="font-semibold">{group.title} ({group.items.length})</h4>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">{group.items.map((item) => <li key={item.id} className="break-words">{item.label}</li>)}</ul></section>)}

          {published.length > 0 && <section className={section} aria-labelledby="dd-published"><div className="flex flex-wrap items-center justify-between gap-2"><h4 id="dd-published" className="font-semibold">Published or scheduled articles — choose for each ({published.length})</h4>
            {published.length > 1 && <div className="flex gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setAll('unpublish')}>Unpublish all</Button><Button type="button" size="sm" variant="outline" onClick={() => setAll('delete')}>Delete all</Button></div>}</div>
            <p className="mt-1 text-xs text-stone-500">Unpublish keeps the article as a private draft{kind === 'sport' ? ' in the sport chosen below' : ''}. Their public pages stop working either way.</p>
            <ul className="mt-2 space-y-2">{published.map((a) => <li key={a.id} className="rounded-lg border border-stone-200 p-3 dark:border-stone-800" data-testid="dd-published-article">
              <div className="flex flex-wrap items-center gap-2">{badge(a.status)}<strong className="min-w-0 flex-1 break-words">{a.title}</strong>{openLink(a.id)}</div>
              <p className="mt-1 break-all font-mono text-[11px] text-stone-500">{a.path}</p>
              <div className="mt-2 flex flex-wrap gap-4 text-xs" role="radiogroup" aria-label={`What happens to ${a.title}`}>
                <label className="flex items-center gap-1.5"><input type="radio" name={`dd-${a.id}`} checked={actions[a.id] === 'unpublish'} onChange={() => setActions((s) => ({ ...s, [a.id]: 'unpublish' }))} /> Unpublish and keep as draft</label>
                <label className="flex items-center gap-1.5 text-rose-700 dark:text-rose-400"><input type="radio" name={`dd-${a.id}`} checked={actions[a.id] === 'delete'} onChange={() => setActions((s) => ({ ...s, [a.id]: 'delete' }))} /> Delete permanently{a.faqCount ? ` (with ${plural(a.faqCount, 'FAQ entry', 'FAQ entries')})` : ''}</label>
              </div></li>)}</ul></section>}

          {privateOnes.length > 0 && <section className={section} aria-labelledby="dd-kept"><h4 id="dd-kept" className="font-semibold">{kind === 'group' ? 'Articles' : 'Private articles'} — kept ({privateOnes.length})</h4>
            <p className="mt-1 text-xs text-stone-500">{kind === 'group' ? '' : 'Drafts, previews and archived articles are never deleted. '}{plan.keptNote}</p>
            <ul className="mt-2 space-y-1.5 text-xs">{privateOnes.map((a) => <li key={a.id} className="flex flex-wrap items-center gap-2" data-testid="dd-kept-article">{badge(a.status)}<span className="min-w-0 flex-1 break-words">{a.title}</span>{newPath(a) && newPath(a) !== a.path && <span className="break-all font-mono text-[10px] text-stone-500">→ {newPath(a)}</span>}{openLink(a.id)}</li>)}</ul></section>}

          {needsTarget && <section className={section} aria-labelledby="dd-move"><label id="dd-move" htmlFor="dd-move-to" className="font-semibold">Move the {plural(keptCount, 'kept article')} to *</label>
            {noTarget ? <p role="alert" className="mt-2 text-xs text-rose-700 dark:text-rose-400">There is no other sport to keep them in. Create one first, or choose Delete for every published article and delete the drafts separately.</p>
              : <SportGroupPicker id="dd-move-to" className="mt-2" label="Sport or group that keeps the articles" emptyLabel="Choose a sport or group"
                  sports={plan.moveTargets!.map((s) => ({ id: s.slug, slug: s.slug, name: `${s.name}${s.isVisible ? '' : ' (hidden)'}` }))} groups={disciplines}
                  sportSlug={moveTo.split('/')[0] ?? ''} groupSlug={moveTo.split('/')[1] ?? ''}
                  onChange={(sport, group) => setMoveTo(group ? `${sport}/${group}` : sport)} />}
            <p className="mt-1 text-xs text-stone-500">{plan.keptNote}</p></section>}

          {error && <div role="alert" className="mt-4 rounded border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">{error}{/changed/i.test(error) && <button type="button" className="ml-2 font-semibold underline" onClick={() => setReloadKey((k) => k + 1)}>Reload list</button>}</div>}
        </>}
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-stone-200 pt-4 dark:border-stone-800">
          {(missingChoice || missingTarget) && <p className="mr-auto text-xs text-amber-700 dark:text-amber-400">{missingChoice ? 'Choose an option for every published article.' : 'Choose the sport or group that keeps the articles.'}</p>}
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="button" variant="danger" onClick={() => void confirm()} disabled={!plan || missingChoice || missingTarget || busy} isLoading={busy} data-testid="dd-confirm">Delete {kind}</Button>
        </div>
      </div>
    </div>
  );
}
