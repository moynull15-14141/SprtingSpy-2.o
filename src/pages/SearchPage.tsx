/**
 * SportingSpy Unified Search & Reference Engine
 * Searches across:
 * - Articles (title, subtitle, content, excerpt)
 * - Sports
 * - Events & alternative event names (e.g. Roland-Garros for French Open)
 * - Event Editions
 * - Article Types (Schedules, Viewing Guides, Rules, Prize Money)
 */

import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { SeoHead } from '../components/layout/SeoHead';
import { Breadcrumbs } from '../components/ui/Breadcrumbs';
import { ArticleCard } from '../components/editorial/ArticleCard';
import { EventCard } from '../components/editorial/EventCard';
import { ArticleType } from '../types';

export const SearchPage: React.FC = () => {
  const { sports, events, editions, articles, navigate, searchQuery, setSearchQuery } = useApp();
  const [selectedSport, setSelectedSport] = useState<string>('');
  const [selectedType, setSelectedType] = useState<string>('');

  const ARTICLE_TYPES: ArticleType[] = [
    'Schedule',
    'Sports Viewing Guide',
    'Prize Money',
    'Rules & Format',
    'Analysis',
    'Event Guide',
    'Results',
    'Preview',
    'Past Winners',
    'Records',
  ];

  const searchResults = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    // 1. Matched Sports
    const matchedSports = q
      ? sports.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
      : [];

    // 2. Matched Events (including alternative names like Roland-Garros, Monte Carlo)
    const matchedEvents = events.filter((e) => {
      const matchesText =
        !q ||
        e.name.toLowerCase().includes(q) ||
        e.shortName.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.defaultVenue.toLowerCase().includes(q);
      const matchesSport = !selectedSport || e.sportSlug === selectedSport;
      return matchesText && matchesSport;
    });

    // 3. Matched Editions
    const matchedEditions = editions.filter((ed) => {
      const matchesText =
        !q ||
        ed.title.toLowerCase().includes(q) ||
        ed.year.toString().includes(q) ||
        ed.venue.toLowerCase().includes(q);
      const matchesSport = !selectedSport || ed.sportSlug === selectedSport;
      return matchesText && matchesSport;
    });

    // 4. Matched Articles
    const matchedArticles = articles.filter((a) => {
      if (a.status !== 'published') return false;
      const matchesText =
        !q ||
        a.title.toLowerCase().includes(q) ||
        (a.subtitle && a.subtitle.toLowerCase().includes(q)) ||
        a.excerpt.toLowerCase().includes(q) ||
        a.content.toLowerCase().includes(q);
      const matchesSport = !selectedSport || a.sportSlug === selectedSport;
      const matchesType = !selectedType || a.articleType === selectedType;
      return matchesText && matchesSport && matchesType;
    });

    return {
      sports: matchedSports,
      events: matchedEvents,
      editions: matchedEditions,
      articles: matchedArticles,
      totalCount: matchedArticles.length + matchedEvents.length + matchedEditions.length + matchedSports.length,
    };
  }, [searchQuery, selectedSport, selectedType, sports, events, editions, articles]);

  return (
    <div className="space-y-8">
      <SeoHead
        title="Search Sports Intelligence, Events & Schedules | SportingSpy"
        description="Search across our comprehensive database of sports, grand slam events, yearly editions, schedules, prize money, and rules."
        canonicalPath="/search"
      />

      <Breadcrumbs items={[{ label: 'Search' }]} />

      <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] p-6 sm:p-8 shadow-sm">
        <h1 className="font-serif text-3xl font-bold text-stone-900 dark:text-stone-100">
          Sports Intelligence Search
        </h1>
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
          Query tournament dossiers, session timetables, prize purses, and technical guides.
        </p>

        {/* Search Input */}
        <div className="mt-6 relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by tournament (e.g. Roland Garros, Monaco GP), sport, rule, or author..."
            className="w-full text-base sm:text-lg pl-12 pr-4 py-3.5 rounded-xl border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-500 shadow-inner"
            autoFocus
          />
          <svg
            className="w-6 h-6 text-stone-400 absolute left-4 top-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-4 top-4 text-xs text-stone-400 hover:text-stone-600 dark:hover:text-stone-200"
            >
              Clear
            </button>
          )}
        </div>

        {/* Filter Controls */}
        <div className="mt-4 flex flex-wrap items-center gap-3 pt-3 border-t border-stone-100 dark:border-stone-800">
          <div className="flex items-center gap-2">
            <span className="text-xs text-stone-500 font-medium">Discipline:</span>
            <select
              value={selectedSport}
              onChange={(e) => setSelectedSport(e.target.value)}
              className="text-xs py-1.5 px-3 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-200 focus:outline-none focus:ring-1 focus:ring-amber-500"
            >
              <option value="">All Disciplines</option>
              {sports.map((s) => (
                <option key={s.id} value={s.slug}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-stone-500 font-medium">Article Type:</span>
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="text-xs py-1.5 px-3 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-200 focus:outline-none focus:ring-1 focus:ring-amber-500"
            >
              <option value="">All Types</option>
              {ARTICLE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          {(selectedSport || selectedType) && (
            <button
              onClick={() => {
                setSelectedSport('');
                setSelectedType('');
              }}
              className="text-xs text-amber-600 dark:text-amber-400 font-semibold hover:underline cursor-pointer"
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* RESULTS DISPLAY */}
      <div className="space-y-10">
        {/* Matched Sports */}
        {searchResults.sports.length > 0 && (
          <section>
            <h2 className="text-xs uppercase font-bold tracking-wider text-amber-600 dark:text-amber-500 mb-3">
              Matched Sports Disciplines ({searchResults.sports.length})
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {searchResults.sports.map((sp) => (
                <div
                  key={sp.id}
                  onClick={() => navigate(`/${sp.slug}`)}
                  className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] hover:border-amber-500 transition-colors cursor-pointer"
                >
                  <h3 className="font-serif text-lg font-bold text-stone-900 dark:text-stone-100">{sp.name}</h3>
                  <p className="mt-1 text-xs text-stone-500 line-clamp-2">{sp.description}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Matched Permanent Events */}
        {searchResults.events.length > 0 && (
          <section>
            <h2 className="text-xs uppercase font-bold tracking-wider text-amber-600 dark:text-amber-500 mb-3">
              Championship Events ({searchResults.events.length})
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {searchResults.events.map((evt) => (
                <EventCard key={evt.id} event={evt} />
              ))}
            </div>
          </section>
        )}

        {/* Matched Articles */}
        <section>
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-stone-200 dark:border-stone-800">
            <h2 className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">
              Articles & Guides ({searchResults.articles.length})
            </h2>
            <span className="text-xs text-stone-500 tabular-nums">
              {searchResults.totalCount} Total matches
            </span>
          </div>

          {searchResults.articles.length === 0 ? (
            <div className="p-8 text-center rounded-xl bg-stone-100/60 dark:bg-stone-900/40 border border-stone-200 dark:border-stone-800">
              <p className="text-sm text-stone-600 dark:text-stone-400">
                No articles matched your criteria. Try widening your search terms or clearing filters.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {searchResults.articles.map((art) => (
                <ArticleCard key={art.id} article={art} variant="standard" />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
