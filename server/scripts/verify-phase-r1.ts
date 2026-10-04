/**
 * PHASE R.1 verification — closes the Phase R MUST-HAVE gaps:
 *   1. Structured audit before/after for Users, Authors, Ads, Comments,
 *      Media metadata, Redirects (and Event/Edition deletes); no secrets.
 *   2. Real-user monitoring in REAL Chrome: reporter runs, page type is
 *      correct, requests reach /api/rum, aggregates land in the database
 *      and Insights shows them; the Settings switch stops collection.
 *   3. AdSense in REAL Chrome with a deterministic stub of Google's script
 *      (served by Playwright request interception in the test browser only;
 *      production code is unchanged): filled slot keeps its space, unfilled
 *      slot collapses, house ad stays, no consent = no ad request, Auto ads
 *      off/on, google-cmp mode. This is MOCK browser verification — live
 *      AdSense is NOT verified here.
 * Disposable fixtures; pre-existing rows and settings are restored and
 * hash-verified.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { chromium, type Browser, type BrowserContext } from 'playwright-core';
import { prisma } from '../db';
import { checkDatabaseUrlIsLocalDev } from '../dbSafety';
import { hashPassword } from '../password';
import { beginContentWrite, cached } from '../publicCache';

assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe, 'Phase R.1 requires a local development database.');
assert(fs.existsSync('.next/BUILD_ID'), 'Build before Phase R.1 verification (npm run build).');
const chromePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
assert(fs.existsSync(chromePath), `Chrome not found at ${chromePath} (set PLAYWRIGHT_EXECUTABLE_PATH).`);

const fx = `r1${crypto.randomUUID().slice(0, 6)}`;
const password = `Phase-R1-${crypto.randomUUID()}`;
const adminId = `${fx}-admin`;
const AD_SLOTS = ['ARTICLE_TOP', 'ARTICLE_MIDDLE', 'ARTICLE_BOTTOM'] as const;
const SETTING_KEYS = ['adsensePublisherId', 'adsenseAutoAds', 'consentMode', 'realUserMonitoring'];
const digest = (rows: unknown) => crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const snapshot = async () => ({
  sports: digest(await prisma.sport.findMany({ where: { NOT: { id: { startsWith: fx } } }, orderBy: { id: 'asc' } })),
  events: digest(await prisma.sportEvent.findMany({ where: { NOT: { id: { startsWith: fx } } }, orderBy: { id: 'asc' } })),
  articles: digest(await prisma.article.findMany({ orderBy: { id: 'asc' }, select: { id: true, status: true, title: true, updatedAt: true } })),
  authors: digest(await prisma.author.findMany({ where: { NOT: { slug: { startsWith: fx } } }, orderBy: { id: 'asc' } })),
  users: digest(await prisma.user.findMany({ where: { NOT: { email: { contains: fx } } }, orderBy: { id: 'asc' }, select: { id: true, role: true, status: true, name: true } })),
  media: digest(await prisma.mediaItem.findMany({ where: { NOT: { title: { startsWith: fx } } }, orderBy: { id: 'asc' } })),
  redirects: digest(await prisma.redirectRule.findMany({ where: { NOT: { sourceUrl: { contains: fx } } }, orderBy: { id: 'asc' } })),
  comments: digest(await prisma.comment.findMany({ orderBy: { id: 'asc' } })),
  ads: digest(await prisma.adSlotConfig.findMany({ orderBy: { id: 'asc' } })),
  settings: digest(await prisma.siteSetting.findMany({ orderBy: { key: 'asc' } })),
});
const before = await snapshot();
const adsBefore = await prisma.adSlotConfig.findMany({ where: { id: { in: [...AD_SLOTS] } } });
const settingsBefore = await prisma.siteSetting.findMany({ where: { key: { in: SETTING_KEYS } } });
const vitalsBefore = await prisma.webVitalStat.findMany();
const viewsBefore = await prisma.pageViewStat.findMany();

const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = (probe.address() as { port: number }).port; await new Promise<void>((resolve) => probe.close(() => resolve()));
const base = `http://localhost:${port}`;
let output = '';
const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
  cwd: process.cwd(), windowsHide: true,
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', TRUST_PROXY: 'false', NODE_ENV: 'production', APP_ENV: 'production', AUTH_MODE: 'production', DEV_LOGIN_BYPASS: 'false', ALLOWED_ORIGIN: base, SITE_ORIGIN: base, INDEXNOW_ENDPOINT: '', GEMINI_API_KEY: '', ENABLE_COMMENTS: 'true', SHOW_AD_PLACEHOLDERS: 'false' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (c) => { output += c; }); child.stderr.on('data', (c) => { output += c; });

let checks = 0; const pass = (m: string) => { checks++; console.log(`PASS ${m}`); };
class Client {
  cookies = new Map<string, string>();
  async request(path: string, method = 'GET', body?: unknown) {
    const headers: Record<string, string> = { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET') headers['x-csrf-token'] = this.cookies.get('csrf_token') ?? '';
    const res = await fetch(base + path, { method, headers, redirect: 'manual', body: body === undefined ? undefined : JSON.stringify(body) });
    for (const raw of res.headers.getSetCookie()) { const [pair] = raw.split(';'); const i = pair.indexOf('='); const v = pair.slice(i + 1); if (v) this.cookies.set(pair.slice(0, i), v); else this.cookies.delete(pair.slice(0, i)); }
    const text = await res.text(); let data: any; try { data = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, text, data };
  }
  async ok(path: string, method = 'GET', body?: unknown) {
    const r = await this.request(path, method, body);
    assert(r.status >= 200 && r.status < 300, `${method} ${path}: HTTP ${r.status} ${r.text.slice(0, 300)}`);
    return r.data;
  }
}
const lastAudit = (entityId: string, action: string) => prisma.auditLog.findFirst({ where: { entityId, action }, orderBy: { timestamp: 'desc' } });
const SECRET = /passwordHash|totpSecret|tokenHash|scrypt:/;
const assertAudit = async (entityId: string, action: string, expect: { before?: string[] | null; after?: string[] | null }) => {
  const row = await lastAudit(entityId, action);
  assert(row, `audit row ${action} for ${entityId}`);
  const text = JSON.stringify({ before: row.before, after: row.after });
  assert(!SECRET.test(text), `${action}: no secrets in the audit values`);
  if (expect.before === null) assert.equal(row.before, null, `${action}: before is null`);
  if (expect.after === null) assert.equal(row.after, null, `${action}: after is null`);
  for (const k of expect.before ?? []) assert(row.before && k in (row.before as object), `${action}: before.${k}`);
  for (const k of expect.after ?? []) assert(row.after && k in (row.after as object), `${action}: after.${k}`);
  return row;
};
let browser: Browser | null = null;
/** Polls with page.evaluate (CDP), which the production CSP (no unsafe-eval) does not block, unlike waitForFunction's injected predicate. */
const until = async (page: import('playwright-core').Page, fn: () => unknown, label: string, timeout = 10_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await page.evaluate(fn)) return; await page.waitForTimeout(100); }
  throw new Error(`Timed out: ${label}`);
};
let completed = false;

