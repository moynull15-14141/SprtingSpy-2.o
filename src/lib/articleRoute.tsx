/** Shared metadata + rendering for the two article URL shapes. */
import type { Metadata } from 'next';
import { ArticlePage } from '../views/ArticlePage';
import { getApprovedComments, getFeatures, getSiteIdentity } from './data';
import type { getArticlePage } from '../../server/services/public/content';
import { pageMetadata } from './seo';
import { articlePath } from './paths';

type ArticleData = NonNullable<Awaited<ReturnType<typeof getArticlePage>>>;

export function articleMetadata({ article, sport, author, featuredImage }: ArticleData): Promise<Metadata> {
  return pageMetadata({
    title: `${article.title} | SportingSpy`,
    description: article.excerpt,
    path: articlePath(article),
    seo: article.seo,
    image: article.featuredImage,
    imageAlt: featuredImage?.alt,
    openGraph: {
      type: 'article',
      publishedTime: article.publishedAt,
      modifiedTime: article.updatedAt || article.publishedAt,
      section: sport.name,
      ...(author ? { authors: [author.name] } : {}),
    },
  });
}

export async function renderArticle(data: ArticleData) {
  const [comments, identity] = await Promise.all([getFeatures().comments ? getApprovedComments(data.article.id) : Promise.resolve(null), getSiteIdentity()]);
  return <ArticlePage data={data} comments={comments} siteName={identity.name} />;
}
