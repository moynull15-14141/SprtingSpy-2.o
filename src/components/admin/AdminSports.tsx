/**
 * SportingSpy Admin Sports Management
 * Allows editors and administrators to:
 * - Create new sports dynamically (unlimited future sports)
 * - Edit existing sports (name, slug, tagline, description, SEO)
 * - Toggle visibility (hide/show)
 * - Reorder sport priority
 * PHASE R (Spec §6.1): image/logo from the Media Library, SEO + social
 * metadata (other stored SEO keys such as canonical/noindex are preserved),
 * featured events, FAQ structured-data opt-in. An edit sends only the fields
 * that changed, so nothing is wiped by an ordinary save. Slug changes create
 * 301 redirects for every URL under the sport (server-side).
 */

import React, { useState } from 'react';
import { SportIconPicker } from './SportIconPicker';
import { SportIcon } from '../ui/SportIcon';
import { suggestSportIcons } from '../../config/sportIcons';
import { useApp } from '../../context/AppContext';
import { Sport } from '../../types';
import { Button } from '../ui/Button';
import { EventConfigurationEditor } from './EventConfigurationEditor';
import { MediaImageField } from './media/MediaShared';
import { SeoFields, seoToDraft, draftToSeo, EMPTY_SEO_DRAFT, type SeoDraft } from './EntityFields';

