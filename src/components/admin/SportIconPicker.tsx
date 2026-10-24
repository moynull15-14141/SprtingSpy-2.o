'use client';

/**
 * Sport icon picker for the Sports CMS form. Suggests icons from the curated
 * set as the sport's name is typed; the admin clicks one to choose it, or
 * opens the full set. A sport may instead use a custom uploaded icon image
 * (Media Library, category "icon"), which is kept separate from photos.
 * When onIconMediaChange is omitted the picker is emoji-only (e.g. groups).
 */

import React, { useId, useState } from 'react';
import { SPORT_ICONS, suggestSportIcons, type SportIconOption } from '../../config/sportIcons';
import { useApp } from '../../context/AppContext';
import { MediaPicker, thumbnailUrl } from './media/MediaShared';

const tile = (selected: boolean) =>
  `inline-flex h-11 w-11 items-center justify-center rounded-xl text-[22px] leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
    selected
      ? 'bg-amber-50 ring-2 ring-amber-600 dark:bg-amber-950/40'
      : 'bg-stone-100 ring-1 ring-stone-200 hover:ring-amber-400 dark:bg-stone-800 dark:ring-stone-700'
  }`;

function IconButton({ option, selected, onPick }: { option: SportIconOption; selected: boolean; onPick: (emoji: string) => void }) {
  return (
    <span className="group/icon relative inline-flex">
      <button type="button" role="radio" aria-checked={selected} aria-label={option.label} title={option.label} onClick={() => onPick(option.emoji)} className={tile(selected)}>
        <span aria-hidden="true">{option.emoji}</span>
      </button>
      <span role="tooltip" className="pointer-events-none absolute left-1/2 top-full z-30 mt-1.5 hidden w-max -translate-x-1/2 rounded-md bg-stone-950 px-2 py-1 text-[11px] font-medium text-white shadow-lg group-hover/icon:block dark:bg-stone-100 dark:text-stone-950">
        {option.label}
      </span>
    </span>
  );
}

export function SportIconPicker({ name, slug, value, onChange, iconMediaId, onIconMediaChange }: {
  name: string;
  slug: string;
  /** The chosen emoji icon, or null to use the top suggestion. */
  value: string | null;
  onChange: (emoji: string | null) => void;
  /** Optional custom icon image (Media Library id). Omit onIconMediaChange for emoji-only. */
  iconMediaId?: string | null;
  onIconMediaChange?: (id: string | null) => void;
}) {
  const id = useId();
  const { mediaItems } = useApp();
  const [showAll, setShowAll] = useState(false);
  const [picking, setPicking] = useState(false);
  const supportsCustom = typeof onIconMediaChange === 'function';
  const customIcon = iconMediaId ? mediaItems.find((m) => m.id === iconMediaId) : undefined;
  const suggestions = suggestSportIcons(name, slug, 6);
  const effective = value ?? suggestions[0]?.emoji ?? '🏅';
  const chosen = SPORT_ICONS.find((o) => o.emoji === effective);
  // Choosing an emoji clears any custom icon; choosing a custom icon clears the emoji selection visually.
  const pickEmoji = (emoji: string | null) => { onChange(emoji); onIconMediaChange?.(null); };

  return (
    <div className="space-y-2" role="group" aria-labelledby={`${id}-label`}>
      <div className="flex items-center justify-between gap-2">
        <span id={`${id}-label`} className="block text-xs font-semibold text-stone-700 dark:text-stone-300">Sport icon</span>
        {!customIcon && value && suggestions[0] && value !== suggestions[0].emoji && (
          <button type="button" onClick={() => pickEmoji(null)} className="text-[11px] font-semibold text-amber-700 hover:underline dark:text-amber-500">Use suggested ({suggestions[0].emoji})</button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-950">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="inline-flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-stone-100 text-[30px] leading-none ring-1 ring-stone-200 dark:bg-stone-800 dark:ring-stone-700">
            {customIcon ? <img src={thumbnailUrl(customIcon)} alt="" className="h-full w-full object-contain" /> : effective}
          </span>
          <span className="text-xs text-stone-600 dark:text-stone-400">
            <span className="block font-semibold text-stone-900 dark:text-stone-100">{customIcon ? (customIcon.title || 'Custom icon') : (chosen?.label ?? 'Medal (generic)')}</span>
            {customIcon ? 'Custom uploaded icon' : value ? 'Chosen' : name.trim() ? (suggestions.length ? 'Suggested from the name' : 'No match yet — pick one below') : 'Type the sport name to get suggestions'}
          </span>
        </div>
        {suggestions.length > 0 && (
          <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Suggested icons">
            <span className="mr-1 text-[10px] font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400">Suggestions</span>
            {suggestions.map((o) => <IconButton key={o.emoji} option={o} selected={!customIcon && effective === o.emoji} onPick={pickEmoji} />)}
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          {supportsCustom && (
            <button type="button" onClick={() => setPicking(true)} className="rounded-lg border border-amber-500 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:bg-amber-950/40 dark:text-amber-300">
              {customIcon ? 'Change custom icon' : 'Upload custom icon'}
            </button>
          )}
          {supportsCustom && customIcon && (
            <button type="button" onClick={() => onIconMediaChange?.(null)} className="text-xs font-semibold text-rose-700 hover:underline dark:text-rose-400">Remove</button>
          )}
          <button type="button" aria-expanded={showAll} aria-controls={`${id}-all`} onClick={() => setShowAll((v) => !v)} className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800">
            {showAll ? 'Hide icons' : 'More icons'}
          </button>
        </div>
      </div>
      {supportsCustom && (
        <p className="text-[11px] text-stone-500 dark:text-stone-400">Custom icons are kept separate from photos in the Media Library. Best as a square, transparent PNG of a simple emblem (no text); it is shown at a small size.</p>
      )}
      {!supportsCustom && <p className="text-[11px] text-stone-500 dark:text-stone-400">{INTRO_HINT}</p>}
      {showAll && (
        <div id={`${id}-all`} role="radiogroup" aria-label="All sport icons" className="grid grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-2 rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-950">
          {SPORT_ICONS.map((o) => <IconButton key={o.emoji} option={o} selected={!customIcon && effective === o.emoji} onPick={(e) => { pickEmoji(e); setShowAll(false); }} />)}
        </div>
      )}
      {picking && <MediaPicker category="icon" onSelect={(m) => { onIconMediaChange?.(m.id); setPicking(false); }} onClose={() => setPicking(false)} />}
    </div>
  );
}

const INTRO_HINT = 'Icons come from one curated set, so every sport keeps the same style.';