try {
  await new Promise<void>((resolve, reject) => { const t = setTimeout(() => reject(new Error(`server did not start: ${output.slice(-800)}`)), 90_000); child.stdout.on('data', (c) => { if (String(c).includes('Server running')) { clearTimeout(t); resolve(); } }); child.once('exit', () => { clearTimeout(t); reject(new Error(`server exited: ${output.slice(-800)}`)); }); });
  await prisma.user.create({ data: { id: adminId, name: 'R1 Admin', email: `${adminId}@example.test`, role: 'Admin', avatar: '', joinedAt: new Date(), passwordHash: hashPassword(password) } });
  const admin = new Client(); await admin.request('/robots.txt');
  assert.equal((await admin.request('/api/auth/login', 'POST', { email: `${adminId}@example.test`, password })).status, 200);

  // ── 1. Structured audit before/after ──
  // Users
  const user = await admin.ok('/api/users', 'POST', { name: 'R1 Staff', email: `${fx}-staff@example.test`, role: 'Author', password: `Staff-${crypto.randomUUID()}` });
  const created = await assertAudit(user.id, 'Created Staff User', { before: null, after: ['name', 'email', 'role'] });
  assert(!JSON.stringify(created).includes('Staff-'), 'the new password is not in the audit row');
  await admin.ok(`/api/users/${user.id}/role`, 'PUT', { role: 'Editor' });
  const role = await assertAudit(user.id, 'Changed User Role', { before: ['role'], after: ['role'] });
  assert.equal((role.before as any).role, 'Author'); assert.equal((role.after as any).role, 'Editor');
  await admin.ok(`/api/users/${user.id}`, 'PUT', { name: 'R1 Staff Renamed' });
  assert.equal(((await assertAudit(user.id, 'Updated Staff User', { before: ['name'], after: ['name'] })).after as any).name, 'R1 Staff Renamed');
  await admin.ok(`/api/users/${user.id}/status`, 'PUT', { status: 'inactive' });
  assert.equal(((await assertAudit(user.id, 'Changed User Status', { before: ['status'], after: ['status'] })).after as any).status, 'inactive');
  await admin.ok(`/api/users/${user.id}`, 'DELETE');
  await assertAudit(user.id, 'Deleted Staff User', { before: ['email', 'role'], after: null });
  // Self-service profile
  await admin.ok('/api/auth/me', 'PATCH', { name: 'R1 Admin Renamed' });
  const profile = await assertAudit(adminId, 'Profile Updated', { before: ['name'], after: ['name'] });
  assert.equal((profile.after as any).name, 'R1 Admin Renamed');
  // Authors
  const author = await admin.ok('/api/authors', 'POST', { name: 'R1 Author', slug: `${fx}-author`, bio: 'Bio.' });
  await assertAudit(author.id, 'Created Author Profile', { before: null, after: ['name', 'slug'] });
  await admin.ok(`/api/authors/${author.id}`, 'PUT', { bio: 'New bio.' });
  const authorUpd = await assertAudit(author.id, 'Updated Author Profile', { before: ['bio'], after: ['bio'] });
  assert.equal(Object.keys(authorUpd.after as object).length, 1, 'only the changed field is stored');
  // Ads
  await admin.ok('/api/ads/ARTICLE_MIDDLE', 'PUT', { enabled: true, provider: 'house', bannerText: `${fx} house banner` });
  const ad = await assertAudit('ARTICLE_MIDDLE', 'Configured Ad Slot', { after: ['bannerText'] });
  assert.equal((ad.after as any).bannerText, `${fx} house banner`);
  // Comments (feature flag on for this test server only)
  const article = await prisma.article.findFirstOrThrow({ where: { status: 'published', editionYear: { not: null } } });
  const comment = await admin.ok('/api/comments', 'POST', { articleId: article.id, content: `${fx} comment` });
  await assertAudit(comment.id, 'Submitted Comment', { before: null, after: ['content', 'status'] });
  await admin.ok(`/api/comments/${comment.id}`, 'PUT', { status: 'rejected' });
  const mod = await assertAudit(comment.id, 'Moderated Comment', { before: ['status'], after: ['status'] });
  assert.equal((mod.after as any).status, 'rejected');
  await admin.ok(`/api/comments/${comment.id}`, 'DELETE');
  await assertAudit(comment.id, 'Deleted Comment', { before: ['content'], after: null });
  // Media metadata
  const media = await admin.ok('/api/media', 'POST', { title: `${fx} image`, url: 'https://example.org/r1-image.jpg', altText: 'Alt', creationType: 'Licensed' });
  await assertAudit(media.id, 'Registered Media Asset', { before: null, after: ['title', 'url', 'creationType'] });
  await admin.ok(`/api/media/${media.id}`, 'PUT', { altText: 'Better alt text', copyrightReview: 'reviewed' });
  const mUpd = await assertAudit(media.id, 'Updated Media Metadata', { before: ['altText', 'copyrightReview'], after: ['altText', 'copyrightReview'] });
  assert.equal((mUpd.after as any).copyrightReview, 'reviewed');
  await admin.ok(`/api/media/${media.id}`, 'DELETE');
  await assertAudit(media.id, 'Deleted Media Asset', { before: ['title', 'url'], after: null });
  // Redirects (target must be a live page)
  const live = (await prisma.article.findFirstOrThrow({ where: { status: 'published', editionYear: null } }));
  const rule = await admin.ok('/api/redirects', 'POST', { sourceUrl: `/${fx}-old`, targetUrl: `/${live.sportSlug}/${live.slug}/`, statusCode: 301 });
  await assertAudit(rule.id, 'Created Redirect Rule', { before: null, after: ['sourceUrl', 'targetUrl', 'statusCode'] });
  await admin.ok(`/api/redirects/${rule.id}`, 'PUT', { statusCode: 302 });
  const rUpd = await assertAudit(rule.id, 'Updated Redirect Rule', { before: ['statusCode'], after: ['statusCode'] });
  assert.equal((rUpd.before as any).statusCode, 301); assert.equal((rUpd.after as any).statusCode, 302);
  await admin.ok(`/api/redirects/${rule.id}`, 'DELETE');
  await assertAudit(rule.id, 'Deleted Redirect Rule', { before: ['sourceUrl'], after: null });
  // Event / Edition deletes
  await admin.ok('/api/sports', 'POST', { name: 'R1 Sport', slug: `${fx}-sport`, description: 'Fixture.' });
  const ev = await admin.ok('/api/events', 'POST', { name: 'R1 Event', slug: `${fx}-event`, sportSlug: `${fx}-sport`, seo: {} });
  const ed = await admin.ok('/api/editions', 'POST', { eventSlug: `${fx}-event`, sportSlug: `${fx}-sport`, year: 2030, title: 'R1 Event 2030', status: 'upcoming', seo: {} });
  await admin.ok(`/api/editions/${ed.id}`, 'DELETE');
  await assertAudit(ed.id, 'Deleted Event Edition', { before: ['title', 'status'], after: null });
  await admin.ok(`/api/events/${ev.id}`, 'DELETE');
  await assertAudit(ev.id, 'Deleted Permanent Event', { before: ['name', 'slug'], after: null });
  const cms = await admin.ok('/api/cms/data');
  assert(cms.auditLogs.some((l: any) => l.entityId === rule.id && l.before), 'CMS audit list carries before/after');
  pass('Audit before/after: Users (create/role/update/status/delete/profile), Authors, Ads, Comments, Media metadata, Redirects, Event/Edition deletes; only changed safe fields; no passwords/hashes/secrets');

  // ── 1b. Public cache write window (regression: page 404 right after scheduled publication) ──
  {
    let calls = 0; let value = 'old';
    const load = cached(`r1-test-${fx}`, async () => { calls++; return value; });
    assert.equal(await load(), 'old'); assert.equal(await load(), 'old'); assert.equal(calls, 1, 'second read is a cache hit');
    const end = beginContentWrite('r1 test write');
    value = 'new';                       // the "database" changes inside the write window
    assert.equal(await load(), 'new', 'reads during a write bypass the cache');
    assert.equal(await load(), 'new'); assert.equal(calls, 3, 'nothing is stored while the write is in progress');
    end();
    assert.equal(await load(), 'new'); assert.equal(await load(), 'new'); assert.equal(calls, 4, 'after the write the fresh value is cached again');
    end(); // idempotent
  }
  pass('Public cache: reads bypass the cache during a content write and nothing stale is stored (scheduler/API race fix)');

  // ── 2. Real-user monitoring in real Chrome ──
  browser = await chromium.launch({ executablePath: chromePath, headless: true });
  const articlePath = `/${article.sportSlug}/${article.eventSlug}/${article.editionYear}/${article.slug}/`;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const rumBodies: any[] = [];
  ctx.on('request', (r) => { if (r.url().endsWith('/api/rum') && r.method() === 'POST') { try { rumBodies.push(JSON.parse(r.postData() || '{}')); } catch { /* ignore */ } } });
  const page = await ctx.newPage();
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + articlePath, { waitUntil: 'networkidle' });
  assert.equal(await page.locator('[data-ss-page-type]').first().getAttribute('data-ss-page-type'), 'article', 'server-rendered page type marker');
  await page.mouse.click(200, 400); await page.keyboard.press('Tab'); await page.mouse.wheel(0, 600); await page.waitForTimeout(500);
  // Hide the page as a tab switch does (visibilitychange → hidden): web-vitals reports the final
  // LCP/CLS/INP and the reporter sends them while the page is still alive. Then leave the page.
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(1000);
  await page.goto(base + '/about/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const views = rumBodies.filter((b) => b.view === true);
  assert(views.some((b) => b.path === articlePath && b.pageType === 'article' && b.device === 'mobile'), 'page view beacon for the article (mobile)');
  assert(views.some((b) => b.path === '/about/' && b.pageType === 'static'), 'page view beacon for the next page');
  // Beacons sent while a page unloads may not be visible to request listeners; the database is the evidence.
  const metricNames = new Set(rumBodies.flatMap((b) => (b.metrics || []).filter(() => b.pageType === 'article').map((m: any) => m.name)));
  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
  let stored = await prisma.webVitalStat.findMany({ where: { day: today, pageType: 'article', device: 'mobile' } });
  for (let i = 0; i < 20 && !stored.some((v) => v.metric === 'LCP'); i++) { await new Promise((r) => setTimeout(r, 250)); stored = await prisma.webVitalStat.findMany({ where: { day: today, pageType: 'article', device: 'mobile' } }); }
  const inpReported = metricNames.has('INP') || (stored.find((v) => v.metric === 'INP')?.samples ?? 0) > vitalsBefore.filter((v) => v.day.getTime() === today.getTime() && v.pageType === 'article' && v.device === 'mobile' && v.metric === 'INP').reduce((a, v) => a + v.samples, 0);
  const before0 = (m: string) => vitalsBefore.filter((v) => v.day.getTime() === today.getTime() && v.pageType === 'article' && v.device === 'mobile' && v.metric === m).reduce((a, v) => a + v.samples, 0);
  assert((stored.find((v) => v.metric === 'LCP')?.samples ?? 0) > before0('LCP'), `LCP sample aggregated in the database (beacons seen: ${JSON.stringify(rumBodies).slice(0, 400)})`);
  assert((stored.find((v) => v.metric === 'CLS')?.samples ?? 0) > before0('CLS'), 'CLS sample aggregated in the database');
  const pv = await prisma.pageViewStat.findUnique({ where: { day_path: { day: today, path: articlePath } } });
  assert(pv && pv.views >= 1 && pv.pageType === 'article', 'page view aggregated');
  const insights = await admin.ok('/api/insights/overview?period=today');
  assert(insights.webVitals.some((v: any) => v.pageType === 'article' && v.metric === 'LCP' && v.device === 'mobile' && v.p75 !== null), 'Insights shows the article LCP p75');
  assert(!errors.length, `no page errors: ${errors.join(' | ')}`);
  // Switch off → the reporter sends nothing.
  await admin.ok('/api/settings', 'PUT', { realUserMonitoring: 'disabled' });
  const offBodies: any[] = [];
  const ctxOff = await browser.newContext();
  ctxOff.on('request', (r) => { if (r.url().endsWith('/api/rum')) offBodies.push(r.url()); });
  const pOff = await ctxOff.newPage();
  await pOff.goto(base + articlePath, { waitUntil: 'networkidle' }); await pOff.goto(base + '/about/', { waitUntil: 'networkidle' }); await pOff.waitForTimeout(800);
  assert.equal(offBodies.length, 0, 'no RUM requests when real-user monitoring is disabled');
  await ctxOff.close(); await ctx.close();
  pass(`Real Chrome RUM: page-type marker, page views, LCP + CLS beacons → database aggregates → Insights p75; disabled setting stops collection; no consent needed (no identifiers); INP ${inpReported ? 'reported' : 'not reported for the short headless interaction (browser-dependent; aggregation path covered by Phase R)'}`);

  // ── 3. AdSense with a stubbed Google script (real Chrome) ──
  const client = 'ca-pub-0000000000000001';
  await admin.ok('/api/settings', 'PUT', { adsensePublisherId: client, adsenseAutoAds: 'disabled', consentMode: 'builtin', realUserMonitoring: '' });
  await admin.ok('/api/ads/ARTICLE_TOP', 'PUT', { enabled: true, provider: 'adsense', providerSlotId: '1111111111' });
  await admin.ok('/api/ads/ARTICLE_BOTTOM', 'PUT', { enabled: true, provider: 'adsense', providerSlotId: '2222222222' });
  const STUB = `(function(){
    function fill(){ document.querySelectorAll('ins.adsbygoogle:not([data-ad-status])').forEach(function(ins){
      ins.setAttribute('data-adsbygoogle-status','done');
      if (ins.getAttribute('data-ad-slot') === '2222222222') { ins.setAttribute('data-ad-status','unfilled'); }
      else { ins.setAttribute('data-ad-status','filled'); ins.innerHTML = '<div data-mock-ad="1" style="height:90px">mock creative</div>'; }
    }); }
    window.__mockAdsenseLoads = (window.__mockAdsenseLoads || 0) + 1;
    var q = window.adsbygoogle = window.adsbygoogle || [];
    q.push = function(){ setTimeout(fill, 30); return 0; };
    setTimeout(fill, 30);
  })();`;
  const adContext = async (consent: string | null) => {
    const c: BrowserContext = await browser!.newContext({ viewport: { width: 1280, height: 900 } });
    if (consent) await c.addCookies([{ name: 'sportingspy_consent', value: consent, url: base }]);
    const requests: string[] = [];
    await c.route('https://pagead2.googlesyndication.com/**', (route) => { requests.push(route.request().url()); return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB }); });
    return { c, requests };
  };
  // A/B/C with advertising consent
  const consented = await adContext('1.a-.d1');
  const p1 = await consented.c.newPage();
  await p1.goto(base + articlePath, { waitUntil: 'networkidle' });
  await until(p1, () => document.querySelector('[data-ad-slot-id="ARTICLE_TOP"] ins.adsbygoogle')?.getAttribute('data-ad-status') === 'filled', "() => document.querySelector('[data-ad-slot-id=\"ARTICLE_TOP\"");
  const top = p1.locator('aside[data-ad-slot-id="ARTICLE_TOP"]');
  assert(await top.isVisible(), 'A: filled slot visible');
  assert(((await top.boundingBox())?.height ?? 0) >= 90, 'A: filled slot keeps its reserved space');
  await until(p1, () => (document.querySelector('[data-ad-slot-id="ARTICLE_BOTTOM"]') as HTMLElement | null)?.hidden === true, "() => (document.querySelector('[data-ad-slot-id=\"ARTICLE_BOT");
  const bottom = p1.locator('[data-ad-slot-id="ARTICLE_BOTTOM"]');
  assert.equal(await bottom.getAttribute('data-ad-collapsed'), 'unfilled', 'B: unfilled slot marked collapsed');
  assert(!(await bottom.isVisible()), 'B: unfilled slot (label + reserved space) collapsed');
  const house = p1.locator('aside[data-ad-slot-id="ARTICLE_MIDDLE"]');
  assert((await house.isVisible()) && (await house.textContent())!.includes(`${fx} house banner`), 'C: house ad visible');
  assert(consented.requests.every((u) => u.includes(`client=${encodeURIComponent(client)}`)) && consented.requests.length >= 1, 'AdSense tag requested with the configured client');
  await consented.c.close();
  // D: no consent → no AdSense request, no AdSense slot; house ad unaffected
  const noConsent = await adContext(null);
  const p2 = await noConsent.c.newPage();
  await p2.goto(base + articlePath, { waitUntil: 'networkidle' }); await p2.waitForTimeout(500);
  assert.equal(await p2.locator('[data-ad-provider="adsense"]').count(), 0, 'D: no AdSense slot without advertising consent');
  assert.equal(noConsent.requests.length, 0, 'D: AdSense script not requested without consent');
  assert(await p2.locator('aside[data-ad-slot-id="ARTICLE_MIDDLE"]').isVisible(), 'D: house ad still shown');
  await noConsent.c.close();
  // E: Auto ads disabled → no tag on a page without AdSense slots
  const autoOff = await adContext('1.a-.d1');
  const p3 = await autoOff.c.newPage();
  await p3.goto(base + '/about/', { waitUntil: 'networkidle' }); await p3.waitForTimeout(500);
  assert.equal(autoOff.requests.length, 0, 'E: Auto ads off → no AdSense tag on pages without slots');
  await autoOff.c.close();
  // F: Auto ads enabled → tag loads on every page (with consent), once
  await admin.ok('/api/settings', 'PUT', { adsenseAutoAds: 'enabled' });
  const autoOn = await adContext('1.a-.d1');
  const p4 = await autoOn.c.newPage();
  await p4.goto(base + '/about/', { waitUntil: 'networkidle' });
  await until(p4, () => (window as unknown as { __mockAdsenseLoads?: number }).__mockAdsenseLoads === 1, "() => (window as unknown as { __mockAdsenseLoads?: number })");
  assert.equal(autoOn.requests.length, 1, 'F: Auto ads on → AdSense tag loaded once on a page without slots');
  await autoOn.c.close();
  // F2: google-cmp mode → AdSense tag loads without the site banner's advertising choice (the certified CMP asks)
  await admin.ok('/api/settings', 'PUT', { consentMode: 'google-cmp', adsenseAutoAds: 'disabled' });
  const cmp = await adContext(null);
  const p5 = await cmp.c.newPage();
  await p5.goto(base + articlePath, { waitUntil: 'networkidle' });
  await until(p5, () => !!document.querySelector('[data-ad-slot-id="ARTICLE_TOP"] ins.adsbygoogle'), "() => !!document.querySelector('[data-ad-slot-id=\"ARTICLE_TO");
  assert(cmp.requests.length >= 1, 'F2: google-cmp mode loads the AdSense tag so the certified CMP can ask');
  await cmp.c.close();
  pass('AdSense (MOCK script in real Chrome; live AdSense NOT verified): A filled keeps space, B unfilled collapses, C house ad visible, D no consent = no request, E Auto ads off = no tag, F Auto ads on = one tag, F2 google-cmp mode');

  completed = true;
} finally {
  if (browser) await browser.close().catch(() => undefined);
  child.kill();
  // Restore ad slots and settings exactly.
  for (const row of adsBefore) await prisma.adSlotConfig.update({ where: { id: row.id }, data: row });
  await prisma.$transaction(async (tx) => {
    for (const key of SETTING_KEYS) {
      const original = settingsBefore.find((s) => s.key === key);
      if (original) await tx.siteSetting.upsert({ where: { key }, create: original, update: original });
      else await tx.siteSetting.deleteMany({ where: { key } });
    }
  });
  await prisma.comment.deleteMany({ where: { content: { startsWith: fx } } });
  await prisma.redirectRule.deleteMany({ where: { sourceUrl: { contains: fx } } });
  await prisma.mediaItem.deleteMany({ where: { title: { startsWith: fx } } });
  await prisma.eventEdition.deleteMany({ where: { sportSlug: `${fx}-sport` } });
  await prisma.sportEvent.deleteMany({ where: { sportSlug: `${fx}-sport` } });
  await prisma.sport.deleteMany({ where: { slug: `${fx}-sport` } });
  await prisma.author.deleteMany({ where: { slug: { startsWith: fx } } });
  await prisma.session.deleteMany({ where: { user: { email: { contains: fx } } } });
  await prisma.user.deleteMany({ where: { email: { contains: fx } } });
  await prisma.pageViewStat.deleteMany({}); if (viewsBefore.length) await prisma.pageViewStat.createMany({ data: viewsBefore });
  await prisma.webVitalStat.deleteMany({}); if (vitalsBefore.length) await prisma.webVitalStat.createMany({ data: vitalsBefore });
  assert.deepEqual(await snapshot(), before, 'Pre-existing rows changed.');
  console.log(completed ? `\nPhase R.1 verification: ${checks} groups passed, 0 failed.` : `\nPhase R.1 verification FAILED after ${checks} group(s).`);
  await prisma.$disconnect();
  if (!completed) process.exitCode = 1;
}
