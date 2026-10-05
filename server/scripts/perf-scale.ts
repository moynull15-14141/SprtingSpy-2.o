/**
 * PHASE P: server-side performance measurement against the synthetic
 * performance database (see perf-seed.ts). Starts the production build with
 * PRISMA_QUERY_LOG=true and, for each URL, reports median/p90 response time,
 * response bytes, and the number and total time of database queries behind
 * one request. Read-only apart from the login session it creates.
 *
 *   DATABASE_URL=…/sportingspy_perf PERF_CACHE=cold|warm npm run perf:scale
 *
 * cold = PUBLIC_CACHE_TTL_SECONDS=0 (every request does its full database
 * work: the cost after a publish or for a never-visited page); warm = default
 * cache, measured after one priming request.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { checkDatabaseUrlIsLocalDev } from '../dbSafety';

const dbName = new URL(process.env.DATABASE_URL ?? 'invalid://x/').pathname.replace(/^\//, '');
assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe && dbName.endsWith('_perf'), 'perf:scale only runs against a local "_perf" database.');
assert(fs.existsSync('.next/BUILD_ID'), 'Build first (npm run build).');
const mode = process.env.PERF_CACHE === 'warm' ? 'warm' : 'cold';
const RUNS = Number(process.env.PERF_RUNS || 5);

const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = (probe.address() as { port: number }).port; await new Promise<void>((r) => probe.close(() => r()));
const base = `http://localhost:${port}`;
let log: string[] = [];
let all = '';
const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
  cwd: process.cwd(), windowsHide: true,
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production', APP_ENV: 'production', AUTH_MODE: 'production', DEV_LOGIN_BYPASS: 'false', ALLOWED_ORIGIN: base, SITE_ORIGIN: base, INDEXNOW_ENDPOINT: '', GEMINI_API_KEY: '', TOTP_ENCRYPTION_KEY: 'perf-scale-key-0123456789abcdef', PRISMA_QUERY_LOG: 'true', ...(mode === 'cold' ? { PUBLIC_CACHE_TTL_SECONDS: '0' } : {}) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (c) => { const s = String(c); all += s; for (const line of s.split('\n')) if (line.startsWith('[db-query]')) log.push(line); });
child.stderr.on('data', (c) => { all += c; });
await new Promise<void>((resolve, reject) => { const t = setTimeout(() => reject(new Error(all.slice(-800))), 120_000); const check = setInterval(() => { if (all.includes('Server running')) { clearInterval(check); clearTimeout(t); resolve(); } }, 200); });

const cookies = new Map<string, string>();
const request = async (path: string, method = 'GET', body?: unknown) => {
  const headers: Record<string, string> = { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['x-csrf-token'] = cookies.get('csrf_token') ?? '';
  const res = await fetch(base + path, { method, headers, redirect: 'manual', body: body === undefined ? undefined : JSON.stringify(body) });
  for (const raw of res.headers.getSetCookie()) { const [pair] = raw.split(';'); const i = pair.indexOf('='); cookies.set(pair.slice(0, i), pair.slice(i + 1)); }
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, bytes: buf.length };
};
await request('/robots.txt');
const login = await request('/api/auth/login', 'POST', { email: 'perf-admin@example.test', password: process.env.PERF_ADMIN_PASSWORD || 'Perf-Admin-Password-1' });
assert.equal(login.status, 200, 'perf admin login');

const targets: [string, string][] = [
  ['Home', '/'], ['Sports directory', '/sports/'], ['Sport hub', '/tennis/'], ['Event', '/tennis/perf-event-0/'], ['Edition', '/tennis/perf-event-0/2026/'],
  ['Article (edition)', '/tennis/perf-event-0/2022/perf-article-0/'], ['Article (general)', '/boxing/perf-article-8/'],
  ['Latest p1', '/latest/'], ['Latest p3000 (deep)', '/latest/?page=3000'], ['Latest sport filter', '/latest/?sport=golf'],
  ['Events directory', '/events/'], ['Events upcoming', '/events/?when=upcoming'], ['Events past p50', '/events/?when=past&page=50'],
  ['Author', '/author/perf-author-1/'], ['Search common', '/search/?q=champion+schedule'], ['Search rare', '/search/?q=perf-event-123'], ['Search typo', '/search/?q=chmapion'],
  ['API search', '/api/search?q=tennis+final'], ['API suggestions', '/api/search/suggestions?q=perf+eve'],
  ['Sitemap index', '/sitemap.xml'], ['Sitemap articles-1', '/sitemaps/articles-1.xml'], ['robots.txt', '/robots.txt'], ['404 page', '/no-such-sport/'],
  ['CMS shell /admin/', '/admin/'], ['CMS data (all)', '/api/cms/data'], ['CMS articles list', '/api/articles'], ['CMS article search', '/api/cms/articles/search?q=tennis'],
  ['Audit logs', '/api/audit-logs'], ['Insights 28d', '/api/insights/overview?period=28d'], ['Insights 12m', '/api/insights/overview?period=12m'], ['SEO overview', '/api/seo/overview'],
  ['Redirects export', '/api/redirects/export'], ['FAQ (site)', '/api/faq?context=site'],
];
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const p90 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(xs.length * 0.9) - 1)];
const results: Record<string, unknown>[] = [];
const only = process.env.PERF_ONLY ? new RegExp(process.env.PERF_ONLY, 'i') : null;
for (const [name, path] of targets.filter(([n]) => !only || only.test(n))) {
  if (mode === 'warm') await request(path);
  const times: number[] = []; const qCounts: number[] = []; const qMs: number[] = []; let bytes = 0; let status = 0; let slow = '';
  for (let i = 0; i < RUNS; i++) {
    log = [];
    const t0 = performance.now();
    const r = await request(path);
    times.push(performance.now() - t0);
    await new Promise((res) => setTimeout(res, 30)); // let the query log lines arrive
    bytes = r.bytes; status = r.status;
    const durations = log.map((l) => Number(l.match(/^\[db-query\] ([\d.]+)ms/)?.[1] ?? 0));
    qCounts.push(log.length); qMs.push(Math.round(durations.reduce((a, b) => a + b, 0)));
    const maxIdx = durations.indexOf(Math.max(...durations, -1));
    if (process.env.PERF_VERBOSE && i === 0) console.log(log.map((l) => '      ' + l.slice(11, 190)).join('\n'));
    if (i === 0 && maxIdx >= 0) slow = `${durations[maxIdx]}ms ${log[maxIdx].replace(/^\[db-query\] [\d.]+ms /, '').slice(0, 160)}`;
  }
  const row = { name, path, status, ms: Math.round(median(times)), p90: Math.round(p90(times)), kb: Math.round(bytes / 102.4) / 10, queries: median(qCounts), queryMs: median(qMs), slowest: slow };
  results.push(row);
  console.log(`${String(status).padEnd(4)} ${name.padEnd(22)} ${String(row.ms).padStart(6)}ms p90 ${String(row.p90).padStart(6)}ms ${String(row.kb).padStart(9)}KB q=${String(row.queries).padStart(3)} qms=${String(row.queryMs).padStart(5)}`);
}
fs.mkdirSync('.perf', { recursive: true });
fs.writeFileSync(`.perf/perf-scale-${mode}-${process.env.PERF_LABEL || 'run'}.json`, JSON.stringify({ mode, runs: RUNS, at: new Date().toISOString(), results }, null, 2));
child.kill();
process.exit(0);
