/**
 * SportingSpy Permanent Event Page
 * URL: /{sport}/{event}/ e.g. /tennis/french-open/
 * Communicates:
 * - Permanent event identity, heritage, and history
 * - All yearly editions (current, upcoming, and past archives)
 * - Articles associated with this event
 * - Breadcrumbs & Schema.org structure
 */

import React from 'react';
import { useApp } from '../context/AppContext';
import { SeoHead } from '../components/layout/SeoHead';
import { Breadcrumbs } from '../components/ui/Breadcrumbs';
import { ArticleCard } from '../components/editorial/ArticleCard';
import { AdSlot } from '../components/ui/AdSlot';

interface EventPageProps {
  sportSlug: string;
  eventSlug: string;
}

export const EventPage: React.FC<EventPageProps> = ({ sportSlug, eventSlug }) => {
  const { sports, events, editions, articles, navigate } = useApp();

  const sport = sports.find((s) => s.slug === sportSlug);
  const event = events.find((e) => e.sportSlug === sportSlug && e.slug === eventSlug);

  if (!sport || !event) {
    return (
      <div className="py-16 text-center">
        <h1 className="font-serif text-3xl font-bold">Event Not Found</h1>
        <p className="mt-2 text-stone-500">The event could not be located in our sports directory.</p>
        <button
          onClick={() => navigate('/events')}
          className="mt-6 px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-semibold"
        >
          View All Events
        </button>
      </div>
    );
  }

  const eventEditions = editions
    .filter((ed) => ed.eventSlug === event.slug)
    .sort((a, b) => b.year - a.year);

  const eventArticles = articles.filter(
    (a) => a.sportSlug === sport.slug && a.eventSlug === event.slug && a.status === 'published'
  );

  const currentEdition = eventEditions.find((ed) => ed.year === event.currentEditionYear) || eventEditions[0];

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name: event.name,
    description: event.description,
    location: {
      '@type': 'Place',
      name: event.defaultVenue,
      address: event.defaultLocation,
    },
    sport: sport.name,
  };

  return (
    <div className="space-y-10">
      <SeoHead
        title={event.seo.metaTitle || `${event.name} – History, Editions & Guides | SportingSpy`}
        description={event.seo.metaDescription || event.description}
        canonicalPath={`/${sport.slug}/${event.slug}`}
        structuredData={structuredData}
      />

      <Breadcrumbs
        items={[
          { label: sport.name, url: `/${sport.slug}` },
          { label: event.name, url: `/${sport.slug}/${event.slug}` },
        ]}
      />

      {/* Permanent Event Hero Banner */}
      <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] p-8 lg:p-10 shadow-sm">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-8">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-500 mb-2">
              <span>{sport.name}</span>
              <span className="text-stone-300 dark:text-stone-700">·</span>
              <span>Permanent Championship</span>
            </div>

            <h1 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold text-stone-900 dark:text-stone-100 leading-tight">
              {event.name}
            </h1>

            <p className="mt-4 text-base sm:text-lg text-stone-700 dark:text-stone-300 leading-relaxed font-sans">
              {event.description}
            </p>

            {event.history && (
              <div className="mt-6 p-4 rounded-xl bg-stone-50 dark:bg-stone-900/60 border border-stone-200 dark:border-stone-800 text-xs sm:text-sm text-stone-600 dark:text-stone-400 leading-relaxed">
                <strong className="block text-stone-900 dark:text-stone-200 font-semibold mb-1">
                  Heritage & Lineage:
                </strong>
                {event.history}
              </div>
            )}
          </div>

          {/* Quick Specifications Card */}
          <div className="lg:col-span-4 rounded-xl bg-stone-50 dark:bg-stone-900/80 p-5 border border-stone-200 dark:border-stone-800 space-y-3 text-xs">
            <h3 className="font-serif text-sm font-bold text-stone-900 dark:text-stone-100 pb-2 border-b border-stone-200 dark:border-stone-800">
              Championship Profile
            </h3>
            <div className="flex justify-between py-1">
              <span className="text-stone-500">Short Name:</span>
              <span className="font-medium text-stone-800 dark:text-stone-200">{event.shortName}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-stone-500">Frequency:</span>
              <span className="font-medium text-stone-800 dark:text-stone-200">{event.frequency}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-stone-500">Permanent Ground:</span>
              <span className="font-medium text-stone-800 dark:text-stone-200 text-right">{event.defaultVenue}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-stone-500">Location:</span>
              <span className="font-medium text-stone-800 dark:text-stone-200">{event.defaultLocation}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-stone-500">Current Edition:</span>
              <span className="font-mono font-bold text-amber-600 dark:text-amber-400">
                {event.currentEditionYear}
              </span>
            </div>

            {currentEdition && (
              <button
                onClick={() => navigate(`/${sport.slug}/${event.slug}/${currentEdition.year}`)}
                className="w-full mt-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold text-center transition-colors cursor-pointer"
              >
                Go to {currentEdition.year} Edition Guide &rarr;
              </button>
            )}
          </div>
        </div>
      </div>

      <AdSlot id="EVENT_TOP" />

      {/* EVENT EDITIONS INDEX */}
      <section aria-labelledby="editions-heading">
        <div className="flex items-center justify-between mb-4 pb-2 border-b border-stone-200 dark:border-stone-800">
          <div>
            <span className="text-xs uppercase tracking-wider font-bold text-amber-600 dark:text-amber-500">
              Annual Editions
            </span>
            <h2 id="editions-heading" className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">
              {event.name} Yearly Editions
            </h2>
          </div>
          <span className="text-xs text-stone-500 tabular-nums">{eventEditions.length} Editions Registered</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {eventEditions.map((ed) => (
            <div
              key={ed.id}
              onClick={() => navigate(`/${sport.slug}/${event.slug}/${ed.year}`)}
              className="group p-5 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] hover:border-amber-500/80 hover:shadow-md transition-all cursor-pointer flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between text-xs text-stone-500 mb-2">
                  <span className="font-mono font-bold text-base text-stone-900 dark:text-stone-100">
                    {ed.year}
                  </span>
                  <span
                    className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded ${
                      ed.status === 'upcoming'
                        ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400'
                        : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400'
                    }`}
                  >
                    {ed.status}
                  </span>
                </div>
                <h3 className="font-serif text-lg font-bold text-stone-900 dark:text-stone-100 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">
                  {ed.title}
                </h3>
                <p className="mt-2 text-xs text-stone-600 dark:text-stone-400 line-clamp-2">
                  {ed.description}
                </p>

                <div className="mt-4 pt-3 border-t border-stone-100 dark:border-stone-800/80 text-xs text-stone-500 space-y-1">
                  <p className="tabular-nums">
                    <strong className="text-stone-700 dark:text-stone-300">Dates:</strong> {ed.startDate} to {ed.endDate}
                  </p>
                  {ed.prizeMoneyTotal && (
                    <p className="tabular-nums">
                      <strong className="text-stone-700 dark:text-stone-300">Purse:</strong> {ed.prizeMoneyTotal}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-stone-100 dark:border-stone-800/80 flex items-center justify-between text-xs font-semibold text-amber-600 dark:text-amber-400">
                <span>View Full Edition Dossier</span>
                <span>&rarr;</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* EVENT ARTICLES */}
      <section aria-labelledby="event-articles-heading">
        <div className="flex items-center justify-between mb-4 pb-2 border-b border-stone-200 dark:border-stone-800">
          <div>
            <span className="text-xs uppercase tracking-wider font-bold text-amber-600 dark:text-amber-500">
              Tournament Journalism
            </span>
            <h2 id="event-articles-heading" className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">
              Articles & Guides for {event.name}
            </h2>
          </div>
          <span className="text-xs text-stone-500 tabular-nums">{eventArticles.length} Articles</span>
        </div>

        {eventArticles.length === 0 ? (
          <p className="text-xs text-stone-500 italic py-4">No published articles for this event yet.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {eventArticles.map((art) => (
              <ArticleCard key={art.id} article={art} variant="standard" />
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
