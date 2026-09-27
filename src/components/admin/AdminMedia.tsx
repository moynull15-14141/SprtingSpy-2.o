/**
 * SportingSpy Central Media Registry & Licensing Manager
 * Adheres to Section 24:
 * Title, Alt Text, Caption, Credit, Source, License, and Creation Type:
 * (Original, AI-created, AI-assisted, Licensed, Official Source, Creative Commons, Other)
 */

import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { MediaCreationType, MediaItem } from '../../types';
import { Button } from '../ui/Button';

export const AdminMedia: React.FC = () => {
  const { mediaItems, addMediaItem } = useApp();
  const [isRegistering, setIsRegistering] = useState(false);

  // Form State
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [altText, setAltText] = useState('');
  const [caption, setCaption] = useState('');
  const [credit, setCredit] = useState('');
  const [source, setSource] = useState('');
  const [license, setLicense] = useState('Editorial Syndication');
  const [creationType, setCreationType] = useState<MediaCreationType>('Original');
  const [feedback, setFeedback] = useState<string | null>(null);

  const CREATION_TYPES: MediaCreationType[] = [
    'Original',
    'AI-created',
    'AI-assisted',
    'Licensed',
    'Official Source',
    'Creative Commons',
    'Other',
  ];

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !url.trim() || !altText.trim()) return;

    addMediaItem({
      title,
      url,
      altText,
      caption: caption || undefined,
      credit: credit || undefined,
      source: source || undefined,
      license: license || undefined,
      creationType,
    });

    setFeedback(`Media asset "${title}" cataloged into editorial library.`);
    setTitle('');
    setUrl('');
    setAltText('');
    setCaption('');
    setCredit('');
    setSource('');
    setIsRegistering(false);
    setTimeout(() => setFeedback(null), 4000);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between pb-4 border-b border-stone-200 dark:border-stone-800">
        <div>
          <h2 className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">
            Central Media & Photographic Registry
          </h2>
          <p className="text-xs text-stone-500 mt-1">
            Archival image catalog with explicit attribution, licensing, and creation type provenance.
          </p>
        </div>
        {!isRegistering && (
          <Button onClick={() => setIsRegistering(true)} size="sm">
            + Catalog New Image
          </Button>
        )}
      </div>

      {feedback && (
        <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-300">
          {feedback}
        </div>
      )}

      {isRegistering && (
        <form onSubmit={handleRegister} className="p-5 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900/60 space-y-4">
          <div className="flex items-center justify-between border-b border-stone-200 dark:border-stone-800 pb-2">
            <h3 className="font-serif text-base font-bold text-stone-900 dark:text-stone-100">
              Register Media Asset
            </h3>
            <button type="button" onClick={() => setIsRegistering(false)} className="text-xs text-stone-500">
              Cancel
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block font-semibold mb-1">Asset Title *</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Roland Garros Court Suzanne-Lenglen Roof"
                className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Image URL or Local Asset Path *</label>
              <input
                type="text"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="/src/assets/images/... or https://"
                className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950 font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block font-semibold mb-1">Alt Text (Accessibility) *</label>
              <input
                type="text"
                required
                value={altText}
                onChange={(e) => setAltText(e.target.value)}
                placeholder="Objective visual description for screen-readers"
                className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Creation Provenance Type *</label>
              <select
                value={creationType}
                onChange={(e) => setCreationType(e.target.value as MediaCreationType)}
                className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950 font-medium"
              >
                {CREATION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div>
              <label className="block font-semibold mb-1">Credit / Photographer</label>
              <input
                type="text"
                value={credit}
                onChange={(e) => setCredit(e.target.value)}
                placeholder="e.g. SportingSpy Paris Bureau"
                className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Source Organization</label>
              <input
                type="text"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="e.g. FFT Archive / Direct Capture"
                className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">License Terms</label>
              <input
                type="text"
                value={license}
                onChange={(e) => setLicense(e.target.value)}
                placeholder="e.g. Editorial Syndication"
                className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-stone-200 dark:border-stone-800">
            <Button type="button" variant="outline" size="sm" onClick={() => setIsRegistering(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm">
              Save to Library
            </Button>
          </div>
        </form>
      )}

      {/* MEDIA GRID VIEW */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {mediaItems.map((item) => (
          <div
            key={item.id}
            className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] overflow-hidden flex flex-col justify-between"
          >
            <div className="aspect-video bg-stone-100 dark:bg-stone-900 overflow-hidden relative">
              <img
                src={item.url}
                alt={item.altText}
                className="w-full h-full object-cover"
              />
              <span className="absolute top-2 right-2 text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-black/70 text-white backdrop-blur-sm">
                {item.creationType}
              </span>
            </div>

            <div className="p-3 text-xs space-y-1">
              <h4 className="font-semibold text-stone-900 dark:text-stone-100 truncate">{item.title}</h4>
              <p className="text-[11px] text-stone-500 truncate">
                Credit: {item.credit || 'SportingSpy'}
              </p>
              <p className="text-[11px] text-stone-400 font-mono truncate">
                License: {item.license || 'Editorial Rights'}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
