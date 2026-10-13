/**
 * SportingSpy Sport Hub Page (Spec §6.2 — a topic hub, not just an archive):
 *   Sport name (H1) · short introduction · Featured Events · Upcoming Events ·
 *   Latest [Sport] Articles · All [Sport] Events · [Sport] Guides & Information ·
 *   Explore [Sport] · contextual FAQ (published, editor-approved).
 * PHASE B: server-rendered. PHASE R: every list is bounded; totals link to
 * the paginated Event discovery / Latest pages.
 *
 * The same page is a GROUP's landing page (/{sport}/{group}/) when
 * `data.discipline` is set ("discipline" is the internal name of a group):
 * the same sections, filled with that group's events, editions and articles
 * only, with the group's own name, tagline, description, image and featured
 * events (never the sport's), and without the sport's FAQ. The sport hub
 * itself always shows everything in the sport. There are two levels only, Sport →
 * Group: a group page lists its sibling groups, never groups of its own.
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
import { absoluteUrl, disciplinePath, sportPath } from '../lib/paths';
import type { getSportHub } from '../../server/services/public/content';
import { PlacedBlocks } from '../components/site/GlobalBlocks';
import { ResponsiveImage } from '../components/editorial/ResponsiveImage';

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
  const { sport, discipline, disciplines, featuredEvents, upcomingEditions, latestArticles, articleTotal, events, eventTotal, guides, guideTotal, recentEditions, faqs, faqSchemaEnabled, heroImage } = data;
  /** What this page is about: the discipline on its landing page, the sport on the hub. */
  const label = discipline?.name ?? sport.name;
  const scope = discipline ? 'group' : 'sport';
  const latestHref = `/latest/?sport=${sport.slug}${discipline ? `&discipline=${discipline.slug}` : ''}`;

  // A hub is a collection of pages about one sport, or about one discipline of it.
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: discipline ? `${discipline.name} (${sport.name})` : sport.name,
    description: discipline ? discipline.description || undefined : sport.description,
    url: absoluteUrl(discipline ? disciplinePath(sport.slug, discipline.slug) : sportPath(sport.slug)),
    ...(discipline ? { isPartOf: { '@type': 'CollectionPage', name: sport.name, url: absoluteUrl(sportPath(sport.slug)) } } : {}),
  };
  // The sport's groups, in their display order, directly under the sport. On a group
  // page the same list shows its siblings and a way back. Groups are never top-level navigation.
  const disciplineNav = disciplines.length > 0 || discipline ? (
    <nav aria-labelledby="sport-groups-heading" className="mt-5" data-testid="group-nav">
      <h2 id="sport-groups-heading" className="mb-2 text-xs font-bold uppercase tracking-wider text-stone-600 dark:text-stone-400">{sport.name} Groups</h2>
      <ol className="flex flex-wrap gap-2 text-xs">
        {discipline && <li>
          <Link href={sportPath(sport.slug)} className="inline-block rounded-full border border-stone-300 px-3 py-1 font-semibold text-stone-700 hover:border-amber-500 dark:border-stone-700 dark:text-stone-300">All {sport.name}</Link>
        </li>}
        {disciplines.map((d) => (
          <li key={d.slug}>
            <Link href={disciplinePath(sport.slug, d.slug)} aria-current={discipline?.slug === d.slug ? 'page' : undefined} className={`inline-block rounded-full border px-3 py-1 font-semibold ${discipline?.slug === d.slug ? 'border-amber-600 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' : 'border-stone-300 text-stone-700 hover:border-amber-500 dark:border-stone-700 dark:text-stone-300'}`}>{d.icon && <span aria-hidden="true" className="mr-1">{d.icon}</span>}{d.name}</Link>
          </li>
        ))}
      </ol>
    </nav>
  ) : null;

  return (
    <div className="space-y-10">
      <RumPageType type="sport" />
      <JsonLd data={structuredData} />

      <Breadcrumbs items={discipline ? [{ label: sport.name, url: `/${sport.slug}` }, { label: discipline.name, url: disciplinePath(sport.slug, discipline.slug) }] : [{ label: sport.name, url: `/${sport.slug}` }]} />

      <PlacedBlocks placement="sport_top" />

      <SportHubTabs
        counts={{ all: articleTotal + eventTotal, events: eventTotal, articles: articleTotal - guideTotal, guides: guideTotal }}
        backdrop={heroImage ? <ResponsiveImage asset={heroImage} alt="" sizes="(min-width: 1024px) 58vw, (min-width: 640px) 70vw, 100vw" priority /> : undefined}
        hero={
          <div className="max-w-3xl">
            <div className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-500 mb-2">
              {discipline ? <>{discipline.icon && <span aria-hidden="true" className="mr-1.5 text-base">{discipline.icon}</span>}<Link href={sportPath(sport.slug)} className="hover:underline">{sport.name}</Link> · Group</> : 'Sport hub'}
            </div>
            <h1 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold text-stone-900 dark:text-stone-100 leading-tight">
              {label}
            </h1>
            {(discipline ? discipline.tagline : sport.tagline) && <p className="mt-2 text-lg font-serif italic text-stone-600 dark:text-stone-400">{discipline ? discipline.tagline : sport.tagline}</p>}
            {discipline
              ? discipline.description && <p className="mt-4 text-sm sm:text-base text-stone-700 dark:text-stone-300 leading-relaxed">{discipline.description}</p>
              : sport.description && <p className="mt-4 text-sm sm:text-base text-stone-700 dark:text-stone-300 leading-relaxed">{sport.description}</p>}
            {disciplineNav}
          </div>
        }
        ad={<AdSlot id="EVENT_TOP" />}
        featuredSection={featuredEvents.length > 0 ? (
          <section aria-labelledby="sport-featured-heading">
            <div className={sectionHead}><h2 id="sport-featured-heading" className={h2}>Featured {label} Events</h2></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">{featuredEvents.map((evt) => <EventCard key={evt.id} event={evt} />)}</div>
          </section>
        ) : null}
        upcomingSection={upcomingEditions.length > 0 ? (
          <section aria-labelledby="sport-upcoming-heading">
            <div className={sectionHead}>
              <h2 id="sport-upcoming-heading" className={h2}>Upcoming {label} Events</h2>
              <Link href={`/events/?sport=${sport.slug}&when=upcoming`} className={moreLink}>{discipline ? `Full ${sport.name} calendar` : 'Full calendar'} &rarr;</Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{upcomingEditions.map((ed) => <EditionLink key={ed.id} ed={ed} />)}</div>
          </section>
        ) : null}
        articlesSection={
          <section aria-labelledby="sport-articles-heading">
            <div className={sectionHead}>
              <h2 id="sport-articles-heading" className={h2}>Latest {label} Articles</h2>
              {articleTotal > latestArticles.length && <Link href={latestHref} className={moreLink}>All {articleTotal} articles &rarr;</Link>}
            </div>
            {latestArticles.length === 0 ? (
              <p className="text-xs text-stone-500 italic py-4 dark:text-stone-400">No articles published under this {scope} yet.</p>
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
              <h2 id="sport-events-heading" className={h2}>All {label} Events</h2>
              <span className="flex items-center gap-3 text-xs text-stone-500 tabular-nums dark:text-stone-400">
                {eventTotal} {eventTotal === 1 ? 'event' : 'events'}
                {eventTotal > 0 && <Link href={`/events/?sport=${sport.slug}`} className={moreLink}>{discipline ? `${sport.name} event calendar` : eventTotal > events.length ? `See all ${eventTotal}` : 'Event calendar'} &rarr;</Link>}
              </span>
            </div>
            {events.length === 0 ? (
              <p className="text-xs text-stone-500 italic py-4 dark:text-stone-400">No events registered for this {scope} yet.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">{events.map((evt) => <EventCard key={evt.id} event={evt} />)}</div>
            )}
          </section>
        }
        guidesSection={guides.length > 0 ? (
          <section aria-labelledby="general-guides-heading" className="rounded-xl bg-amber-50/50 dark:bg-amber-950/20 p-6 border border-amber-200/60 dark:border-amber-900/40">
            <div className="mb-4">
              <span className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">Guides &amp; information</span>
              <h2 id="general-guides-heading" className="font-serif text-xl font-bold text-stone-900 dark:text-stone-100">{label} Guides &amp; Information</h2>
              <p className="text-xs text-stone-600 dark:text-stone-400 mt-1">Rules, scoring, formats and other {label.toLowerCase()} information that is not tied to one event.</p>
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
            {guideTotal > guides.length && <p className="mt-4"><Link href={latestHref} className={moreLink}>More {label} articles &rarr;</Link></p>}
          </section>
        ) : null}
        exploreSection={
          <section aria-labelledby="sport-explore-heading">
            <div className={sectionHead}><h2 id="sport-explore-heading" className={h2}>Explore {sport.name}</h2></div>
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
              {discipline && <li><Link href={sportPath(sport.slug)} className="block rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] p-4 font-semibold hover:border-amber-500">All of {sport.name}</Link></li>}
              {discipline && <li><Link href={latestHref} className="block rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] p-4 font-semibold hover:border-amber-500">All {label.toLowerCase()} articles</Link></li>}
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
        faqSection={discipline ? null : <ContextFaq items={faqs} heading={`${sport.name}: frequently asked questions`} schemaEnabled={faqSchemaEnabled} />}
      />
    </div>
  );
};
