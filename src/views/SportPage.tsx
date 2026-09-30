/**
 * SportingSpy Sport Hub Page
 * Topic hub supporting:
 * - H1 and introduction
 * - Featured & upcoming events
 * - Latest articles
 * - Guides / general information (articles belonging directly to the sport without event/edition)
 * - Breadcrumbs & Schema.org structure
 * PHASE B: server-rendered from route-specific data.
 */

import React from 'react';
import Link from 'next/link';
import { Breadcrumbs } from '../components/ui/Breadcrumbs';
import { ArticleCard } from '../components/editorial/ArticleCard';
import { EventCard } from '../components/editorial/EventCard';
import { SportHubTabs } from '../components/editorial/SportHubTabs';
import { AdSlot } from '../components/ui/AdSlot';
import { JsonLd } from '../components/seo/JsonLd';
import { absoluteUrl, sportPath } from '../lib/paths';
import type { getSportHub } from '../../server/services/public/content';
import { PlacedBlocks } from '../components/site/GlobalBlocks';

type SportHubData = NonNullable<Awaited<ReturnType<typeof getSportHub>>>;

export const SportPage: React.FC<{ data: SportHubData }> = ({ data }) => {
  const { sport, events: sportEvents, articles: sportArticles, editions: sportEditions } = data;
  // General articles belonging directly to sport (no event/edition)
  const generalGuides = sportArticles.filter((a) => !a.eventSlug);
  const eventArticles = sportArticles.filter((a) => !!a.eventSlug);

  // A sport hub is a collection of pages about one sport.
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: sport.name,
    description: sport.description,
    url: absoluteUrl(sportPath(sport.slug)),
  };

  return (
    <div className="space-y-10">
      <JsonLd data={structuredData} />

      <Breadcrumbs items={[{ label: sport.name, url: `/${sport.slug}` }]} />

      <PlacedBlocks placement="sport_top" />

      <SportHubTabs
        counts={{
          all: sportArticles.length + sportEvents.length,
          events: sportEvents.length,
          articles: eventArticles.length,
          guides: generalGuides.length,
        }}
        hero={
          <div className="max-w-3xl">
            <div className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-500 mb-2">Discipline Hub</div>
            <h1 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold text-stone-900 dark:text-stone-100 leading-tight">
              {sport.name}
            </h1>
            <p className="mt-2 text-lg font-serif italic text-stone-600 dark:text-stone-400">{sport.tagline}</p>
            <p className="mt-4 text-sm sm:text-base text-stone-700 dark:text-stone-300 leading-relaxed">{sport.description}</p>
          </div>
        }
        ad={<AdSlot id="EVENT_TOP" />}
        eventsSection={
          <section aria-labelledby="sport-events-heading">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-stone-200 dark:border-stone-800">
              <h2 id="sport-events-heading" className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">
                Championship Events in {sport.name}
              </h2>
              <span className="text-xs text-stone-500 tabular-nums dark:text-stone-400">{sportEvents.length} Events</span>
            </div>

            {sportEvents.length === 0 ? (
              <p className="text-xs text-stone-500 italic py-4 dark:text-stone-400">No events registered for this sport yet.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {sportEvents.map((evt) => (
                  <EventCard key={evt.id} event={evt} />
                ))}
              </div>
            )}
          </section>
        }
        articlesSection={
          <section aria-labelledby="sport-articles-heading">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-stone-200 dark:border-stone-800">
              <h2 id="sport-articles-heading" className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">
                Latest {sport.name} Editorial & Schedules
              </h2>
              <span className="text-xs text-stone-500 tabular-nums dark:text-stone-400">{sportArticles.length} Articles</span>
            </div>

            {sportArticles.length === 0 ? (
              <p className="text-xs text-stone-500 italic py-4 dark:text-stone-400">No articles published under this sport yet.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {sportArticles.map((art) => (
                  <ArticleCard key={art.id} article={art} variant="standard" />
                ))}
              </div>
            )}
          </section>
        }
        guidesSection={
          generalGuides.length > 0 ? (
            <section aria-labelledby="general-guides-heading" className="rounded-xl bg-amber-50/50 dark:bg-amber-950/20 p-6 border border-amber-200/60 dark:border-amber-900/40">
              <div className="mb-4">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">Foundational Knowledge</span>
                <h2 id="general-guides-heading" className="font-serif text-xl font-bold text-stone-900 dark:text-stone-100">
                  {sport.name} Rules, Scoring & Format Guides
                </h2>
                <p className="text-xs text-stone-600 dark:text-stone-400 mt-1">
                  General articles explaining fundamental sporting rules, regulations, and formats independent of individual tournament editions.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {generalGuides.map((guide) => (
                  <Link
                    key={guide.id}
                    href={guide.url}
                    className="block p-4 rounded-lg bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 hover:border-amber-500 transition-colors cursor-pointer"
                  >
                    <div className="text-xs text-amber-700 dark:text-amber-400 font-semibold mb-1">{guide.articleType}</div>
                    <h3 className="font-serif text-base font-bold text-stone-900 dark:text-stone-100 leading-snug">{guide.title}</h3>
                    <p className="mt-1 text-xs text-stone-600 dark:text-stone-400 line-clamp-2">{guide.excerpt}</p>
                    <div className="mt-3 text-[11px] font-semibold text-amber-700 dark:text-amber-400">Read Full Guide &rarr;</div>
                  </Link>
                ))}
              </div>
            </section>
          ) : null
        }
        editionsSection={
          sportEditions.length > 0 ? (
            <section aria-labelledby="sport-editions-heading">
              <div className="flex items-center justify-between mb-4 pb-2 border-b border-stone-200 dark:border-stone-800">
                <h2 id="sport-editions-heading" className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">
                  Active & Upcoming Staging
                </h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {sportEditions.map((ed) => (
                  <Link
                    key={ed.id}
                    href={ed.url}
                    className="p-4 rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] hover:shadow-sm transition-all cursor-pointer flex justify-between items-center"
                  >
                    <div>
                      <h3 className="font-serif text-base font-bold text-stone-900 dark:text-stone-100">{ed.title}</h3>
                      {(ed.startDate || ed.endDate || ed.venue) && <p className="text-xs text-stone-500 tabular-nums dark:text-stone-400">
                        {[ed.startDate && ed.endDate ? `${ed.startDate} to ${ed.endDate}` : ed.startDate || ed.endDate, ed.venue].filter(Boolean).join(' · ')}
                      </p>}
                    </div>
                    <span className="text-xs font-semibold text-amber-700 dark:text-amber-400 whitespace-nowrap ml-4">View Dossier &rarr;</span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null
        }
      />
    </div>
  );
};
