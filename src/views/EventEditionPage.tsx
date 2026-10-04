/**
 * SportingSpy Event Edition Page
 * URL: /{sport}/{event}/{year}/ e.g. /tennis/french-open/2027/
 * Structure (Spec §8.4): Breadcrumbs · H1 · Quick Facts · Short Edition
 * Description · Official Source · Latest Articles · Related Articles, plus the
 * edition's published FAQ. Quick Facts show only the facts this edition has
 * and are never interrupted by ads. Latest/Related are generated from
 * relationships (PHASE R).
 */

import React from 'react';
import Link from 'next/link';
import { Breadcrumbs } from '../components/ui/Breadcrumbs';
import { ArticleCard } from '../components/editorial/ArticleCard';
import { AdSlot } from '../components/ui/AdSlot';
import { JsonLd } from '../components/seo/JsonLd';
import { ContextFaq } from '../components/editorial/ContextFaq';
import { RumPageType } from '../components/analytics/RumPageType';
import { absoluteUrl, editionPath, eventPath } from '../lib/paths';
import { editionDates } from '../lib/eventDates';
import { absoluteMedia, schemaStatus } from './EventPage';
import type { getEditionPage } from '../../server/services/public/content';

type EditionPageData = NonNullable<Awaited<ReturnType<typeof getEditionPage>>>;
const dateLabel = (ed: EditionPageData['edition']) => (ed.startDate || ed.endDate ? editionDates(ed) : null);

