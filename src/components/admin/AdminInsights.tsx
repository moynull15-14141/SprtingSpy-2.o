/**
 * Analytics & Insights (PHASE R, Spec §25; Blueprint §6). Content and search
 * performance — separate from ad placement management (Ad Placements).
 *
 * Every number comes from a real source: first-party aggregates (page views,
 * Core Web Vitals, internal search) or the imported Search Console / Bing
 * data. A source that is not connected or has no data says so; nothing is
 * estimated or filled with placeholders.
 */

import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Button } from '../ui/Button';

type PeriodKey = 'today' | '7d' | '28d' | '3m' | '6m' | '12m' | 'custom';
const PERIODS: [PeriodKey, string][] = [['today', 'Today'], ['7d', '7 days'], ['28d', '28 days'], ['3m', '3 months'], ['6m', '6 months'], ['12m', '12 months'], ['custom', 'Custom']];

interface Row { key: string; clicks: number; impressions: number; ctr: number; position: number }
interface EngineData { hasData: boolean; totals: { clicks: number; impressions: number; ctr: number | null; position: number | null }; trend: { day: string; clicks: number; impressions: number }[]; queries: Row[]; pages: Row[]; countries: Row[]; devices: Row[]; appearance: Row[] }
interface Overview {
  period: { from: string; to: string; days: number };
  measurement: { realUserMonitoring: boolean; retention: string; thresholds: Record<string, { good: number; poor: number }> };
  pageViews: { total: number; byPageType: { pageType: string; views: number }[]; topPages: { path: string; pageType: string; views: number }[]; trend: { day: string; views: number }[] };
  webVitals: { pageType: string; metric: string; device: string; samples: number; p75: number | null; rating: string | null; goodShare: number | null }[];
  regressions: { pageType: string; metric: string; before: number; after: number; samples: { before: number; after: number }; reason: string }[];
  search: { totals: { searches: number; zeroResults: number; distinctQueries: number }; popular: { query: string; searches: number; zeroResults: number }[]; noResults: { query: string; searches: number }[]; trend: { day: string; searches: number; zeroResults: number }[] };
  searchEngines: { providers: { google: { configured: boolean; property: string | null; credentials: boolean; serviceAccount: string | null }; bing: { configured: boolean; siteUrl: string | null; credentials: boolean } }; google: EngineData; bing: EngineData; snapshots: { source: string; kind: string; fetchedAt: string; data: unknown }[] };
  publishing: { total: number; byType: { articleType: string; count: number }[] };
  // PHASE Q: content performance (first-party page views resolved to content) and the previous period.
  content: {
    topArticles: { path: string; views: number; id: string | null; title: string | null; articleType: string | null; sport: string | null; sportName: string | null; status: string | null }[];
    topEvents: { id: string | null; name: string | null; sport: string; sportName: string; path: string; eventViews: number; editionViews: number; articleViews: number; total: number }[];
    bySport: { sport: string; sportName: string; views: number }[];
    byArticleType: { articleType: string; views: number }[];
    unmatchedArticleViews: number;
  };
  previous: { from: string; to: string; views: number; articleViews: number; eventViews: number; searches: number };
  cache: { hits: number; misses: number; entries: number; ttlSeconds: number };
}

const card = 'rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-[#121417]';
const h3 = 'font-serif text-lg font-bold text-stone-900 dark:text-stone-100';
const num = (n: number) => n.toLocaleString('en-GB');
const pct = (n: number | null) => (n === null ? '—' : `${(n * 100).toFixed(1)}%`);
const fmtVital = (metric: string, v: number | null) => (v === null ? '—' : metric === 'CLS' ? v.toFixed(2) : `${num(Math.round(v))} ms`);
const RATING: Record<string, string> = { good: 'text-emerald-700 dark:text-emerald-400', 'needs-improvement': 'text-amber-700 dark:text-amber-400', poor: 'text-rose-700 dark:text-rose-400' };

