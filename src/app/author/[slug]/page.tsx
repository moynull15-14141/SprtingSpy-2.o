import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AuthorPage } from '../../../views/AuthorPage';
import { getAuthorPage } from '../../../lib/data';
import { pageMetadata } from '../../../lib/seo';
import { authorPath } from '../../../lib/paths';
import { authorIndexability } from '../../../lib/indexability';

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const data = await getAuthorPage((await params).slug);
  if (!data) return {};
  const { author } = data;
  return pageMetadata({
    // PHASE D: an author page with no published articles is thin (noindex), as in the sitemap.
    noindex: !authorIndexability(data.articles.length).indexable,
    title: `${author.name} – ${author.roleTitle} | SportingSpy`,
    description: author.bio,
    path: authorPath(author.slug),
    image: author.avatar,
    openGraph: { type: 'profile' },
  });
}

export default async function Page({ params }: { params: Params }) {
  const data = await getAuthorPage((await params).slug);
  if (!data) notFound();
  return <AuthorPage data={data} />;
}
