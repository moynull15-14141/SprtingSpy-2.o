/**
 * Public search service (PHASE B boundary, PHASE E internals, PHASE M unified).
 *
 * Articles and Events are both found and ranked by PostgreSQL full-text search
 * (services/search/articleSearch.ts, services/search/eventSearch.ts) with
 * publication/visibility rules enforced in SQL. `kind` selects the result type:
 *   ''        Articles (paginated) plus, on page 1, the top Events as a group
 *   'article' Articles only
 *   'event'   Events only (paginated)
 * Article-only filters (category, author, dates) do not apply to Events, so
 * the Event group is omitted while they are active. Matching sports remain a
 * small reference list on the first page of an unfiltered keyword search.
 */

import type { Prisma } from '../../generated/prisma/client';
import {
  _db as db,
  _summarize as summarize,
  _summarySelect as summarySelect,
  _summarizeEvents as summarizeEvents,
  _toSport as toSport,
  type EventSummary,
} from './content';
import { searchArticleIds, suggestArticleTitles, queryTerms, SEARCH_MAX_QUERY } from '../search/articleSearch';
import { searchEventIds, suggestEvents, type EventSearchHit } from '../search/eventSearch';
import type { SearchQuery } from '../search/params';
import { articlePath, editionPath, eventPath, sportPath } from '../../../src/lib/paths';

export { SEARCH_MAX_QUERY };
export const SEARCH_PAGE_SIZE = 12;
/** Events shown above the Article list in an "All" search. */
export const EVENT_GROUP_SIZE = 4;

export type PublicSearchInput = Pick<SearchQuery, 'q' | 'kind' | 'sport' | 'type' | 'author' | 'from' | 'to' | 'sort' | 'page'> & { limit?: number };
export type EventResult = EventSummary & { url: string; matchedEdition?: { year: number; title: string; url: string } };

/** Hydrates ranked Event hits (one query + the shared summarizer), keeping rank order. */
async function hydrateEvents(hits: EventSearchHit[]): Promise<EventResult[]> {
  if (!hits.length) return [];
  const prisma = await db();
  const rows = await prisma.sportEvent.findMany({ where: { id: { in: hits.map((h) => h.id) } } });
  const byId = new Map((await summarizeEvents(rows)).map((e) => [e.id, e]));
  return hits.flatMap((h) => {
    const event = byId.get(h.id);
    if (!event) return [];
    return [{
      ...event,
      url: eventPath(event.sportSlug, event.slug),
      ...(h.edition ? { matchedEdition: { ...h.edition, url: editionPath(event.sportSlug, event.slug, h.edition.year) } } : {}),
    }];
  });
}

