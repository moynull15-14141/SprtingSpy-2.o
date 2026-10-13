import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EventPage } from '../../../views/EventPage';
import { SportPage } from '../../../views/SportPage';
import { getArticlePage, getDisciplineHub, getEventPage } from '../../../lib/data';
import { descriptionFrom, pageMetadata } from '../../../lib/seo';
import { disciplinePath, eventPath } from '../../../lib/paths';
import { disciplineIndexability } from '../../../lib/indexability';
import { articleMetadata, renderArticle } from '../../../lib/articleRoute';

// /{sport}/{segment}/ is a permanent event, a discipline's landing page, or an
// article without an edition (e.g. /tennis/tennis-scoring/).
//
// Resolution order: event, then article, then discipline. The first two are
// exactly the previous behaviour, so every URL that showed an event or an
// article before still shows it. A discipline is tried only when neither
// exists, so its page can never take over an existing URL. The three slug
// sets are also kept disjoint on every write (server/urlStability.ts): for
// valid data at most one of the three lookups finds anything.
type Params = Promise<{ sport: string; event: string }>;

async function resolve(params: Params) {
  const { sport, event } = await params;
  const eventData = await getEventPage(sport, event);
  if (eventData) return { kind: 'event' as const, data: eventData };
  const articleData = await getArticlePage(sport, event);
  if (articleData) return { kind: 'article' as const, data: articleData };
  const disciplineData = await getDisciplineHub(sport, event);
  if (disciplineData) return { kind: 'discipline' as const, data: disciplineData };
  return null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const found = await resolve(params);
  if (!found) return {};
  if (found.kind === 'article') return articleMetadata(found.data);
  if (found.kind === 'discipline') {
    const { sport, discipline, articleTotal, eventTotal } = found.data;
    // Same rule as the sitemap: retired or empty discipline pages render but are not index targets.
    const indexability = disciplineIndexability({ sportVisible: true, isVisible: true, isActive: discipline!.isActive, seo: discipline!.seo, publishedArticleCount: articleTotal, visibleEventCount: eventTotal });
    return pageMetadata({
      noindex: !indexability.indexable,
      title: `${discipline!.name} – ${sport.name} Events, Guides & Articles | SportingSpy`,
      description: descriptionFrom(discipline!.description, `${discipline!.name}: ${sport.name} events, editions and articles on SportingSpy.`),
      path: disciplinePath(sport.slug, discipline!.slug),
      seo: discipline!.seo,
      // The group's own image only; without one the site default applies (never the sport's).
      image: discipline!.heroImage ?? undefined,
    });
  }
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
  if (found.kind === 'discipline') return <SportPage data={found.data} />;
  return found.kind === 'event' ? <EventPage data={found.data} /> : renderArticle(found.data);
}
