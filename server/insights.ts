/**
 * Analytics & Insights API (PHASE R, Spec §25; Blueprint §6 "Analytics /
 * Insights" admin section). Content/click performance only — ad placement
 * management stays in Admin → Ad Placements.
 *
 * Sources (all real, never estimated):
 *   - PageViewStat / WebVitalStat  first-party aggregates (server/rum.ts)
 *   - SearchQueryStat              internal search analytics (server/searchAnalytics.ts)
 *   - SearchPerformanceStat        Google Search Console / Bing data (server/searchConsole.ts)
 *   - Article table                publishing activity
 *   - PHASE Q: PageViewStat joined to Article / SportEvent / Sport for
 *     content performance (top articles, events, sports, article types)
 * A source with no data is reported as empty, never filled with placeholders.
 *
 *   GET /api/insights/overview?period=today|7d|28d|3m|6m|12m|custom[&from=YYYY-MM-DD&to=YYYY-MM-DD]
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import { prisma } from './db';
import { requireRole, type AuthLookup } from './auth';
import { searchInsights } from './searchAnalytics';
import { searchProviders } from './searchConsole';
import { BUCKETS, RUM_METRICS, THRESHOLDS, p75FromHistogram, type RumMetric } from './rum';
import { publicCacheStats } from './publicCache';
import { DEFAULT_RETENTION } from './analyticsRetention';

export const PERIODS = { today: 1, '7d': 7, '28d': 28, '3m': 90, '6m': 180, '12m': 365 } as const;
export type Period = keyof typeof PERIODS | 'custom';
const DAY = 86_400_000;
const utcDay = (d: Date) => new Date(d.toISOString().slice(0, 10) + 'T00:00:00.000Z');

export function periodRange(period: string, fromRaw?: unknown, toRaw?: unknown): { ok: true; from: Date; to: Date; days: number } | { ok: false; error: string } {
  const today = utcDay(new Date());
  if (period === 'custom') {
    const valid = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
    if (!valid(fromRaw) || !valid(toRaw)) return { ok: false, error: 'A custom period needs from and to dates (YYYY-MM-DD).' };
    const from = utcDay(new Date(fromRaw as string));
    const to = utcDay(new Date(toRaw as string));
    if (to < from) return { ok: false, error: 'The end date is before the start date.' };
    const days = Math.round((to.getTime() - from.getTime()) / DAY) + 1;
    if (days > 400) return { ok: false, error: 'A custom period can cover at most 400 days.' };
    return { ok: true, from, to, days };
  }
  const days = PERIODS[period as keyof typeof PERIODS];
  if (!days) return { ok: false, error: `period must be one of: ${[...Object.keys(PERIODS), 'custom'].join(', ')}.` };
  return { ok: true, from: new Date(today.getTime() - (days - 1) * DAY), to: today, days };
}

/** Merges histograms of the same metric. */
const mergeHist = (a: number[], b: number[]) => Array.from({ length: Math.max(a.length, b.length) }, (_, i) => (a[i] || 0) + (b[i] || 0));

async function vitals(from: Date, to: Date) {
  const rows = await prisma.webVitalStat.findMany({ where: { day: { gte: from, lte: to } } });
  const groups = new Map<string, { pageType: string; metric: RumMetric; device: string; samples: number; good: number; needsWork: number; poor: number; histogram: number[] }>();
  for (const r of rows) {
    for (const device of [r.device, 'all']) {
      const key = `${r.pageType}|${r.metric}|${device}`;
      const g = groups.get(key) ?? { pageType: r.pageType, metric: r.metric as RumMetric, device, samples: 0, good: 0, needsWork: 0, poor: 0, histogram: [] };
      g.samples += r.samples; g.good += r.good; g.needsWork += r.needsWork; g.poor += r.poor; g.histogram = mergeHist(g.histogram, r.histogram);
      groups.set(key, g);
    }
  }
  return [...groups.values()].map((g) => {
    const p75 = p75FromHistogram(g.metric, g.histogram);
    const t = THRESHOLDS[g.metric];
    return { pageType: g.pageType, metric: g.metric, device: g.device, samples: g.samples, p75, rating: p75 === null ? null : p75 <= t.good ? 'good' : p75 <= t.poor ? 'needs-improvement' : 'poor', goodShare: g.samples ? g.good / g.samples : null };
  }).sort((a, b) => a.pageType.localeCompare(b.pageType) || a.metric.localeCompare(b.metric) || a.device.localeCompare(b.device));
}

