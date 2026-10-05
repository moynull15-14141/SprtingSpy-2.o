/**
 * PHASE Q verification — analytics & measurement. Local production-mode
 * server, local development database, disposable fixtures. The analytics
 * aggregate tables and settings are snapshotted and restored exactly.
 *
 * API: Insights authorization (anonymous 401, Author 403, Editor/Admin 200),
 * date-range validation, empty state, previous-period comparison; first-party
 * view counts resolved to content (top articles/events, by sport, by Article
 * Type, views of URLs that no longer resolve); crawler user agents not
 * counted; retention keeps recent rows, deletes expired ones, "unlimited"
 * keeps everything.
 *
 * Real Chrome (Google's script stubbed by request interception, nothing
 * leaves the machine): nothing before consent; after "Accept all" exactly one
 * page_view per navigation, select_content for a homepage card click,
 * article_view / event_view once, search + search_result_click without a
 * duplicate select_content; one first-party view per page; "Reject optional"
 * sends nothing and loads no Google script; a blocked Google script never
 * breaks the page; Admin → Analytics & Insights renders real numbers and the
 * period buttons work, without page errors.
 *
 * Run: npm run build && npm run test:phase-q  (stop other app instances first)
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { chromium, type Page } from 'playwright-core';
import { prisma } from '../db';
import { checkDatabaseUrlIsLocalDev } from '../dbSafety';
import { hashPassword } from '../password';
import { purgeExpiredAnalytics, retentionCutoff } from '../analyticsRetention';

assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe, 'Phase Q requires a local development database.');
assert(fs.existsSync('.next/BUILD_ID'), 'Build before Phase Q verification (npm run build).');
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
assert(fs.existsSync(executablePath), 'Set PLAYWRIGHT_EXECUTABLE_PATH to an installed Chrome/Chromium.');

const fx = `q${crypto.randomUUID().slice(0, 6)}`;
const sport = `${fx}-sport`;
const eventSlug = `${fx}-open`;
const token = `${fx}zeta`;
const password = `Phase-Q-${crypto.randomUUID()}`;
const ids = { admin: `${fx}-admin`, editor: `${fx}-editor`, author: `${fx}-author`, byline: `${fx}-byline` };
const digest = (rows: unknown) => crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const snapshot = async () => ({
  articles: digest(await prisma.article.findMany({ where: { NOT: { sportSlug: sport } }, orderBy: { id: 'asc' }, select: { id: true, status: true, updatedAt: true } })),
  events: digest(await prisma.sportEvent.findMany({ where: { NOT: { sportSlug: sport } }, orderBy: { id: 'asc' } })),
  settings: digest(await prisma.siteSetting.findMany({ orderBy: { key: 'asc' } })),
  pageViews: digest(await prisma.pageViewStat.findMany({ orderBy: [{ day: 'asc' }, { path: 'asc' }] })),
  vitals: digest(await prisma.webVitalStat.count()),
  searches: digest(await prisma.searchQueryStat.findMany({ orderBy: [{ day: 'asc' }, { query: 'asc' }] })),
  engines: digest(await prisma.searchPerformanceStat.count()),
});
const before = await snapshot();
const saved = {
  settings: await prisma.siteSetting.findMany(),
  pageViews: await prisma.pageViewStat.findMany(),
  vitals: await prisma.webVitalStat.findMany(),
  searches: await prisma.searchQueryStat.findMany(),
  engines: await prisma.searchPerformanceStat.findMany(),
};

const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = (probe.address() as { port: number }).port; await new Promise<void>((r) => probe.close(() => r()));
const base = `http://localhost:${port}`;
let output = '';
const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port), HOST: '127.0.0.1', TRUST_PROXY: 'false', NODE_ENV: 'production', APP_ENV: 'production', AUTH_MODE: 'production', DEV_LOGIN_BYPASS: 'false', ALLOWED_ORIGIN: base, SITE_ORIGIN: base, INDEXNOW_ENDPOINT: '', GEMINI_API_KEY: '', TOTP_ENCRYPTION_KEY: `phase-q-${crypto.randomUUID()}`, RESEND_API_KEY: '', MAIL_FROM: '' };
delete env.PRISMA_QUERY_LOG;
const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], { cwd: process.cwd(), windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', (c) => { output += c; }); child.stderr.on('data', (c) => { output += c; });

let checks = 0; const pass = (m: string) => { checks++; console.log(`PASS ${m}`); };
class Client {
  cookies = new Map<string, string>();
  constructor(readonly ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36') {}
  async request(path: string, method = 'GET', body?: unknown) {
    const headers: Record<string, string> = { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '), 'User-Agent': this.ua };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET') headers['x-csrf-token'] = this.cookies.get('csrf_token') ?? '';
    const res = await fetch(base + path, { method, headers, redirect: 'manual', body: body === undefined ? undefined : JSON.stringify(body) });
    for (const raw of res.headers.getSetCookie()) { const [pair] = raw.split(';'); const i = pair.indexOf('='); const v = pair.slice(i + 1); if (v) this.cookies.set(pair.slice(0, i), v); else this.cookies.delete(pair.slice(0, i)); }
    const text = await res.text(); let data: any; try { data = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, text, data };
  }
  async ok(path: string, method = 'GET', body?: unknown, expected = [200, 201, 204]) {
    const r = await this.request(path, method, body);
    assert(expected.includes(r.status), `${method} ${path}: HTTP ${r.status} ${r.text.slice(0, 300)}`);
    return r.data;
  }
}
const anon = new Client();
const login = async (email: string) => { const c = new Client(); await c.request('/robots.txt'); const r = await c.request('/api/auth/login', 'POST', { email, password }); assert.equal(r.status, 200, r.text); return c; };
const doc = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `${t} ${'Useful detail for readers of this fixture article. '.repeat(25)}` }] }] });
const today = new Date().toISOString().slice(0, 10);
let completed = false;

try {
  await new Promise<void>((resolve, reject) => { const t = setTimeout(() => reject(new Error(`server did not start: ${output.slice(-800)}`)), 90_000); child.stdout.on('data', (c) => { if (String(c).includes('Server running')) { clearTimeout(t); resolve(); } }); child.once('exit', () => { clearTimeout(t); reject(new Error(`server exited: ${output.slice(-800)}`)); }); });
  await anon.request('/robots.txt');

  // ── Fixtures ──
  for (const [id, role] of [[ids.admin, 'Admin'], [ids.editor, 'Editor'], [ids.author, 'Author']] as const) {
    await prisma.user.create({ data: { id, name: `Q ${role}`, email: `${id}@example.test`, role, avatar: '', joinedAt: new Date(), passwordHash: hashPassword(password) } });
  }
  await prisma.author.create({ data: { id: ids.byline, slug: ids.byline, name: 'Q Fixture Byline', roleTitle: 'Reporter', bio: 'Fixture.', avatar: '', userId: ids.author } });
  const admin = await login(`${ids.admin}@example.test`);
  const editor = await login(`${ids.editor}@example.test`);
  const author = await login(`${ids.author}@example.test`);
  await admin.ok('/api/sports', 'POST', { name: 'Q Fixture Sport', slug: sport, tagline: 'Fixture', description: 'Fixture sport for Phase Q verification.' });
  const event = await admin.ok('/api/events', 'POST', { name: `Q Fixture Open ${token}`, slug: eventSlug, sportSlug: sport, shortName: 'Q Open', description: 'A fixture event.', seo: {} });
  await admin.ok('/api/editions', 'POST', { eventSlug, sportSlug: sport, year: 2028, title: 'Q Fixture Open 2028', status: 'upcoming', description: 'The 2028 edition of the fixture event.', seo: {} });
  const mk = (slug: string, title: string, articleType: string, extra: Record<string, unknown>) => admin.ok('/api/articles', 'POST', { title, slug, sportSlug: sport, articleType, excerpt: `${title} excerpt.`, body: doc(title), authorId: ids.byline, status: 'published', seo: {}, ...extra });
  const a1 = await mk('schedule', `Q ${token} schedule`, 'Schedule', { eventSlug, editionYear: 2028 });
  const a2 = await mk(`${fx}-guide`, `Q ${token} guide`, 'Event Guide', {});
  const paths = { a1: `/${sport}/${eventSlug}/2028/schedule/`, a2: `/${sport}/${fx}-guide/`, event: `/${sport}/${eventSlug}/`, edition: `/${sport}/${eventSlug}/2028/`, sport: `/${sport}/`, gone: `/${sport}/${fx}-deleted-article/` };
  const overview = (c: Client, qs = 'period=today') => c.ok(`/api/insights/overview?${qs}`);

  // ── 1. Authorization and validation ──
  assert.equal((await anon.request('/api/insights/overview')).status, 401, 'anonymous cannot read analytics');
  assert.equal((await author.request('/api/insights/overview')).status, 403, 'Authors cannot read analytics');
  assert((await overview(editor)).pageViews, 'Editor can read analytics');
  for (const qs of ['period=forever', 'period=custom&from=2026-01-10', 'period=custom&from=2026-02-01&to=2026-01-01', 'period=custom&from=2020-01-01&to=2026-01-01', 'period=custom&from=2026-13-01&to=2026-13-02', "period=custom&from=2026-01-01'--&to=2026-01-02"]) {
    assert.equal((await admin.request(`/api/insights/overview?${qs}`)).status, 400, `rejected: ${qs}`);
  }
  pass('Insights API: anonymous 401, Author 403, Editor/Admin 200; unknown period, missing/reversed/over-400-day/invalid/injected dates rejected (400)');

  // ── 2. Empty state ──
  const empty = await overview(admin, 'period=custom&from=2090-01-01&to=2090-01-28');
  assert.equal(empty.pageViews.total, 0); assert.deepEqual(empty.content.topArticles, []); assert.deepEqual(empty.content.topEvents, []);
  assert.deepEqual(empty.content.bySport, []); assert.equal(empty.search.totals.searches, 0); assert.equal(empty.previous.views, 0); assert.equal(empty.publishing.total, 0);
  pass('Empty period: zero totals, empty content tables and previous period (no placeholders)');

  // ── 3. Real first-party views resolve to content; crawlers ignored ──
  const view = (c: Client, path: string, pageType: string) => c.ok('/api/rum', 'POST', { view: true, path, pageType, device: 'desktop' });
  const reader = new Client(); await reader.request('/robots.txt');
  const bot = new Client('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'); await bot.request('/robots.txt');
  for (const [p, t, n] of [[paths.a1, 'article', 3], [paths.a2, 'article', 1], [paths.event, 'event', 2], [paths.edition, 'edition', 4], [paths.sport, 'sport', 1], [paths.gone, 'article', 2]] as const) {
    for (let i = 0; i < n; i++) await view(reader, p, t);
  }
  for (let i = 0; i < 5; i++) await view(bot, paths.a1, 'article');
  const row = (p: string) => prisma.pageViewStat.findFirst({ where: { path: p } });
  assert.equal((await row(paths.a1))?.views, 3, 'crawler views not counted');
  const ov = await overview(admin);
  const top1 = ov.content.topArticles.find((a: any) => a.path === paths.a1);
  assert(top1 && top1.id === a1.id && top1.title === a1.title && top1.views === 3 && top1.articleType === 'Schedule' && top1.status === 'published', 'top article resolved to its title/type/status');
  assert.equal(ov.content.topArticles.find((a: any) => a.path === paths.a2)?.views, 1);
  const gone = ov.content.topArticles.find((a: any) => a.path === paths.gone);
  assert(gone && gone.status === 'not found' && gone.id === null && ov.content.unmatchedArticleViews >= 2, 'views of a URL that no longer resolves are reported, not attributed elsewhere');
  const ev = ov.content.topEvents.find((e: any) => e.id === event.id);
  assert(ev && ev.eventViews === 2 && ev.editionViews === 4 && ev.articleViews === 3 && ev.total === 9, 'event row: event page + edition pages + its articles');
  assert.equal(ov.content.bySport.find((s: any) => s.sport === sport)?.views, 3 + 1 + 2 + 4 + 1 + 2, 'sport total covers hub, event, edition and article pages');
  const types = Object.fromEntries(ov.content.byArticleType.map((t: any) => [t.articleType, t.views]));
  assert(types.Schedule >= 3 && types['Event Guide'] >= 1, 'views by Article Type');
  assert(ov.measurement.retention === '25-months', 'default retention reported');
  pass('Content performance: real /api/rum views resolve to article titles, types and status, events (event + edition + article views), sports and Article Types; unresolvable URLs reported separately; crawler user agents not counted');

  // ── 4. Retention ──
  const old = new Date('2020-01-15T00:00:00Z');
  const recent = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 24, 2));
  await prisma.pageViewStat.createMany({ data: [{ day: old, path: `/${fx}-old/`, pageType: 'static', views: 7 }, { day: recent, path: `/${fx}-recent/`, pageType: 'static', views: 5 }] });
  await prisma.searchQueryStat.create({ data: { day: old, query: `${fx} old query`, searches: 2, zeroResults: 1 } });
  await admin.ok('/api/settings', 'PUT', { analyticsRetention: 'unlimited' });
  assert.equal((await purgeExpiredAnalytics({ force: true }))?.retention, 'unlimited');
  assert(await row(`/${fx}-old/`), '"unlimited" keeps everything');
  await admin.ok('/api/settings', 'PUT', { analyticsRetention: '25-months' });
  const purge = await purgeExpiredAnalytics({ force: true });
  assert(purge && purge.deleted >= 2 && purge.cutoff === retentionCutoff(25).toISOString().slice(0, 10));
  assert(!(await row(`/${fx}-old/`)) && !(await prisma.searchQueryStat.findFirst({ where: { query: `${fx} old query` } })), 'expired rows deleted');
  assert(await row(`/${fx}-recent/`), 'rows inside the retention window kept');
  assert(await row(paths.a1), 'current rows kept');
  assert.equal((await admin.request('/api/settings', 'PUT', { analyticsRetention: '5-years' })).status, 400, 'only the offered retention choices');
  pass('Retention: "unlimited" keeps everything; 25 months deletes only expired aggregate rows (whole months), keeps recent ones; invalid choice rejected');

  // ── 4b. The privacy page describes what is actually measured ──
  const privacy = (await anon.request('/privacy-policy/')).text;
  assert(privacy.includes('Site measurement') && /kept for (<!-- -->)?25 months/.test(privacy), 'first-party measurement and retention described');
  assert(!privacy.includes('It is not stored by us'), 'no claim that search text is never stored');
  assert(privacy.includes('we keep a daily count per search'), 'aggregate search counts disclosed');
  await admin.ok('/api/settings', 'PUT', { analyticsRetention: '13-months' });
  assert(/kept for (<!-- -->)?13 months/.test((await anon.request('/privacy-policy/')).text), 'retention text follows the setting');
  await admin.ok('/api/settings', 'PUT', { analyticsRetention: '25-months' });
  pass('Privacy page: states first-party aggregate measurement, the configured retention and the daily search counts (no false "not stored" claim)');

  // ── 5. Real Chrome: GA4 consent, events, duplicates, failure tolerance ──
  await admin.ok('/api/settings', 'PUT', { ga4MeasurementId: 'G-PHASEQ1234' });
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const newPage = async (opts: { blockGa?: boolean } = {}) => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const gaRequests: string[] = [];
      await context.route(/googletagmanager\.com|google-analytics\.com/, (route) => {
        gaRequests.push(route.request().url());
        return opts.blockGa ? route.abort() : route.fulfill({ status: 200, contentType: 'text/javascript', body: '/* GA4 stub (test) */' });
      });
      await context.addInitScript(`window.__events = []; window.addEventListener('sportingspy:analytics', (e) => window.__events.push(e.detail));`);
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      return { context, page, gaRequests, errors };
    };
    const events = (page: Page) => page.evaluate(`window.__events`) as Promise<{ name: string; params: Record<string, unknown> }[]>;
    const waitFor = async (page: Page, pred: (e: { name: string; params: Record<string, unknown> }[]) => boolean, what: string) => {
      for (let i = 0; i < 60; i++) { if (pred(await events(page))) return; await page.waitForTimeout(100); }
      throw new Error(`timed out waiting for ${what}: ${JSON.stringify(await events(page))}`);
    };

    // a. Accept: one page_view per navigation, select_content, article_view/event_view once, search events.
    const { context, page, gaRequests, errors } = await newPage();
    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    assert.deepEqual(await events(page), [], 'nothing before consent'); assert.equal(gaRequests.length, 0, 'no Google script before consent');
    await page.getByRole('button', { name: 'Accept all' }).click();
    await waitFor(page, (e) => e.some((x) => x.name === 'page_view'), 'home page_view');
    assert(gaRequests.length >= 1, 'GA4 script requested after consent');
    // The homepage can use manually curated sections, so a newly published
    // fixture article is guaranteed in Latest rather than on the homepage.
    await page.goto(`${base}/latest/`, { waitUntil: 'networkidle' });
    await page.locator(`a[data-content-id="${a2.id}"]`).first().click();
    await page.waitForURL(`**${paths.a2}`);
    await waitFor(page, (e) => e.some((x) => x.name === 'article_view'), 'article_view');
    await page.waitForTimeout(400);
    let ev1 = await events(page);
    const select = ev1.filter((x) => x.name === 'select_content');
    assert.equal(select.length, 1, 'one select_content for the card click');
    assert.equal(select[0].params.content_type, 'article'); assert.equal(select[0].params.content_id, a2.id); assert.match(String(select[0].params.placement), /^latest:/);
    assert.equal(ev1.filter((x) => x.name === 'page_view' && x.params.page_path === paths.a2).length, 1, 'one page_view for the article');
    assert.equal(ev1.filter((x) => x.name === 'article_view').length, 1, 'one article_view');
    assert.equal(ev1.filter((x) => x.name === 'page_view' && x.params.page_path === '/latest/').length, 1, 'Latest page_view not repeated');
    await page.waitForTimeout(300);
    assert.equal((await row(paths.a2))?.views, 2, 'first-party: exactly one more view for the article visit (1 from group 3)');
    await page.goto(`${base}${paths.edition}`, { waitUntil: 'networkidle' });
    await waitFor(page, (e) => e.some((x) => x.name === 'event_view'), 'event_view');
    ev1 = await events(page);
    const evView = ev1.filter((x) => x.name === 'event_view');
    assert.equal(evView.length, 1); assert.equal(evView[0].params.event_id, event.id); assert.equal(evView[0].params.edition_year, 2028); assert.equal(evView[0].params.edition_status, 'upcoming');
    await page.goto(`${base}/search/?q=${token}`, { waitUntil: 'networkidle' });
    await waitFor(page, (e) => e.some((x) => x.name === 'search'), 'search');
    const search = (await events(page)).find((x) => x.name === 'search')!;
    assert.equal(search.params.search_term, token); assert(Number(search.params.result_count) >= 2);
    // The Event group (above the article results) and the article list both report their clicks.
    await page.locator('[data-result-kind="event"] a[data-result-position="1"]').click();
    await page.waitForURL(`**${paths.event}`);
    await waitFor(page, (e) => e.some((x) => x.name === 'search_result_click'), 'search_result_click (event)');
    await page.goBack({ waitUntil: 'networkidle' });
    await page.locator('a[data-result-position="1"]:not([data-result-kind="event"] a)').first().click();
    await page.waitForLoadState('networkidle');
    await waitFor(page, (e) => e.filter((x) => x.name === 'search_result_click').length === 2, 'search_result_click (article)');
    const afterSearch = await events(page);
    const clicks = afterSearch.filter((x) => x.name === 'search_result_click');
    assert.deepEqual(clicks.map((c) => c.params.result_type), ['event', 'article'], 'event and article result clicks, each once');
    assert.equal(clicks[0].params.link_path, paths.event); assert.equal(clicks[0].params.position, 1);
    // One search event per results-page view (going back to the results is a new view); the Event group never adds one.
    const searchViews = afterSearch.filter((x) => x.name === 'page_view' && String(x.params.page_path).startsWith('/search/')).length;
    assert.equal(afterSearch.filter((x) => x.name === 'search').length, searchViews, `one search event per results-page view: ${JSON.stringify(afterSearch.map((x) => x.name))}`);
    assert.equal(afterSearch.filter((x) => x.name === 'select_content').length, 0, 'search result clicks are not double-counted as select_content');
    assert(!JSON.stringify(afterSearch).includes('@'), 'no e-mail-like values in analytics payloads');
    assert.deepEqual(errors, [], 'no page errors (consent accepted)');
    await context.close();

    // b. Reject: nothing sent, no Google script, site works.
    const r = await newPage();
    await r.page.goto(`${base}/`, { waitUntil: 'networkidle' });
    await r.page.getByRole('button', { name: 'Reject optional' }).click();
    await r.page.goto(`${base}${paths.a1}`, { waitUntil: 'networkidle' });
    await r.page.waitForTimeout(400);
    assert.deepEqual(await events(r.page), [], 'nothing sent after rejecting'); assert.equal(r.gaRequests.length, 0, 'no Google script after rejecting');
    assert((await r.page.locator('h1').innerText()).includes(token), 'article renders');
    assert.deepEqual(r.errors, []);
    await r.context.close();

    // c. Google script blocked (ad blocker / outage): the site keeps working.
    const b = await newPage({ blockGa: true });
    await b.page.goto(`${base}/`, { waitUntil: 'networkidle' });
    await b.page.getByRole('button', { name: 'Accept all' }).click();
    await b.page.goto(`${base}${paths.event}`, { waitUntil: 'networkidle' });
    assert((await b.page.locator('h1').innerText()).includes('Q Fixture Open'), 'event page renders with GA4 blocked');
    await b.page.goto(`${base}/search/?q=${token}`, { waitUntil: 'networkidle' });
    assert(await b.page.locator('a[data-result-position="1"]').count(), 'search works with GA4 blocked');
    assert.deepEqual(b.errors, [], 'no page errors with GA4 blocked');
    await b.context.close();
    pass('Real Chrome GA4: nothing before consent; one page_view per navigation; select_content (Latest card), article_view, event_view, search and search_result_click once each, no double counting; one first-party view per visit; reject = no Google script and no events; blocked Google script never breaks pages');

    // d. Admin dashboard.
    const d = await newPage();
    await d.page.goto(`${base}/admin/`, { waitUntil: 'networkidle' });
    await d.page.getByPlaceholder('Email').fill(`${ids.admin}@example.test`);
    await d.page.getByPlaceholder('Password').fill(password);
    await d.page.getByRole('button', { name: 'Sign In' }).click();
    await d.page.getByRole('heading', { name: 'Content Management System' }).waitFor();
    const statuses: number[] = [];
    d.page.on('response', (res) => { if (res.url().includes('/api/insights/overview')) statuses.push(res.status()); });
    await d.page.getByRole('button', { name: 'Analytics & Insights', exact: true }).click();
    await d.page.getByRole('heading', { name: 'Content performance' }).waitFor();
    await d.page.getByRole('button', { name: 'Today', exact: true }).click();
    await d.page.getByText(a1.title).first().waitFor();
    const kpis = await d.page.locator('[data-insights-kpis]').innerText();
    assert(/Page views/.test(kpis) && /Article views/.test(kpis) && /Event & edition views/.test(kpis) && /Site searches/.test(kpis));
    await d.page.getByText(`Q Fixture Open ${token}`).first().waitFor();
    await d.page.getByRole('button', { name: '7 days', exact: true }).click();
    await d.page.getByText(a1.title).first().waitFor();
    await d.page.getByRole('button', { name: 'Custom', exact: true }).click();
    await d.page.locator('input[type="date"]').nth(0).fill('2090-01-01');
    await d.page.locator('input[type="date"]').nth(1).fill('2090-01-07');
    await d.page.getByText('No article views counted in this period.').first().waitFor();
    assert(statuses.length >= 3 && statuses.every((s) => s === 200), `insights requests ${statuses}`);
    assert.deepEqual(d.errors, [], 'no page errors on the dashboard');
    await d.context.close();
    pass('Real Chrome dashboard: Overview KPIs, Top articles/events with real titles, Today / 7 days / Custom periods (including an empty period) load with HTTP 200 and no page errors');
  } finally {
    await browser.close();
  }

  completed = true;
} finally {
  child.kill();
  await prisma.siteSetting.deleteMany({});
  if (saved.settings.length) await prisma.siteSetting.createMany({ data: saved.settings });
  await prisma.pageViewStat.deleteMany({}); if (saved.pageViews.length) await prisma.pageViewStat.createMany({ data: saved.pageViews });
  await prisma.webVitalStat.deleteMany({}); if (saved.vitals.length) await prisma.webVitalStat.createMany({ data: saved.vitals });
  await prisma.searchQueryStat.deleteMany({}); if (saved.searches.length) await prisma.searchQueryStat.createMany({ data: saved.searches });
  await prisma.searchPerformanceStat.deleteMany({}); if (saved.engines.length) await prisma.searchPerformanceStat.createMany({ data: saved.engines });
  await prisma.auditLog.deleteMany({ where: { userId: { in: Object.values(ids) } } });
  await prisma.article.deleteMany({ where: { sportSlug: sport } });
  await prisma.eventEdition.deleteMany({ where: { sportSlug: sport } });
  await prisma.sportEvent.deleteMany({ where: { sportSlug: sport } });
  await prisma.sport.deleteMany({ where: { slug: sport } });
  await prisma.session.deleteMany({ where: { userId: { in: [ids.admin, ids.editor, ids.author] } } });
  await prisma.author.deleteMany({ where: { id: ids.byline } });
  await prisma.user.deleteMany({ where: { id: { in: [ids.admin, ids.editor, ids.author] } } });
  assert.deepEqual(await snapshot(), before, 'Pre-existing rows changed.');
  console.log(completed ? `\nPhase Q verification: ${checks} groups passed, 0 failed.` : `\nPhase Q verification FAILED after ${checks} group(s).`);
  await prisma.$disconnect();
  if (!completed) process.exitCode = 1;
}
