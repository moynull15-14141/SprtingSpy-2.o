/**
 * SportingSpy Permanent Events Directory
 * URL: /events
 * Catalog of permanent world championship sporting events.
 */

import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { SeoHead } from '../components/layout/SeoHead';
import { Breadcrumbs } from '../components/ui/Breadcrumbs';
import { EventCard } from '../components/editorial/EventCard';

export const EventsDirectoryPage: React.FC = () => {
  const { events, sports } = useApp();
  const [filterSport, setFilterSport] = useState<string>('');

  const filteredEvents = events.filter((e) => {
    if (!e.isVisible) return false;
    if (filterSport && e.sportSlug !== filterSport) return false;
    return true;
  });

  return (
    <div className="space-y-8">
      <SeoHead
        title="Permanent Sporting Events & Championships | SportingSpy"
        description="Comprehensive index of global sports championships, Grand Slams, endurance races, and major tournaments."
        canonicalPath="/events"
      />

      <Breadcrumbs items={[{ label: 'Events Directory' }]} />

      <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] p-8 shadow-sm">
        <span className="text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-500">
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
          <button
            onClick={() => setFilterSport('')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
              filterSport === ''
                ? 'bg-amber-600 text-white font-semibold'
                : 'bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-200'
            }`}
          >
            All Sports ({events.length})
          </button>
          {sports
            .filter((s) => events.some((e) => e.sportSlug === s.slug))
            .map((sp) => (
              <button
                key={sp.id}
                onClick={() => setFilterSport(sp.slug)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                  filterSport === sp.slug
                    ? 'bg-amber-600 text-white font-semibold'
                    : 'bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-200'
                }`}
              >
                {sp.name}
              </button>
            ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredEvents.map((evt) => (
          <EventCard key={evt.id} event={evt} />
        ))}
      </div>
    </div>
  );
};
