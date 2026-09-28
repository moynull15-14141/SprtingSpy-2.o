import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getArticlePage } from '../../../../../lib/data';
import { yearParam } from '../../../../../lib/params';
import { articleMetadata, renderArticle } from '../../../../../lib/articleRoute';

type Params = Promise<{ sport: string; event: string; year: string; article: string }>;

async function load(params: Params) {
  const { sport, event, year, article } = await params;
  const y = yearParam(year);
  return y === null ? null : getArticlePage(sport, article, event, y);
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const data = await load(params);
  return data ? articleMetadata(data) : {};
}

export default async function Page({ params }: { params: Params }) {
  const data = await load(params);
  if (!data) notFound();
  return renderArticle(data);
}
