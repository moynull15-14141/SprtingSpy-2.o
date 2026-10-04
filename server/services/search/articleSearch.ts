/**
 * Article search (PHASE E) — the single search implementation behind public
 * search, the public/suggestion APIs, CMS article search and the editor's
 * Internal Link / Related Story selectors.
 *
 * Strategy (PostgreSQL native, no external engine):
 * - `Article.searchVector` is a STORED generated tsvector (migration
 *   20260929090000_phase_e_search) weighted A title, B subtitle/type/sport/
 *   event/SEO keywords, C excerpt, D body text. PostgreSQL recomputes it on
 *   every write, so it cannot go stale. GIN-indexed.
 * - Plain queries match every word as a prefix (`crick` -> cricket,
 *   `বাংলাদেশ` -> বাংলাদেশের). Queries using web-search syntax (quotes,
 *   `-exclude`, `or`) go through websearch_to_tsquery instead.
 * - Ranking: ts_rank_cd over the weighted vector (A 1.0, B 0.4, C 0.2, D 0.1,
 *   length-normalized so long bodies do not dominate), plus title bonuses
 *   (exact title > title prefix > title contains the whole query) and, for
 *   multi-word queries, a phrase bonus when the words appear adjacent and in
 *   order anywhere in the document (PHASE M). Ties break on publishedAt DESC,
 *   then id, so paging is deterministic.
 * - Only when full-text finds nothing, a pg_trgm word-similarity match on the
 *   title (GIN trigram index) provides typo tolerance (`Rolan Garos`).
 *
 * Every value reaches SQL as a bound parameter; the only SQL built from
 * strings is fixed fragments chosen in this file.
 */

import { Prisma } from '../../generated/prisma/client';
import { SEARCH_MAX_QUERY, normalizeQuery, queryTerms } from '../../../src/lib/searchText';

export { SEARCH_MAX_QUERY, normalizeQuery, queryTerms };
export const SEARCH_MAX_LIMIT = 50;
export const FUZZY_THRESHOLD = 0.45;

export type SearchSort = 'relevance' | 'newest' | 'oldest';
export type SearchScope = 'public' | 'staff';
export type ArticleStatusFilter = 'draft' | 'preview' | 'scheduled' | 'published' | 'archived';

export interface ArticleSearchParams {
  q?: string;
  /** `public` enforces publication visibility; `staff` is for authorized CMS callers only. */
  scope: SearchScope;
  sport?: string;
  type?: string;
  authorId?: string;
  ownerUserId?: string;
  reviewStatus?: string;
  draftsOnly?: boolean;
  myDraftsUserId?: string;
  /** Staff scope only; ignored for public scope. */
  status?: ArticleStatusFilter;
  from?: Date;
  to?: Date;
  sort?: SearchSort;
  page?: number;
  limit?: number;
  excludeId?: string;
}

export interface ArticleSearchResult {
  ids: string[];
  total: number;
  page: number;
  pageSize: number;
  /** How the rows were matched: keyword search, typo fallback, or plain listing. */
  mode: 'fulltext' | 'fuzzy' | 'browse';
}

const db = async () => (await import('../../db')).prisma;

/** Web-search syntax: a quoted phrase, a -excluded word, or an OR between words. */
export const usesWebSyntax = (q: string) => /"|(^|\s)-[\p{L}\p{N}]|\sor\s/iu.test(q);

/** The tsquery for `q`, or null when it contains no searchable term. */
export function tsQuery(q: string): Prisma.Sql | null {
  const terms = queryTerms(q);
  if (!terms.length) return null;
  if (usesWebSyntax(q)) return Prisma.sql`websearch_to_tsquery('english', ${q})`;
  // Terms contain only letters/digits, so they cannot carry tsquery operators.
  return Prisma.sql`to_tsquery('english', ${terms.map((t) => `${t}:*`).join(' & ')})`;
}

export const likeEscape = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * PHASE M: bonus when a multi-word plain query appears as an exact phrase
 * (adjacent, in order) in `vector`. Single words and web-search syntax get none.
 */
export function phraseBonus(vector: Prisma.Sql, q: string, weight = 0.3): Prisma.Sql {
  if (queryTerms(q).length < 2 || usesWebSyntax(q)) return Prisma.sql`0`;
  // The weight is a fixed constant from this codebase, inlined so PostgreSQL types the CASE as numeric.
  return Prisma.sql`(CASE WHEN ${vector} @@ phraseto_tsquery('english', ${q}) THEN ${Prisma.raw(weight.toFixed(2))} ELSE 0 END)`;
}

/**
 * Query words the 'english' configuration keeps (stop words such as "the" or
 * "us" carry no meaning for similarity), in query order. Shared by the Article
 * and Event typo fallbacks.
 */
export async function meaningfulTerms(q: string): Promise<string[]> {
  const prisma = await db();
  const kept = await prisma.$queryRaw<{ t: string }[]>`SELECT t FROM unnest(${queryTerms(q)}::text[]) WITH ORDINALITY AS u(t, n) WHERE numnode(to_tsquery('english', t || ':*')) > 0 ORDER BY n`;
  return kept.map((r) => r.t);
}

