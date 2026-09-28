/**
 * SportingSpy Latest Articles Page
 * URL: /latest/
 * Chronological editorial wire of all published sports analysis, schedules, and guides.
 * PHASE B: filters and pagination are URL query parameters handled on the
 * server (?sport=, ?type=, ?page=); only the requested page is queried.
 */

import React from 'react';
import Link from 'next/link';
import { Breadcrumbs } from '../components/ui/Breadcrumbs';
import { ArticleCard } from '../components/editorial/ArticleCard';
import { FilterSelect } from '../components/ui/FilterSelect';
import { ArticleType } from '../types';
import type { getLatest } from '../../server/services/public/content';

type LatestData = Awaited<ReturnType<typeof getLatest>>;

export const LATEST_FILTER_TYPES: ArticleType[] = [
  'Schedule',
  'How to Watch',
  'Prize Money',
  'Rules & Format',
  'Analysis',
  'Event Guide',
  'Results',
  'Preview',
];

const selectClass =
  'text-xs py-1.5 px-3 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-200 focus:outline-none focus:ring-1 focus:ring-amber-500';
const pagerClass = 'px-3 py-1.5 rounded-lg border border-stone-300 dark:border-stone-700 text-xs font-semibold cursor-pointer';

export const LatestArticlesPage: React.FC<{ data: LatestData; selectedSport: string; selectedType: string; currentPage: number }> = ({
  data,
  selectedSport,
  selectedType,
  currentPage,
}) => {
  const { articles: paginatedArticles, sports, allPublished, totalPages } = data;
  const pageHref = (page: number) => {
    const query = new URLSearchParams();
    if (selectedSport) query.set('sport', selectedSport);
    if (selectedType) query.set('type', selectedType);
    if (page > 1) query.set('page', String(page));
    const qs = query.toString();
    return `/latest/${qs ? `?${qs}` : ''}`;
  };

  return (
    <div className="space-y-8">
      <Breadcrumbs items={[{ label: 'Latest Articles' }]} />

      <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] p-8 shadow-sm">
        <span className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-500">Editorial Wire</span>
        <h1 className="font-serif text-3xl sm:text-4xl font-bold text-stone-900 dark:text-stone-100 mt-1">Latest Sports Journalism</h1>
        <p className="mt-2 text-stone-600 dark:text-stone-400 max-w-2xl text-sm sm:text-base">
          Chronological record of verified sports dossiers, tournament timetables, purse records, and tactical explanations.
        </p>

        {/* Filters */}
        <div className="mt-6 flex flex-wrap items-center gap-3 pt-4 border-t border-stone-100 dark:border-stone-800">
          <FilterSelect param="sport" value={selectedSport} className={selectClass} label="Filter by sport">
            <option value="">All Disciplines ({allPublished})</option>
            {sports.map((s) => (
              <option key={s.id} value={s.slug}>
                {s.name}
              </option>
            ))}
          </FilterSelect>

          <FilterSelect param="type" value={selectedType} className={selectClass} label="Filter by article type">
            <option value="">All Article Formats</option>
            {LATEST_FILTER_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </FilterSelect>

          {(selectedSport || selectedType) && (
            <Link href="/latest/" className="text-xs text-amber-700 dark:text-amber-400 font-semibold hover:underline">
              Clear Filters
            </Link>
          )}
        </div>
      </div>

      <h2 className="sr-only">Articles</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {paginatedArticles.map((art) => (
          <ArticleCard key={art.id} article={art} variant="standard" />
        ))}
      </div>

      {totalPages > 1 && (
        <nav aria-label="Pagination" className="flex items-center justify-center gap-2 pt-6 border-t border-stone-200 dark:border-stone-800">
          {currentPage > 1 ? (
            <Link href={pageHref(currentPage - 1)} rel="prev" className={pagerClass}>&larr; Previous</Link>
          ) : (
            <span className={`${pagerClass} opacity-40`}>&larr; Previous</span>
          )}
          <span className="text-xs text-stone-500 font-mono px-3 dark:text-stone-400">
            Page {currentPage} of {totalPages}
          </span>
          {currentPage < totalPages ? (
            <Link href={pageHref(currentPage + 1)} rel="next" className={pagerClass}>Next &rarr;</Link>
          ) : (
            <span className={`${pagerClass} opacity-40`}>Next &rarr;</span>
          )}
        </nav>
      )}
    </div>
  );
};
