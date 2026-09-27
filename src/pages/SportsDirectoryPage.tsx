/**
 * SportingSpy All Sports Directory
 * URL: /sports
 * Comprehensive catalog of all sporting disciplines covered.
 */

import React from 'react';
import { useApp } from '../context/AppContext';
import { SeoHead } from '../components/layout/SeoHead';
import { Breadcrumbs } from '../components/ui/Breadcrumbs';

export const SportsDirectoryPage: React.FC = () => {
  const { sports, events, articles, navigate } = useApp();

  return (
    <div className="space-y-8">
      <SeoHead
        title="All Sports Covered – Multi-Sport Directory | SportingSpy"
        description="Browse the complete catalog of sports covered by SportingSpy, from Tennis and Motorsport to Golf, Rugby, Football, and Athletics."
        canonicalPath="/sports"
      />

      <Breadcrumbs items={[{ label: 'Sports Directory' }]} />

      <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] p-8 shadow-sm">
        <span className="text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-500">
          Global Athletic Disciplines
        </span>
        <h1 className="font-serif text-3xl sm:text-4xl font-bold text-stone-900 dark:text-stone-100 mt-1">
          Sports Directory
        </h1>
        <p className="mt-2 text-stone-600 dark:text-stone-400 max-w-2xl text-sm sm:text-base">
          SportingSpy provides structured tournament intelligence across 12 permanent sports disciplines. Each hub maintains official event records, yearly staging editions, and regulatory scoring guides.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {sports.map((sport) => {
          const sportEvents = events.filter((e) => e.sportSlug === sport.slug && e.isVisible);
          const sportArticles = articles.filter((a) => a.sportSlug === sport.slug && a.status === 'published');

          return (
            <div
              key={sport.id}
              onClick={() => navigate(`/${sport.slug}`)}
              className="group p-6 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] hover:border-amber-500/80 hover:shadow-md transition-all cursor-pointer flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between text-xs text-stone-400 mb-2">
                  <span className="font-mono text-amber-700 dark:text-amber-400 font-semibold">
                    /{sport.slug}
                  </span>
                  <span className="tabular-nums font-mono text-[11px] bg-stone-100 dark:bg-stone-800 px-2 py-0.5 rounded">
                    {sportEvents.length} Events
                  </span>
                </div>

                <h2 className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">
                  {sport.name}
                </h2>

                <p className="mt-1 text-xs font-serif italic text-stone-500">
                  {sport.tagline}
                </p>

                <p className="mt-3 text-xs text-stone-600 dark:text-stone-400 line-clamp-3 leading-relaxed">
                  {sport.description}
                </p>
              </div>

              <div className="mt-6 pt-4 border-t border-stone-100 dark:border-stone-800/80 flex items-center justify-between text-xs">
                <span className="text-stone-500">{sportArticles.length} Editorial Articles</span>
                <span className="font-semibold text-amber-600 dark:text-amber-400 group-hover:translate-x-1 transition-transform">
                  Enter Hub &rarr;
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