function filters(p: ArticleSearchParams): Prisma.Sql[] {
  const where: Prisma.Sql[] = [];
  if (p.scope === 'public') {
    // Mirrors publishedArticleWhere() in services/public/content.ts: published,
    // in a visible sport, and not attached to a hidden event.
    where.push(Prisma.sql`a."status" = 'published'`);
    where.push(Prisma.sql`EXISTS (SELECT 1 FROM "Sport" s WHERE s."slug" = a."sportSlug" AND s."isVisible")`);
    where.push(Prisma.sql`(a."eventSlug" IS NULL OR NOT EXISTS (
      SELECT 1 FROM "SportEvent" e JOIN "Sport" es ON es."slug" = e."sportSlug"
      WHERE e."sportSlug" = a."sportSlug" AND e."slug" = a."eventSlug" AND (NOT e."isVisible" OR NOT es."isVisible")))`);
  } else if (p.status) {
    where.push(Prisma.sql`a."status"::text = ${p.status}`);
  }
  if (p.sport) where.push(Prisma.sql`a."sportSlug" = ${p.sport}`);
  if (p.type) where.push(Prisma.sql`a."articleType" = ${p.type}`);
  if (p.authorId) where.push(Prisma.sql`a."authorId" = ${p.authorId}`);
  if (p.ownerUserId) where.push(Prisma.sql`EXISTS (SELECT 1 FROM "Author" own WHERE own."id" = a."authorId" AND own."userId" = ${p.ownerUserId})`);
  if (p.draftsOnly) where.push(Prisma.sql`a."status" IN ('draft', 'preview')`);
  if (p.myDraftsUserId) {
    where.push(Prisma.sql`EXISTS (SELECT 1 FROM "Author" own WHERE own."id" = a."authorId" AND own."userId" = ${p.myDraftsUserId})`);
  }
  if (p.reviewStatus) where.push(Prisma.sql`a."reviewStatus"::text = ${p.reviewStatus}`);
  if (p.from) where.push(Prisma.sql`a."publishedAt" >= ${p.from}`);
  if (p.to) where.push(Prisma.sql`a."publishedAt" < ${p.to}`);
  if (p.excludeId) where.push(Prisma.sql`a."id" <> ${p.excludeId}`);
  return where;
}

const whereSql = (parts: Prisma.Sql[]) => (parts.length ? Prisma.sql`WHERE ${Prisma.join(parts, ' AND ')}` : Prisma.empty);

function dateOrder(sort: SearchSort | undefined): Prisma.Sql {
  return sort === 'oldest' ? Prisma.sql`a."publishedAt" ASC, a."id" ASC` : Prisma.sql`a."publishedAt" DESC, a."id" ASC`;
}

