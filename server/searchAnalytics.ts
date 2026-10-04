/**
 * Internal search analytics (PHASE R, Spec §19.5, §25.5): aggregate popular
 * searches, no-result searches and trends, feeding the SEO/content
 * opportunity system (Admin → Insights and the SEO scanner).
 *
 * Privacy: only the normalized query text and two counters per UTC day are
 * stored. Text that looks personal (an e-mail address or a long digit run) is
 * stored as "(redacted)". No user, session, IP, device or user-agent data is
 * kept; the user agent is read only to skip obvious crawlers.
 */

import { prisma } from './db';
import { sanitizeSearchTerm } from '../src/lib/analytics/sanitize';

const BOT_UA = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|headless|lighthouse|pagespeed|monitor|curl|wget|python-requests/i;

const utcDay = (d = new Date()) => new Date(d.toISOString().slice(0, 10) + 'T00:00:00.000Z');

/** Counts one search (first results page only). Never throws. */
export async function recordSearch(query: string, total: number, userAgent?: string | null): Promise<void> {
  try {
    if (userAgent && BOT_UA.test(userAgent)) return;
    const term = sanitizeSearchTerm(query);
    if (!term || term.length < 2) return;
    const zero = total === 0 ? 1 : 0;
    await prisma.$executeRaw`
      INSERT INTO "SearchQueryStat" ("day", "query", "searches", "zeroResults") VALUES (${utcDay()}, ${term}, 1, ${zero})
      ON CONFLICT ("day", "query") DO UPDATE SET "searches" = "SearchQueryStat"."searches" + 1, "zeroResults" = "SearchQueryStat"."zeroResults" + ${zero}`;
  } catch {
    // Analytics must never break search.
  }
}

export interface SearchInsight {
  totals: { searches: number; zeroResults: number; distinctQueries: number };
  popular: { query: string; searches: number; zeroResults: number }[];
  noResults: { query: string; searches: number }[];
  trend: { day: string; searches: number; zeroResults: number }[];
}

export async function searchInsights(from: Date, to: Date, limit = 25): Promise<SearchInsight> {
  const [popular, noResults, trend, totals] = await Promise.all([
    prisma.$queryRaw<{ query: string; searches: bigint; zero: bigint }[]>`
      SELECT "query", SUM("searches") AS searches, SUM("zeroResults") AS zero FROM "SearchQueryStat"
      WHERE "day" >= ${from} AND "day" <= ${to} GROUP BY "query" ORDER BY searches DESC, "query" ASC LIMIT ${limit}`,
    prisma.$queryRaw<{ query: string; zero: bigint }[]>`
      SELECT "query", SUM("zeroResults") AS zero FROM "SearchQueryStat"
      WHERE "day" >= ${from} AND "day" <= ${to} GROUP BY "query" HAVING SUM("zeroResults") > 0 ORDER BY zero DESC, "query" ASC LIMIT ${limit}`,
    prisma.$queryRaw<{ day: Date; searches: bigint; zero: bigint }[]>`
      SELECT "day", SUM("searches") AS searches, SUM("zeroResults") AS zero FROM "SearchQueryStat"
      WHERE "day" >= ${from} AND "day" <= ${to} GROUP BY "day" ORDER BY "day" ASC`,
    prisma.$queryRaw<{ searches: bigint | null; zero: bigint | null; distinct: bigint }[]>`
      SELECT SUM("searches") AS searches, SUM("zeroResults") AS zero, COUNT(DISTINCT "query") AS distinct FROM "SearchQueryStat"
      WHERE "day" >= ${from} AND "day" <= ${to}`,
  ]);
  return {
    totals: { searches: Number(totals[0]?.searches ?? 0), zeroResults: Number(totals[0]?.zero ?? 0), distinctQueries: Number(totals[0]?.distinct ?? 0) },
    popular: popular.map((r) => ({ query: r.query, searches: Number(r.searches), zeroResults: Number(r.zero) })),
    noResults: noResults.map((r) => ({ query: r.query, searches: Number(r.zero) })),
    trend: trend.map((r) => ({ day: r.day.toISOString().slice(0, 10), searches: Number(r.searches), zeroResults: Number(r.zero) })),
  };
}

/** No-result queries searched at least `min` times in the last `days` days (content opportunities). */
export async function noResultOpportunities(days = 28, min = 3) {
  const from = utcDay(new Date(Date.now() - days * 86_400_000));
  const rows = await prisma.$queryRaw<{ query: string; zero: bigint }[]>`
    SELECT "query", SUM("zeroResults") AS zero FROM "SearchQueryStat" WHERE "day" >= ${from} AND "query" <> '(redacted)'
    GROUP BY "query" HAVING SUM("zeroResults") >= ${min} ORDER BY zero DESC LIMIT 50`;
  return rows.map((r) => ({ query: r.query, searches: Number(r.zero) }));
}