/**
 * Regression detection (Spec §25.8): p75 of the last 7 days vs the 28 days
 * before. Flagged when it got at least 20% worse with ≥ 50 samples in both
 * windows, or when it crossed from good into needs-improvement/poor.
 */
export async function vitalRegressions(now = new Date()) {
  const today = utcDay(now);
  const recentFrom = new Date(today.getTime() - 6 * DAY);
  const baseFrom = new Date(recentFrom.getTime() - 28 * DAY);
  const baseTo = new Date(recentFrom.getTime() - DAY);
  const [recent, base] = await Promise.all([vitals(recentFrom, today), vitals(baseFrom, baseTo)]);
  const out: { pageType: string; metric: string; before: number; after: number; samples: { before: number; after: number }; reason: string }[] = [];
  for (const r of recent.filter((v) => v.device === 'all')) {
    const b = base.find((v) => v.device === 'all' && v.pageType === r.pageType && v.metric === r.metric);
    if (!b || r.p75 === null || b.p75 === null || r.samples < 50 || b.samples < 50) continue;
    const t = THRESHOLDS[r.metric as RumMetric];
    const crossed = b.p75 <= t.good && r.p75 > t.good;
    const worse = r.p75 >= b.p75 * 1.2 && r.p75 > b.p75;
    if (crossed || worse) out.push({ pageType: r.pageType, metric: r.metric, before: b.p75, after: r.p75, samples: { before: b.samples, after: r.samples }, reason: crossed ? 'moved out of the "good" range' : 'p75 is at least 20% worse' });
  }
  return out;
}

/**
 * Page views and content performance from the first-party counters
 * (PHASE R; PHASE Q). PHASE Q: ONE grouped pass over the period
 * (path × page type, at most one row per site URL) feeds the totals, page
 * types, top pages and the content tables, plus one pass for the daily trend
 * — instead of a scan per figure. Article rows are resolved to their article
 * by recomputing each article's public URL in SQL (src/lib/paths.ts#articlePath).
 * Views of URLs that no longer resolve (deleted, unpublished or moved content)
 * are reported as such, never attributed elsewhere.
 */
