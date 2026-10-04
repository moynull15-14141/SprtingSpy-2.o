import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SportPage } from '../../views/SportPage';
import { getSportHub } from '../../lib/data';
import { pageMetadata } from '../../lib/seo';
import { sportPath } from '../../lib/paths';
import { sportIndexability } from '../../lib/indexability';

type Params = Promise<{ sport: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const data = await getSportHub((await params).sport);
  if (!data) return {};
  const { sport } = data;
  // PHASE D: same rule as the sitemap — a hub with no content is thin (noindex).
  const indexability = sportIndexability({ isVisible: true, seo: sport.seo, publishedArticleCount: data.articleTotal, visibleEventCount: data.eventTotal });
  return pageMetadata({
    noindex: !indexability.indexable,
    title: `${sport.name} Guides, Tournament Schedules & Records | SportingSpy`,
    description: sport.description,
    path: sportPath(sport.slug),
    seo: sport.seo,
    image: sport.heroImage,
  });
}

export default async function Page({ params }: { params: Params }) {
  const data = await getSportHub((await params).sport);
  if (!data) notFound();
  return <SportPage data={data} />;
}
