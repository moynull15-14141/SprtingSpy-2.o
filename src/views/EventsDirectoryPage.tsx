/**
 * SportingSpy Permanent Events Directory
 * URL: /events
 * Catalog of permanent world championship sporting events.
 */

import React from 'react';
import Link from 'next/link';
import { Breadcrumbs } from '../components/ui/Breadcrumbs';
import { EventCard } from '../components/editorial/EventCard';
import type { getEventsDirectory } from '../../server/services/public/content';

type EventsDirectoryData = Awaited<ReturnType<typeof getEventsDirectory>>;

// The sport filter is a plain link (?sport=), rendered on the server.
export const EventsDirectoryPage: React.FC<{ data: EventsDirectoryData; filterSport: string }> = ({ data, filterSport }) => {
  const { sports, total, events: filteredEvents } = data;

  return (
    <div className="space-y-8">

      <Breadcrumbs items={[{ label: 'Events Directory' }]} />

      <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] p-8 shadow-sm">
        <span className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-500">
          Championship Institutions
        </span>
        <h1 className="font-serif text-3xl sm:text-4xl font-bold text-stone-900 dark:text-stone-100 mt-1">
          Permanent Events Index
        </h1>
        <p className="mt-2 text-stone-600 dark:text-stone-400 max-w-2xl text-sm sm:text-base">
          Events in SportingSpy are permanent sporting institutions with rich heritage, rather than single-year matches. Select an event to explore its history and annual staging editions.
        </p>

        {/* Filter Tabs */}
        <div className="mt-6 flex flex-wrap gap-2 pt-4 border-t border-stone-100 dark:border-stone-800">
          <Link
            href="/events/"
            className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
              filterSport === ''
                ? 'bg-amber-700 text-white font-semibold'
                : 'bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-200'
            }`}
          >
            All Sports ({total})
          </Link>
          {sports
            .map((sp) => (
              <Link
                key={sp.id}
                href={`/events/?sport=${sp.slug}`}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                  filterSport === sp.slug
                    ? 'bg-amber-700 text-white font-semibold'
                    : 'bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-200'
                }`}
              >
                {sp.name}
              </Link>
            ))}
        </div>
      </div>

      <h2 className="sr-only">Events</h2>
      {filteredEvents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-300 p-8 text-center dark:border-stone-700">
          <p className="font-semibold text-stone-800 dark:text-stone-200">No events have been added{filterSport ? ' for this sport' : ''} yet.</p>
          <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">Browse another sport or return as new events are published.</p>
        </div>
      ) : <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredEvents.map((evt) => (
          <EventCard key={evt.id} event={evt} />
        ))}
      </div>}
    </div>
  );
};