export async function pageViewsAndContent(from: Date, to: Date, limit = 25) {
  const [rows, trend, events, sports] = await Promise.all([
    prisma.$queryRaw<{ path: string; pageType: string; views: number; id: string | null; title: string | null; articleType: string | null; sportSlug: string | null; eventSlug: string | null; status: string | null }[]>`
      WITH v AS (
        SELECT "path", "pageType", SUM("views")::int AS views FROM "PageViewStat"
        WHERE "day" >= ${from} AND "day" <= ${to} GROUP BY "path", "pageType"
      )
      SELECT DISTINCT ON (v."path", v."pageType") v."path", v."pageType", v.views, a."id", a."title", a."articleType", a."sportSlug", a."eventSlug", a."status"::text AS status
      FROM v LEFT JOIN "Article" a ON v."pageType" = 'article' AND v."path" = CASE
        WHEN a."eventSlug" IS NOT NULL AND a."editionYear" IS NOT NULL THEN '/' || a."sportSlug" || '/' || a."eventSlug" || '/' || a."editionYear" || '/' || a."slug" || '/'
        ELSE '/' || a."sportSlug" || '/' || a."slug" || '/' END
      ORDER BY v."path", v."pageType", (a."status" = 'published') DESC NULLS LAST`,
    prisma.pageViewStat.groupBy({ by: ['day'], where: { day: { gte: from, lte: to } }, _sum: { views: true }, orderBy: { day: 'asc' } }),
    prisma.sportEvent.findMany({ select: { id: true, sportSlug: true, slug: true, name: true } }),
    prisma.sport.findMany({ select: { slug: true, name: true } }),
  ]);
  const add = (m: Map<string, number>, k: string, n: number) => m.set(k, (m.get(k) ?? 0) + n);
  const segment = (path: string, i: number) => path.split('/')[i] ?? '';
  const sportName = new Map(sports.map((x) => [x.slug, x.name]));
  const eventByKey = new Map(events.map((e) => [`${e.sportSlug}/${e.slug}`, e]));

  let total = 0;
  const byType = new Map<string, number>();
  const byPath = new Map<string, { views: number; pageType: string }>();
  const bySport = new Map<string, number>();
  const byArticleType = new Map<string, number>();
  const eventTotals = new Map<string, { eventViews: number; editionViews: number; articleViews: number }>();
  const eventEntry = (key: string) => eventTotals.get(key) ?? eventTotals.set(key, { eventViews: 0, editionViews: 0, articleViews: 0 }).get(key)!;
  let unmatchedArticleViews = 0;
  const articles: typeof rows = [];
  for (const r of rows) {
    total += r.views;
    add(byType, r.pageType, r.views);
    const p = byPath.get(r.path);
    byPath.set(r.path, { views: (p?.views ?? 0) + r.views, pageType: p && p.pageType > r.pageType ? p.pageType : r.pageType });
    if (['sport', 'event', 'edition', 'article'].includes(r.pageType)) add(bySport, segment(r.path, 1), r.views);
    if (r.pageType === 'event') eventEntry(`${segment(r.path, 1)}/${segment(r.path, 2)}`).eventViews += r.views;
    if (r.pageType === 'edition') eventEntry(`${segment(r.path, 1)}/${segment(r.path, 2)}`).editionViews += r.views;
    if (r.pageType === 'article') {
      articles.push(r);
      if (!r.id) unmatchedArticleViews += r.views;
      else {
        add(byArticleType, r.articleType ?? '', r.views);
        if (r.eventSlug) eventEntry(`${r.sportSlug}/${r.eventSlug}`).articleViews += r.views;
      }
    }
  }
  const sorted = <T,>(xs: T[], views: (x: T) => number, key: (x: T) => string) => xs.sort((a, b) => views(b) - views(a) || key(a).localeCompare(key(b)));
  return {
    pageViews: {
      total,
      byPageType: sorted([...byType].map(([pageType, views]) => ({ pageType, views })), (x) => x.views, (x) => x.pageType),
      topPages: sorted([...byPath].map(([path, v]) => ({ path, pageType: v.pageType, views: v.views })), (x) => x.views, (x) => x.path).slice(0, limit),
      trend: trend.map((r) => ({ day: r.day.toISOString().slice(0, 10), views: r._sum.views ?? 0 })),
    },
    content: {
      topArticles: sorted(articles, (x) => x.views, (x) => x.path).slice(0, limit).map((r) => ({
        path: r.path, views: r.views, id: r.id, title: r.title, articleType: r.articleType,
        sport: r.sportSlug, sportName: r.sportSlug ? sportName.get(r.sportSlug) ?? r.sportSlug : null, status: r.id ? r.status : 'not found',
      })),
      topEvents: sorted([...eventTotals].map(([key, t]) => {
        const [sport, slug] = key.split('/');
        const e = eventByKey.get(key);
        return { id: e?.id ?? null, name: e?.name ?? null, sport, sportName: sportName.get(sport) ?? sport, path: `/${sport}/${slug}/`, ...t, total: t.eventViews + t.editionViews + t.articleViews };
      }), (x) => x.total, (x) => x.path).slice(0, limit),
      bySport: sorted([...bySport].filter(([sport]) => sportName.has(sport)).map(([sport, views]) => ({ sport, sportName: sportName.get(sport)!, views })), (x) => x.views, (x) => x.sport),
      byArticleType: sorted([...byArticleType].map(([articleType, views]) => ({ articleType, views })), (x) => x.views, (x) => x.articleType),
      unmatchedArticleViews,
    },
  };
}

/** PHASE Q: totals of the same-length period just before `from` (for comparison). */
async function previousTotals(from: Date, days: number) {
  const prevTo = new Date(from.getTime() - DAY);
  const prevFrom = new Date(from.getTime() - days * DAY);
  const [views, searches] = await Promise.all([
    prisma.pageViewStat.groupBy({ by: ['pageType'], where: { day: { gte: prevFrom, lte: prevTo } }, _sum: { views: true } }),
    prisma.searchQueryStat.aggregate({ where: { day: { gte: prevFrom, lte: prevTo } }, _sum: { searches: true } }),
  ]);
  const byType: Record<string, number> = Object.fromEntries(views.map((r) => [r.pageType, r._sum.views ?? 0]));
  return {
    from: prevFrom.toISOString().slice(0, 10), to: prevTo.toISOString().slice(0, 10),
    views: Object.values(byType).reduce((a, b) => a + b, 0),
    articleViews: byType.article ?? 0,
    eventViews: (byType.event ?? 0) + (byType.edition ?? 0),
    searches: searches._sum.searches ?? 0,
  };
}

