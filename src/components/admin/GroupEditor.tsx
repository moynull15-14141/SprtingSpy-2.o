/**
 * The full editor of one group (Sport → Group), opened with Edit in the
 * Groups list of the Sport form. It is the Sport form's own fields and
 * components (icon picker, Media Library image, featured events, SEO +
 * social), saved to the group itself through PUT /api/disciplines/:id.
 *
 * A save sends only the fields that changed, so nothing stored is overwritten
 * by an ordinary save, and nothing is ever written to the parent sport or to
 * a sibling group. A slug change moves the group's page; the server writes
 * the 301 from the old address.
 *
 * Not here on purpose: Event configuration (it defines the event fields of a
 * whole sport), the FAQ structured-data switch (FAQ entries have no group
 * context) and retirement (an action in the Groups list). A group has no
 * groups of its own.
 */
import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import type { Discipline } from '../../types';
import { suggestSportIcons } from '../../config/sportIcons';
import { Button } from '../ui/Button';
import { SportIconPicker } from './SportIconPicker';
import { MediaImageField } from './media/MediaShared';
import { SeoFields, seoToDraft, draftToSeo, type SeoDraft } from './EntityFields';

const inputClass = 'w-full text-xs p-2.5 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950';
const labelClass = 'block text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1';

export function GroupEditor({ group, sportName, onClose, sportHasUnsavedChanges = false, onDirtyChange }: { group: Discipline; sportName: string; onClose: () => void; /** The sport form behind this editor holds edits that are not saved yet. */ sportHasUnsavedChanges?: boolean; onDirtyChange?: (dirty: boolean) => void }) {
  const { apiCall, events, mediaItems, refreshData } = useApp();
  const [name, setName] = useState(group.name);
  const [slug, setSlug] = useState(group.slug);
  const [icon, setIcon] = useState<string | null>(group.icon ?? null);
  const [tagline, setTagline] = useState(group.tagline || '');
  const [description, setDescription] = useState(group.description || '');
  const [order, setOrder] = useState<number>(group.order);
  const [isVisible, setIsVisible] = useState(group.isVisible);
  const [heroImage, setHeroImage] = useState(group.heroImage || '');
  const [featuredEventIds, setFeaturedEventIds] = useState<string[]>(group.featuredEventIds || []);
  const [seoDraft, setSeoDraft] = useState<SeoDraft>(seoToDraft(group.seo));
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Only this group's own events can be featured on its page.
  const groupEvents = events.filter((e) => e.sportSlug === group.sportSlug && e.disciplineSlug === group.slug);
  const toggleFeatured = (id: string) => setFeaturedEventIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : ids.length >= 12 ? ids : [...ids, id]));
  const moveFeatured = (id: string, dir: -1 | 1) => setFeaturedEventIds((ids) => {
    const i = ids.indexOf(id); const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return ids;
    const next = [...ids]; [next[i], next[j]] = [next[j], next[i]]; return next;
  });

  /** Only the fields that differ from what is stored: an ordinary save never overwrites stored values with defaults. */
  const pendingChanges = (): Record<string, unknown> => {
    const full: Record<string, unknown> = {
      name: name.trim(), slug: slug.trim(), tagline: tagline.trim(), description: description.trim(), order: Number(order), isVisible,
      icon, heroImage: heroImage || null, featuredEventIds,
      // Blank SEO fields mean "automatic default"; canonical/noindex and other stored keys are kept.
      seo: draftToSeo(seoDraft, group.seo),
    };
    const before: Record<string, unknown> = { name: group.name, slug: group.slug, tagline: group.tagline || '', description: group.description || '', order: group.order, isVisible: group.isVisible, icon: group.icon ?? null, heroImage: group.heroImage || null, featuredEventIds: group.featuredEventIds || [], seo: group.seo };
    return Object.fromEntries(Object.entries(full).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(before[k])));
  };
  const dirty = Object.keys(pendingChanges()).length > 0;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => { if (!dirty || window.confirm('Discard the unsaved changes to this group?')) onClose(); };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !slug.trim() || saving) return;
    const changes = pendingChanges();
    if (!Object.keys(changes).length) { setFeedback('No changes to save.'); return; }
    if (changes.slug && !window.confirm(`Change the URL from /${group.sportSlug}/${group.slug}/ to /${group.sportSlug}/${slug.trim()}/? The group's page moves and the old URL will redirect (301) to the new one. Its events and articles follow automatically.`)) return;
    setSaving(true); setFeedback(null);
    const res = await apiCall<Discipline & { movedUrls?: number }>(`/api/disciplines/${group.id}`, { method: 'PUT', body: changes });
    await refreshData();
    setSaving(false);
    // On failure the server's message is shown and the form keeps what was typed.
    setFeedback(res.data ? `Group "${res.data.name}" saved.${res.data.movedUrls ? ' Its page URL changed and the old one redirects (301).' : ''}` : null);
  };

  return (
    <form onSubmit={handleSave} className="p-6 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900/60 space-y-4" data-testid="group-editor">
      <div className="flex items-center justify-between border-b border-stone-200 dark:border-stone-800 pb-2">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-500">{sportName} · Group</p>
          <h3 className="font-serif text-lg font-bold text-stone-900 dark:text-stone-100">Edit Group</h3>
        </div>
        <button type="button" onClick={close} className="text-xs text-stone-500 dark:text-stone-400">Back to {sportName}</button>
      </div>
      <p className="text-[11px] text-stone-500 dark:text-stone-400">
        Public page: <span className="font-mono">/{group.sportSlug}/{group.slug}/</span>
        {!group.isActive && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-800 dark:bg-amber-950 dark:text-amber-300">Retired</span>}
        . These settings belong to this group only; the sport and its other groups are not changed.
      </p>

      {sportHasUnsavedChanges && (
        <div role="note" data-testid="sport-unsaved-note" className="p-3 rounded-lg border border-amber-300 bg-amber-50 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          The {sportName} form has changes that are not saved yet. They are still there when you go back, and <strong>Save Group does not save them</strong>: go back and use Save Changes on the sport.
        </div>
      )}

      {feedback && <div role="status" className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-300">{feedback}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="group-name" className={labelClass}>Group Name *</label>
          <input id="group-name" type="text" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Running" className={inputClass} />
        </div>
        <div>
          <label htmlFor="group-slug" className={labelClass}>URL Slug * (Unique within {sportName}, lowercase)</label>
          <input id="group-slug" type="text" required maxLength={120} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="e.g. running" className={`${inputClass} font-mono`} />
        </div>
      </div>

      {icon === null ? (
        <div className="text-xs">
          <span className={labelClass}>Group icon</span>
          <button type="button" onClick={() => setIcon(suggestSportIcons(name, slug, 1)[0]?.emoji ?? '🏅')} className="font-semibold text-amber-700 hover:underline dark:text-amber-400">+ Add an icon</button>
          <span className="ml-2 text-stone-500 dark:text-stone-400">No icon is shown for this group.</span>
        </div>
      ) : (
        <div>
          <SportIconPicker name={name} slug={slug} value={icon} onChange={(emoji) => setIcon(emoji ?? suggestSportIcons(name, slug, 1)[0]?.emoji ?? icon)} />
          <button type="button" onClick={() => setIcon(null)} className="mt-1 text-[11px] font-semibold text-rose-600 hover:underline dark:text-rose-400">Remove icon</button>
        </div>
      )}

      <div>
        <label htmlFor="group-tagline" className={labelClass}>Tagline / Focus</label>
        <input id="group-tagline" type="text" maxLength={300} value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="e.g. Sprints, middle distance, marathons and road races" className={inputClass} />
      </div>

      <div>
        <label htmlFor="group-description" className={labelClass}>Description</label>
        <textarea id="group-description" rows={3} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What SportingSpy covers in this group..." className={inputClass} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="group-order" className={labelClass}>Display Order Priority</label>
          <input id="group-order" type="number" min={0} max={10000} value={order} onChange={(e) => setOrder(Number(e.target.value))} className="w-full text-xs p-2 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950 font-mono" />
        </div>
        <div className="flex items-center gap-2 pt-6">
          <label className="inline-flex items-center gap-2 text-xs font-semibold cursor-pointer">
            <input type="checkbox" checked={isVisible} onChange={(e) => setIsVisible(e.target.checked)} />
            <span>Visible on the public site (its page and the {sportName} group list)</span>
          </label>
        </div>
      </div>

      <MediaImageField id="group-hero-image" label="Group image (Media Library)" value={heroImage} onChange={setHeroImage} items={mediaItems} hint="Shown on the right side of this group's page header. Images come from the Media Library so their rights, alt text and responsive sizes are tracked." />

      <fieldset className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
        <legend className="px-1 text-xs font-bold uppercase tracking-wider text-stone-700 dark:text-stone-200">Featured events ({featuredEventIds.length}/12)</legend>
        <p className="mb-2 text-[11px] text-stone-500 dark:text-stone-400">Shown first on this group&apos;s page, in this order. With none chosen, the group&apos;s events marked “featured” are shown. Only events that belong to this group are listed.</p>
        {groupEvents.length === 0 ? <p className="text-[11px] italic text-stone-500">No event belongs to this group yet. Give an event this group in Events &amp; Editions first.</p> : (
          <ul className="space-y-1">
            {[...featuredEventIds.map((id) => groupEvents.find((ev) => ev.id === id)).filter(Boolean), ...groupEvents.filter((ev) => !featuredEventIds.includes(ev.id))].map((evt) => evt && (
              <li key={evt.id} className="flex items-center gap-2 text-xs">
                <input type="checkbox" id={`group-feat-${evt.id}`} checked={featuredEventIds.includes(evt.id)} onChange={() => toggleFeatured(evt.id)} />
                <label htmlFor={`group-feat-${evt.id}`} className="flex-1">{evt.name}</label>
                {featuredEventIds.includes(evt.id) && <>
                  <button type="button" onClick={() => moveFeatured(evt.id, -1)} aria-label={`Move ${evt.name} up`} className="px-1 text-stone-500 hover:text-stone-900">↑</button>
                  <button type="button" onClick={() => moveFeatured(evt.id, 1)} aria-label={`Move ${evt.name} down`} className="px-1 text-stone-500 hover:text-stone-900">↓</button>
                </>}
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <SeoFields idPrefix="group-seo" value={seoDraft} onChange={setSeoDraft} defaults={{ title: `${name || 'Group'} – ${sportName} Events, Guides & Articles | SportingSpy`, description }} />

      <div className="pt-2 flex justify-end gap-2 border-t border-stone-200 dark:border-stone-800">
        <Button type="button" variant="outline" size="sm" onClick={close}>Back to {sportName}</Button>
        <Button type="submit" size="sm" isLoading={saving}>Save Group</Button>
      </div>
    </form>
  );
}
