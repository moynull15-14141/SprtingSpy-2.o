/**
 * SportingSpy Homepage
 * Prioritizes:
 * 1. Latest Articles (Lead Story + Featured Grid + Archive List)
 * 2. Featured / Important Events
 * 3. Sports Discovery (Multi-sport architecture)
 * 4. Upcoming Event Editions & Guides
 */

import React from 'react';
import { useApp } from '../context/AppContext';
import { SeoHead } from '../components/layout/SeoHead';
import { ArticleCard } from '../components/editorial/ArticleCard';
import { EventCard } from '../components/editorial/EventCard';
import { AdSlot } from '../components/ui/AdSlot';
import { BRANDING } from '../config/branding';

export const HomePage: React.FC = () => {
  const { articles, events, sports, editions, navigate } = useApp();

  const publishedArticles = articles.filter((a) => a.status === 'published');
  const leadArticle = publishedArticles[0];
  const secondaryArticles = publishedArticles.slice(1, 4);
  const compactArticles = publishedArticles.slice(4, 8);

  const featuredEvents = events.filter((e) => e.featured && e.isVisible);
  const upcomingEditions = editions.filter((ed) => ed.status === 'upcoming').slice(0, 3);

  // Schema.org Organization + WebSite structured data
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'SportsOrganization',
    name: BRANDING.name,
    url: `https://${BRANDING.domain}`,
    description: BRANDING.description,
    founder: {
      '@type': 'Organization',
      name: 'SportingSpy Editorial Bureau',
    },
  };

  return (
    <div className="space-y-12">
      <SeoHead
        title="SportingSpy – The Multi-Sport Intelligence & Editorial Platform"
        description="Authoritative multi-sport information, Grand Slam tournament schedules, Formula 1 circuit telemetry, Golf major purse allocations, and structured sports reference."
        canonicalPath="/"
        structuredData={structuredData}
      />

      {/* Optional Top Ad Slot */}
      <AdSlot id="HOMEPAGE_TOP" />

      {/* Editorial Hero Intro Banner */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-stone-900 via-stone-950 to-stone-900 text-stone-100 p-8 sm:p-12 border border-stone-800 shadow-xl">
        <div className="relative z-10 max-w-3xl">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-amber-500 mb-3">
            <span>Multi-Sport Intelligence Hub</span>
            <span className="text-stone-600">·</span>
            <span className="text-stone-400">Archival & Current Staging</span>
          </div>
          <h1 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-white leading-tight">
            Authoritative sporting guides, verified schedules, and championship editions.
          </h1>
          <p className="mt-4 text-base sm:text-lg text-stone-300 leading-relaxed max-w-2xl font-sans">
            Independent, data-verified sports journalism across 12 core athletic disciplines. No automated clickbait—only structured tournament dossiers, venue mechanics, and rules analysis.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              onClick={() => navigate('/events')}
              className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-stone-950 font-semibold text-sm transition-colors cursor-pointer"
            >
              Explore Major Events
            </button>
            <button
              onClick={() => navigate('/sports')}
              className="px-4 py-2 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 text-sm transition-colors border border-stone-700 cursor-pointer"
            >
              Browse All 12 Sports
            </button>
          </div>
        </div>

        {/* Subtle decorative background motif */}
        <div className="absolute right-0 bottom-0 top-0 w-1/3 opacity-15 pointer-events-none bg-gradient-to-l from-amber-500 to-transparent"></div>
      </section>

      {/* SECTION 1: LATEST EDITORIAL ARTICLES */}
      <section aria-labelledby="latest-articles-heading">
        <div className="flex items-end justify-between mb-6 pb-2 border-b border-stone-200 dark:border-stone-800">
          <div>
            <span className="text-xs uppercase tracking-wider font-bold text-amber-600 dark:text-amber-500">
              Editorial Wire
            </span>
            <h2
              id="latest-articles-heading"
              className="font-serif text-2xl sm:text-3xl font-bold text-stone-900 dark:text-stone-100"
            >
              Latest Analysis & Guides
            </h2>
          </div>
          <button
            onClick={() => navigate('/latest')}
            className="text-xs font-semibold text-amber-700 dark:text-amber-400 hover:underline cursor-pointer"
          >
            View All Articles ({publishedArticles.length}) &rarr;
          </button>
        </div>

        {/* Lead Story */}
        {leadArticle && (
          <div className="mb-8">
            <ArticleCard article={leadArticle} variant="lead" />
          </div>
        )}

        {/* Secondary Grid + Compact List */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Secondary feature cards (2 columns on left) */}
          <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-6">
            {secondaryArticles.map((article) => (
              <ArticleCard key={article.id} article={article} variant="standard" />
            ))}
          </div>

          {/* Compact Archive List (Right column) */}
          <div className="lg:col-span-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] p-5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-stone-900 dark:text-stone-200 mb-4 pb-2 border-b border-stone-100 dark:border-stone-800">
              Quick Editorial Reference
            </h3>
            <div className="divide-y divide-stone-100 dark:divide-stone-800/80">
              {compactArticles.length > 0 ? (
                compactArticles.map((art) => (
                  <ArticleCard key={art.id} article={art} variant="compact" />
                ))
              ) : (
                <p className="text-xs text-stone-500 py-3">Explore additional sport sections below.</p>
              )}
            </div>
            <button
              onClick={() => navigate('/latest')}
              className="w-full mt-4 py-2 text-xs font-semibold text-center text-stone-700 dark:text-stone-300 hover:text-amber-600 dark:hover:text-amber-400 border border-stone-200 dark:border-stone-800 rounded-lg hover:bg-stone-50 dark:hover:bg-stone-800/50 transition-colors"
            >
              Browse Full Editorial Archive &rarr;
            </button>
          </div>
        </div>
      </section>

      {/* Mid-page Ad slot */}
      <AdSlot id="HOMEPAGE_MIDDLE" />

      {/* SECTION 2: FEATURED PERMANENT EVENTS */}
      <section aria-labelledby="featured-events-heading">
        <div className="flex items-end justify-between mb-6 pb-2 border-b border-stone-200 dark:border-stone-800">
          <div>
            <span className="text-xs uppercase tracking-wider font-bold text-amber-600 dark:text-amber-500">
              Permanent Sporting Institutions
            </span>
            <h2
              id="featured-events-heading"
              className="font-serif text-2xl sm:text-3xl font-bold text-stone-900 dark:text-stone-100"
            >
              Iconic Global Events
            </h2>
          </div>
          <button
            onClick={() => navigate('/events')}
            className="text-xs font-semibold text-amber-700 dark:text-amber-400 hover:underline cursor-pointer"
          >
            All Permanent Events &rarr;
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {featuredEvents.map((evt) => (
            <EventCard key={evt.id} event={evt} />
          ))}
        </div>
      </section>

      {/* SECTION 3: MULTI-SPORT DISCOVERY (ALL 12 SPORTS) */}
      <section aria-labelledby="sports-discovery-heading">
        <div className="flex items-end justify-between mb-6 pb-2 border-b border-stone-200 dark:border-stone-800">
          <div>
            <span className="text-xs uppercase tracking-wider font-bold text-amber-600 dark:text-amber-500">
              Comprehensive Coverage
            </span>
            <h2
              id="sports-discovery-heading"
              className="font-serif text-2xl sm:text-3xl font-bold text-stone-900 dark:text-stone-100"
            >
              Explore by Sport
            </h2>
          </div>
          <button
            onClick={() => navigate('/sports')}
            className="text-xs font-semibold text-amber-700 dark:text-amber-400 hover:underline cursor-pointer"
          >
            Full Sports Directory &rarr;
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {sports
            .filter((s) => s.isVisible)
            .map((sp) => {
              const sportArticlesCount = articles.filter((a) => a.sportSlug === sp.slug).length;
              const sportEventsCount = events.filter((e) => e.sportSlug === sp.slug).length;

              return (
                <div
                  key={sp.id}
                  onClick={() => navigate(`/${sp.slug}`)}
                  className="group p-5 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] hover:border-amber-500/60 dark:hover:border-amber-500/60 hover:shadow-md transition-all cursor-pointer flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between text-xs text-stone-400 mb-2">
                      <span className="font-mono text-[11px]">/{sp.slug}</span>
                      <span className="tabular-nums font-mono text-[11px]">
                        {sportEventsCount} Events
                      </span>
                    </div>
                    <h3 className="font-serif text-lg font-bold text-stone-900 dark:text-stone-100 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">
                      {sp.name}
                    </h3>
                    <p className="mt-1.5 text-xs text-stone-600 dark:text-stone-400 line-clamp-2 leading-relaxed">
                      {sp.tagline}
                    </p>
                  </div>
                  <div className="mt-4 pt-3 border-t border-stone-100 dark:border-stone-800/80 flex items-center justify-between text-[11px] text-stone-500">
                    <span>{sportArticlesCount} Articles</span>
                    <span className="group-hover:translate-x-1 transition-transform text-amber-600 dark:text-amber-400 font-semibold">
                      Explore &rarr;
                    </span>
                  </div>
                </div>
              );
            })}
        </div>
      </section>

      {/* SECTION 4: UPCOMING EVENT EDITIONS SPOTLIGHT */}
      <section aria-labelledby="upcoming-editions-heading" className="rounded-2xl bg-stone-100 dark:bg-stone-900/60 p-6 sm:p-8 border border-stone-200 dark:border-stone-800">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between mb-6 pb-2 border-b border-stone-200 dark:border-stone-800 gap-2">
          <div>
            <span className="text-xs uppercase tracking-wider font-bold text-amber-600 dark:text-amber-500">
              Calendar & Timetables
            </span>
            <h2
              id="upcoming-editions-heading"
              className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100"
            >
              Upcoming Championship Staging
            </h2>
          </div>
          <span className="text-xs text-stone-500">Official tournament dates & session matrices</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {upcomingEditions.map((ed) => {
            const parentEvent = events.find((e) => e.slug === ed.eventSlug);
            const parentSport = sports.find((s) => s.slug === ed.sportSlug);

            return (
              <div
                key={ed.id}
                onClick={() => navigate(`/${ed.sportSlug}/${ed.eventSlug}/${ed.year}`)}
                className="group p-5 rounded-xl bg-white dark:bg-[#121417] border border-stone-200 dark:border-stone-800 hover:shadow-md transition-all cursor-pointer flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between text-xs text-amber-700 dark:text-amber-500 font-semibold mb-2">
                    <span>{parentSport?.name}</span>
                    <span className="font-mono text-stone-500 text-[11px]">{ed.status.toUpperCase()}</span>
                  </div>
                  <h3 className="font-serif text-lg font-bold text-stone-900 dark:text-stone-100 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">
                    {ed.title}
                  </h3>
                  <div className="mt-3 space-y-1 text-xs text-stone-600 dark:text-stone-400">
                    <p className="tabular-nums">
                      <strong className="text-stone-800 dark:text-stone-200">Dates:</strong> {ed.startDate} to {ed.endDate}
                    </p>
                    <p>
                      <strong className="text-stone-800 dark:text-stone-200">Venue:</strong> {ed.venue}
                    </p>
                    {ed.prizeMoneyTotal && (
                      <p className="tabular-nums">
                        <strong className="text-stone-800 dark:text-stone-200">Purse:</strong> {ed.prizeMoneyTotal}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-stone-100 dark:border-stone-800 flex items-center justify-between text-xs font-semibold text-amber-600 dark:text-amber-400">
                  <span>View Edition Guide</span>
                  <span>&rarr;</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
