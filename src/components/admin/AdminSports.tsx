/**
 * SportingSpy Admin Sports Management
 * Allows editors and administrators to:
 * - Create new sports dynamically (unlimited future sports)
 * - Edit existing sports (name, slug, tagline, description, SEO)
 * - Toggle visibility (hide/show)
 * - Reorder sport priority
 */

import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Sport } from '../../types';
import { Button } from '../ui/Button';

export const AdminSports: React.FC = () => {
  const { sports, addSport, updateSport, deleteSport, navigate } = useApp();
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [tagline, setTagline] = useState('');
  const [description, setDescription] = useState('');
  const [order, setOrder] = useState<number>(1);
  const [isVisible, setIsVisible] = useState(true);
  const [metaTitle, setMetaTitle] = useState('');
  const [metaDescription, setMetaDescription] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  const resetForm = () => {
    setName('');
    setSlug('');
    setTagline('');
    setDescription('');
    setOrder(sports.length + 1);
    setIsVisible(true);
    setMetaTitle('');
    setMetaDescription('');
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

    const payload = {
      name,
      slug,
      tagline,
      description,
      order: Number(order),
      isVisible,
      featuredEventIds: [],
      seo: {
        metaTitle: metaTitle || `${name} Tournament Guides & Records | SportingSpy`,
        metaDescription: metaDescription || description,
      },
    };

    if (editingId) {
      updateSport(editingId, payload);
      setFeedback(`Sport "${name}" updated successfully.`);
    } else {
      addSport(payload);
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
    setMetaTitle(s.seo.metaTitle || '');
    setMetaDescription(s.seo.metaDescription || '');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between pb-4 border-b border-stone-200 dark:border-stone-800">
        <div>
          <h2 className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">
            Sports Disciplines ({sports.length})
          </h2>
          <p className="text-xs text-stone-500 mt-1">
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
            <button type="button" onClick={resetForm} className="text-xs text-stone-500">
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
      <div className="overflow-x-auto rounded-xl border border-stone-200 dark:border-stone-800">
        <table className="w-full text-left text-xs">
          <thead className="bg-stone-50 dark:bg-stone-900/60 uppercase tracking-wider text-stone-500 border-b border-stone-200 dark:border-stone-800">
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
                  <span className="font-semibold text-stone-900 dark:text-stone-100 mr-2">{sport.name}</span>
                  <span className="text-stone-400 font-mono text-[11px]">/{sport.slug}</span>
                </td>
                <td className="p-3 text-stone-500 max-w-xs truncate">{sport.tagline}</td>
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
                  <button
                    onClick={() => navigate(`/${sport.slug}`)}
                    className="text-stone-600 hover:text-amber-600 dark:text-stone-400 font-semibold"
                  >
                    View
                  </button>
                  <button
                    onClick={() => startEdit(sport)}
                    className="text-amber-600 dark:text-amber-400 font-semibold hover:underline"
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
