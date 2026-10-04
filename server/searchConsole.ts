/**
 * Search performance data import (PHASE R, Spec §17.2 "Search Console
 * integration", §25.3 Google Search Console, §25.4 Bing Webmaster Tools).
 *
 * Verification meta tags (Settings) prove site ownership; this module imports
 * the actual DATA. Nothing is estimated: rows are stored exactly as the
 * provider API returned them and the Insights screen shows "not connected"
 * until a provider is configured.
 *
 * Google (service account, read-only scope):
 *   env  GOOGLE_SEARCH_CONSOLE_CREDENTIALS  service-account JSON (client_email, private_key)
 *   set  searchConsoleProperty               e.g. "sc-domain:sportingspy.com" or "https://sportingspy.com/"
 *   The service account's e-mail must be added as a user of the property in
 *   Search Console (OWNER action).
 *   Imported: daily clicks/impressions/CTR/position, queries, pages,
 *   countries, devices, search appearance; sitemap status snapshot.
 *
 * Bing (API key):
 *   env  BING_WEBMASTER_API_KEY
 *   set  bingSiteUrl                         e.g. "https://sportingspy.com/"
 *   Imported: daily traffic, queries, pages; crawl statistics snapshot.
 *
 * Index coverage per URL is not available as a bulk API from either
 * provider; the sitemap snapshot reports submitted/indexed counts where the
 * provider returns them.
 */

import crypto from 'node:crypto';
import express, { type Request, type Response, type NextFunction } from 'express';
import { prisma } from './db';
import { requireRole, type AuthLookup } from './auth';
import { recordAudit } from './audit';

const GOOGLE_API = () => (process.env.SEARCH_CONSOLE_API_BASE || 'https://searchconsole.googleapis.com').replace(/\/+$/, '');
const GOOGLE_TOKEN = () => process.env.GOOGLE_OAUTH_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const BING_API = () => (process.env.BING_WEBMASTER_API_BASE || 'https://ssl.bing.com/webmaster/api.svc/json').replace(/\/+$/, '');
const DIMENSIONS = ['query', 'page', 'country', 'device', 'searchAppearance'] as const;
const DAY = 86_400_000;

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const utcDate = (s: string) => new Date(`${s}T00:00:00.000Z`);

interface ServiceAccount { client_email: string; private_key: string; token_uri?: string }

function googleCredentials(): ServiceAccount | null {
  const raw = process.env.GOOGLE_SEARCH_CONSOLE_CREDENTIALS;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ServiceAccount;
    return parsed.client_email && parsed.private_key ? parsed : null;
  } catch {
    return null;
  }
}

async function setting(key: string): Promise<string | null> {
  return (await prisma.siteSetting.findUnique({ where: { key } }))?.value?.trim() || null;
}

export async function searchProviders() {
  const [property, bingSite] = await Promise.all([setting('searchConsoleProperty'), setting('bingSiteUrl')]);
  return {
    google: { configured: !!(googleCredentials() && property), property, credentials: !!googleCredentials(), serviceAccount: googleCredentials()?.client_email ?? null },
    bing: { configured: !!(process.env.BING_WEBMASTER_API_KEY && bingSite), siteUrl: bingSite, credentials: !!process.env.BING_WEBMASTER_API_KEY },
  };
}

// ── Google ──

const b64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');

async function googleAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/webmasters.readonly', aud: GOOGLE_TOKEN(), iat: now, exp: now + 3600 }));
  const signature = crypto.createSign('RSA-SHA256').update(`${header}.${claims}`).sign(sa.private_key).toString('base64url');
  const response = await fetch(GOOGLE_TOKEN(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${signature}` }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Google token request failed (HTTP ${response.status}).`);
  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) throw new Error('Google token response had no access token.');
  return body.access_token;
}

async function googleQuery(token: string, property: string, body: Record<string, unknown>) {
  const response = await fetch(`${GOOGLE_API()}/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Search Console query failed (HTTP ${response.status}).`);
  return ((await response.json()) as { rows?: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[] }).rows || [];
}

type StatRow = { source: string; day: Date; dimension: string; key: string; clicks: number; impressions: number; ctr: number; position: number };

