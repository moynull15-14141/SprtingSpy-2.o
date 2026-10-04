/**
 * SportingSpy Permanent Events Directory
 * URL: /events
 * Catalog of permanent world championship sporting events.
 *
 * PHASE E5: Event discovery. Sport and timing filters are plain links
 * (?sport=, ?when=upcoming|ongoing|past, ?page=), rendered on the server, so
 * every view works without JavaScript and is shareable. Timing comes only
 * from stored Edition dates/status (src/lib/eventTiming.ts).
 */

import React from 'react';
import Link from 'next/link';
import { Breadcrumbs } from '../components/ui/Breadcrumbs';
import { EventCard } from '../components/editorial/EventCard';
import { EditionCard } from '../components/editorial/EditionCard';
import { TIMING_LABELS, type EditionTiming } from '../lib/eventTiming';
import type { DiscoveryEdition, getEventsDirectory } from '../../server/services/public/content';

type EventsDirectoryData = Awaited<ReturnType<typeof getEventsDirectory>>;

const tabClass = (active: boolean) => `px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
  active ? 'bg-amber-700 text-white font-semibold' : 'bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700'
}`;
const pagerClass = 'px-3 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 text-xs font-semibold text-stone-700 dark:text-stone-300';

/** /events/ URL with the given filters (empty values and page 1 omitted). */
const eventsHref = ({ sport, when, page }: { sport?: string; when?: string; page?: number }) => {
  const qs = new URLSearchParams();
  if (sport) qs.set('sport', sport);
  if (when) qs.set('when', when);
  if (page && page > 1) qs.set('page', String(page));
  const query = qs.toString();
  return `/events/${query ? `?${query}` : ''}`;
};

const PREVIEW_HEADINGS: Record<EditionTiming, { eyebrow: string; title: string }> = {
  ongoing: { eyebrow: 'Live calendar', title: 'Happening now' },
  upcoming: { eyebrow: 'Calendar', title: 'Upcoming editions' },
  past: { eyebrow: 'Results archive', title: 'Recently completed' },
};

const EditionGrid: React.FC<{ editions: DiscoveryEdition[]; today: string }> = ({ editions, today }) => (
  <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
    {editions.map((ed) => <EditionCard key={ed.id} edition={ed} today={today} />)}
  </div>
);