function Bars({ data, value, label }: { data: Record<string, unknown>[]; value: string; label: string }) {
  const max = Math.max(1, ...data.map((d) => Number(d[value]) || 0));
  if (!data.length) return <p className="text-xs text-stone-500 dark:text-stone-400">No data in this period.</p>;
  return (
    <ul className="space-y-1 text-xs" aria-label={label}>
      {data.slice(0, 31).map((d, i) => (
        <li key={i} className="grid grid-cols-[6.5rem_minmax(0,1fr)_4rem] items-center gap-2">
          <span className="tabular-nums text-stone-500">{String(d.day)}</span>
          <span className="h-2 rounded bg-amber-600/80" style={{ width: `${((Number(d[value]) || 0) / max) * 100}%` }} aria-hidden="true" />
          <span className="text-right tabular-nums">{num(Number(d[value]) || 0)}</span>
        </li>
      ))}
    </ul>
  );
}

function Table({ rows, columns, empty }: { rows: Record<string, unknown>[]; columns: [string, string, (v: unknown) => string][]; empty: string }) {
  if (!rows.length) return <p className="text-xs text-stone-500 dark:text-stone-400">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-xs">
        <thead className="text-[10px] uppercase tracking-wider text-stone-500"><tr>{columns.map(([k, l]) => <th key={k} className="px-2 py-1">{l}</th>)}</tr></thead>
        <tbody className="divide-y divide-stone-100 dark:divide-stone-800">{rows.map((r, i) => <tr key={i}>{columns.map(([k, , f]) => <td key={k} className="max-w-[28rem] break-words px-2 py-1 tabular-nums">{f(r[k])}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/** PHASE Q: change against the previous period of the same length ("new" when it had none). */
function Change({ now, before }: { now: number; before: number }) {
  if (!before) return <span className="text-[11px] text-stone-500">{now ? 'new in this period' : 'no data in either period'}</span>;
  const delta = (now - before) / before;
  const cls = delta > 0 ? 'text-emerald-700 dark:text-emerald-400' : delta < 0 ? 'text-rose-700 dark:text-rose-400' : 'text-stone-500';
  return <span className={`text-[11px] ${cls}`}>{delta > 0 ? '+' : ''}{(delta * 100).toFixed(1)}% vs previous period ({num(before)})</span>;
}

const str = (v: unknown) => String(v ?? '');
const n0 = (v: unknown) => num(Number(v) || 0);
const engineColumns: [string, string, (v: unknown) => string][] = [['key', 'Key', str], ['clicks', 'Clicks', n0], ['impressions', 'Impressions', n0], ['ctr', 'CTR', (v) => pct(Number(v))], ['position', 'Avg. position', (v) => (Number(v) ? Number(v).toFixed(1) : '—')]];

export const AdminInsights: React.FC = () => {
  const { apiCall, currentUser, showNotification } = useApp();
  const [period, setPeriod] = useState<PeriodKey>('28d');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [device, setDevice] = useState<'all' | 'mobile' | 'desktop'>('all');
  const [syncing, setSyncing] = useState(false);

  const load = async () => {
    if (period === 'custom' && (!from || !to)) return;
    setError(null);
    const qs = period === 'custom' ? `period=custom&from=${from}&to=${to}` : `period=${period}`;
    const res = await apiCall<Overview>(`/api/insights/overview?${qs}`);
    if (res.data) setData(res.data); else setError(res.error || 'Insights could not be loaded.');
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [period, from, to]);

  const sync = async () => {
    setSyncing(true);
    const res = await apiCall<{ results: Record<string, { ok: boolean; detail: string }> }>('/api/search-console/sync', { method: 'POST', body: { days: 28 } });
    setSyncing(false);
    if (res.data) { showNotification(Object.entries(res.data.results).map(([k, v]) => `${k}: ${v.detail}`).join(' ') || 'Nothing to import.', 'success'); void load(); }
  };

  const vitals = (data?.webVitals ?? []).filter((v) => v.device === device);

  return (
    <div className="space-y-6">
      <div className="border-b border-stone-200 pb-4 dark:border-stone-800">
        <h2 className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">Analytics &amp; Insights</h2>
        <p className="mt-1 max-w-3xl text-xs text-stone-500 dark:text-stone-400">Content, search and real-user performance. Advertising slots are managed separately in Ad Placements. Only measured data is shown.</p>
      </div>

      <div className="flex flex-wrap items-end gap-2" role="group" aria-label="Period">
        {PERIODS.map(([key, label]) => (
          <button key={key} type="button" aria-pressed={period === key} onClick={() => setPeriod(key)} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${period === key ? 'bg-amber-700 text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-300'}`}>{label}</button>
        ))}
        {period === 'custom' && <>
          <label className="text-xs">From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="ml-1 rounded border border-stone-300 p-1 dark:border-stone-700 dark:bg-stone-950" /></label>
          <label className="text-xs">To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="ml-1 rounded border border-stone-300 p-1 dark:border-stone-700 dark:bg-stone-950" /></label>
        </>}
        {data && <span className="ml-auto text-xs text-stone-500 dark:text-stone-400">{data.period.from} – {data.period.to} (UTC)</span>}
      </div>

      {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">{error}</p>}
      {!data ? <p className="text-sm text-stone-500" aria-live="polite">{period === 'custom' && (!from || !to) ? 'Choose both dates.' : 'Loading…'}</p> : (
        <>
          {/* PHASE Q: OVERVIEW */}
          <section className={card} aria-labelledby="ins-overview">
            <h3 id="ins-overview" className={h3}>Overview</h3>
            <p className="mt-1 text-[11px] text-stone-500 dark:text-stone-400">First-party page views (aggregate counts per page and UTC day; no visitors or sessions are tracked, so these are views, not unique users). Previous period: {data.previous.from} – {data.previous.to}.</p>
            {(() => {
              const byType = Object.fromEntries(data.pageViews.byPageType.map((r) => [r.pageType, r.views]));
              const kpis: [string, number, number][] = [
                ['Page views', data.pageViews.total, data.previous.views],
                ['Article views', byType.article ?? 0, data.previous.articleViews],
                ['Event & edition views', (byType.event ?? 0) + (byType.edition ?? 0), data.previous.eventViews],
                ['Site searches', data.search.totals.searches, data.previous.searches],
              ];
              return (
                <dl className="mt-3 grid grid-cols-2 gap-3 text-xs lg:grid-cols-4" data-insights-kpis>
                  {kpis.map(([label, now, before]) => <div key={label}><dt className="text-stone-500">{label}</dt><dd className="text-xl font-bold tabular-nums">{num(now)}</dd><dd><Change now={now} before={before} /></dd></div>)}
                </dl>
              );
            })()}
          </section>

          {/* PHASE Q: CONTENT PERFORMANCE */}
          <section className={card} aria-labelledby="ins-content">
            <h3 id="ins-content" className={h3}>Content performance</h3>
            <p className="mt-1 text-[11px] text-stone-500 dark:text-stone-400">Views of each article, event and edition page in this period. Card and search-result clicks are measured in Google Analytics (select_content, search_result_click) when it is configured and visitors consent.</p>
            <div className="mt-3 grid gap-4 lg:grid-cols-2">
              <div className="lg:col-span-2"><h4 className="mb-1 text-xs font-semibold">Top articles</h4><Table rows={data.content.topArticles.map((a) => ({ ...a, label: a.title ?? `${a.path} (no longer resolves)` })) as unknown as Record<string, unknown>[]} columns={[['label', 'Article', str], ['articleType', 'Type', str], ['sportName', 'Sport', str], ['status', 'Status', str], ['views', 'Views', n0]]} empty="No article views counted in this period." /></div>
              <div className="lg:col-span-2"><h4 className="mb-1 text-xs font-semibold">Top events</h4><Table rows={data.content.topEvents.map((e) => ({ ...e, label: e.name ?? `${e.path} (no longer resolves)` })) as unknown as Record<string, unknown>[]} columns={[['label', 'Event', str], ['sportName', 'Sport', str], ['eventViews', 'Event page', n0], ['editionViews', 'Edition pages', n0], ['articleViews', 'Its articles', n0], ['total', 'Total', n0]]} empty="No event or edition views counted in this period." /></div>
              <div><h4 className="mb-1 text-xs font-semibold">Views by sport</h4><Table rows={data.content.bySport as unknown as Record<string, unknown>[]} columns={[['sportName', 'Sport', str], ['views', 'Views (hub, events, editions, articles)', n0]]} empty="No sport views counted in this period." /></div>
              <div><h4 className="mb-1 text-xs font-semibold">Article views by Article Type</h4><Table rows={data.content.byArticleType as unknown as Record<string, unknown>[]} columns={[['articleType', 'Article Type', str], ['views', 'Views', n0]]} empty="No article views counted in this period." /></div>
            </div>
            {data.content.unmatchedArticleViews > 0 && <p className="mt-2 text-[11px] text-stone-500 dark:text-stone-400">{num(data.content.unmatchedArticleViews)} article view(s) were for URLs that no longer resolve (deleted, unpublished or moved articles); they are not attributed to other content.</p>}
          </section>

          {/* SEARCH ENGINES */}
          <section className={card} aria-labelledby="ins-engines">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="ins-engines" className={h3}>Search engines (Google Search Console · Bing Webmaster Tools)</h3>
              {currentUser.role === 'Admin' && (data.searchEngines.providers.google.configured || data.searchEngines.providers.bing.configured) && <Button size="sm" variant="outline" isLoading={syncing} onClick={() => void sync()}>Import latest data</Button>}
            </div>
            {(['google', 'bing'] as const).map((src) => {
              const p = data.searchEngines.providers[src];
              const d = data.searchEngines[src];
              return (
                <div key={src} className="mt-4 border-t border-stone-100 pt-3 dark:border-stone-800">
                  <h4 className="text-sm font-semibold">{src === 'google' ? 'Google Search Console' : 'Bing Webmaster Tools'}</h4>
                  {!p.configured ? (
                    <p className="mt-1 text-xs text-stone-600 dark:text-stone-400">
                      Not connected. {src === 'google'
                        ? <>Owner setup: create a Google Cloud service account with read-only Search Console access, add its e-mail as a user of the property, put its JSON key in the server environment variable <code>GOOGLE_SEARCH_CONSOLE_CREDENTIALS</code>, and set Settings → Search engine data → Search Console property. {p.credentials ? 'Credentials found; the property is not set.' : ''}</>
                        : <>Owner setup: create an API key in Bing Webmaster Tools, put it in the server environment variable <code>BING_WEBMASTER_API_KEY</code>, and set Settings → Search engine data → Bing site URL. {p.credentials ? 'API key found; the site URL is not set.' : ''}</>}
                    </p>
                  ) : !d.hasData ? <p className="mt-1 text-xs text-stone-600 dark:text-stone-400">Connected ({src === 'google' ? data.searchEngines.providers.google.property : data.searchEngines.providers.bing.siteUrl}). No data imported for this period yet.</p> : (
                    <div className="mt-2 space-y-3">
                      <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                        <div><dt className="text-stone-500">Clicks</dt><dd className="text-lg font-bold tabular-nums">{num(d.totals.clicks)}</dd></div>
                        <div><dt className="text-stone-500">Impressions</dt><dd className="text-lg font-bold tabular-nums">{num(d.totals.impressions)}</dd></div>
                        <div><dt className="text-stone-500">CTR</dt><dd className="text-lg font-bold tabular-nums">{pct(d.totals.ctr)}</dd></div>
                        <div><dt className="text-stone-500">Avg. position</dt><dd className="text-lg font-bold tabular-nums">{d.totals.position === null ? '—' : d.totals.position.toFixed(1)}</dd></div>
                      </dl>
                      <Bars data={d.trend} value="clicks" label="Daily clicks" />
                      <div className="grid gap-4 lg:grid-cols-2">
                        <div><h5 className="mb-1 text-xs font-semibold">Top queries</h5><Table rows={d.queries as unknown as Record<string, unknown>[]} columns={engineColumns} empty="No query data." /></div>
                        <div><h5 className="mb-1 text-xs font-semibold">Top pages</h5><Table rows={d.pages as unknown as Record<string, unknown>[]} columns={engineColumns} empty="No page data." /></div>
                        {src === 'google' && <>
                          <div><h5 className="mb-1 text-xs font-semibold">Countries</h5><Table rows={d.countries as unknown as Record<string, unknown>[]} columns={engineColumns} empty="No country data." /></div>
                          <div><h5 className="mb-1 text-xs font-semibold">Devices</h5><Table rows={d.devices as unknown as Record<string, unknown>[]} columns={engineColumns} empty="No device data." /></div>
                          <div><h5 className="mb-1 text-xs font-semibold">Search appearance</h5><Table rows={d.appearance as unknown as Record<string, unknown>[]} columns={engineColumns} empty="No search appearance data." /></div>
                        </>}
                      </div>
                    </div>
                  )}
                  {data.searchEngines.snapshots.filter((s) => s.source === src).map((s) => (
                    <details key={s.kind} className="mt-2 text-xs"><summary className="cursor-pointer font-semibold">{s.kind === 'sitemaps' ? 'Sitemap status' : 'Crawl statistics'} (fetched {new Date(s.fetchedAt).toLocaleString()})</summary><pre className="mt-1 max-h-64 overflow-auto rounded bg-stone-50 p-2 text-[11px] dark:bg-stone-900">{JSON.stringify(s.data, null, 2)}</pre></details>
                  ))}
                </div>
              );
            })}
          </section>

          {/* PAGE VIEWS */}
          <section className={card} aria-labelledby="ins-views">
            <h3 id="ins-views" className={h3}>Page views (first-party, aggregate)</h3>
            {!data.measurement.realUserMonitoring && <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">Real-user monitoring is switched off in Settings; no new views or vitals are being counted.</p>}
            <p className="mt-1 text-[11px] text-stone-500 dark:text-stone-400">Aggregates are kept for {data.measurement.retention === 'unlimited' ? 'an unlimited time' : data.measurement.retention.replace('-', ' ')} (Settings → Privacy &amp; consent → Analytics retention).</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{num(data.pageViews.total)}</p>
            <div className="mt-3 grid gap-4 lg:grid-cols-2">
              <div><h4 className="mb-1 text-xs font-semibold">By page type</h4><Table rows={data.pageViews.byPageType as unknown as Record<string, unknown>[]} columns={[['pageType', 'Page type', str], ['views', 'Views', n0]]} empty="No page views counted in this period." /></div>
              <div><h4 className="mb-1 text-xs font-semibold">Top pages</h4><Table rows={data.pageViews.topPages as unknown as Record<string, unknown>[]} columns={[['path', 'Path', str], ['pageType', 'Type', str], ['views', 'Views', n0]]} empty="No page views counted in this period." /></div>
            </div>
            <div className="mt-3"><h4 className="mb-1 text-xs font-semibold">Daily views</h4><Bars data={data.pageViews.trend} value="views" label="Daily page views" /></div>
          </section>

          {/* CORE WEB VITALS */}
          <section className={card} aria-labelledby="ins-vitals">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="ins-vitals" className={h3}>Core Web Vitals (real users, 75th percentile)</h3>
              <div className="flex gap-1" role="group" aria-label="Device">{(['all', 'mobile', 'desktop'] as const).map((d) => <button key={d} type="button" aria-pressed={device === d} onClick={() => setDevice(d)} className={`rounded px-2 py-1 text-xs ${device === d ? 'bg-amber-700 text-white' : 'bg-stone-100 dark:bg-stone-800'}`}>{d}</button>)}</div>
            </div>
            <p className="mt-1 text-[11px] text-stone-500 dark:text-stone-400">Targets: LCP &lt; 2.5 s, INP &lt; 200 ms, CLS &lt; 0.1 (Spec §23.2). Values are the upper edge of the histogram bucket that holds the 75th percentile.</p>
            <div className="mt-2"><Table rows={vitals as unknown as Record<string, unknown>[]} columns={[['pageType', 'Page type', str], ['metric', 'Metric', str], ['p75', 'p75', (v) => String(v ?? '—')], ['rating', 'Rating', (v) => String(v ?? '—')], ['goodShare', 'Good', (v) => pct(v as number | null)], ['samples', 'Samples', n0]]} empty="No real-user measurements in this period." /></div>
            {vitals.length > 0 && <ul className="mt-2 flex flex-wrap gap-3 text-xs">{vitals.map((v) => <li key={`${v.pageType}-${v.metric}`} className={RATING[v.rating ?? ''] ?? ''}>{v.pageType} {v.metric}: {fmtVital(v.metric, v.p75)}</li>)}</ul>}
            <h4 className="mt-4 text-xs font-semibold">Regressions (last 7 days vs the 28 days before)</h4>
            {data.regressions.length === 0 ? <p className="text-xs text-stone-500 dark:text-stone-400">None detected (needs at least 50 samples in both windows).</p> : (
              <ul className="mt-1 space-y-1 text-xs text-rose-800 dark:text-rose-300">{data.regressions.map((r, i) => <li key={i}><strong>{r.pageType} {r.metric}</strong>: {fmtVital(r.metric, r.before)} → {fmtVital(r.metric, r.after)} — {r.reason} ({r.samples.before} / {r.samples.after} samples)</li>)}</ul>
            )}
          </section>

          {/* INTERNAL SEARCH */}
          <section className={card} aria-labelledby="ins-search">
            <h3 id="ins-search" className={h3}>Site search</h3>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
              <div><dt className="text-stone-500">Searches</dt><dd className="text-lg font-bold tabular-nums">{num(data.search.totals.searches)}</dd></div>
              <div><dt className="text-stone-500">With no results</dt><dd className="text-lg font-bold tabular-nums">{num(data.search.totals.zeroResults)}</dd></div>
              <div><dt className="text-stone-500">Distinct queries</dt><dd className="text-lg font-bold tabular-nums">{num(data.search.totals.distinctQueries)}</dd></div>
            </dl>
            <div className="mt-3 grid gap-4 lg:grid-cols-2">
              <div><h4 className="mb-1 text-xs font-semibold">Popular searches</h4><Table rows={data.search.popular as unknown as Record<string, unknown>[]} columns={[['query', 'Query', str], ['searches', 'Searches', n0], ['zeroResults', 'No results', n0]]} empty="No searches in this period." /></div>
              <div><h4 className="mb-1 text-xs font-semibold">No-result searches (content opportunities)</h4><Table rows={data.search.noResults as unknown as Record<string, unknown>[]} columns={[['query', 'Query', str], ['searches', 'Times', n0]]} empty="Every search found something." /></div>
            </div>
            <div className="mt-3"><h4 className="mb-1 text-xs font-semibold">Search trend</h4><Bars data={data.search.trend} value="searches" label="Daily searches" /></div>
          </section>

          {/* PUBLISHING */}
          <section className={card} aria-labelledby="ins-publishing">
            <h3 id="ins-publishing" className={h3}>Publishing in this period</h3>
            <p className="mt-1 text-2xl font-bold tabular-nums">{num(data.publishing.total)} <span className="text-sm font-normal text-stone-500">articles published</span></p>
            <Table rows={data.publishing.byType as unknown as Record<string, unknown>[]} columns={[['articleType', 'Article Type', str], ['count', 'Published', n0]]} empty="Nothing was published in this period." />
          </section>

          <p className="text-[11px] text-stone-500 dark:text-stone-400">Public data cache (this server process): {num(data.cache.hits)} hits, {num(data.cache.misses)} misses, {data.cache.entries} entries, {data.cache.ttlSeconds}s TTL.</p>
        </>
      )}
    </div>
  );
};
