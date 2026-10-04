import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EventEditionPage } from '../../../../views/EventEditionPage';
import { getEditionPage } from '../../../../lib/data';
import { descriptionFrom, pageMetadata } from '../../../../lib/seo';
import { editionPath } from '../../../../lib/paths';
import { yearParam } from '../../../../lib/params';

type Params = Promise<{ sport: string; event: string; year: string }>;

async function load(params: Params) {
  const { sport, event, year } = await params;
  const y = yearParam(year);
  return y === null ? null : getEditionPage(sport, event, y);
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const data = await load(params);
  if (!data) return {};
  const { sport, event, edition } = data;
  return pageMetadata({
    title: `${edition.title} – Official Dates, Venue & Guides | SportingSpy`,
    description: descriptionFrom(edition.description, `${edition.title} – ${event.name} edition guide on SportingSpy.`),
    // Same rule as the sitemap (editionIndexability): an Edition of a noindexed Event is not indexable.
    noindex: !!event.seo?.noIndex,
    path: editionPath(sport.slug, event.slug, edition.year),
    seo: edition.seo,
    image: edition.featuredImage,
  });
}

export default async function Page({ params }: { params: Params }) {
  const data = await load(params);
  if (!data) notFound();
  return <EventEditionPage data={data} />;
}
