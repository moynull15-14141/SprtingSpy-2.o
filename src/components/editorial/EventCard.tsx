/**
 * SportingSpy Permanent Event Card
 * Represents an iconic sporting event (French Open, The Masters, Monaco GP).
 * Links to permanent event hub and latest active edition.
 */

import React from 'react';
import { useApp } from '../../context/AppContext';
import { SportEvent } from '../../types';

interface EventCardProps {
  event: SportEvent;
  className?: string;
}

export const EventCard: React.FC<EventCardProps> = ({ event, className = '' }) => {
  const { navigate, sports, editions } = useApp();
  const sport = sports.find((s) => s.slug === event.sportSlug);
  const latestEdition = editions.find(
    (ed) => ed.eventSlug === event.slug && ed.year === event.currentEditionYear
  );

  return (
    <div
      className={`group rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between ${className}`}
    >
      <div>
        <div className="flex items-center justify-between text-xs text-stone-500 dark:text-stone-400 mb-2">
          <span className="font-semibold text-amber-700 dark:text-amber-500 uppercase tracking-wider">
            {sport?.name}
          </span>
          <span className="tabular-nums font-mono text-[11px] bg-stone-100 dark:bg-stone-800 px-2 py-0.5 rounded text-stone-700 dark:text-stone-300">
            {event.currentEditionYear} Edition Active
          </span>
        </div>

        <h3
          onClick={() => navigate(`/${event.sportSlug}/${event.slug}`)}
          className="font-serif text-xl font-bold text-stone-900 dark:text-stone-100 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors cursor-pointer"
        >
          {event.name}
        </h3>

        <p className="mt-2 text-xs text-stone-600 dark:text-stone-400 line-clamp-2 leading-relaxed">
          {event.description}
        </p>

        <div className="mt-4 pt-3 border-t border-stone-100 dark:border-stone-800/80 space-y-1 text-xs text-stone-600 dark:text-stone-400">
          <div className="flex items-center justify-between">
            <span className="text-stone-400">Permanent Venue:</span>
            <span className="font-medium text-stone-800 dark:text-stone-200 truncate max-w-[200px]">{event.defaultVenue}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-stone-400">Location:</span>
            <span className="font-medium text-stone-800 dark:text-stone-200">{event.defaultLocation}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-stone-400">Cadence:</span>
            <span className="font-medium text-stone-800 dark:text-stone-200">{event.frequency}</span>
          </div>
        </div>
      </div>

      <div className="mt-5 pt-3 border-t border-stone-100 dark:border-stone-800/80 flex items-center justify-between gap-2">
        <button
          onClick={() => navigate(`/${event.sportSlug}/${event.slug}`)}
          className="text-xs font-semibold text-stone-700 dark:text-stone-300 hover:text-amber-600 dark:hover:text-amber-400 transition-colors cursor-pointer"
        >
          Event History &rarr;
        </button>

        {latestEdition && (
          <button
            onClick={() => navigate(`/${event.sportSlug}/${event.slug}/${latestEdition.year}`)}
            className="text-xs font-semibold text-amber-600 dark:text-amber-400 hover:underline cursor-pointer"
          >
            {latestEdition.year} Guide &rarr;
          </button>
        )}
      </div>
    </div>
  );
};
