'use client';

/**
 * Sport icon picker for the Sports CMS form. Suggests icons from the curated
 * set as the sport's name is typed; the admin clicks one to choose it, or
 * opens the full set. Only curated icons can be chosen, so every sport's
 * icon keeps the same style.
 */

import React, { useId, useState } from 'react';
import { SPORT_ICONS, suggestSportIcons, type SportIconOption } from '../../config/sportIcons';

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

export function SportIconPicker({ name, slug, value, onChange }: {
  name: string;
  slug: string;
  /** The chosen icon, or null to use the top suggestion. */
  value: string | null;
  onChange: (emoji: string | null) => void;
}) {
  const id = useId();
  const [showAll, setShowAll] = useState(false);
  const suggestions = suggestSportIcons(name, slug, 6);
  const effective = value ?? suggestions[0]?.emoji ?? '🏅';
  const chosen = SPORT_ICONS.find((o) => o.emoji === effective);

  return (
    <div className="space-y-2" role="group" aria-labelledby={`${id}-label`}>
      <div className="flex items-center justify-between gap-2">
        <span id={`${id}-label`} className="block text-xs font-semibold text-stone-700 dark:text-stone-300">Sport icon</span>
        {value && suggestions[0] && value !== suggestions[0].emoji && (
          <button type="button" onClick={() => onChange(null)} className="text-[11px] font-semibold text-amber-700 hover:underline dark:text-amber-500">Use suggested ({suggestions[0].emoji})</button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-950">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-stone-100 text-[30px] leading-none ring-1 ring-stone-200 dark:bg-stone-800 dark:ring-stone-700">{effective}</span>
          <span className="text-xs text-stone-600 dark:text-stone-400">
            <span className="block font-semibold text-stone-900 dark:text-stone-100">{chosen?.label ?? 'Medal (generic)'}</span>
            {value ? 'Chosen' : name.trim() ? (suggestions.length ? 'Suggested from the name' : 'No match yet — pick one below') : 'Type the sport name to get suggestions'}
          </span>
        </div>
        {suggestions.length > 0 && (
          <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Suggested icons">
            <span className="mr-1 text-[10px] font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400">Suggestions</span>
            {suggestions.map((o) => <IconButton key={o.emoji} option={o} selected={effective === o.emoji} onPick={onChange} />)}
          </div>
        )}
        <button type="button" aria-expanded={showAll} aria-controls={`${id}-all`} onClick={() => setShowAll((v) => !v)} className="ml-auto rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800">
          {showAll ? 'Hide icons' : 'More icons'}
        </button>
      </div>
      {showAll && (
        <div id={`${id}-all`} role="radiogroup" aria-label="All sport icons" className="grid grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-2 rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-950">
          {SPORT_ICONS.map((o) => <IconButton key={o.emoji} option={o} selected={effective === o.emoji} onPick={(e) => { onChange(e); setShowAll(false); }} />)}
        </div>
      )}
    </div>
  );
}
