/**
 * Real-user monitoring (PHASE R, Spec §25.6–25.8, §23.2) and aggregate page
 * views (§25.2).
 *
 * Browsers send Core Web Vitals measured by Next.js (`useReportWebVitals`) to
 * POST /api/rum when a page is hidden. Nothing identifying is stored: no
 * cookie value, IP address, user agent, session or query string. Each sample
 * only increments a daily counter (WebVitalStat histogram bucket, PageViewStat
 * view count), so individual visits cannot be reconstructed.
 *
 * Collection can be switched off in Admin → Settings ("Real-user monitoring").
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import { prisma } from './db';
import { createRateLimiter } from './rateLimit';

export const RUM_PAGE_TYPES = ['home', 'sport', 'event', 'edition', 'article', 'search', 'latest', 'events', 'sports', 'author', 'faq', 'static'] as const;
export type RumPageType = (typeof RUM_PAGE_TYPES)[number];
export const RUM_METRICS = ['LCP', 'INP', 'CLS'] as const;
export type RumMetric = (typeof RUM_METRICS)[number];

/** Upper bucket edges (the last bucket is open-ended). Units: ms, ms, unitless. */
export const BUCKETS: Record<RumMetric, number[]> = {
  LCP: [500, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 7000, 10000],
  INP: [50, 100, 150, 200, 300, 400, 500, 700, 1000, 2000],
  CLS: [0.02, 0.05, 0.08, 0.1, 0.15, 0.2, 0.25, 0.35, 0.5, 1],
};
/** Google's "good" and "poor" thresholds (Spec §23.2 targets: LCP < 2.5 s, INP < 200 ms, CLS < 0.1). */
export const THRESHOLDS: Record<RumMetric, { good: number; poor: number }> = {
  LCP: { good: 2500, poor: 4000 },
  INP: { good: 200, poor: 500 },
  CLS: { good: 0.1, poor: 0.25 },
};

export const bucketIndex = (metric: RumMetric, value: number) => {
  const edges = BUCKETS[metric];
  const i = edges.findIndex((edge) => value <= edge);
  return i === -1 ? edges.length : i;
};

/** 75th percentile estimated from a histogram (upper edge of the bucket holding p75). */
export function p75FromHistogram(metric: RumMetric, histogram: number[]): number | null {
  const total = histogram.reduce((a, b) => a + b, 0);
  if (!total) return null;
  const target = Math.ceil(total * 0.75);
  let seen = 0;
  for (let i = 0; i < histogram.length; i++) {
    seen += histogram[i] || 0;
    if (seen >= target) {
      const edges = BUCKETS[metric];
      return i < edges.length ? edges[i] : edges[edges.length - 1] * 1.5;
    }
  }
  return null;
}

const utcDay = () => new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
const cleanPath = (raw: unknown): string | null => {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.length > 300) return null;
  const path = raw.split(/[?#]/)[0];
  if (/^\/(admin|account|api|reset-password)(\/|$)/.test(path)) return null; // never measured
  return /^[\w\-/%.~]+$/.test(path) ? (path.endsWith('/') ? path : `${path}/`) : null;
};

let enabledCache: { at: number; value: boolean } | null = null;
async function collectionEnabled(): Promise<boolean> {
  if (enabledCache && Date.now() - enabledCache.at < 60_000) return enabledCache.value;
  const row = await prisma.siteSetting.findUnique({ where: { key: 'realUserMonitoring' } }).catch(() => null);
  const value = row?.value !== 'disabled';
  enabledCache = { at: Date.now(), value };
  return value;
}
export const forgetRumSetting = () => { enabledCache = null; };

export async function recordVital(day: Date, pageType: RumPageType, metric: RumMetric, device: 'mobile' | 'desktop', value: number) {
  const idx = bucketIndex(metric, value);
  const size = BUCKETS[metric].length + 1;
  const initial = Array.from({ length: size }, (_, i) => (i === idx ? 1 : 0));
  const t = THRESHOLDS[metric];
  const good = value <= t.good ? 1 : 0;
  const poor = value > t.poor ? 1 : 0;
  const needs = good || poor ? 0 : 1;
  // PostgreSQL arrays are 1-based.
  await prisma.$executeRaw`
    INSERT INTO "WebVitalStat" ("day", "pageType", "metric", "device", "samples", "good", "needsWork", "poor", "histogram")
    VALUES (${day}, ${pageType}, ${metric}, ${device}, 1, ${good}, ${needs}, ${poor}, ${initial}::int[])
    ON CONFLICT ("day", "pageType", "metric", "device") DO UPDATE SET
      "samples" = "WebVitalStat"."samples" + 1,
      "good" = "WebVitalStat"."good" + ${good},
      "needsWork" = "WebVitalStat"."needsWork" + ${needs},
      "poor" = "WebVitalStat"."poor" + ${poor},
      "histogram"[${idx + 1}] = COALESCE("WebVitalStat"."histogram"[${idx + 1}], 0) + 1`;
}

export async function recordPageView(day: Date, path: string, pageType: RumPageType) {
  await prisma.$executeRaw`
    INSERT INTO "PageViewStat" ("day", "path", "pageType", "views") VALUES (${day}, ${path}, ${pageType}, 1)
    ON CONFLICT ("day", "path") DO UPDATE SET "views" = "PageViewStat"."views" + 1, "pageType" = ${pageType}`;
}

export function rumRouter() {
  const router = express.Router();
  const limiter = createRateLimiter(60_000, 60);
  router.post('/api/rum', (req: Request, res: Response, next: NextFunction) => {
    (async () => {
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const limit = limiter.check(ip);
      if (limit.limited) return res.status(429).end();
      limiter.record(ip);
      if (!(await collectionEnabled())) return res.status(204).end();
      const body = (req.body || {}) as { path?: unknown; pageType?: unknown; device?: unknown; view?: unknown; metrics?: unknown };
      const path = cleanPath(body.path);
      const pageType = RUM_PAGE_TYPES.includes(body.pageType as RumPageType) ? (body.pageType as RumPageType) : null;
      const device = body.device === 'mobile' || body.device === 'desktop' ? body.device : null;
      if (!path || !pageType || !device) return res.status(400).json({ error: 'Invalid measurement.' });
      const day = utcDay();
      if (body.view === true) await recordPageView(day, path, pageType);
      if (Array.isArray(body.metrics)) {
        for (const m of body.metrics.slice(0, 6) as { name?: unknown; value?: unknown }[]) {
          if (!RUM_METRICS.includes(m?.name as RumMetric) || typeof m.value !== 'number' || !Number.isFinite(m.value) || m.value < 0) continue;
          const metric = m.name as RumMetric;
          // Discard physically implausible values (broken clocks, background tabs).
          if ((metric === 'LCP' && m.value > 120_000) || (metric === 'INP' && m.value > 60_000) || (metric === 'CLS' && m.value > 50)) continue;
          await recordVital(day, pageType, metric, device, m.value);
        }
      }
      return res.status(204).end();
    })().catch(next);
  });
  return router;
}