/** Searches articles and returns the matching ids for one page, in rank order. */
export async function searchArticleIds(params: ArticleSearchParams): Promise<ArticleSearchResult> {
  const prisma = await db();
  const q = normalizeQuery(params.q);
  const pageSize = Math.min(Math.max(1, Math.floor(params.limit ?? 12)), SEARCH_MAX_LIMIT);
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const offset = (page - 1) * pageSize;
  const base = filters(params);
  const query = q ? tsQuery(q) : null;

  // Text without a searchable word (e.g. "!!!") matches nothing publicly,
  // rather than silently listing everything under a "results for" heading.
  if (q && !query && params.scope === 'public') return { ids: [], total: 0, page, pageSize, mode: 'fulltext' };

  // No keywords: a plain listing ordered by date ("relevance" means newest).
  if (!q) {
    const [rows, count] = await Promise.all([
      prisma.$queryRaw<{ id: string }[]>`SELECT a."id" FROM "Article" a ${whereSql(base)} ORDER BY ${dateOrder(params.sort)} LIMIT ${pageSize} OFFSET ${offset}`,
      prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "Article" a ${whereSql(base)}`,
    ]);
    return { ids: rows.map((r) => r.id), total: count[0]?.n ?? 0, page, pageSize, mode: 'browse' };
  }

  const lowered = q.toLowerCase();
  const titleBonus = Prisma.sql`(CASE WHEN lower(a."title") = ${lowered} THEN 2.0
      WHEN a."title" ILIKE ${`${likeEscape(q)}%`} THEN 0.6
      WHEN a."title" ILIKE ${`%${likeEscape(q)}%`} THEN 0.4 ELSE 0 END)`;
  // Staff can jump straight to an article by its id or slug.
  const staffExact = params.scope === 'staff' ? Prisma.sql`a."id" = ${q} OR a."slug" = ${q}` : null;

  const match = query
    ? staffExact ? Prisma.sql`(a."searchVector" @@ ${query} OR ${staffExact})` : Prisma.sql`a."searchVector" @@ ${query}`
    : staffExact!;
  const score = query
    ? Prisma.sql`ts_rank_cd(a."searchVector", ${query}, 1) + ${titleBonus} + ${phraseBonus(Prisma.sql`a."searchVector"`, q)}${staffExact ? Prisma.sql` + (CASE WHEN ${staffExact} THEN 5 ELSE 0 END)` : Prisma.empty}`
    : Prisma.sql`5`;
  const order = params.sort === 'newest' || params.sort === 'oldest' ? dateOrder(params.sort) : Prisma.sql`score DESC, ${dateOrder('newest')}`;
  const where = whereSql([...base, match]);

  const [rows, count] = await Promise.all([
    prisma.$queryRaw<{ id: string }[]>`SELECT a."id", ${score} AS score FROM "Article" a ${where} ORDER BY ${order} LIMIT ${pageSize} OFFSET ${offset}`,
    prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "Article" a ${where}`,
  ]);
  const total = count[0]?.n ?? 0;
  if (total > 0 || queryTerms(q).join('').length < 3) return { ids: rows.map((r) => r.id), total, page, pageSize, mode: 'fulltext' };

  // Typo tolerance: nothing matched as words. Every query word must still be
  // accounted for — either as a word prefix in the document, or by trigram
  // word similarity to the title or excerpt (`<%` uses the GIN trigram
  // indexes with the transaction-local threshold). Matching the query as a
  // whole would let one exact word "carry" an unmatched one. Explicit
  // web-search syntax (quotes, -word, or) never falls back.
  if (usesWebSyntax(q)) return { ids: [], total: 0, page, pageSize, mode: 'fulltext' };
  // English stop words ("the", "of") carry no meaning for similarity; the
  // search configuration's own stop-word list decides which words to keep.
  const terms = await meaningfulTerms(q);
  if (!terms.length) return { ids: [], total: 0, page, pageSize, mode: 'fulltext' };
  const termMatch = terms.map((t) => Prisma.sql`(a."searchVector" @@ to_tsquery('english', ${`${t}:*`}) OR ${t} <% a."title" OR ${t} <% a."excerpt")`);
  const termScore = Prisma.join(terms.map((t) => Prisma.sql`greatest(word_similarity(${t}, a."title"), word_similarity(${t}, a."excerpt") * 0.8)`), ' + ');
  const fuzzyWhere = whereSql([...base, ...termMatch, Prisma.sql`(${Prisma.join(terms.map((t) => Prisma.sql`${t} <% a."title" OR ${t} <% a."excerpt"`), ' OR ')})`]);
  const fuzzyOrder = params.sort === 'newest' || params.sort === 'oldest' ? dateOrder(params.sort) : Prisma.sql`score DESC, ${dateOrder('newest')}`;
  const [fuzzyRows, fuzzyCount] = await prisma.$transaction([
    prisma.$executeRaw`SELECT set_config('pg_trgm.word_similarity_threshold', ${String(FUZZY_THRESHOLD)}, true)`,
    prisma.$queryRaw<{ id: string }[]>`SELECT a."id", ${termScore} AS score FROM "Article" a ${fuzzyWhere} ORDER BY ${fuzzyOrder} LIMIT ${pageSize} OFFSET ${offset}`,
    prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "Article" a ${fuzzyWhere}`,
  ]).then(([, r, c]) => [r, c] as const);
  const fuzzyTotal = fuzzyCount[0]?.n ?? 0;
  return { ids: fuzzyRows.map((r) => r.id), total: fuzzyTotal, page, pageSize, mode: fuzzyTotal ? 'fuzzy' : 'fulltext' };
}

/**
 * Title suggestions for autocomplete: up to `limit` titles whose headline or
 * category-level fields (weights A/B) match every typed word as a prefix,
 * plus close trigram title matches. One indexed query.
 */
export async function suggestArticleTitles(params: { q: string; scope: SearchScope; limit?: number }): Promise<{ id: string; title: string; sportSlug: string; articleType: string }[]> {
  const q = normalizeQuery(params.q);
  const terms = queryTerms(q);
  if (!terms.length || q.length < 2) return [];
  // `:*AB` restricts matching to the title (A) and subtitle/type/sport/event/
  // keyword (B) lexemes, so a word buried in the body does not suggest a title.
  const query = Prisma.sql`to_tsquery('english', ${terms.map((t) => `${t}:*AB`).join(' & ')})`;
  const prisma = await db();
  const limit = Math.min(Math.max(1, params.limit ?? 6), 10);
  const where = whereSql([...filters({ scope: params.scope }), Prisma.sql`(a."searchVector" @@ ${query} OR ${q} <% a."title")`]);
  const [, rows] = await prisma.$transaction([
    prisma.$executeRaw`SELECT set_config('pg_trgm.word_similarity_threshold', ${String(FUZZY_THRESHOLD)}, true)`,
    prisma.$queryRaw<{ id: string; title: string; sportSlug: string; articleType: string }[]>`
      SELECT a."id", a."title", a."sportSlug", a."articleType",
        ts_rank_cd(a."searchVector", ${query}, 1) * 2
          + (CASE WHEN a."title" ILIKE ${`${likeEscape(q)}%`} THEN 1 ELSE 0 END)
          + word_similarity(${q}, a."title") AS score
      FROM "Article" a ${where}
      ORDER BY score DESC, a."publishedAt" DESC, a."id" ASC
      LIMIT ${limit}`,
  ]);
  return rows;
}
