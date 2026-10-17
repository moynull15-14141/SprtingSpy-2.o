/**
 * Groups of one sport (Athletics → Running), inside the Sport form.
 * Admins add, reorder, hide/show, retire/reactivate and delete them here, and
 * open a group's full editor with Edit (GroupEditor.tsx); other staff see the
 * list. Every action is saved at once through /api/disciplines (it is not
 * part of the sport's own Save).
 *
 * Two levels only: Sport → Group. A group belongs directly to one sport and
 * cannot contain another group; it is never a sport and does not appear in
 * the sports list or the site navigation. "Group" is the word shown to
 * people; the model, API and fields keep their earlier name (discipline).
 */
import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import type { Discipline } from '../../types';
import { DeleteDependentsDialog } from './DeleteDependentsDialog';

const slugOf = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const inputClass = 'w-full min-w-0 rounded border border-stone-300 bg-white p-2 text-xs dark:border-stone-700 dark:bg-stone-950';
const badge = 'rounded px-1.5 py-0.5 text-[10px] font-bold uppercase';

export function DisciplineManager({ sportSlug, sportName, onEdit }: { sportSlug: string; sportName: string; onEdit: (groupId: string) => void }) {
  const { apiCall, currentUser, disciplines, events, articles, refreshData } = useApp();
  const canEdit = currentUser.role === 'Admin';
  const list = disciplines.filter((d) => d.sportSlug === sportSlug).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [notice, setNotice] = useState('');
  // Guided deletion: the dialog lists the events and articles that lose the group.
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const usage = (d: Discipline) => ({
    events: events.filter((e) => e.sportSlug === d.sportSlug && e.disciplineSlug === d.slug).length,
    articles: articles.filter((a) => a.sportSlug === d.sportSlug && a.disciplineSlug === d.slug).length,
  });
  /** Runs one or more requests, then reloads the CMS data. Server messages are shown by apiCall. */
  const run = async (done: string, ...calls: (() => Promise<{ data: unknown }>)[]) => {
    setBusy(true); setNotice('');
    let ok = true;
    for (const call of calls) { if (!(await call()).data) { ok = false; break; } }
    await refreshData();
    setBusy(false);
    if (ok) setNotice(done);
    return ok;
  };
  const put = (id: string, body: Record<string, unknown>) => () => apiCall<Discipline>(`/api/disciplines/${id}`, { method: 'PUT', body });

  const add = async () => {
    const cleanName = name.trim(); const cleanSlug = slug.trim();
    if (!cleanName || !cleanSlug) return;
    if (await run(`Group "${cleanName}" created. Use Edit to add its tagline, description, image and SEO.`, () => apiCall<Discipline>('/api/disciplines', { method: 'POST', body: { sportSlug, name: cleanName, slug: cleanSlug } }))) { setName(''); setSlug(''); setSlugTouched(false); }
  };
  /** Swaps the display position with the neighbour. */
  const move = (index: number, direction: -1 | 1) => {
    const other = list[index + direction]; const current = list[index];
    if (!other) return;
    // Positions are renumbered so equal or missing order values cannot block a move.
    const order = list.map((d) => d.id);
    [order[index], order[index + direction]] = [order[index + direction], order[index]];
    const calls = order.map((id, position) => ({ id, position: position + 1 })).filter(({ id, position }) => list.find((d) => d.id === id)!.order !== position).map(({ id, position }) => put(id, { order: position }));
    void run(`"${current.name}" moved ${direction < 0 ? 'up' : 'down'}.`, ...calls);
  };
  const remove = (d: Discipline) => { setNotice(''); setDeletingId(d.id); };

  return (
    <fieldset className="rounded-lg border border-stone-200 p-3 dark:border-stone-800" aria-busy={busy} data-testid="discipline-manager">
      {deletingId && <DeleteDependentsDialog kind="group" id={deletingId} onClose={() => setDeletingId(null)} onDeleted={(message) => { setDeletingId(null); setNotice(message); }} />}
      <legend className="px-1 text-xs font-bold uppercase tracking-wider text-stone-700 dark:text-stone-200">Groups in {sportName} ({list.length})</legend>
      <p className="mb-2 text-[11px] text-stone-500 dark:text-stone-400">
        Optional groups directly under this sport (for example Running, Jumping). Each group has its own landing page; use Edit for its name, URL, tagline, description, image, featured events and SEO. Events and articles of {sportName} can be given one group. A group is not a separate sport and cannot contain other groups. Changes here are saved immediately.
      </p>
      {notice && <p role="status" className="mb-2 rounded border border-emerald-200 bg-emerald-50 p-2 text-[11px] text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">{notice}</p>}
      {list.length === 0 ? <p className="text-[11px] italic text-stone-500">This sport has no groups. It works exactly as before.</p> : (
        <ul className="divide-y divide-stone-100 dark:divide-stone-800">
          {list.map((d, index) => {
            const used = usage(d); const inUse = used.events + used.articles > 0;
            return (
              <li key={d.id} className="flex flex-wrap items-center gap-2 py-2 text-xs" data-discipline={d.slug}>
                {d.icon && <span aria-hidden="true">{d.icon}</span>}
                <span className="font-semibold text-stone-900 dark:text-stone-100">{d.name}</span>
                <span className="font-mono text-[11px] text-stone-500 dark:text-stone-400">{d.slug}</span>
                {!d.isVisible && <span className={`${badge} bg-stone-200 text-stone-600 dark:bg-stone-800 dark:text-stone-300`}>Hidden</span>}
                {!d.isActive && <span className={`${badge} bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300`}>Retired</span>}
                <span className="text-[11px] text-stone-500 dark:text-stone-400">{inUse ? `${used.events} event(s), ${used.articles} article(s)` : 'not used yet'}</span>
                {canEdit && (
                  <span className="ml-auto flex flex-wrap items-center gap-2">
                    <button type="button" disabled={busy || index === 0} onClick={() => move(index, -1)} aria-label={`Move ${d.name} up`} className="px-1 text-stone-500 hover:text-stone-900 disabled:opacity-30">↑</button>
                    <button type="button" disabled={busy || index === list.length - 1} onClick={() => move(index, 1)} aria-label={`Move ${d.name} down`} className="px-1 text-stone-500 hover:text-stone-900 disabled:opacity-30">↓</button>
                    <button type="button" disabled={busy} onClick={() => onEdit(d.id)} aria-label={`Edit ${d.name}`} className="font-semibold text-amber-700 hover:underline disabled:opacity-50 dark:text-amber-400">Edit</button>
                    <button type="button" disabled={busy} onClick={() => void run(`"${d.name}" is now ${d.isVisible ? 'hidden' : 'visible'}.`, put(d.id, { isVisible: !d.isVisible }))} aria-label={`${d.isVisible ? 'Hide' : 'Show'} ${d.name}`} className="text-stone-600 hover:underline disabled:opacity-50 dark:text-stone-300">{d.isVisible ? 'Hide' : 'Show'}</button>
                    <button type="button" disabled={busy} onClick={() => { if (d.isActive && !window.confirm(`Retire "${d.name}"? It stays on the content that already has it, but can no longer be chosen for other events or articles.`)) return; void run(`"${d.name}" ${d.isActive ? 'retired' : 'reactivated'}.`, put(d.id, { isActive: !d.isActive })); }} aria-label={`${d.isActive ? 'Retire' : 'Reactivate'} ${d.name}`} className="text-stone-600 hover:underline disabled:opacity-50 dark:text-stone-300">{d.isActive ? 'Retire' : 'Reactivate'}</button>
                    <button type="button" disabled={busy} onClick={() => remove(d)} aria-label={`Delete ${d.name}`} title={inUse ? 'Its events and articles are kept without the group; the dialog lists them first.' : undefined} className="text-rose-600 hover:underline disabled:cursor-not-allowed disabled:opacity-40 dark:text-rose-400">Delete</button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canEdit ? (
        <div className="mt-3 grid grid-cols-1 gap-2 border-t border-stone-200 pt-3 dark:border-stone-800 sm:grid-cols-[1fr_1fr_auto]">
          <div>
            <label htmlFor="new-discipline-name" className="mb-1 block text-[11px] font-semibold text-stone-700 dark:text-stone-300">Group name</label>
            <input id="new-discipline-name" value={name} maxLength={120} placeholder="e.g. Running" className={inputClass}
              onChange={(e) => { setName(e.target.value); if (!slugTouched) setSlug(slugOf(e.target.value)); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void add(); } }} />
          </div>
          <div>
            <label htmlFor="new-discipline-slug" className="mb-1 block text-[11px] font-semibold text-stone-700 dark:text-stone-300">Slug (unique within this sport)</label>
            <input id="new-discipline-slug" value={slug} maxLength={120} placeholder="e.g. running" className={`${inputClass} font-mono`}
              onChange={(e) => { setSlug(e.target.value); setSlugTouched(true); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void add(); } }} />
          </div>
          <button type="button" disabled={busy || !name.trim() || !slug.trim()} onClick={() => void add()} className="self-end rounded bg-stone-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900">{busy ? 'Saving…' : 'Create group'}</button>
        </div>
      ) : <p className="mt-2 text-[11px] text-stone-500 dark:text-stone-400">Only an Admin can change groups.</p>}
    </fieldset>
  );
}

/**
 * The groups an event or article of `sportSlug` may be given: the active
 * ones, plus the record's current one when it has been retired since.
 */
export function selectableDisciplines(all: Discipline[], sportSlug: string, current?: string | null): Discipline[] {
  return all.filter((d) => d.sportSlug === sportSlug && (d.isActive || d.slug === current)).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}
