import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EventsDirectoryPage } from '../../views/EventsDirectoryPage';
import { getEventsDirectory } from '../../lib/data';
import { pageMetadata } from '../../lib/seo';
import { firstParam, pageParam, slugParam, type SearchParams } from '../../lib/params';
import { timingParam, type EditionTiming } from '../../lib/eventTiming';
import { RumPageType } from '../../components/analytics/RumPageType';

async function readParams(searchParams: SearchParams) {
  const params = await searchParams;
  const when = timingParam(params.when);
  return {
    sport: slugParam(params.sport),
    when: (when || '') as EditionTiming | '',
    page: pageParam(params.page),
    invalid: (!!firstParam(params.sport) && !slugParam(params.sport)) || when === null,
  };
}

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const { sport, when, page } = await readParams(searchParams);
  const filtered = !!(sport || when);
  const paged = !!page && page > 1;
  return pageMetadata({
    title: `Permanent Sporting Events & Championships${paged ? ` – Page ${page}` : ''} | SportingSpy`,
    description: 'Comprehensive index of global sports championships, Grand Slams, endurance races, and major tournaments.',
    // Pages of the unfiltered index are canonical to themselves; sport/timing
    // views are navigation aids, not separate indexable pages (Spec §17/§18).
    path: paged && !filtered ? `/events/?page=${page}` : '/events/',
    noindex: filtered,
  });
}

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const { sport, when, page, invalid } = await readParams(searchParams);
  if (invalid || page === null) notFound();
  const data = await getEventsDirectory({ sport: sport || undefined, when: when || undefined, page });
  if (sport && !data.sports.some((s) => s.slug === sport)) notFound();
  if (page > data.totalPages) notFound();
  return <><RumPageType type="events" /><EventsDirectoryPage data={data} filterSport={sport} /></>;
}
