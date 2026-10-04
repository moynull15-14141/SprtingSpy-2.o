/**
 * SportingSpy Sport Hub Page (Spec §6.2 — a topic hub, not just an archive):
 *   Sport name (H1) · short introduction · Featured Events · Upcoming Events ·
 *   Latest [Sport] Articles · All [Sport] Events · [Sport] Guides & Information ·
 *   Explore [Sport] · contextual FAQ (published, editor-approved).
 * PHASE B: server-rendered. PHASE R: every list is bounded; totals link to
 * the paginated Event discovery / Latest pages.
 */

import React from 'react';
import Link from 'next/link';
import { Breadcrumbs } from '../components/ui/Breadcrumbs';
import { ArticleCard } from '../components/editorial/ArticleCard';
import { EventCard } from '../components/editorial/EventCard';
import { SportHubTabs } from '../components/editorial/SportHubTabs';
import { ContextFaq } from '../components/editorial/ContextFaq';
import { RumPageType } from '../components/analytics/RumPageType';
import { AdSlot } from '../components/ui/AdSlot';
import { JsonLd } from '../components/seo/JsonLd';
import { absoluteUrl, sportPath } from '../lib/paths';
import type { getSportHub } from '../../server/services/public/content';
import { PlacedBlocks } from '../components/site/GlobalBlocks';

type SportHubData = NonNullable<Awaited<ReturnType<typeof getSportHub>>>;

const sectionHead = 'flex flex-wrap items-center justify-between gap-2 mb-4 pb-2 border-b border-stone-200 dark:border-stone-800';
const h2 = 'font-serif text-2xl font-bold text-stone-900 dark:text-stone-100';
const moreLink = 'text-xs font-semibold text-amber-700 hover:underline dark:text-amber-400';

const EditionLink: React.FC<{ ed: SportHubData['upcomingEditions'][number] }> = ({ ed }) => (
  <Link href={ed.url} className="p-4 rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] hover:shadow-sm transition-all flex justify-between items-center gap-4">
    <div className="min-w-0">
      <h3 className="font-serif text-base font-bold text-stone-900 dark:text-stone-100 break-words">{ed.title}</h3>
      {(ed.startDate || ed.endDate || ed.venue) && <p className="text-xs text-stone-500 tabular-nums dark:text-stone-400">
        {[ed.startDate && ed.endDate ? `${ed.startDate} to ${ed.endDate}` : ed.startDate || ed.endDate, ed.venue].filter(Boolean).join(' · ')}
      </p>}
    </div>
    <span className="text-xs font-semibold text-amber-700 dark:text-amber-400 whitespace-nowrap">View edition &rarr;</span>
  </Link>
);

