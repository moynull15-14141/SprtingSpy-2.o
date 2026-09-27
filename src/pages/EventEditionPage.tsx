/**
 * SportingSpy Event Edition Page
 * URL: /{sport}/{event}/{year}/ e.g. /tennis/french-open/2027/
 * Dedicated dossier for a specific staging year of an event.
 * Flexible quick facts specific to the sport (surface for tennis, laps for motorsport, par for golf, etc.)
 */

import React from 'react';
import { useApp } from '../context/AppContext';
import { SeoHead } from '../components/layout/SeoHead';
import { Breadcrumbs } from '../components/ui/Breadcrumbs';
import { ArticleCard } from '../components/editorial/ArticleCard';
import { AdSlot } from '../components/ui/AdSlot';

interface EventEditionPageProps {
  sportSlug: string;
  eventSlug: string;
  year: number;
}

export const EventEditionPage: React.FC<EventEditionPageProps> = ({
  sportSlug,
  eventSlug,
  year,
}) => {
  const { sports, events, editions, articles, navigate } = useApp();

  const sport = sports.find((s) => s.slug === sportSlug);
  const event = events.find((e) => e.sportSlug === sportSlug && e.slug === eventSlug);
  const edition = editions.find((ed) => ed.eventSlug === eventSlug && ed.year === year);

  if (!sport || !event || !edition) {
    return (
      <div className="py-16 text-center">
        <h1 className="font-serif text-3xl font-bold">Event Edition Not Found</h1>
        <p className="mt-2 text-stone-500">
          The requested edition {year} for {eventSlug} could not be found.
        </p>
        <button
          onClick={() => navigate(`/${sportSlug}/${eventSlug}`)}
          className="mt-6 px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-semibold"
        >
          View Event Overview
        </button>
      </div>
    );
  }

  // Articles belonging to this specific edition
  const editionArticles = articles.filter(
    (a) =>
      a.sportSlug === sport.slug &&
      a.eventSlug === event.slug &&
      a.editionYear === edition.year &&
      a.status === 'published'
  );

  // Other editions of this event
  const otherEditions = editions.filter(
    (ed) => ed.eventSlug === event.slug && ed.year !== edition.year
  );

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name: edition.title,
    startDate: edition.startDate,
    endDate: edition.endDate,
    location: {
      '@type': 'Place',
      name: edition.venue,
      address: edition.location,
    },
    sport: sport.name,
    description: edition.description,
    url: `https://sportingspy.com/${sport.slug}/${event.slug}/${edition.year}`,
  };

  return (
    <div className="space-y-10">
      <SeoHead
        title={edition.seo.metaTitle || `${edition.title} – Official Dates, Venue & Guides | SportingSpy`}
        description={edition.seo.metaDescription || edition.description}
        canonicalPath={`/${sport.slug}/${event.slug}/${edition.year}`}
        structuredData={structuredData}
      />

      <Breadcrumbs
        items={[
          { label: sport.name, url: `/${sport.slug}` },
          { label: event.name, url: `/${sport.slug}/${event.slug}` },
          { label: `${edition.year} Edition`, url: `/${sport.slug}/${event.slug}/${edition.year}` },
        ]}
      />

      {/* EDITION DOSSIER HERO */}
      <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] p-8 lg:p-10 shadow-sm">
        <div className="max-w-4xl">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-500 mb-2">
            <span>{sport.name}</span>
            <span className="text-stone-300 dark:text-stone-700">·</span>
            <span>{event.name}</span>
            <span className="text-stone-300 dark:text-stone-700">·</span>
            <span className="font-mono text-stone-500">{edition.status.toUpperCase()}</span>
          </div>

          <h1 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold text-stone-900 dark:text-stone-100 leading-tight">
            {edition.title}
          </h1>

          <p className="mt-4 text-base sm:text-lg text-stone-700 dark:text-stone-300 leading-relaxed font-sans">
            {edition.description}
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-4 text-xs sm:text-sm text-stone-600 dark:text-stone-400">
            <span className="inline-flex items-center gap-1.5 font-medium text-stone-900 dark:text-stone-100">
              <span className="text-amber-600">📅</span>
              <span className="tabular-nums">{edition.startDate} to {edition.endDate}</span>
            </span>
            <span className="text-stone-300 dark:text-stone-700">·</span>
            <span className="inline-flex items-center gap-1.5 font-medium text-stone-900 dark:text-stone-100">
              <span className="text-amber-600">📍</span>
              <span>{edition.venue}, {edition.location}</span>
            </span>
            {edition.prizeMoneyTotal && (
              <>
                <span className="text-stone-300 dark:text-stone-700">·</span>
                <span className="inline-flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400">
                  <span>🏆</span>
                  <span className="tabular-nums font-semibold">Purse: {edition.prizeMoneyTotal}</span>
                </span>
              </>
            )}
          </div>
        </div>

        {/* Edition Quick Action Strip */}
        <div className="mt-8 pt-6 border-t border-stone-100 dark:border-stone-800/80 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {edition.officialSourceUrl && (
              <a
                href={edition.officialSourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3.5 py-1.5 rounded-lg bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 text-stone-800 dark:text-stone-200 text-xs font-semibold inline-flex items-center gap-1.5"
              >
                Official Tournament Portal &rarr;
              </a>
            )}
            <button
              onClick={() => navigate(`/${sport.slug}/${event.slug}`)}
              className="text-xs text-stone-500 hover:text-stone-800 dark:hover:text-stone-200 transition-colors"
            >
              &larr; Permanent Event Profile
            </button>
          </div>

          {/* Switch Edition year */}
          {otherEditions.length > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-stone-400">Switch Edition:</span>
              {otherEditions.map((oe) => (
                <button
                  key={oe.id}
                  onClick={() => navigate(`/${sport.slug}/${event.slug}/${oe.year}`)}
                  className="px-2.5 py-1 rounded bg-stone-100 dark:bg-stone-800/80 hover:bg-amber-100 dark:hover:bg-stone-700 font-mono text-stone-700 dark:text-stone-300 tabular-nums cursor-pointer"
                >
                  {oe.year}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <AdSlot id="EVENT_TOP" />

      {/* QUICK FACTS GRID (SPORT-SPECIFIC) */}
      <section aria-labelledby="quick-facts-heading">
        <div className="mb-4">
          <span className="text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-500">
            Dossier Specifications
          </span>
          <h2 id="quick-facts-heading" className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">
            {edition.title} Quick Facts
          </h2>
          <p className="text-xs text-stone-500 mt-0.5">
            Sport-specific parameters calibrated for {sport.name}.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {edition.quickFacts.map((fact, idx) => (
            <div
              key={idx}
              className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] shadow-sm"
            >
              <div className="text-xs text-stone-400 font-medium mb-1">{fact.label}</div>
              <div className="text-sm font-semibold text-stone-900 dark:text-stone-100 tabular-nums">
                {fact.value}
              </div>
            </div>
          ))}

          {edition.defendingChampions && edition.defendingChampions.length > 0 && (
            <div className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] shadow-sm sm:col-span-2 lg:col-span-1">
              <div className="text-xs text-stone-400 font-medium mb-1">Defending Champion(s)</div>
              <div className="text-sm font-semibold text-stone-900 dark:text-stone-100 space-y-0.5">
                {edition.defendingChampions.map((c, i) => (
                  <div key={i} className="flex justify-between">
                    <span className="text-stone-500 text-xs">{c.category}:</span>
                    <span className="text-amber-700 dark:text-amber-400 font-medium">{c.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {edition.qualificationInfo && (
          <div className="mt-4 p-4 rounded-xl bg-stone-50 dark:bg-stone-900/60 border border-stone-200 dark:border-stone-800 text-xs sm:text-sm text-stone-600 dark:text-stone-400">
            <strong className="text-stone-900 dark:text-stone-200">Qualification & Draw Criteria: </strong>
            {edition.qualificationInfo}
          </div>
        )}
      </section>

      {/* DEDICATED ARTICLES FOR THIS EDITION */}
      <section aria-labelledby="edition-articles-heading">
        <div className="flex items-center justify-between mb-4 pb-2 border-b border-stone-200 dark:border-stone-800">
          <div>
            <span className="text-xs uppercase tracking-wider font-bold text-amber-600 dark:text-amber-500">
              Verified Guides & Timetables
            </span>
            <h2 id="edition-articles-heading" className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">
              {edition.year} Edition Guides & Schedules
            </h2>
          </div>
          <span className="text-xs text-stone-500 tabular-nums">{editionArticles.length} Articles</span>
        </div>

        {editionArticles.length === 0 ? (
          <div className="p-8 text-center rounded-xl border border-dashed border-stone-300 dark:border-stone-700">
            <p className="text-xs text-stone-500">
              Session schedules, viewing guides, and prize money tables for {edition.title} are currently being compiled.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {editionArticles.map((art) => (
              <ArticleCard key={art.id} article={art} variant="standard" />
            ))}
          </div>
        )}
      </section>

      <AdSlot id="EVENT_BOTTOM" />
    </div>
  );
};