export async function searchPublic(input: PublicSearchInput) {
  const prisma = await db();
  const query = input.q;
  const kind = input.kind ?? '';
  const hasTerms = queryTerms(query).length > 0;
  const text = (fields: string[]) =>
    hasTerms ? { OR: fields.map((f) => ({ [f]: { contains: query, mode: 'insensitive' as const } })) } : {};

  // An unknown author slug must filter to nothing, not be ignored.
  const author = input.author ? await prisma.author.findUnique({ where: { slug: input.author }, select: { id: true, name: true } }) : null;
  const authorId = input.author ? author?.id ?? '__none__' : undefined;
  const pageSize = input.limit ?? SEARCH_PAGE_SIZE;
  const articleOnlyFilters = !!(input.type || input.author || input.from || input.to);

  const articleParams = { scope: 'public' as const, q: query, sport: input.sport || undefined, type: input.type || undefined, authorId, from: input.from, to: input.to, sort: input.sort };
  // Events: paginated in the Events view; a small first-page group in "All" (keyword searches only).
  const eventGroup = kind === '' && hasTerms && !articleOnlyFilters;
  const eventPage = kind === 'event' ? input.page : 1;
  const eventLimit = kind === 'event' ? pageSize : EVENT_GROUP_SIZE;
  const showReference = kind === '' && hasTerms && input.page === 1 && !articleOnlyFilters;

  const [articleFound, eventFound, sportRows, filterSports, filterAuthors] = await Promise.all([
    // In the Events view only the Article count (for the type tabs) is needed.
    searchArticleIds({ ...articleParams, page: kind === 'event' ? 1 : input.page, limit: kind === 'event' ? 1 : pageSize }),
    kind === 'event' || eventGroup || (kind === 'article' && hasTerms)
      ? searchEventIds({ q: query, sport: input.sport || undefined, page: eventPage, limit: kind === 'article' ? 1 : eventLimit })
      : Promise.resolve(null),
    showReference && !input.sport
      ? prisma.sport.findMany({ where: { isVisible: true, ...(text(['name', 'description']) as Prisma.SportWhereInput) }, orderBy: { order: 'asc' }, take: 6 })
      : Promise.resolve([]),
    prisma.sport.findMany({ where: { isVisible: true }, orderBy: { order: 'asc' }, select: { id: true, slug: true, name: true } }),
    prisma.author.findMany({ orderBy: { name: 'asc' }, select: { slug: true, name: true } }),
  ]);

  // Hydrate the page of Article ids, keeping the rank order from the search.
  const articleIds = kind === 'event' ? [] : articleFound.ids;
  const rows = articleIds.length ? await prisma.article.findMany({ where: { id: { in: articleIds } }, select: summarySelect }) : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = articleIds.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => !!r);
  const eventHits = eventFound && kind !== 'article' && (kind === 'event' || input.page === 1) ? eventFound.hits : [];
  const [articles, events] = await Promise.all([summarize(ordered), hydrateEvents(eventHits)]);

  const eventTotal = eventFound?.total ?? 0;
  const paged = kind === 'event'
    ? { total: eventTotal, page: eventFound!.page, pageSize: eventFound!.pageSize, mode: eventFound!.mode }
    : { total: articleFound.total, page: articleFound.page, pageSize: articleFound.pageSize, mode: articleFound.mode };

  return {
    query,
    kind,
    sports: sportRows.map(toSport),
    events,
    eventTotal,
    eventMode: eventFound?.mode ?? 'fulltext',
    articles,
    articleTotal: articleFound.total,
    /** Whether Events were searched at all for this request (false while article-only filters are active in "All"). */
    eventsSearched: !!eventFound,
    page: paged.page,
    pageSize: paged.pageSize,
    /** Pages of the paginated result type (Articles, or Events in the Events view). */
    totalPages: Math.max(1, Math.ceil(paged.total / paged.pageSize)),
    mode: paged.mode,
    filterSports,
    filterAuthors,
    /** PHASE R: active Article Types (database-backed) for the category filter. */
    filterTypes: (await (await import('../../articleTypes')).activeArticleTypes()).map((t) => t.name),
  };
}

export type PublicSearchData = Awaited<ReturnType<typeof searchPublic>>;

/** Autocomplete: matching sports, visible Events and published Article titles, each URL at most once. */
export async function publicSuggestions(q: string) {
  const prisma = await db();
  const hasTerms = queryTerms(q).length > 0 && q.length >= 2;
  if (!hasTerms) return { articles: [], sports: [], events: [] };
  const [titles, sports, events] = await Promise.all([
    suggestArticleTitles({ q, scope: 'public', limit: 6 }),
    prisma.sport.findMany({ where: { isVisible: true, name: { contains: q, mode: 'insensitive' } }, orderBy: { order: 'asc' }, take: 3, select: { slug: true, name: true } }),
    suggestEvents({ q, limit: 3 }),
  ]);
  const rows = titles.length
    ? await prisma.article.findMany({ where: { id: { in: titles.map((t) => t.id) } }, select: { id: true, slug: true, sportSlug: true, eventSlug: true, editionYear: true } })
    : [];
  const pathById = new Map(rows.map((r) => [r.id, articlePath(r)]));
  const sportNames = new Map((await prisma.sport.findMany({ where: { slug: { in: [...new Set(titles.map((t) => t.sportSlug))] } }, select: { slug: true, name: true } })).map((s) => [s.slug, s.name]));
  const seen = new Set<string>();
  const once = (url: string) => (seen.has(url) ? false : (seen.add(url), true));
  return {
    sports: sports.map((s) => ({ name: s.name, url: sportPath(s.slug) })).filter((s) => once(s.url)),
    events: events.map((e) => ({ name: e.name, url: eventPath(e.sportSlug, e.slug), sportName: e.sportName })).filter((e) => once(e.url)),
    articles: titles
      .map((t) => ({ title: t.title, url: pathById.get(t.id) || '', sportName: sportNames.get(t.sportSlug) || t.sportSlug, articleType: t.articleType }))
      .filter((a) => a.url && once(a.url)),
  };
}