export const SportPage: React.FC<{ data: SportHubData }> = ({ data }) => {
  const { sport, featuredEvents, upcomingEditions, latestArticles, articleTotal, events, eventTotal, guides, guideTotal, recentEditions, faqs, faqSchemaEnabled } = data;

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
      <RumPageType type="sport" />
      <JsonLd data={structuredData} />

      <Breadcrumbs items={[{ label: sport.name, url: `/${sport.slug}` }]} />

      <PlacedBlocks placement="sport_top" />

      <SportHubTabs
        counts={{ all: articleTotal + eventTotal, events: eventTotal, articles: articleTotal - guideTotal, guides: guideTotal }}
        hero={
          <div className="max-w-3xl">
            <div className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-500 mb-2">Sport hub</div>
            <h1 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold text-stone-900 dark:text-stone-100 leading-tight">
              {sport.name}
            </h1>
            {sport.tagline && <p className="mt-2 text-lg font-serif italic text-stone-600 dark:text-stone-400">{sport.tagline}</p>}
            {sport.description && <p className="mt-4 text-sm sm:text-base text-stone-700 dark:text-stone-300 leading-relaxed">{sport.description}</p>}
          </div>
        }
        ad={<AdSlot id="EVENT_TOP" />}
        featuredSection={featuredEvents.length > 0 ? (
          <section aria-labelledby="sport-featured-heading">
            <div className={sectionHead}><h2 id="sport-featured-heading" className={h2}>Featured {sport.name} Events</h2></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">{featuredEvents.map((evt) => <EventCard key={evt.id} event={evt} />)}</div>
          </section>
        ) : null}
        upcomingSection={upcomingEditions.length > 0 ? (
          <section aria-labelledby="sport-upcoming-heading">
            <div className={sectionHead}>
              <h2 id="sport-upcoming-heading" className={h2}>Upcoming {sport.name} Events</h2>
              <Link href={`/events/?sport=${sport.slug}&when=upcoming`} className={moreLink}>Full calendar &rarr;</Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{upcomingEditions.map((ed) => <EditionLink key={ed.id} ed={ed} />)}</div>
          </section>
        ) : null}
        articlesSection={
          <section aria-labelledby="sport-articles-heading">
            <div className={sectionHead}>
              <h2 id="sport-articles-heading" className={h2}>Latest {sport.name} Articles</h2>
              {articleTotal > latestArticles.length && <Link href={`/latest/?sport=${sport.slug}`} className={moreLink}>All {articleTotal} articles &rarr;</Link>}
            </div>
            {latestArticles.length === 0 ? (
              <p className="text-xs text-stone-500 italic py-4 dark:text-stone-400">No articles published under this sport yet.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {latestArticles.map((art) => <ArticleCard key={art.id} article={art} variant="standard" />)}
              </div>
            )}
          </section>
        }
        eventsSection={
          <section aria-labelledby="sport-events-heading">
            <div className={sectionHead}>
              <h2 id="sport-events-heading" className={h2}>All {sport.name} Events</h2>
              <span className="flex items-center gap-3 text-xs text-stone-500 tabular-nums dark:text-stone-400">
                {eventTotal} {eventTotal === 1 ? 'event' : 'events'}
                {eventTotal > 0 && <Link href={`/events/?sport=${sport.slug}`} className={moreLink}>{eventTotal > events.length ? `See all ${eventTotal}` : 'Event calendar'} &rarr;</Link>}
              </span>
            </div>
            {events.length === 0 ? (
              <p className="text-xs text-stone-500 italic py-4 dark:text-stone-400">No events registered for this sport yet.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">{events.map((evt) => <EventCard key={evt.id} event={evt} />)}</div>
            )}
          </section>
        }
        guidesSection={guides.length > 0 ? (
          <section aria-labelledby="general-guides-heading" className="rounded-xl bg-amber-50/50 dark:bg-amber-950/20 p-6 border border-amber-200/60 dark:border-amber-900/40">
            <div className="mb-4">
              <span className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">Guides &amp; information</span>
              <h2 id="general-guides-heading" className="font-serif text-xl font-bold text-stone-900 dark:text-stone-100">{sport.name} Guides &amp; Information</h2>
              <p className="text-xs text-stone-600 dark:text-stone-400 mt-1">Rules, scoring, formats and other {sport.name.toLowerCase()} information that is not tied to one event.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {guides.map((guide) => (
                <Link key={guide.id} href={guide.url} className="block p-4 rounded-lg bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 hover:border-amber-500 transition-colors">
                  <div className="text-xs text-amber-700 dark:text-amber-400 font-semibold mb-1">{guide.articleType}</div>
                  <h3 className="font-serif text-base font-bold text-stone-900 dark:text-stone-100 leading-snug">{guide.title}</h3>
                  <p className="mt-1 text-xs text-stone-600 dark:text-stone-400 line-clamp-2">{guide.excerpt}</p>
                  <div className="mt-3 text-[11px] font-semibold text-amber-700 dark:text-amber-400">Read guide &rarr;</div>
                </Link>
              ))}
            </div>
            {guideTotal > guides.length && <p className="mt-4"><Link href={`/latest/?sport=${sport.slug}`} className={moreLink}>More {sport.name} articles &rarr;</Link></p>}
          </section>
        ) : null}
        exploreSection={
          <section aria-labelledby="sport-explore-heading">
            <div className={sectionHead}><h2 id="sport-explore-heading" className={h2}>Explore {sport.name}</h2></div>
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
              <li><Link href={`/events/?sport=${sport.slug}`} className="block rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] p-4 font-semibold hover:border-amber-500">{sport.name} event calendar</Link></li>
              <li><Link href={`/events/?sport=${sport.slug}&when=past`} className="block rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] p-4 font-semibold hover:border-amber-500">Past {sport.name.toLowerCase()} events &amp; results</Link></li>
              <li><Link href={`/latest/?sport=${sport.slug}`} className="block rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] p-4 font-semibold hover:border-amber-500">All {sport.name.toLowerCase()} articles</Link></li>
              <li><Link href={`/search/?sport=${sport.slug}`} className="block rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] p-4 font-semibold hover:border-amber-500">Search {sport.name.toLowerCase()} coverage</Link></li>
            </ul>
            {recentEditions.length > 0 && (
              <div className="mt-6">
                <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400">Recently completed</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{recentEditions.map((ed) => <EditionLink key={ed.id} ed={ed} />)}</div>
              </div>
            )}
          </section>
        }
        faqSection={<ContextFaq items={faqs} heading={`${sport.name}: frequently asked questions`} schemaEnabled={faqSchemaEnabled} />}
      />
    </div>
  );
};
