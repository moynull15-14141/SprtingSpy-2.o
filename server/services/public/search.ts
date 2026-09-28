/**
 * Public search service (PHASE B boundary, PHASE E internals).
 *
 * Articles are found and ranked by the shared PostgreSQL full-text search
 * (services/search/articleSearch.ts) with publication visibility enforced in
 * SQL. Sports and championship events are small reference tables and keep a
 * simple case-insensitive match, shown on the first page of a keyword search.
 */

import type { Prisma } from '../../generated/prisma/client';
import {
  _db as db,
  _summarize as summarize,
  _summarySelect as summarySelect,
  _summarizeEvents as summarizeEvents,
  _visibleEventWhere as visibleEventWhere,
  _toSport as toSport,
} from './content';
import { searchArticleIds, suggestArticleTitles, queryTerms, SEARCH_MAX_QUERY } from '../search/articleSearch';
import type { SearchQuery } from '../search/params';
import { articlePath, sportPath } from '../../../src/lib/paths';

export { SEARCH_MAX_QUERY };
export const SEARCH_PAGE_SIZE = 12;

export type PublicSearchInput = Pick<SearchQuery, 'q' | 'sport' | 'type' | 'author' | 'from' | 'to' | 'sort' | 'page'> & { limit?: number };

export async function searchPublic(input: PublicSearchInput) {
  const prisma = await db();
  const query = input.q;
  const hasTerms = queryTerms(query).length > 0;
  const text = (fields: string[]) =>
    hasTerms ? { OR: fields.map((f) => ({ [f]: { contains: query, mode: 'insensitive' as const } })) } : {};

  // An unknown author slug must filter to nothing, not be ignored.
  const author = input.author ? await prisma.author.findUnique({ where: { slug: input.author }, select: { id: true, name: true } }) : null;
  const authorId = input.author ? author?.id ?? '__none__' : undefined;
  const pageSize = input.limit ?? SEARCH_PAGE_SIZE;

  const showReference = hasTerms && input.page === 1 && !input.type && !input.author && !input.from && !input.to;
  const [found, sportRows, eventRows, filterSports, filterAuthors] = await Promise.all([
    searchArticleIds({ scope: 'public', q: query, sport: input.sport || undefined, type: input.type || undefined, authorId, from: input.from, to: input.to, sort: input.sort, page: input.page, limit: pageSize }),
    showReference && !input.sport
      ? prisma.sport.findMany({ where: { isVisible: true, ...(text(['name', 'description']) as Prisma.SportWhereInput) }, orderBy: { order: 'asc' }, take: 6 })
      : Promise.resolve([]),
    showReference
      ? prisma.sportEvent.findMany({ where: visibleEventWhere({ ...(text(['name', 'shortName', 'description', 'defaultVenue']) as Prisma.SportEventWhereInput), ...(input.sport ? { sportSlug: input.sport } : {}) }), take: 6 })
      : Promise.resolve([]),
    prisma.sport.findMany({ where: { isVisible: true }, orderBy: { order: 'asc' }, select: { id: true, slug: true, name: true } }),
    prisma.author.findMany({ orderBy: { name: 'asc' }, select: { slug: true, name: true } }),
  ]);

  // Hydrate the page of ids, keeping the rank order from the search.
  const rows = found.ids.length ? await prisma.article.findMany({ where: { id: { in: found.ids } }, select: summarySelect }) : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = found.ids.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => !!r);
  const [articles, events] = await Promise.all([summarize(ordered), summarizeEvents(eventRows)]);

  return {
    query,
    sports: sportRows.map(toSport),
    events,
    articles,
    articleTotal: found.total,
    page: found.page,
    pageSize: found.pageSize,
    totalPages: Math.max(1, Math.ceil(found.total / found.pageSize)),
    mode: found.mode,
    filterSports,
    filterAuthors,
  };
}

export type PublicSearchData = Awaited<ReturnType<typeof searchPublic>>;

/** Autocomplete: a few matching published titles plus matching sports. */
export async function publicSuggestions(q: string) {
  const prisma = await db();
  const hasTerms = queryTerms(q).length > 0 && q.length >= 2;
  if (!hasTerms) return { articles: [], sports: [] };
  const [titles, sports] = await Promise.all([
    suggestArticleTitles({ q, scope: 'public', limit: 6 }),
    prisma.sport.findMany({ where: { isVisible: true, name: { contains: q, mode: 'insensitive' } }, orderBy: { order: 'asc' }, take: 3, select: { slug: true, name: true } }),
  ]);
  const rows = titles.length
    ? await prisma.article.findMany({ where: { id: { in: titles.map((t) => t.id) } }, select: { id: true, slug: true, sportSlug: true, eventSlug: true, editionYear: true } })
    : [];
  const pathById = new Map(rows.map((r) => [r.id, articlePath(r)]));
  const sportNames = new Map((await prisma.sport.findMany({ where: { slug: { in: [...new Set(titles.map((t) => t.sportSlug))] } }, select: { slug: true, name: true } })).map((s) => [s.slug, s.name]));
  return {
    articles: titles.map((t) => ({ title: t.title, url: pathById.get(t.id) || '/search/', sportName: sportNames.get(t.sportSlug) || t.sportSlug, articleType: t.articleType })),
    sports: sports.map((s) => ({ name: s.name, url: sportPath(s.slug) })),
  };
}
