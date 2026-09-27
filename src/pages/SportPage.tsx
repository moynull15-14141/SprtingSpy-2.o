/**
 * SportingSpy Sport Hub Page
 * Topic hub supporting:
 * - H1 and introduction
 * - Featured & upcoming events
 * - Latest articles
 * - Guides / general information (articles belonging directly to the sport without event/edition)
 * - Breadcrumbs & Schema.org structure
 */

import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { SeoHead } from '../components/layout/SeoHead';
import { Breadcrumbs } from '../components/ui/Breadcrumbs';
import { ArticleCard } from '../components/editorial/ArticleCard';
import { EventCard } from '../components/editorial/EventCard';
import { AdSlot } from '../components/ui/AdSlot';

interface SportPageProps {
  sportSlug: string;
}

export const SportPage: React.FC<SportPageProps> = ({ sportSlug }) => {
  const { sports, events, articles, editions, navigate } = useApp();
  const [activeTab, setActiveTab] = useState<'all' | 'articles' | 'events' | 'guides'>('all');

  const sport = sports.find((s) => s.slug === sportSlug);

  if (!sport) {
    return (
      <div className="py-16 text-center">
        <h1 className="font-serif text-3xl font-bold">Sport Not Found</h1>
        <p className="mt-2 text-stone-500">The sport discipline "/{sportSlug}" could not be located in our index.</p>
        <button
          onClick={() => navigate('/sports')}
          className="mt-6 px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-semibold"
        >
          View Sports Directory
        </button>
      </div>
    );
  }

  const sportEvents = events.filter((e) => e.sportSlug === sport.slug && e.isVisible);
  const sportArticles = articles.filter((a) => a.sportSlug === sport.slug && a.status === 'published');
  // General articles belonging directly to sport (no event/edition)
  const generalGuides = sportArticles.filter((a) => !a.eventSlug);
  const eventArticles = sportArticles.filter((a) => !!a.eventSlug);
  const sportEditions = editions.filter((ed) => ed.sportSlug === sport.slug);

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'SportsSpecialty',
    name: sport.name,
    description: sport.description,
    url: `https://sportingspy.com/${sport.slug}`,
  };

  return (
    <div className="space-y-10">
      <SeoHead
        title={sport.seo.metaTitle || `${sport.name} Guides, Tournament Schedules & Records | SportingSpy`}
        description={sport.seo.metaDescription || sport.description}
        canonicalPath={`/${sport.slug}`}
        structuredData={structuredData}
      />

      <Breadcrumbs items={[{ label: sport.name, url: `/${sport.slug}` }]} />

      {/* Sport Hub Hero Banner */}
      <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] p-8 lg:p-10 shadow-sm">
        <div className="max-w-3xl">
          <div className="text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-500 mb-2">
            Discipline Hub
          </div>
          <h1 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold text-stone-900 dark:text-stone-100 leading-tight">
            {sport.name}
          </h1>
          <p className="mt-2 text-lg font-serif italic text-stone-600 dark:text-stone-400">
            {sport.tagline}
          </p>
          <p className="mt-4 text-sm sm:text-base text-stone-700 dark:text-stone-300 leading-relaxed">
            {sport.description}
          </p>
        </div>

        {/* Quick Hub Filter Bar */}
        <div className="mt-8 pt-6 border-t border-stone-100 dark:border-stone-800/80 flex flex-wrap gap-2">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              activeTab === 'all'
                ? 'bg-amber-600 text-white font-semibold'
                : 'bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-200'
            }`}
          >
            All Content ({sportArticles.length + sportEvents.length})
          </button>
          <button
            onClick={() => setActiveTab('events')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              activeTab === 'events'
                ? 'bg-amber-600 text-white font-semibold'
                : 'bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-200'
            }`}
          >
            Permanent Events ({sportEvents.length})
          </button>
          <button
            onClick={() => setActiveTab('articles')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              activeTab === 'articles'
                ? 'bg-amber-600 text-white font-semibold'
                : 'bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-200'
            }`}
          >
            Tournament Articles ({eventArticles.length})
          </button>
          <button
            onClick={() => setActiveTab('guides')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              activeTab === 'guides'
                ? 'bg-amber-600 text-white font-semibold'
                : 'bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-200'
            }`}
          >
            General Guides & Scoring ({generalGuides.length})
          </button>
        </div>
      </div>

      <AdSlot id="EVENT_TOP" />

      {/* PERMANENT EVENTS IN THIS SPORT */}
      {(activeTab === 'all' || activeTab === 'events') && (
        <section aria-labelledby="sport-events-heading">
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-stone-200 dark:border-stone-800">
            <h2 id="sport-events-heading" className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">
              Championship Events in {sport.name}
            </h2>
            <span className="text-xs text-stone-500 tabular-nums">{sportEvents.length} Events</span>
          </div>

          {sportEvents.length === 0 ? (
            <p className="text-xs text-stone-500 italic py-4">No events registered for this sport yet.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {sportEvents.map((evt) => (
                <EventCard key={evt.id} event={evt} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* LATEST ARTICLES & GUIDES */}
      {(activeTab === 'all' || activeTab === 'articles') && (
        <section aria-labelledby="sport-articles-heading">
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-stone-200 dark:border-stone-800">
            <h2 id="sport-articles-heading" className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">
              Latest {sport.name} Editorial & Schedules
            </h2>
            <span className="text-xs text-stone-500 tabular-nums">{sportArticles.length} Articles</span>
          </div>

          {sportArticles.length === 0 ? (
            <p className="text-xs text-stone-500 italic py-4">No articles published under this sport yet.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {sportArticles.map((art) => (
                <ArticleCard key={art.id} article={art} variant="standard" />
              ))}
            </div>
          )}
        </section>
      )}

      {/* GENERAL GUIDES & RULES (BELONG DIRECTLY TO SPORT) */}
      {(activeTab === 'all' || activeTab === 'guides') && generalGuides.length > 0 && (
        <section aria-labelledby="general-guides-heading" className="rounded-xl bg-amber-50/50 dark:bg-amber-950/20 p-6 border border-amber-200/60 dark:border-amber-900/40">
          <div className="mb-4">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
              Foundational Knowledge
            </span>
            <h2 id="general-guides-heading" className="font-serif text-xl font-bold text-stone-900 dark:text-stone-100">
              {sport.name} Rules, Scoring & Format Guides
            </h2>
            <p className="text-xs text-stone-600 dark:text-stone-400 mt-1">
              General articles explaining fundamental sporting rules, regulations, and formats independent of individual tournament editions.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {generalGuides.map((guide) => (
              <div
                key={guide.id}
                onClick={() => navigate(`/${sport.slug}/${guide.slug}`)}
                className="p-4 rounded-lg bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 hover:border-amber-500 transition-colors cursor-pointer"
              >
                <div className="text-xs text-amber-700 dark:text-amber-400 font-semibold mb-1">
                  {guide.articleType}
                </div>
                <h3 className="font-serif text-base font-bold text-stone-900 dark:text-stone-100 leading-snug">
                  {guide.title}
                </h3>
                <p className="mt-1 text-xs text-stone-600 dark:text-stone-400 line-clamp-2">
                  {guide.excerpt}
                </p>
                <div className="mt-3 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                  Read Full Guide &rarr;
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* UPCOMING EDITIONS IN THIS SPORT */}
      {sportEditions.length > 0 && (
        <section aria-labelledby="sport-editions-heading">
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-stone-200 dark:border-stone-800">
            <h2 id="sport-editions-heading" className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">
              Active & Upcoming Staging
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {sportEditions.map((ed) => (
              <div
                key={ed.id}
                onClick={() => navigate(`/${sport.slug}/${ed.eventSlug}/${ed.year}`)}
                className="p-4 rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] hover:shadow-sm transition-all cursor-pointer flex justify-between items-center"
              >
                <div>
                  <h4 className="font-serif text-base font-bold text-stone-900 dark:text-stone-100">
                    {ed.title}
                  </h4>
                  <p className="text-xs text-stone-500 tabular-nums">
                    {ed.startDate} to {ed.endDate} · {ed.venue}
                  </p>
                </div>
                <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 whitespace-nowrap ml-4">
                  View Dossier &rarr;
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
