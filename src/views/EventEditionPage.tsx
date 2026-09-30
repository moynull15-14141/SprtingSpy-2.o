/**
 * SportingSpy Event Edition Page
 * URL: /{sport}/{event}/{year}/ e.g. /tennis/french-open/2027/
 * Dedicated dossier for a specific staging year of an event.
 * Flexible quick facts specific to the sport (surface for tennis, laps for motorsport, par for golf, etc.)
 */

import React from 'react';
import Link from 'next/link';
import { Breadcrumbs } from '../components/ui/Breadcrumbs';
import { ArticleCard } from '../components/editorial/ArticleCard';
import { AdSlot } from '../components/ui/AdSlot';
import { JsonLd } from '../components/seo/JsonLd';
import { absoluteUrl, editionPath, eventPath } from '../lib/paths';
import type { getEditionPage } from '../../server/services/public/content';

type EditionPageData = NonNullable<Awaited<ReturnType<typeof getEditionPage>>>;

export const EventEditionPage: React.FC<{ data: EditionPageData }> = ({ data }) => {
  const { sport, event, edition, articles: editionArticles, otherEditions } = data;

  const structuredData = edition.startDate ? {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name: edition.title,
    startDate: edition.startDate,
    ...(edition.endDate ? { endDate: edition.endDate } : {}),
    ...((edition.venue || edition.location) ? { location: {
      '@type': 'Place',
      ...(edition.venue ? { name: edition.venue } : {}),
      ...(edition.location ? { address: edition.location } : {}),
    } } : {}),
    sport: sport.name,
    ...(edition.description ? { description: edition.description } : {}),
    url: absoluteUrl(editionPath(sport.slug, event.slug, edition.year)),
    ...(edition.officialSourceUrl ? { sameAs: edition.officialSourceUrl } : {}),
  } : null;

  return (
    <div className="space-y-10">
      {structuredData && <JsonLd data={structuredData} />}

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
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-500 mb-2">
            <span>{sport.name}</span>
            <span aria-hidden="true" className="text-stone-300 dark:text-stone-700">·</span>
            <span>{event.name}</span>
            <span aria-hidden="true" className="text-stone-300 dark:text-stone-700">·</span>
            <span className="font-mono text-stone-500 dark:text-stone-400">{edition.status.toUpperCase()}</span>
          </div>

          <h1 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold text-stone-900 dark:text-stone-100 leading-tight">
            {edition.title}
          </h1>

          {edition.description && <p className="mt-4 text-base sm:text-lg text-stone-700 dark:text-stone-300 leading-relaxed font-sans">{edition.description}</p>}

          <div className="mt-6 flex flex-wrap items-center gap-4 text-xs sm:text-sm text-stone-600 dark:text-stone-400">
            {(edition.startDate || edition.endDate) && <span className="inline-flex items-center gap-1.5 font-medium text-stone-900 dark:text-stone-100">
              <span className="text-amber-700 dark:text-amber-500">📅</span>
              <span className="tabular-nums">{edition.startDate && edition.endDate ? `${edition.startDate} to ${edition.endDate}` : edition.startDate || edition.endDate}</span>
            </span>}
            {(edition.venue || edition.location) && <span className="inline-flex items-center gap-1.5 font-medium text-stone-900 dark:text-stone-100">
              <span className="text-amber-700 dark:text-amber-500">📍</span>
              <span>{[edition.venue, edition.location].filter(Boolean).join(', ')}</span>
            </span>}
            {edition.prizeMoneyTotal && (
              <>
                <span aria-hidden="true" className="text-stone-300 dark:text-stone-700">·</span>
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
            <Link
              href={eventPath(sport.slug, event.slug)}
              className="text-xs text-stone-500 hover:text-stone-800 dark:hover:text-stone-200 transition-colors dark:text-stone-400"
            >
              &larr; Permanent Event Profile
            </Link>
          </div>

          {/* Switch Edition year */}
          {otherEditions.length > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-stone-500 dark:text-stone-400">Switch Edition:</span>
              {otherEditions.map((oe) => (
                <Link
                  key={oe.id}
                  href={editionPath(sport.slug, event.slug, oe.year)}
                  className="px-2.5 py-1 rounded bg-stone-100 dark:bg-stone-800/80 hover:bg-amber-100 dark:hover:bg-stone-700 font-mono text-stone-700 dark:text-stone-300 tabular-nums cursor-pointer"
                >
                  {oe.year}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <AdSlot id="EVENT_TOP" />

      {/* QUICK FACTS GRID (SPORT-SPECIFIC) */}
      <section aria-labelledby="quick-facts-heading" className="min-w-0 break-words">
        <div className="mb-4">
          <span className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-500">
            Dossier Specifications
          </span>
          <h2 id="quick-facts-heading" className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">
            {edition.title} Quick Facts
          </h2>
          <p className="text-xs text-stone-500 mt-0.5 dark:text-stone-400">
            Sport-specific parameters calibrated for {sport.name}.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {edition.quickFacts.map((fact, idx) => (
            <div
              key={idx}
              className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] shadow-sm"
            >
              <div className="text-xs text-stone-500 font-medium mb-1 dark:text-stone-400">{fact.label}</div>
              <div className="text-sm font-semibold text-stone-900 dark:text-stone-100 tabular-nums">
                {fact.value}
              </div>
            </div>
          ))}

          {edition.participantsCount != null && (
            <div className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] shadow-sm">
              <div className="text-xs text-stone-500 font-medium mb-1 dark:text-stone-400">Participants</div>
              <div className="text-sm font-semibold text-stone-900 dark:text-stone-100 tabular-nums">{edition.participantsCount}</div>
            </div>
          )}

          {edition.defendingChampions && edition.defendingChampions.length > 0 && (
            <div className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] shadow-sm sm:col-span-2 lg:col-span-1">
              <div className="text-xs text-stone-500 font-medium mb-1 dark:text-stone-400">Defending Champion(s)</div>
              <div className="text-sm font-semibold text-stone-900 dark:text-stone-100 space-y-0.5">
                {edition.defendingChampions.map((c, i) => (
                  <div key={i} className="flex min-w-0 flex-wrap justify-between gap-2 break-words">
                    <span className="text-stone-500 text-xs dark:text-stone-400">{c.category}:</span>
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
            <span className="text-xs uppercase tracking-wider font-bold text-amber-700 dark:text-amber-500">
              Verified Guides & Timetables
            </span>
            <h2 id="edition-articles-heading" className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">
              {edition.year} Edition Guides & Schedules
            </h2>
          </div>
          <span className="text-xs text-stone-500 tabular-nums dark:text-stone-400">{editionArticles.length} Articles</span>
        </div>

        {editionArticles.length === 0 ? (
          <div className="p-8 text-center rounded-xl border border-dashed border-stone-300 dark:border-stone-700">
            <p className="text-xs text-stone-500 dark:text-stone-400">
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
