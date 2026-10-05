/**
 * Edition card for Event discovery (PHASE E5). Shows only stored facts:
 * title, Event, Sport, dates, venue/location and the timing derived from
 * them (src/lib/eventTiming.ts). Server-rendered.
 */

import React from 'react';
import Link from 'next/link';
import { CalendarDays, MapPin } from 'lucide-react';
import type { DiscoveryEdition } from '../../../server/services/public/content';
import { editionDates } from '../../lib/eventDates';
import { TIMING_LABELS, editionTiming } from '../../lib/eventTiming';

const TIMING_BADGE = {
  ongoing: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  upcoming: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  past: 'bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300',
} as const;

export const EditionCard: React.FC<{ edition: DiscoveryEdition; today: string }> = ({ edition, today }) => {
  const timing = editionTiming(edition, today);
  const dates = editionDates(edition);
  const place = [edition.venue, edition.location].filter(Boolean).join(', ');
  return (
    <article className="flex min-w-0 flex-col justify-between rounded-xl border border-stone-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md dark:border-stone-800 dark:bg-[#121417]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="min-w-0 truncate font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-500">{edition.sportName}</span>
          <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-bold uppercase ${TIMING_BADGE[timing]}`}>{TIMING_LABELS[timing]}</span>
        </div>
        <h3 className="mt-2 break-words font-serif text-lg font-bold text-stone-900 dark:text-stone-100">
          <Link href={edition.url} data-content-type="edition" data-content-id={edition.id} className="hover:text-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:hover:text-amber-400">{edition.title}</Link>
        </h3>
        <p className="mt-1 break-words text-xs text-stone-500 dark:text-stone-400">
          Part of <Link href={edition.eventUrl} data-content-type="event" className="font-semibold text-stone-700 hover:underline dark:text-stone-300">{edition.eventName}</Link>
        </p>
        {(dates || place) && <div className="mt-3 space-y-1.5 text-xs text-stone-600 dark:text-stone-400">
          {dates && <p className="flex items-start gap-1.5"><CalendarDays size={14} aria-hidden="true" className="mt-px shrink-0 text-amber-700 dark:text-amber-500" /><span className="sr-only">Dates: </span><span className="tabular-nums">{dates}</span></p>}
          {place && <p className="flex items-start gap-1.5"><MapPin size={14} aria-hidden="true" className="mt-px shrink-0 text-amber-700 dark:text-amber-500" /><span className="sr-only">Venue: </span><span className="min-w-0 break-words">{place}</span></p>}
        </div>}
      </div>
      <Link href={edition.url} data-content-type="edition" data-content-id={edition.id} className="mt-4 inline-block border-t border-stone-100 pt-3 text-xs font-semibold text-amber-700 hover:underline dark:border-stone-800 dark:text-amber-400" aria-label={`View the ${edition.title} guide`}>
        View edition guide <span aria-hidden="true">→</span>
      </Link>
    </article>
  );
};
