import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EventsDirectoryPage } from '../../views/EventsDirectoryPage';
import { getEventsDirectory } from '../../lib/data';
import { pageMetadata } from '../../lib/seo';
import { firstParam, slugParam, type SearchParams } from '../../lib/params';

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const filtered = !!firstParam((await searchParams).sport);
  return pageMetadata({
    title: 'Permanent Sporting Events & Championships | SportingSpy',
    description: 'Comprehensive index of global sports championships, Grand Slams, endurance races, and major tournaments.',
    path: '/events/',
    // Filtered views are navigation aids, not separate indexable pages (Spec §17/§18).
    noindex: filtered,
  });
}

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const raw = firstParam((await searchParams).sport);
  const sport = slugParam(raw);
  if (raw && !sport) notFound();
  const data = await getEventsDirectory(sport || undefined);
  if (sport && !data.sports.some((s) => s.slug === sport)) notFound();
  return <EventsDirectoryPage data={data} filterSport={sport} />;
}
