import React from 'react';
import Link from 'next/link';
import { CalendarDays, ExternalLink, MapPin, Trophy } from 'lucide-react';
import { Breadcrumbs } from '../components/ui/Breadcrumbs';
import { ArticleCard } from '../components/editorial/ArticleCard';
import { EventCard } from '../components/editorial/EventCard';
import { CardImage } from '../components/editorial/CardImage';
import { DynamicPublicEventFields } from '../components/editorial/DynamicPublicEventFields';
import { JsonLd } from '../components/seo/JsonLd';
import { AdSlot } from '../components/ui/AdSlot';
import { absoluteUrl, editionPath } from '../lib/paths';
import type { EventEdition } from '../types';
import type { getEventPage } from '../../server/services/public/content';

type EventPageData = NonNullable<Awaited<ReturnType<typeof getEventPage>>>;
const longDate = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const editionDates = (edition: EventEdition) => edition.startDate && edition.endDate ? `${longDate(edition.startDate)} – ${longDate(edition.endDate)}` : edition.startDate ? longDate(edition.startDate) : edition.endDate ? longDate(edition.endDate) : null;
const schemaStatus = (status: EventEdition['status']) => status === 'completed' ? 'https://schema.org/EventCompleted' : status === 'upcoming' || status === 'active' ? 'https://schema.org/EventScheduled' : undefined;
const absoluteMedia = (url: string) => /^https?:\/\//i.test(url) ? url : absoluteUrl(url.startsWith('/') ? url : `/${url}`);