async function searchPerformance(source: 'google' | 'bing', from: Date, to: Date) {
  const where = { source, day: { gte: from, lte: to } };
  const [series, ...dims] = await Promise.all([
    prisma.searchPerformanceStat.findMany({ where: { ...where, dimension: 'date' }, orderBy: { day: 'asc' } }),
    ...(['query', 'page', 'country', 'device', 'searchAppearance'] as const).map((dimension) => prisma.$queryRaw<{ key: string; clicks: bigint; impressions: bigint; position: number }[]>`
      SELECT "key", SUM("clicks") AS clicks, SUM("impressions") AS impressions,
             CASE WHEN SUM("impressions") > 0 THEN SUM("position" * "impressions") / SUM("impressions") ELSE AVG("position") END AS position
      FROM "SearchPerformanceStat" WHERE "source" = ${source} AND "dimension" = ${dimension} AND "day" >= ${from} AND "day" <= ${to}
      GROUP BY "key" ORDER BY clicks DESC, impressions DESC LIMIT 25`),
  ]);
  const clicks = series.reduce((a, r) => a + r.clicks, 0);
  const impressions = series.reduce((a, r) => a + r.impressions, 0);
  const avgPosition = impressions ? series.reduce((a, r) => a + r.position * r.impressions, 0) / impressions : null;
  const named = (rows: { key: string; clicks: bigint; impressions: bigint; position: number }[]) => rows.map((r) => ({ key: r.key, clicks: Number(r.clicks), impressions: Number(r.impressions), ctr: Number(r.impressions) ? Number(r.clicks) / Number(r.impressions) : 0, position: Number(r.position) }));
  return {
    hasData: series.length > 0 || dims.some((d) => d.length > 0),
    totals: { clicks, impressions, ctr: impressions ? clicks / impressions : null, position: avgPosition },
    trend: series.map((r) => ({ day: r.day.toISOString().slice(0, 10), clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })),
    queries: named(dims[0]), pages: named(dims[1]), countries: named(dims[2]), devices: named(dims[3]), appearance: named(dims[4]),
  };
}

export function insightsRouter(getLookup: () => AuthLookup) {
  const router = express.Router();
  const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };

  router.get('/overview', requireRole(getLookup, ['Admin', 'Editor']), wrap(async (req, res) => {
    const range = periodRange(String(req.query.period || '28d'), req.query.from, req.query.to);
    if (!range.ok) return res.status(400).json({ error: (range as { error: string }).error });
    const { from, to, days } = range;
    const endExclusive = new Date(to.getTime() + DAY);
    const [viewsAndContent, webVitals, regressions, search, providers, google, bing, publishedRows, snapshots, rumSetting, previous, retention] = await Promise.all([
      pageViewsAndContent(from, to),
      vitals(from, to),
      vitalRegressions(),
      searchInsights(from, to),
      searchProviders(),
      searchPerformance('google', from, to),
      searchPerformance('bing', from, to),
      prisma.article.groupBy({ by: ['articleType'], where: { status: 'published', publishedAt: { gte: from, lt: endExclusive } }, _count: { _all: true } }),
      prisma.searchEngineSnapshot.findMany(),
      prisma.siteSetting.findUnique({ where: { key: 'realUserMonitoring' } }),
      previousTotals(from, days),
      prisma.siteSetting.findUnique({ where: { key: 'analyticsRetention' } }),
    ]);
    return res.json({
      period: { name: req.query.period || '28d', from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), days },
      measurement: { realUserMonitoring: rumSetting?.value !== 'disabled', retention: retention?.value ?? DEFAULT_RETENTION, metrics: RUM_METRICS, buckets: BUCKETS, thresholds: THRESHOLDS },
      pageViews: viewsAndContent.pageViews,
      content: viewsAndContent.content,
      previous,
      webVitals,
      regressions,
      search,
      searchEngines: { providers, google, bing, snapshots },
      publishing: { total: publishedRows.reduce((a, r) => a + r._count._all, 0), byType: publishedRows.map((r) => ({ articleType: r.articleType, count: r._count._all })).sort((a, b) => b.count - a.count) },
      cache: publicCacheStats(),
    });
  }));

  return router;
}