export const AdminSports: React.FC = () => {
  const { sports, events, mediaItems, addSport, updateSport, deleteSport, navigate } = useApp();
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [configurationSportSlug, setConfigurationSportSlug] = useState<string | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [tagline, setTagline] = useState('');
  const [description, setDescription] = useState('');
  const [order, setOrder] = useState<number>(1);
  const [isVisible, setIsVisible] = useState(true);
  // null = use the top suggestion for the name.
  const [icon, setIcon] = useState<string | null>(null);
  const [seoDraft, setSeoDraft] = useState<SeoDraft>(EMPTY_SEO_DRAFT);
  const [heroImage, setHeroImage] = useState('');
  const [featuredEventIds, setFeaturedEventIds] = useState<string[]>([]);
  const [faqSchemaEnabled, setFaqSchemaEnabled] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const editingSport = sports.find((s) => s.id === editingId);

  const resetForm = () => {
    setName('');
    setSlug('');
    setTagline('');
    setDescription('');
    setOrder(sports.length + 1);
    setIsVisible(true);
    setIcon(null);
    setSeoDraft(EMPTY_SEO_DRAFT);
    setHeroImage('');
    setFeaturedEventIds([]);
    setFaqSchemaEnabled(false);
    setIsCreating(false);
    setEditingId(null);
  };

  const handleNameChange = (val: string) => {
    setName(val);
    if (!editingId) {
      setSlug(val.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !slug.trim()) return;

    const full = {
      name,
      slug,
      tagline,
      description,
      order: Number(order),
      isVisible,
      // Store the concrete icon (chosen, or the current top suggestion) so it never changes by itself.
      icon: icon ?? suggestSportIcons(name, slug, 1)[0]?.emoji ?? null,
      heroImage: heroImage || null,
      featuredEventIds,
      faqSchemaEnabled,
      // Blank SEO fields mean "automatic default"; canonical/noindex and other stored keys are kept.
      seo: draftToSeo(seoDraft, editingSport?.seo),
    };

    if (editingId && editingSport) {
      // Only the fields that changed: an ordinary save never overwrites stored values with defaults.
      const before: Record<string, unknown> = { name: editingSport.name, slug: editingSport.slug, tagline: editingSport.tagline, description: editingSport.description, order: editingSport.order, isVisible: editingSport.isVisible, icon: editingSport.icon ?? null, heroImage: editingSport.heroImage || null, featuredEventIds: editingSport.featuredEventIds, faqSchemaEnabled: !!editingSport.faqSchemaEnabled, seo: editingSport.seo };
      const changes = Object.fromEntries(Object.entries(full).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(before[k])));
      if (changes.slug && !confirm(`Change the URL from /${editingSport.slug}/ to /${slug}/? Every page under this sport moves; old URLs will redirect (301) to the new ones.`)) return;
      if (Object.keys(changes).length) updateSport(editingId, changes as Partial<Sport>);
      setFeedback(Object.keys(changes).length ? `Sport "${name}" updated.` : 'No changes to save.');
    } else {
      const { featuredEventIds: _none, ...create } = full;
      addSport(create as never);
      setFeedback(`New sport "${name}" created and added to directory.`);
    }

    resetForm();
    setTimeout(() => setFeedback(null), 5000);
  };

  const startEdit = (s: Sport) => {
    setEditingId(s.id);
    setIsCreating(true);
    setName(s.name);
    setSlug(s.slug);
    setTagline(s.tagline);
    setDescription(s.description);
    setOrder(s.order);
    setIsVisible(s.isVisible);
    setIcon(s.icon ?? null);
    setSeoDraft(seoToDraft(s.seo));
    setHeroImage(s.heroImage || '');
    setFeaturedEventIds(s.featuredEventIds || []);
    setFaqSchemaEnabled(!!s.faqSchemaEnabled);
  };
  const sportEvents = events.filter((e) => e.sportSlug === (editingSport?.slug ?? slug));
  const toggleFeatured = (id: string) => setFeaturedEventIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : ids.length >= 12 ? ids : [...ids, id]));
  const moveFeatured = (id: string, dir: -1 | 1) => setFeaturedEventIds((ids) => {
    const i = ids.indexOf(id); const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return ids;
    const next = [...ids]; [next[i], next[j]] = [next[j], next[i]]; return next;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between pb-4 border-b border-stone-200 dark:border-stone-800">
        <div>
          <h2 className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">
            Sports Disciplines ({sports.length})
          </h2>
          <p className="text-xs text-stone-500 mt-1 dark:text-stone-400">
            Dynamic catalog of sports hubs. Extensible beyond the initial 12 disciplines.
          </p>
        </div>
        {!isCreating && (
          <Button onClick={() => setIsCreating(true)} size="sm">
            + Add New Sport
          </Button>
        )}
      </div>

      {feedback && (
        <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-300">
          {feedback}
        </div>
      )}

      {isCreating && (
        <form onSubmit={handleSave} className="p-6 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900/60 space-y-4">
          <div className="flex items-center justify-between border-b border-stone-200 dark:border-stone-800 pb-2">
            <h3 className="font-serif text-lg font-bold text-stone-900 dark:text-stone-100">
              {editingId ? 'Edit Sport Hub' : 'Add New Sport Discipline'}
            </h3>
            <button type="button" onClick={resetForm} className="text-xs text-stone-500 dark:text-stone-400">
              Cancel
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">
                Sport Name *
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="e.g. Cricket, Swimming, Skiing"
                className="w-full text-xs p-2.5 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">
                URL Slug * (Unique, lowercase)
              </label>
              <input
                type="text"
                required
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="e.g. cricket"
                className="w-full text-xs p-2.5 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950 font-mono"
              />
            </div>
          </div>

          <SportIconPicker name={name} slug={slug} value={icon} onChange={setIcon} />

          <div>
            <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">
              Tagline / Focus
            </label>
            <input
              type="text"
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="e.g. Test Matches, World Cups, Pitch Conditions & Formats"
              className="w-full text-xs p-2.5 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">
              Description *
            </label>
            <textarea
              rows={3}
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Authoritative summary of what SportingSpy documents for this sport..."
              className="w-full text-xs p-2.5 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">
                Display Order Priority
              </label>
              <input
                type="number"
                value={order}
                onChange={(e) => setOrder(Number(e.target.value))}
                className="w-full text-xs p-2 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950 font-mono"
              />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <label className="inline-flex items-center gap-2 text-xs font-semibold cursor-pointer">
                <input
                  type="checkbox"
                  checked={isVisible}
                  onChange={(e) => setIsVisible(e.target.checked)}
                />
                <span>Visible on Public Navigation & Megamenu</span>
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <MediaImageField id="sport-hero-image" label="Sport image / logo (Media Library)" value={heroImage} onChange={setHeroImage} items={mediaItems} hint="Shown on the right side of the sport hub header. Images come from the Media Library so their rights, alt text and responsive sizes are tracked." />
            </div>
            <label className="flex items-start gap-2 pt-6 text-xs">
              <input type="checkbox" checked={faqSchemaEnabled} onChange={(e) => setFaqSchemaEnabled(e.target.checked)} className="mt-0.5" />
              <span><span className="font-semibold">FAQPage structured data</span> for this sport&apos;s published FAQ (only when it passes validation).</span>
            </label>
          </div>

          {editingId && (
            <fieldset className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
              <legend className="px-1 text-xs font-bold uppercase tracking-wider text-stone-700 dark:text-stone-200">Featured events ({featuredEventIds.length}/12)</legend>
              <p className="mb-2 text-[11px] text-stone-500 dark:text-stone-400">Shown first on the sport page, in this order. With none chosen, events marked “featured” are shown.</p>
              {sportEvents.length === 0 ? <p className="text-[11px] italic text-stone-500">This sport has no events yet.</p> : (
                <ul className="space-y-1">
                  {[...featuredEventIds.map((id) => sportEvents.find((e) => e.id === id)).filter(Boolean), ...sportEvents.filter((e) => !featuredEventIds.includes(e.id))].map((evt) => evt && (
                    <li key={evt.id} className="flex items-center gap-2 text-xs">
                      <input type="checkbox" id={`feat-${evt.id}`} checked={featuredEventIds.includes(evt.id)} onChange={() => toggleFeatured(evt.id)} />
                      <label htmlFor={`feat-${evt.id}`} className="flex-1">{evt.name}</label>
                      {featuredEventIds.includes(evt.id) && <>
                        <button type="button" onClick={() => moveFeatured(evt.id, -1)} aria-label={`Move ${evt.name} up`} className="px-1 text-stone-500 hover:text-stone-900">↑</button>
                        <button type="button" onClick={() => moveFeatured(evt.id, 1)} aria-label={`Move ${evt.name} down`} className="px-1 text-stone-500 hover:text-stone-900">↓</button>
                      </>}
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>
          )}

          <SeoFields idPrefix="sport-seo" value={seoDraft} onChange={setSeoDraft} defaults={{ title: `${name || 'Sport'} Guides, Tournament Schedules & Records | SportingSpy`, description }} />

          <div className="pt-2 flex justify-end gap-2 border-t border-stone-200 dark:border-stone-800">
            <Button type="button" variant="outline" size="sm" onClick={resetForm}>
              Cancel
            </Button>
            <Button type="submit" size="sm">
              {editingId ? 'Save Changes' : 'Create Sport'}
            </Button>
          </div>
        </form>
      )}

      {/* SPORTS LIST */}
      {configurationSportSlug && <EventConfigurationEditor sportSlug={configurationSportSlug} onClose={() => setConfigurationSportSlug(null)} />}
      <div className="overflow-x-auto rounded-xl border border-stone-200 dark:border-stone-800">
        <table className="w-full text-left text-xs">
          <thead className="bg-stone-50 dark:bg-stone-900/60 uppercase tracking-wider text-stone-500 border-b border-stone-200 dark:border-stone-800 dark:text-stone-400">
            <tr>
              <th className="p-3">Order</th>
              <th className="p-3">Name & Slug</th>
              <th className="p-3">Tagline</th>
              <th className="p-3">Visibility</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
            {sports.map((sport) => (
              <tr key={sport.id} className="hover:bg-stone-50 dark:hover:bg-stone-900/40">
                <td className="p-3 font-mono tabular-nums">{sport.order}</td>
                <td className="p-3">
                  <span className="mr-2 inline-flex align-middle"><SportIcon slug={sport.slug} name={sport.name} icon={sport.icon} size="sm" /></span>
                  <span className="font-semibold text-stone-900 dark:text-stone-100 mr-2">{sport.name}</span>
                  <span className="text-stone-500 font-mono text-[11px] dark:text-stone-400">/{sport.slug}</span>
                </td>
                <td className="p-3 text-stone-500 max-w-xs truncate dark:text-stone-400">{sport.tagline}</td>
                <td className="p-3">
                  <button
                    onClick={() => updateSport(sport.id, { isVisible: !sport.isVisible })}
                    className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded cursor-pointer ${
                      sport.isVisible
                        ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
                        : 'bg-stone-200 dark:bg-stone-800 text-stone-600'
                    }`}
                  >
                    {sport.isVisible ? 'Visible' : 'Hidden'}
                  </button>
                </td>
                <td className="p-3 text-right space-x-2">
                  <button type="button" onClick={() => { if (configurationSportSlug && configurationSportSlug !== sport.slug && !window.confirm('Leave the current configuration editor? Unsaved changes may be lost.')) return; setConfigurationSportSlug(sport.slug); }} className="font-semibold text-amber-700 hover:underline dark:text-amber-400">Event configuration</button>
                  <button
                    onClick={() => navigate(`/${sport.slug}`)}
                    className="text-stone-600 hover:text-amber-600 dark:text-stone-400 font-semibold"
                  >
                    View
                  </button>
                  <button
                    onClick={() => startEdit(sport)}
                    className="text-amber-700 dark:text-amber-400 font-semibold hover:underline"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Delete sport "${sport.name}"?`)) {
                        deleteSport(sport.id);
                      }
                    }}
                    className="text-rose-600 dark:text-rose-400 hover:underline"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