export const EventPage: React.FC<{ data: EventPageData }> = ({ data }) => {
  const { sport, event, sportConfiguration, sportSpecificValues, editions, articles, currentEdition, relatedEvents } = data;
  const terminology = sportConfiguration.terminology;
  const currentDates = currentEdition ? editionDates(currentEdition) : null;
  const detailRows = [
    { label: 'Sport', value: sport.name, icon: Trophy },
    { label: 'Type', value: event.eventType, icon: Trophy },
    { label: 'Frequency', value: event.frequency, icon: CalendarDays },
    { label: terminology.venue, value: event.defaultVenue, icon: MapPin },
    { label: 'Location', value: event.defaultLocation, icon: MapPin },
  ].filter((row) => row.value);

  const eventSchema = currentEdition?.startDate ? {
    '@context': 'https://schema.org', '@type': 'SportsEvent', name: currentEdition.title || event.name,
    ...(event.description ? { description: event.description } : {}), startDate: currentEdition.startDate,
    ...(currentEdition.endDate ? { endDate: currentEdition.endDate } : {}), ...(schemaStatus(currentEdition.status) ? { eventStatus: schemaStatus(currentEdition.status) } : {}),
    url: absoluteUrl(editionPath(sport.slug, event.slug, currentEdition.year)),
    ...(currentEdition.featuredImage || event.featuredImage ? { image: [absoluteMedia(currentEdition.featuredImage || event.featuredImage!)] } : {}),
    ...(currentEdition.venue || currentEdition.location ? { location: { '@type': 'Place', ...(currentEdition.venue ? { name: currentEdition.venue } : {}), ...(currentEdition.location ? { address: currentEdition.location } : {}) } } : {}),
  } : null;

  return <div className="min-w-0 space-y-10">
    {eventSchema && <JsonLd data={eventSchema} />}
    <Breadcrumbs items={[{ label: 'Sports', url: '/sports' }, { label: sport.name, url: `/${sport.slug}` }, { label: event.name }]} />

    <header className="overflow-hidden rounded-2xl border border-stone-200 bg-stone-900 shadow-sm dark:border-stone-800">
      <div className="relative aspect-[16/7] min-h-64 max-h-[34rem]">
        <CardImage src={event.featuredImage} alt={event.name} loading="eager" className="h-full w-full object-cover" fallback={<div className="h-full w-full bg-[radial-gradient(circle_at_80%_20%,rgba(217,119,6,0.28),transparent_34%),linear-gradient(135deg,#1c1917,#0c0a09)]" aria-hidden="true" />} />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/45 to-black/10" aria-hidden="true" />
        <div className="absolute inset-x-0 bottom-0 p-5 text-white sm:p-8 lg:p-10">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-300">{sport.name} · {terminology.event}</p>
          <h1 className="mt-2 max-w-5xl break-words font-serif text-3xl font-bold leading-tight sm:text-4xl lg:text-5xl">{event.name}</h1>
          {event.shortName && event.shortName !== event.name && <p className="mt-2 text-sm text-stone-200 sm:text-base">{event.shortName}</p>}
        </div>
      </div>
    </header>

    <AdSlot id="EVENT_TOP" />
    <div className="grid min-w-0 items-start gap-7 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)] xl:gap-10">
      <main className="min-w-0 space-y-7">
        {event.description && <section aria-labelledby="about-event-heading" className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-[#121417] sm:p-7">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700 dark:text-amber-500">Overview</p>
          <h2 id="about-event-heading" className="mt-1 font-serif text-2xl font-bold">About this {terminology.event}</h2>
          <p className="mt-4 whitespace-pre-line text-base leading-8 text-stone-700 dark:text-stone-300">{event.description}</p>
        </section>}
        <DynamicPublicEventFields fields={sportConfiguration.fields} values={sportSpecificValues} />
        {event.history && <section aria-labelledby="history-heading" className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-[#121417] sm:p-7">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700 dark:text-amber-500">Archive</p><h2 id="history-heading" className="mt-1 font-serif text-2xl font-bold">History and heritage</h2>
          <p className="mt-4 whitespace-pre-line text-sm leading-7 text-stone-700 dark:text-stone-300">{event.history}</p>
        </section>}

        {editions.length > 0 && <section aria-labelledby="editions-heading">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2 border-b border-stone-200 pb-3 dark:border-stone-800"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700 dark:text-amber-500">Edition archive</p><h2 id="editions-heading" className="font-serif text-2xl font-bold">{event.name} editions</h2></div><span className="text-xs text-stone-500 dark:text-stone-400">{editions.length} {editions.length === 1 ? 'edition' : 'editions'}</span></div>
          <div className="grid gap-5 sm:grid-cols-2">{editions.map((edition) => {
            const dates = editionDates(edition);
            return <article key={edition.id} className="group overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-[#121417]"><Link href={editionPath(sport.slug, event.slug, edition.year)} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500">
              <div className="aspect-[16/8] overflow-hidden bg-stone-900"><CardImage src={edition.featuredImage ?? undefined} alt={edition.title} loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" fallback={<div className="flex h-full items-center justify-center bg-gradient-to-br from-stone-800 to-stone-950 px-6 text-center font-serif text-lg text-stone-300">{edition.title}</div>} /></div>
              <div className="p-5"><div className="flex items-center justify-between gap-3"><span className="font-mono text-sm font-bold">{edition.year}</span><span className="text-[10px] font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400">{edition.status}</span></div><h3 className="mt-2 break-words font-serif text-xl font-bold group-hover:text-amber-700 dark:group-hover:text-amber-400">{edition.title}</h3><div className="mt-3 space-y-1 text-xs leading-relaxed text-stone-600 dark:text-stone-400">{dates && <p>{dates}</p>}{edition.venue && <p>{edition.venue}</p>}{edition.location && <p>{edition.location}</p>}</div><span className="mt-4 inline-block text-xs font-semibold text-amber-700 dark:text-amber-400">View edition guide <span aria-hidden="true">→</span></span></div>
            </Link></article>;
          })}</div>
        </section>}

        {articles.length > 0 && <section aria-labelledby="coverage-heading"><div className="mb-4 border-b border-stone-200 pb-3 dark:border-stone-800"><p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700 dark:text-amber-500">Editorial</p><h2 id="coverage-heading" className="font-serif text-2xl font-bold">Coverage of {event.name}</h2></div><div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{articles.map((article) => <ArticleCard key={article.id} article={article} variant="standard" />)}</div></section>}
      </main>

      <aside className="min-w-0 space-y-5 lg:sticky lg:top-6" aria-label="Event details">
        {detailRows.length > 0 && <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-[#121417]"><h2 className="font-serif text-xl font-bold">{terminology.event} details</h2><dl className="mt-4 divide-y divide-stone-100 dark:divide-stone-800">{detailRows.map(({ label, value, icon: Icon }) => <div key={label} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2 py-3"><Icon aria-hidden="true" className="mt-0.5 text-amber-700 dark:text-amber-500" size={16} /><div><dt className="text-xs font-semibold text-stone-500 dark:text-stone-400">{label}</dt><dd className="mt-0.5 break-words text-sm font-medium">{value}</dd></div></div>)}</dl>{event.officialSourceUrl && <a href={event.officialSourceUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 hover:underline dark:text-amber-400">Official website <ExternalLink size={13} aria-hidden="true" /></a>}</section>}
        {currentEdition && <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5 dark:border-amber-900/60 dark:bg-amber-950/20"><p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700 dark:text-amber-400">Current Edition:</p><h2 className="mt-1 break-words font-serif text-xl font-bold">{currentEdition.title}</h2><div className="mt-3 space-y-1 text-sm text-stone-700 dark:text-stone-300">{currentDates && <p>{currentDates}</p>}{currentEdition.venue && <p>{currentEdition.venue}</p>}{currentEdition.location && <p>{currentEdition.location}</p>}<p className="capitalize">Status: {currentEdition.status}</p></div><Link href={editionPath(sport.slug, event.slug, currentEdition.year)} className="mt-4 inline-flex rounded-lg bg-amber-700 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500">View {currentEdition.year} edition</Link></section>}
      </aside>
    </div>

    {relatedEvents.length > 0 && <section aria-labelledby="related-events-heading"><div className="mb-4 border-b border-stone-200 pb-3 dark:border-stone-800"><p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700 dark:text-amber-500">More in {sport.name}</p><h2 id="related-events-heading" className="font-serif text-2xl font-bold">Related events</h2></div><div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{relatedEvents.map((related) => <EventCard key={related.id} event={related} />)}</div></section>}
  </div>;
};
