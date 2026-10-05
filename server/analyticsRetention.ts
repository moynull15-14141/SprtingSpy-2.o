/**
 * Analytics retention (PHASE Q). The first-party aggregates (PageViewStat,
 * WebVitalStat, SearchQueryStat) and the imported Search Console / Bing rows
 * (SearchPerformanceStat) grow by one row per day per page/query. Rows older
 * than the retention chosen in Admin → Settings → Privacy & consent are
 * deleted, whole UTC months at a time. Default: 25 months (two full years of
 * year-on-year comparison; the dashboard reads at most 400 days). "unlimited"
 * keeps everything. Only these aggregate tables are touched.
 */

import { prisma } from './db';

export const RETENTION_OPTIONS = ['13-months', '25-months', '37-months', 'unlimited'] as const;
export const DEFAULT_RETENTION = '25-months';
const MONTHS: Record<string, number | null> = { '13-months': 13, '25-months': 25, '37-months': 37, unlimited: null };
const INTERVAL_MS = 6 * 60 * 60 * 1000;
let lastRun = 0;

/** First day (UTC) of the month `months` months before `now`'s month. Rows before it are expired. */
export function retentionCutoff(months: number, now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));
}

/**
 * Deletes expired aggregate rows. Runs at most every 6 hours unless `force`.
 * Returns null when skipped. Never throws.
 */
export async function purgeExpiredAnalytics(options: { now?: Date; force?: boolean } = {}) {
  const now = options.now ?? new Date();
  if (!options.force && now.getTime() - lastRun < INTERVAL_MS) return null;
  lastRun = now.getTime();
  try {
    const setting = await prisma.siteSetting.findUnique({ where: { key: 'analyticsRetention' } });
    // `null` means unlimited; only an unknown/missing value falls back to the default.
    const choice = setting?.value && setting.value in MONTHS ? setting.value : DEFAULT_RETENTION;
    const months = MONTHS[choice];
    if (months === null) return { retention: 'unlimited', deleted: 0 };
    const cutoff = retentionCutoff(months, now);
    const where = { day: { lt: cutoff } };
    const results = await prisma.$transaction([
      prisma.pageViewStat.deleteMany({ where }),
      prisma.webVitalStat.deleteMany({ where }),
      prisma.searchQueryStat.deleteMany({ where }),
      prisma.searchPerformanceStat.deleteMany({ where }),
    ]);
    const deleted = results.reduce((a, r) => a + r.count, 0);
    if (deleted) console.log(`[Analytics] Retention (${months} months): removed ${deleted} aggregate row(s) before ${cutoff.toISOString().slice(0, 10)}.`);
    return { retention: `${months}-months`, cutoff: cutoff.toISOString().slice(0, 10), deleted };
  } catch {
    console.error('[Analytics] Retention clean-up failed. Check database availability.');
    return null;
  }
}