export const EventsDirectoryPage: React.FC<{ data: EventsDirectoryData; filterSport: string }> = ({ data, filterSport }) => {
  const { sports, total, events, eventTotal, editions, previews, counts, when, page, totalPages, today } = data;
  const sportName = sports.find((s) => s.slug === filterSport)?.name;
  const pageHref = (p: number) => eventsHref({ sport: filterSport, when, page: p });

  return (
    <div className="space-y-8">

      <Breadcrumbs items={[{ label: 'Events Directory' }]} />

      <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] p-5 sm:p-8 shadow-sm">
        <span className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-500">
          Championship Institutions
        </span>
        <h1 className="font-serif text-3xl sm:text-4xl font-bold text-stone-900 dark:text-stone-100 mt-1">
          Permanent Events Index
        </h1>
        <p className="mt-2 text-stone-600 dark:text-stone-400 max-w-2xl text-sm sm:text-base">
          Events in SportingSpy are permanent sporting institutions with rich heritage, rather than single-year matches. Select an event to explore its history and annual staging editions.
        </p>

        {/* Sport filter */}
        <nav aria-label="Filter events by sport" className="mt-6 flex flex-wrap gap-2 pt-4 border-t border-stone-100 dark:border-stone-800">
          <Link href={eventsHref({ when })} className={tabClass(filterSport === '')} aria-current={filterSport === '' ? 'true' : undefined}>
            All Sports ({total})
          </Link>
          {sports.map((sp) => (
            <Link key={sp.id} href={eventsHref({ sport: sp.slug, when })} className={tabClass(filterSport === sp.slug)} aria-current={filterSport === sp.slug ? 'true' : undefined}>
              {sp.name}
            </Link>
          ))}
        </nav>

        {/* Timing filter */}
        <nav aria-label="Filter by edition timing" className="mt-3 flex flex-wrap gap-2">
          <Link href={eventsHref({ sport: filterSport })} className={tabClass(!when)} aria-current={!when ? 'true' : undefined}>All events</Link>
          {(['upcoming', 'ongoing', 'past'] as const).map((t) => (
            <Link key={t} href={eventsHref({ sport: filterSport, when: t })} className={tabClass(when === t)} aria-current={when === t ? 'true' : undefined}>
              {TIMING_LABELS[t]} ({counts[t]})
            </Link>
          ))}
        </nav>
      </div>

      {when ? (
        <section aria-labelledby="timing-heading" className="space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-2 border-b border-stone-200 pb-3 dark:border-stone-800">
            <h2 id="timing-heading" className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">
              {TIMING_LABELS[when]} editions{sportName ? ` in ${sportName}` : ''}
            </h2>
            <span className="text-xs text-stone-500 tabular-nums dark:text-stone-400">{counts[when]} {counts[when] === 1 ? 'edition' : 'editions'}</span>
          </div>
          {editions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-stone-300 p-8 text-center dark:border-stone-700">
              <p className="font-semibold text-stone-800 dark:text-stone-200">No {TIMING_LABELS[when].toLowerCase()} editions{sportName ? ` in ${sportName}` : ''} right now.</p>
              <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
                <Link href={eventsHref({ sport: filterSport })} className="font-semibold text-amber-700 hover:underline dark:text-amber-400">Browse all events</Link> or try another filter.
              </p>
            </div>
          ) : <EditionGrid editions={editions} today={today} />}
        </section>
      ) : (
        <>
          {previews && page === 1 && (['ongoing', 'upcoming', 'past'] as const).map((t) => previews[t].length > 0 && (
            <section key={t} aria-labelledby={`${t}-heading`} className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-2 border-b border-stone-200 pb-3 dark:border-stone-800">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700 dark:text-amber-500">{PREVIEW_HEADINGS[t].eyebrow}</p>
                  <h2 id={`${t}-heading`} className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">{PREVIEW_HEADINGS[t].title}</h2>
                </div>
                {counts[t] > previews[t].length && (
                  <Link href={eventsHref({ sport: filterSport, when: t })} className="text-xs font-semibold text-amber-700 hover:underline dark:text-amber-400">
                    See all {counts[t]} <span aria-hidden="true">→</span>
                  </Link>
                )}
              </div>
              <EditionGrid editions={previews[t]} today={today} />
            </section>
          ))}

          <section aria-labelledby="all-events-heading" className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-2 border-b border-stone-200 pb-3 dark:border-stone-800">
              <h2 id="all-events-heading" className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">{sportName ? `${sportName} events` : 'All events'}</h2>
              <span className="text-xs text-stone-500 tabular-nums dark:text-stone-400">{eventTotal} {eventTotal === 1 ? 'event' : 'events'}</span>
            </div>
            {events.length === 0 ? (
              <div className="rounded-xl border border-dashed border-stone-300 p-8 text-center dark:border-stone-700">
                <p className="font-semibold text-stone-800 dark:text-stone-200">No events have been added{filterSport ? ' for this sport' : ''} yet.</p>
                <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">Browse another sport or return as new events are published.</p>
              </div>
            ) : <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {events.map((evt) => (
                <EventCard key={evt.id} event={evt} />
              ))}
            </div>}
          </section>
        </>
      )}

      {totalPages > 1 && (
        <nav aria-label="Pagination" className="flex items-center justify-center gap-2 pt-6 border-t border-stone-200 dark:border-stone-800">
          {page > 1 ? <Link href={pageHref(page - 1)} rel="prev" className={pagerClass}>&larr; Previous</Link> : <span className={`${pagerClass} opacity-40`}>&larr; Previous</span>}
          <span className="text-xs text-stone-500 font-mono px-3 dark:text-stone-400">Page {page} of {totalPages}</span>
          {page < totalPages ? <Link href={pageHref(page + 1)} rel="next" className={pagerClass}>Next &rarr;</Link> : <span className={`${pagerClass} opacity-40`}>Next &rarr;</span>}
        </nav>
      )}
    </div>
  );
};
