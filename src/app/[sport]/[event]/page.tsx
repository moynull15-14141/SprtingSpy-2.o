import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EventPage } from '../../../views/EventPage';
import { getArticlePage, getEventPage } from '../../../lib/data';
import { descriptionFrom, pageMetadata } from '../../../lib/seo';
import { eventPath } from '../../../lib/paths';
import { articleMetadata, renderArticle } from '../../../lib/articleRoute';

// /{sport}/{segment}/ is either a permanent event or an article without an
// edition (e.g. /tennis/tennis-scoring/). Events take precedence, exactly as
// in the previous router.
type Params = Promise<{ sport: string; event: string }>;

async function resolve(params: Params) {
  const { sport, event } = await params;
  const eventData = await getEventPage(sport, event);
  if (eventData) return { kind: 'event' as const, data: eventData };
  const articleData = await getArticlePage(sport, event);
  if (articleData) return { kind: 'article' as const, data: articleData };
  return null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const found = await resolve(params);
  if (!found) return {};
  if (found.kind === 'article') return articleMetadata(found.data);
  const { event, sport } = found.data;
  return pageMetadata({
    title: `${event.name} – History, Editions & Guides | SportingSpy`,
    description: descriptionFrom(event.description, `${event.name} – ${sport.name} event guide on SportingSpy.`),
    path: eventPath(sport.slug, event.slug),
    seo: event.seo,
    image: event.featuredImage,
  });
}

export default async function Page({ params }: { params: Params }) {
  const found = await resolve(params);
  if (!found) notFound();
  return found.kind === 'event' ? <EventPage data={found.data} /> : renderArticle(found.data);
}
