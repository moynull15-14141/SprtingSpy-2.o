import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SportPage } from '../../views/SportPage';
import { getPublishedPage, getSportHub } from '../../lib/data';
import { pageMetadata } from '../../lib/seo';
import { sportPath } from '../../lib/paths';
import { sportIndexability } from '../../lib/indexability';
import { CmsPageBody, cmsPageMetadata } from '../../lib/pageRoute';

type Params = Promise<{ sport: string }>;

// PHASE PAGES: /{slug}/ is a sport hub or, when no sport has that slug, a
// published CMS page. The API keeps the two slug sets disjoint.

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const slug = (await params).sport;
  const data = await getSportHub(slug);
  if (!data) {
    const page = await getPublishedPage(slug);
    return page ? cmsPageMetadata(page.page) : {};
  }
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
  const slug = (await params).sport;
  const data = await getSportHub(slug);
  if (data) return <SportPage data={data} />;
  const page = await getPublishedPage(slug);
  if (!page) notFound();
  return <CmsPageBody view={page} />;
}
