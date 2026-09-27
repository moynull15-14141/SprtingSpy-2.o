/**
 * SportingSpy Latest Articles Page
 * URL: /latest
 * Chronological editorial wire of all published sports analysis, schedules, and guides.
 */

import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { SeoHead } from '../components/layout/SeoHead';
import { Breadcrumbs } from '../components/ui/Breadcrumbs';
import { ArticleCard } from '../components/editorial/ArticleCard';
import { ArticleType } from '../types';

export const LatestArticlesPage: React.FC = () => {
  const { articles, sports } = useApp();
  const [selectedSport, setSelectedSport] = useState<string>('');
  const [selectedType, setSelectedType] = useState<string>('');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const PAGE_SIZE = 6;

  const published = articles.filter((a) => a.status === 'published');

  const filteredArticles = published.filter((a) => {
    if (selectedSport && a.sportSlug !== selectedSport) return false;
    if (selectedType && a.articleType !== selectedType) return false;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filteredArticles.length / PAGE_SIZE));
  const paginatedArticles = filteredArticles.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  const ARTICLE_TYPES: ArticleType[] = [
    'Schedule',
    'Sports Viewing Guide',
    'Prize Money',
    'Rules & Format',
    'Analysis',
    'Event Guide',
    'Results',
    'Preview',
  ];

  return (
    <div className="space-y-8">
      <SeoHead
        title="Latest Sports Editorial, Schedules & Analysis | SportingSpy"
        description="Freshly published tournament schedules, broadcast channel guides, prize money data, and technical sports analysis."
        canonicalPath="/latest"
      />

      <Breadcrumbs items={[{ label: 'Latest Articles' }]} />

      <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] p-8 shadow-sm">
        <span className="text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-500">
          Editorial Wire
        </span>
        <h1 className="font-serif text-3xl sm:text-4xl font-bold text-stone-900 dark:text-stone-100 mt-1">
          Latest Sports Journalism
        </h1>
        <p className="mt-2 text-stone-600 dark:text-stone-400 max-w-2xl text-sm sm:text-base">
          Chronological record of verified sports dossiers, tournament timetables, purse records, and tactical explanations.
        </p>

        {/* Filters */}
        <div className="mt-6 flex flex-wrap items-center gap-3 pt-4 border-t border-stone-100 dark:border-stone-800">
          <select
            value={selectedSport}
            onChange={(e) => setSelectedSport(e.target.value)}
            className="text-xs py-1.5 px-3 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-200 focus:outline-none focus:ring-1 focus:ring-amber-500"
          >
            <option value="">All Disciplines ({published.length})</option>
            {sports.map((s) => (
              <option key={s.id} value={s.slug}>
                {s.name}
              </option>
            ))}
          </select>

          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="text-xs py-1.5 px-3 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-200 focus:outline-none focus:ring-1 focus:ring-amber-500"
          >
            <option value="">All Article Formats</option>
            {ARTICLE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          {(selectedSport || selectedType) && (
            <button
              onClick={() => {
                setSelectedSport('');
                setSelectedType('');
              }}
              className="text-xs text-amber-600 dark:text-amber-400 font-semibold hover:underline"
            >
              Clear Filters
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {paginatedArticles.map((art) => (
          <ArticleCard key={art.id} article={art} variant="standard" />
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-6 border-t border-stone-200 dark:border-stone-800">
          <button
            disabled={currentPage === 1}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            className="px-3 py-1.5 rounded-lg border border-stone-300 dark:border-stone-700 text-xs font-semibold disabled:opacity-40 cursor-pointer"
          >
            &larr; Previous
          </button>
          <span className="text-xs text-stone-500 font-mono px-3">
            Page {currentPage} of {totalPages}
          </span>
          <button
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            className="px-3 py-1.5 rounded-lg border border-stone-300 dark:border-stone-700 text-xs font-semibold disabled:opacity-40 cursor-pointer"
          >
            Next &rarr;
          </button>
        </div>
      )}
    </div>
  );
};