export const EventEditionPage: React.FC<{ data: EditionPageData }> = ({ data }) => {
  const { sport, event, edition, latestArticles, articleTotal, relatedArticles, otherEditions, faqs, faqSchemaEnabled } = data;
  const hasQuickFacts = edition.quickFacts.length > 0 || edition.participantsCount != null || !!edition.defendingChampions?.length || !!edition.qualificationInfo || !!edition.prizeMoneyTotal || !!dateLabel(edition) || !!(edition.venue || edition.location);

  const editionUrl = absoluteUrl(editionPath(sport.slug, event.slug, edition.year));
  const dates = editionDates(edition);
  // Same `@id` as the Event page's current-Edition SportsEvent (PHASE E5). Facts only: no organizer,
  // offers or attendance mode are modelled, so none are emitted.
  const structuredData = edition.startDate ? {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    '@id': `${editionUrl}#event`,
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
    url: editionUrl,
    ...(schemaStatus(edition.status) ? { eventStatus: schemaStatus(edition.status) } : {}),
    ...(edition.featuredImage || event.featuredImage ? { image: [absoluteMedia(edition.featuredImage || event.featuredImage!)] } : {}),
    ...(edition.officialSourceUrl ? { sameAs: edition.officialSourceUrl } : {}),
  } : null;

  return (
    <div className="space-y-10">
      <RumPageType type="edition" />
      {structuredData && <JsonLd data={structuredData} />}

      <Breadcrumbs
        items={[
          { label: 'Sports', url: '/sports' },
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

          <div className="mt-6 flex flex-wrap items-center gap-4 text-xs sm:text-sm text-stone-600 dark:text-stone-400">
            {(edition.startDate || edition.endDate) && <span className="inline-flex items-center gap-1.5 font-medium text-stone-900 dark:text-stone-100">
              <span className="text-amber-700 dark:text-amber-500">📅</span>
              <span className="tabular-nums">{dates}</span>
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
                Official website &rarr;
              </a>
            )}
            <Link
              href={eventPath(sport.slug, event.slug)}
              className="text-xs text-stone-500 hover:text-stone-800 dark:hover:text-stone-200 transition-colors dark:text-stone-400"
            >
              &larr; {event.name} overview
            </Link>
          </div>

          {/* Switch Edition year */}
          {otherEditions.length > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-stone-500 dark:text-stone-400">Other editions:</span>
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

      {/* QUICK FACTS (only the facts this edition has; never interrupted by ads) */}
      {hasQuickFacts && <section aria-labelledby="quick-facts-heading" className="min-w-0 break-words">
        <div className="mb-4">
          <span className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-500">
            Quick facts
          </span>
          <h2 id="quick-facts-heading" className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">
            {edition.title} Quick Facts
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {dateLabel(edition) && (
            <div className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] shadow-sm">
              <div className="text-xs text-stone-500 font-medium mb-1 dark:text-stone-400">Dates</div>
              <div className="text-sm font-semibold text-stone-900 dark:text-stone-100 tabular-nums">{dateLabel(edition)}</div>
            </div>
          )}
          {[edition.venue, edition.location].filter(Boolean).join(', ') && (
            <div className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] shadow-sm">
              <div className="text-xs text-stone-500 font-medium mb-1 dark:text-stone-400">Venue</div>
              <div className="text-sm font-semibold text-stone-900 dark:text-stone-100 tabular-nums">{[edition.venue, edition.location].filter(Boolean).join(', ')}</div>
            </div>
          )}
          {edition.prizeMoneyTotal && (
            <div className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] shadow-sm">
              <div className="text-xs text-stone-500 font-medium mb-1 dark:text-stone-400">Prize money</div>
              <div className="text-sm font-semibold text-stone-900 dark:text-stone-100 tabular-nums">{edition.prizeMoneyTotal}</div>
            </div>
          )}
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
            <strong className="text-stone-900 dark:text-stone-200">Qualification: </strong>
            {edition.qualificationInfo}
          </div>
        )}
      </section>}

      {/* SHORT EDITION DESCRIPTION + OFFICIAL SOURCE (Spec §8.4–8.5) */}
      {(edition.description || edition.officialSourceUrl) && (
        <section aria-labelledby="edition-about-heading" className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] p-6 sm:p-8">
          <h2 id="edition-about-heading" className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">About {edition.title}</h2>
          {edition.description && <p className="mt-3 text-base leading-relaxed text-stone-700 dark:text-stone-300">{edition.description}</p>}
          {edition.officialSourceUrl && (
            <p className="mt-4 text-sm">
              <span className="font-semibold text-stone-900 dark:text-stone-100">Official source: </span>
              <a href={edition.officialSourceUrl} target="_blank" rel="noopener noreferrer" className="break-all font-semibold text-amber-700 hover:underline dark:text-amber-400">{edition.officialSourceUrl.replace(/^https?:\/\//, '')}</a>
            </p>
          )}
        </section>
      )}

      <AdSlot id="EVENT_TOP" />

      {/* LATEST ARTICLES: newest published articles of this edition */}
      <section aria-labelledby="edition-articles-heading">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4 pb-2 border-b border-stone-200 dark:border-stone-800">
          <div>
            <span className="text-xs uppercase tracking-wider font-bold text-amber-700 dark:text-amber-500">Latest articles</span>
            <h2 id="edition-articles-heading" className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">
              Latest {edition.title} articles
            </h2>
          </div>
          <span className="text-xs text-stone-500 tabular-nums dark:text-stone-400">{articleTotal} {articleTotal === 1 ? 'article' : 'articles'}</span>
        </div>

        {latestArticles.length === 0 ? (
          <div className="p-8 text-center rounded-xl border border-dashed border-stone-300 dark:border-stone-700">
            <p className="text-xs text-stone-500 dark:text-stone-400">No articles have been published for {edition.title} yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {latestArticles.map((art) => (
              <ArticleCard key={art.id} article={art} variant="standard" />
            ))}
          </div>
        )}
        {articleTotal > latestArticles.length && (
          <p className="mt-4"><Link href={`/search/?q=${encodeURIComponent(edition.title)}&sport=${sport.slug}`} className="text-xs font-semibold text-amber-700 hover:underline dark:text-amber-400">All {articleTotal} articles &rarr;</Link></p>
        )}
      </section>

      {/* RELATED ARTICLES: evergreen guides of this event and sport */}
      {relatedArticles.length > 0 && (
        <section aria-labelledby="edition-related-heading">
          <div className="mb-4 pb-2 border-b border-stone-200 dark:border-stone-800">
            <span className="text-xs uppercase tracking-wider font-bold text-amber-700 dark:text-amber-500">Related articles</span>
            <h2 id="edition-related-heading" className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">{event.name} guides &amp; background</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {relatedArticles.map((art) => <ArticleCard key={art.id} article={art} variant="standard" />)}
          </div>
        </section>
      )}

      <ContextFaq items={faqs} heading={`${edition.title}: frequently asked questions`} schemaEnabled={faqSchemaEnabled} />

      <AdSlot id="EVENT_BOTTOM" />
    </div>
  );
};
