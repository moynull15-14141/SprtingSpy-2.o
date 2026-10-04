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

async function pageViews(from: Date, to: Date) {
  const [byType, top, trend, total] = await Promise.all([
    prisma.pageViewStat.groupBy({ by: ['pageType'], where: { day: { gte: from, lte: to } }, _sum: { views: true } }),
    prisma.$queryRaw<{ path: string; pageType: string; views: bigint }[]>`
      SELECT "path", MAX("pageType") AS "pageType", SUM("views") AS views FROM "PageViewStat" WHERE "day" >= ${from} AND "day" <= ${to}
      GROUP BY "path" ORDER BY views DESC, "path" ASC LIMIT 25`,
    prisma.pageViewStat.groupBy({ by: ['day'], where: { day: { gte: from, lte: to } }, _sum: { views: true }, orderBy: { day: 'asc' } }),
    prisma.pageViewStat.aggregate({ where: { day: { gte: from, lte: to } }, _sum: { views: true } }),
  ]);
  return {
    total: total._sum.views ?? 0,
    byPageType: byType.map((r) => ({ pageType: r.pageType, views: r._sum.views ?? 0 })).sort((a, b) => b.views - a.views),
    topPages: top.map((r) => ({ path: r.path, pageType: r.pageType, views: Number(r.views) })),
    trend: trend.map((r) => ({ day: r.day.toISOString().slice(0, 10), views: r._sum.views ?? 0 })),
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
    const [views, webVitals, regressions, search, providers, google, bing, publishedRows, snapshots, rumSetting] = await Promise.all([
      pageViews(from, to),
      vitals(from, to),
      vitalRegressions(),
      searchInsights(from, to),
      searchProviders(),
      searchPerformance('google', from, to),
      searchPerformance('bing', from, to),
      prisma.article.groupBy({ by: ['articleType'], where: { status: 'published', publishedAt: { gte: from, lt: endExclusive } }, _count: { _all: true } }),
      prisma.searchEngineSnapshot.findMany(),
      prisma.siteSetting.findUnique({ where: { key: 'realUserMonitoring' } }),
    ]);
    return res.json({
      period: { name: req.query.period || '28d', from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), days },
      measurement: { realUserMonitoring: rumSetting?.value !== 'disabled', metrics: RUM_METRICS, buckets: BUCKETS, thresholds: THRESHOLDS },
      pageViews: views,
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
