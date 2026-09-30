/**
 * SportingSpy All Sports Directory
 * URL: /sports
 * Comprehensive catalog of all sporting disciplines covered.
 */

import React from 'react';
import Link from 'next/link';
import { Breadcrumbs } from '../components/ui/Breadcrumbs';
import type { getSportsDirectory } from '../../server/services/public/content';
import { SportIcon } from '../components/ui/SportIcon';

type SportsDirectoryData = Awaited<ReturnType<typeof getSportsDirectory>>;

export const SportsDirectoryPage: React.FC<{ sports: SportsDirectoryData }> = ({ sports }) => {
  return (
    <div className="space-y-8">

      <Breadcrumbs items={[{ label: 'Sports Directory' }]} />

      <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] p-8 shadow-sm">
        <span className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-500">
          Global Athletic Disciplines
        </span>
        <h1 className="font-serif text-3xl sm:text-4xl font-bold text-stone-900 dark:text-stone-100 mt-1">
          Sports Directory
        </h1>
        <p className="mt-2 text-stone-600 dark:text-stone-400 max-w-2xl text-sm sm:text-base">
          Structured tournament coverage across {sports.length} {sports.length === 1 ? 'sport' : 'sports'}. Each hub collects its events, yearly editions and rules &amp; scoring guides as coverage grows.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {sports.map((sport) => {
          return (
            <Link
              key={sport.id}
              href={`/${sport.slug}/`}
              className="group p-6 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] hover:border-amber-500/80 hover:shadow-md transition-all cursor-pointer flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between text-xs text-stone-500 mb-3 dark:text-stone-400">
                  <SportIcon slug={sport.slug} name={sport.name} icon={sport.icon} size="lg" />
                  <span className="tabular-nums font-mono text-[11px] text-stone-600 dark:text-stone-300 bg-stone-100 dark:bg-stone-800 px-2 py-0.5 rounded">
                    {sport.eventCount} {sport.eventCount === 1 ? 'Event' : 'Events'}
                  </span>
                </div>

                <h2 className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">
                  {sport.name}
                </h2>

                <p className="mt-1 text-xs font-serif italic text-stone-500 dark:text-stone-400">
                  {sport.tagline}
                </p>

                <p className="mt-3 text-xs text-stone-600 dark:text-stone-400 line-clamp-3 leading-relaxed">
                  {sport.description}
                </p>
              </div>

              <div className="mt-6 pt-4 border-t border-stone-100 dark:border-stone-800/80 flex items-center justify-between text-xs">
                <span className="text-stone-500 dark:text-stone-400">{sport.articleCount} Editorial Articles</span>
                <span className="font-semibold text-amber-700 dark:text-amber-400 group-hover:translate-x-1 transition-transform">
                  Enter Hub &rarr;
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
};