async function storeRows(rows: StatRow[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    await prisma.$transaction(chunk.map((r) => prisma.searchPerformanceStat.upsert({
      where: { source_day_dimension_key: { source: r.source, day: r.day, dimension: r.dimension, key: r.key } },
      create: r,
      update: { clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position },
    })));
  }
}

/** Imports `days` complete days ending 3 days ago (Search Console data lags ~2–3 days). */
export async function syncGoogle(days: number): Promise<{ rows: number; from: string; to: string }> {
  const sa = googleCredentials();
  const property = await setting('searchConsoleProperty');
  if (!sa || !property) throw new Error('Google Search Console is not configured.');
  const token = await googleAccessToken(sa);
  const end = new Date(Date.now() - 3 * DAY);
  const start = new Date(end.getTime() - (days - 1) * DAY);
  const rows: StatRow[] = [];
  const series = await googleQuery(token, property, { startDate: isoDay(start), endDate: isoDay(end), dimensions: ['date'], rowLimit: 1000 });
  for (const r of series) rows.push({ source: 'google', day: utcDate(r.keys[0]), dimension: 'date', key: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position });
  for (let t = start.getTime(); t <= end.getTime(); t += DAY) {
    const day = isoDay(new Date(t));
    for (const dimension of DIMENSIONS) {
      const result = await googleQuery(token, property, { startDate: day, endDate: day, dimensions: [dimension], rowLimit: 500 });
      for (const r of result) rows.push({ source: 'google', day: utcDate(day), dimension, key: String(r.keys[0]).slice(0, 500), clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position });
    }
  }
  await storeRows(rows);
  // Sitemap status snapshot.
  const sm = await fetch(`${GOOGLE_API()}/webmasters/v3/sites/${encodeURIComponent(property)}/sitemaps`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
  if (sm.ok) {
    const data = (await sm.json()) as Record<string, unknown>;
    await prisma.searchEngineSnapshot.upsert({ where: { source_kind: { source: 'google', kind: 'sitemaps' } }, create: { source: 'google', kind: 'sitemaps', fetchedAt: new Date(), data: data as object }, update: { fetchedAt: new Date(), data: data as object } });
  }
  return { rows: rows.length, from: isoDay(start), to: isoDay(end) };
}

// ── Bing ──

const bingDate = (value: unknown): Date | null => {
  const m = typeof value === 'string' ? value.match(/\/Date\((\d+)/) : null;
  return m ? utcDate(isoDay(new Date(Number(m[1])))) : null;
};

async function bingCall(method: string, siteUrl: string) {
  const url = `${BING_API()}/${method}?siteUrl=${encodeURIComponent(siteUrl)}&apikey=${encodeURIComponent(process.env.BING_WEBMASTER_API_KEY || '')}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Bing ${method} failed (HTTP ${response.status}).`);
  return ((await response.json()) as { d?: unknown }).d;
}

export async function syncBing(): Promise<{ rows: number }> {
  const siteUrl = await setting('bingSiteUrl');
  if (!process.env.BING_WEBMASTER_API_KEY || !siteUrl) throw new Error('Bing Webmaster Tools is not configured.');
  const rows: StatRow[] = [];
  type BingStat = { Query?: string; Date?: string; Clicks?: number; Impressions?: number; AvgImpressionPosition?: number; AvgClickPosition?: number };
  const traffic = ((await bingCall('GetRankAndTrafficStats', siteUrl)) || []) as BingStat[];
  for (const r of traffic) {
    const day = bingDate(r.Date);
    if (!day) continue;
    const clicks = r.Clicks || 0, impressions = r.Impressions || 0;
    rows.push({ source: 'bing', day, dimension: 'date', key: isoDay(day), clicks, impressions, ctr: impressions ? clicks / impressions : 0, position: r.AvgImpressionPosition ?? 0 });
  }
  for (const [method, dimension] of [['GetQueryStats', 'query'], ['GetPageStats', 'page']] as const) {
    const list = ((await bingCall(method, siteUrl)) || []) as BingStat[];
    for (const r of list) {
      const day = bingDate(r.Date);
      if (!day || !r.Query) continue;
      const clicks = r.Clicks || 0, impressions = r.Impressions || 0;
      rows.push({ source: 'bing', day, dimension, key: r.Query.slice(0, 500), clicks, impressions, ctr: impressions ? clicks / impressions : 0, position: r.AvgImpressionPosition ?? 0 });
    }
  }
  await storeRows(rows);
  const crawl = await bingCall('GetCrawlStats', siteUrl).catch(() => null);
  if (crawl) await prisma.searchEngineSnapshot.upsert({ where: { source_kind: { source: 'bing', kind: 'crawl' } }, create: { source: 'bing', kind: 'crawl', fetchedAt: new Date(), data: { stats: crawl } as object }, update: { fetchedAt: new Date(), data: { stats: crawl } as object } });
  return { rows: rows.length };
}

async function logSync(integration: string, status: 'success' | 'failure', detail: string) {
  await prisma.seoIntegrationLog.create({ data: { id: `seo-int-${crypto.randomUUID()}`, integration, action: 'import', status, httpStatus: null, detail: detail.slice(0, 1000), urls: [], createdAt: new Date() } });
}

/** Runs every configured import; one failure never blocks the other. */
export async function runSearchSync(days: number) {
  const providers = await searchProviders();
  const results: Record<string, { ok: boolean; detail: string }> = {};
  if (providers.google.configured) {
    try { const r = await syncGoogle(days); results.google = { ok: true, detail: `${r.rows} rows imported for ${r.from} – ${r.to}.` }; await logSync('search-console', 'success', results.google.detail); }
    catch (err) { results.google = { ok: false, detail: err instanceof Error ? err.message : 'Import failed.' }; await logSync('search-console', 'failure', results.google.detail); }
  }
  if (providers.bing.configured) {
    try { const r = await syncBing(); results.bing = { ok: true, detail: `${r.rows} rows imported.` }; await logSync('bing-webmaster', 'success', results.bing.detail); }
    catch (err) { results.bing = { ok: false, detail: err instanceof Error ? err.message : 'Import failed.' }; await logSync('bing-webmaster', 'failure', results.bing.detail); }
  }
  return { providers, results };
}

let lastScheduledCheck = 0;
/** Called by the 30-second scheduler: imports at most once a day, only when configured. */
export async function runScheduledSearchSync(_origin: string) {
  if (Date.now() - lastScheduledCheck < 60 * 60_000) return;
  lastScheduledCheck = Date.now();
  const providers = await searchProviders();
  if (!providers.google.configured && !providers.bing.configured) return;
  const last = await prisma.seoIntegrationLog.findFirst({ where: { integration: { in: ['search-console', 'bing-webmaster'] }, action: 'import' }, orderBy: { createdAt: 'desc' } });
  if (last && Date.now() - last.createdAt.getTime() < 22 * 60 * 60_000) return;
  await runSearchSync(7);
}

export function searchConsoleRouter(getLookup: () => AuthLookup, _origin: () => string) {
  const router = express.Router();
  const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };

  router.get('/status', requireRole(getLookup, ['Admin', 'Editor']), wrap(async (_req, res) => {
    const [providers, logs, snapshots] = await Promise.all([
      searchProviders(),
      prisma.seoIntegrationLog.findMany({ where: { integration: { in: ['search-console', 'bing-webmaster'] } }, orderBy: { createdAt: 'desc' }, take: 10 }),
      prisma.searchEngineSnapshot.findMany(),
    ]);
    return res.json({ providers, logs, snapshots });
  }));

  router.post('/sync', requireRole(getLookup, ['Admin']), wrap(async (req, res) => {
    const days = Number.isInteger(req.body?.days) && req.body.days >= 1 && req.body.days <= 90 ? req.body.days : 7;
    const result = await runSearchSync(days);
    if (!result.providers.google.configured && !result.providers.bing.configured) return res.status(400).json({ error: 'No search engine data provider is configured. See Admin → Insights → Search engines for the setup steps.', ...result });
    await recordAudit(prisma, { userId: req.authContext!.userId, userName: req.authContext!.userName, action: 'Imported Search Performance', entityType: 'Integration', entityId: 'search-performance', details: Object.entries(result.results).map(([k, v]) => `${k}: ${v.ok ? 'ok' : 'failed'} — ${v.detail}`).join(' ') || 'Nothing imported.' });
    return res.json(result);
  }));

  return router;
}
