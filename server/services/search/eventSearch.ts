/**
 * Event search (PHASE M) — the Event half of unified search, built on the same
 * PostgreSQL strategy as Article search (services/search/articleSearch.ts).
 *
 * - `SportEvent.searchVector` (STORED generated tsvector, migration
 *   20261009090000_phase_m_event_search) is weighted A name/short name,
 *   B sport/event slug words and event type, C default venue/location/
 *   frequency, D description/history. GIN-indexed.
 * - `EventEdition.searchVector` (A title, B year, C venue/location,
 *   D description) lets "french open 2027" or an edition venue find the
 *   Event. The Event is always the result; the best-matching Edition is a
 *   secondary detail, so one Event never appears twice.
 * - Same query syntax as Articles: every plain word must match as a prefix
 *   (AND); quotes / -word / or use websearch_to_tsquery.
 * - Ranking: ts_rank_cd(Event) + 0.5 × best Edition rank + name bonuses
 *   (exact name/short name 2.0 > prefix 0.6 > contains 0.4) + phrase bonus.
 *   Ties break on name, then id, so paging is deterministic.
 * - Only when full-text finds nothing, every remaining word must still match
 *   as a prefix or by trigram word similarity to the name / short name
 *   (GIN trigram index on name), with at least one fuzzy name match. Event
 *   names are short, distinctive proper nouns, so their threshold (0.4) is a
 *   little looser than the Article one (0.45): "wimbeldon" → Wimbledon.
 * - The matched Edition is reported only when it explains the match: the
 *   Event's own text did not match, or the query names that Edition's year.
 * - Visibility mirrors visibleEventWhere(): the Event and its Sport must be
 *   visible. Hidden Events, and Events of hidden Sports, never match.
 *
 * Every value reaches SQL as a bound parameter.
 */

import { Prisma } from '../../generated/prisma/client';
import {
  SEARCH_MAX_LIMIT, likeEscape, meaningfulTerms, normalizeQuery, phraseBonus, queryTerms, tsQuery, usesWebSyntax,
} from './articleSearch';

const db = async () => (await import('../../db')).prisma;
/** Trigram word-similarity threshold for Event names (see header). */
export const EVENT_FUZZY_THRESHOLD = 0.4;

export interface EventSearchParams {
  q?: string;
  sport?: string;
  page?: number;
  limit?: number;
}

export interface EventSearchHit {
  id: string;
  /** The best-matching Edition when the query matched one (e.g. a year or edition venue). */
  edition?: { year: number; title: string };
}

export interface EventSearchResult {
  hits: EventSearchHit[];
  total: number;
  page: number;
  pageSize: number;
  mode: 'fulltext' | 'fuzzy' | 'browse';
}

function visible(sport?: string): Prisma.Sql[] {
  const where = [
    Prisma.sql`e."isVisible"`,
    Prisma.sql`EXISTS (SELECT 1 FROM "Sport" s WHERE s."slug" = e."sportSlug" AND s."isVisible")`,
  ];
  if (sport) where.push(Prisma.sql`e."sportSlug" = ${sport}`);
  return where;
}

const whereSql = (parts: Prisma.Sql[]) => Prisma.sql`WHERE ${Prisma.join(parts, ' AND ')}`;
type Row = { id: string; edition_year: number | null; edition_title: string | null; direct?: boolean | null };
const toHits = (rows: Row[], q = ''): EventSearchHit[] => {
  const years = new Set(queryTerms(q).filter((t) => /^\d{4}$/.test(t)).map(Number));
  return rows.map((r) => {
    const explains = r.edition_year !== null && !!r.edition_title && (!r.direct || years.has(r.edition_year));
    return { id: r.id, ...(explains ? { edition: { year: r.edition_year!, title: r.edition_title! } } : {}) };
  });
};

