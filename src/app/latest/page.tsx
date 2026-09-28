import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LatestArticlesPage } from '../../views/LatestArticlesPage';
import { getLatest } from '../../lib/data';
import { pageMetadata } from '../../lib/seo';
import { articleTypeParam, firstParam, pageParam, slugParam, type SearchParams } from '../../lib/params';

async function readParams(searchParams: SearchParams) {
  const params = await searchParams;
  return {
    sport: slugParam(params.sport),
    type: articleTypeParam(params.type),
    page: pageParam(params.page),
    invalid: (!!firstParam(params.sport) && !slugParam(params.sport)) || (!!firstParam(params.type) && !articleTypeParam(params.type)),
  };
}

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const { sport, type, page } = await readParams(searchParams);
  const paged = page && page > 1;
  return pageMetadata({
    title: `Latest Sports Editorial, Schedules & Analysis${paged ? ` – Page ${page}` : ''} | SportingSpy`,
    description: 'Freshly published tournament schedules, broadcast channel guides, prize money data, and technical sports analysis.',
    // Pages of the unfiltered wire are canonical to themselves; filtered
    // combinations are noindex and point at the unfiltered listing.
    path: paged && !sport && !type ? `/latest/?page=${page}` : '/latest/',
    noindex: !!(sport || type),
  });
}

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const { sport, type, page, invalid } = await readParams(searchParams);
  if (invalid || page === null) notFound();
  const data = await getLatest({ sport: sport || undefined, type: type || undefined, page });
  if (page > data.totalPages) notFound();
  return <LatestArticlesPage data={data} selectedSport={sport} selectedType={type} currentPage={page} />;
}