/** Searches visible Events and returns one page of ids in rank order. */
export async function searchEventIds(params: EventSearchParams): Promise<EventSearchResult> {
  const prisma = await db();
  const q = normalizeQuery(params.q);
  const pageSize = Math.min(Math.max(1, Math.floor(params.limit ?? 12)), SEARCH_MAX_LIMIT);
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const offset = (page - 1) * pageSize;
  const base = visible(params.sport);
  const query = q ? tsQuery(q) : null;

  if (q && !query) return { hits: [], total: 0, page, pageSize, mode: 'fulltext' };

  if (!q) {
    const [rows, count] = await Promise.all([
      prisma.$queryRaw<Row[]>`SELECT e."id", NULL::int AS edition_year, NULL::text AS edition_title FROM "SportEvent" e ${whereSql(base)}
        ORDER BY e."featured" DESC, e."name" ASC, e."id" ASC LIMIT ${pageSize} OFFSET ${offset}`,
      prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "SportEvent" e ${whereSql(base)}`,
    ]);
    return { hits: toHits(rows), total: count[0]?.n ?? 0, page, pageSize, mode: 'browse' };
  }

  const lowered = q.toLowerCase();
  const nameBonus = Prisma.sql`(CASE WHEN lower(e."name") = ${lowered} OR lower(e."shortName") = ${lowered} THEN 2.0
      WHEN e."name" ILIKE ${`${likeEscape(q)}%`} OR e."shortName" ILIKE ${`${likeEscape(q)}%`} THEN 0.6
      WHEN e."name" ILIKE ${`%${likeEscape(q)}%`} OR e."shortName" ILIKE ${`%${likeEscape(q)}%`} THEN 0.4 ELSE 0 END)`;
  // The single best-matching Edition of each Event (LATERAL: one indexed probe per candidate Event).
  const bestEdition = Prisma.sql`LEFT JOIN LATERAL (
      SELECT ed."year", ed."title", ts_rank_cd(ed."searchVector", ${query}, 1) AS rank
      FROM "EventEdition" ed
      WHERE ed."sportSlug" = e."sportSlug" AND ed."eventSlug" = e."slug" AND ed."searchVector" @@ ${query}
      ORDER BY rank DESC, ed."year" DESC LIMIT 1) best ON true`;
  const match = Prisma.sql`(e."searchVector" @@ ${query} OR best."year" IS NOT NULL)`;
  const score = Prisma.sql`(CASE WHEN e."searchVector" @@ ${query} THEN ts_rank_cd(e."searchVector", ${query}, 1) ELSE 0 END)
      + coalesce(best.rank, 0) * 0.5 + ${nameBonus} + ${phraseBonus(Prisma.sql`e."searchVector"`, q)}`;
  const where = whereSql([...base, match]);

  const [rows, count] = await Promise.all([
    prisma.$queryRaw<Row[]>`SELECT e."id", best."year" AS edition_year, best."title" AS edition_title, (e."searchVector" @@ ${query}) AS direct, ${score} AS score
      FROM "SportEvent" e ${bestEdition} ${where}
      ORDER BY score DESC, e."name" ASC, e."id" ASC LIMIT ${pageSize} OFFSET ${offset}`,
    prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "SportEvent" e ${bestEdition} ${where}`,
  ]);
  const total = count[0]?.n ?? 0;
  if (total > 0 || queryTerms(q).join('').length < 3 || usesWebSyntax(q)) return { hits: toHits(rows, q), total, page, pageSize, mode: 'fulltext' };

  // Typo tolerance, mirroring the Article fallback: every meaningful word must
  // match as a word prefix or by trigram similarity to the name/short name,
  // and at least one must be a fuzzy name match (`<%` uses the trigram index
  // with the transaction-local threshold).
  const terms = await meaningfulTerms(q);
  if (!terms.length) return { hits: [], total: 0, page, pageSize, mode: 'fulltext' };
  const termMatch = terms.map((t) => Prisma.sql`(e."searchVector" @@ to_tsquery('english', ${`${t}:*`}) OR ${t} <% e."name" OR ${t} <% e."shortName")`);
  const anyFuzzy = Prisma.sql`(${Prisma.join(terms.map((t) => Prisma.sql`${t} <% e."name" OR ${t} <% e."shortName"`), ' OR ')})`;
  const termScore = Prisma.join(terms.map((t) => Prisma.sql`greatest(word_similarity(${t}, e."name"), word_similarity(${t}, e."shortName"))`), ' + ');
  const fuzzyWhere = whereSql([...base, ...termMatch, anyFuzzy]);
  const [fuzzyRows, fuzzyCount] = await prisma.$transaction([
    prisma.$executeRaw`SELECT set_config('pg_trgm.word_similarity_threshold', ${String(EVENT_FUZZY_THRESHOLD)}, true)`,
    prisma.$queryRaw<Row[]>`SELECT e."id", NULL::int AS edition_year, NULL::text AS edition_title, ${termScore} AS score
      FROM "SportEvent" e ${fuzzyWhere} ORDER BY score DESC, e."name" ASC, e."id" ASC LIMIT ${pageSize} OFFSET ${offset}`,
    prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "SportEvent" e ${fuzzyWhere}`,
  ]).then(([, r, c]) => [r, c] as const);
  const fuzzyTotal = fuzzyCount[0]?.n ?? 0;
  return { hits: toHits(fuzzyRows), total: fuzzyTotal, page, pageSize, mode: fuzzyTotal ? 'fuzzy' : 'fulltext' };
}

/**
 * Event suggestions for autocomplete: visible Events whose name/short name or
 * slug/type words (weights A/B) match every typed word as a prefix, plus close
 * trigram name matches. One indexed query.
 */
export async function suggestEvents(params: { q: string; limit?: number }): Promise<{ id: string; name: string; slug: string; sportSlug: string; sportName: string }[]> {
  const q = normalizeQuery(params.q);
  const terms = queryTerms(q);
  if (!terms.length || q.length < 2) return [];
  const query = Prisma.sql`to_tsquery('english', ${terms.map((t) => `${t}:*AB`).join(' & ')})`;
  const prisma = await db();
  const limit = Math.min(Math.max(1, params.limit ?? 3), 10);
  const where = whereSql([...visible(), Prisma.sql`(e."searchVector" @@ ${query} OR ${q} <% e."name")`]);
  const [, rows] = await prisma.$transaction([
    prisma.$executeRaw`SELECT set_config('pg_trgm.word_similarity_threshold', ${String(EVENT_FUZZY_THRESHOLD)}, true)`,
    prisma.$queryRaw<{ id: string; name: string; slug: string; sportSlug: string; sportName: string }[]>`
      SELECT e."id", e."name", e."slug", e."sportSlug", s."name" AS "sportName",
        ts_rank_cd(e."searchVector", ${query}, 1) * 2
          + (CASE WHEN e."name" ILIKE ${`${likeEscape(q)}%`} OR e."shortName" ILIKE ${`${likeEscape(q)}%`} THEN 1 ELSE 0 END)
          + word_similarity(${q}, e."name") AS score
      FROM "SportEvent" e JOIN "Sport" s ON s."slug" = e."sportSlug" ${where}
      ORDER BY score DESC, e."featured" DESC, e."name" ASC, e."id" ASC
      LIMIT ${limit}`,
  ]);
  return rows;
}
