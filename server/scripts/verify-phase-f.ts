/** Phase F — Analytics, Privacy/Consent and Monetization verification.
 * Local database only. Runs the production build on a random port. Google's
 * scripts are stubbed in the browser (no request ever reaches Google). The
 * two provider settings and two ad slots are changed through the real Admin
 * APIs and restored afterwards; every pre-existing row is hash-compared.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { chromium, type Page, type BrowserContext } from 'playwright-core';
import { prisma } from '../db';
import { checkDatabaseUrlIsLocalDev } from '../dbSafety';
import { hashPassword } from '../password';
import { trackingConfig } from '../trackingConfig';
import { answerAll, needsChoice, parseConsent, serializeConsent } from '../../src/lib/consent';
import { sanitizePath, sanitizeSearchTerm, sanitizeParams } from '../../src/lib/analytics/sanitize';

assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe, 'Phase F verification requires a local, non-production database.');
assert(fs.existsSync('.next/BUILD_ID'), 'Run npm run build first.');
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
assert(executablePath && fs.existsSync(executablePath), 'Set PLAYWRIGHT_EXECUTABLE_PATH to an installed Chromium executable.');

const fixture = `phasef-${crypto.randomUUID()}`;
const password = `Test-${crypto.randomUUID()}`;
const userIds = { admin: `${fixture}-admin`, editor: `${fixture}-editor` };
const GA = 'G-TEST1234';
const ADS = 'ca-pub-0000000000000001';
const digest = (v: string) => crypto.createHash('sha256').update(v).digest('hex');
const tables = ['sport', 'sportEvent', 'eventEdition', 'article', 'articleMedia', 'author', 'user', 'session', 'comment', 'mediaItem', 'adSlotConfig', 'redirectRule', 'siteSetting', 'seoRule', 'seoScanRun', 'seoIntegrationLog', 'auditLog'] as const;
async function snapshot() {
  const out: Record<string, { count: number; hash: string }> = {};
  for (const table of tables) {
    const rows = await (prisma[table] as any).findMany();
    rows.sort((a: unknown, b: unknown) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    out[table] = { count: rows.length, hash: digest(JSON.stringify(rows)) };
  }
  return out;
}
let checks = 0; const pass = (s: string) => { checks++; console.log(`PASS ${s}`); };

// ── Pure units (no server) ──
assert.deepEqual(parseConsent('1.a1.d0'), { analytics: true, advertising: false });
assert.deepEqual(parseConsent('1.a-.d1'), { analytics: undefined, advertising: true });
for (const bad of ['', '2.a1.d1', '1.a1', 'x', '1.a2.d0', '1.a1.d0; evil']) assert.equal(parseConsent(bad), null, bad);
assert.equal(serializeConsent(answerAll(['analytics'], true)), '1.a1.d-', 'accept-all only answers offered categories');
assert.equal(needsChoice({ analytics: true }, ['analytics', 'advertising']), true, 'a newly configured category is asked about');
assert.equal(sanitizePath('/search/?q=john@example.com&sport=tennis&token=abc#x'), '/search/?sport=tennis');
assert.equal(sanitizeSearchTerm('  Call ME 01711-223344 '), '(redacted)');
assert.equal(sanitizeSearchTerm('someone@example.com'), '(redacted)');
assert.equal(sanitizeSearchTerm('French   OPEN'), 'french open');
assert.deepEqual(sanitizeParams({ a: 'x'.repeat(300), b: { nested: 1 }, c: NaN, d: 2, e: 'ok' }, ['a', 'b', 'c', 'd']), { a: 'x'.repeat(100), d: 2 });
assert.deepEqual(await trackingConfig(), { ga4MeasurementId: null, adsenseClient: null }, 'providers stay off outside production');
pass('consent cookie format, per-category answers, payload/path/search-term sanitizing, and development kill-switch');

const before = await snapshot();
const originalSlots = await prisma.adSlotConfig.findMany({ where: { id: { in: ['ARTICLE_TOP', 'ARTICLE_MIDDLE'] } } });
const originalSettings = await prisma.siteSetting.findMany({ where: { key: { in: ['ga4MeasurementId', 'adsensePublisherId'] } } });
const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = (probe.address() as { port: number }).port; await new Promise<void>((r) => probe.close(() => r()));
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
  cwd: process.cwd(), windowsHide: true,
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production', APP_ENV: 'production', AUTH_MODE: 'production', DEV_LOGIN_BYPASS: 'false', TRUST_PROXY: 'false', ALLOWED_ORIGIN: base, GEMINI_API_KEY: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = ''; child.stdout.on('data', (c) => { output += c; }); child.stderr.on('data', (c) => { output += c; });

class Client {
  cookies = new Map<string, string>();
  async request(p: string, method = 'GET', body?: unknown) {
    const headers: Record<string, string> = { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET') headers['x-csrf-token'] = this.cookies.get('csrf_token') || '';
    const res = await fetch(base + p, { method, headers, redirect: 'manual', body: body === undefined ? undefined : JSON.stringify(body) });
    for (const raw of res.headers.getSetCookie()) { const pair = raw.split(';')[0]; const i = pair.indexOf('='); this.cookies.set(pair.slice(0, i), pair.slice(i + 1)); }
    const text = await res.text(); let data: any = null; try { data = JSON.parse(text); } catch {}
    return { status: res.status, headers: res.headers, text, data };
  }
  async login(role: keyof typeof userIds) {
    await this.request('/api/auth/me');
    return this.request('/api/auth/login', 'POST', { email: `${fixture}-${role}@example.test`, password });
  }
}
const expect = async (c: Client, p: string, code: number, method = 'GET', body?: unknown) => {
  const r = await c.request(p, method, body);
  assert.equal(r.status, code, `${method} ${p}: expected ${code}, got ${r.status}: ${r.text.slice(0, 300)}`);
  return r;
};

// Browser helpers. Evaluate strings, not functions, so the TS loader cannot inject helpers.
const events = async (page: Page) => (await page.evaluate(`(window.dataLayer || []).map((a) => Array.from(a)).filter((a) => a[0] === 'event').map((a) => ({ name: a[1], params: a[2] }))`)) as { name: string; params: Record<string, unknown> }[];
const googleRequests: string[] = [];
async function newContext(browser: import('playwright-core').Browser, viewport = { width: 1280, height: 900 }): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport });
  await context.route(/googletagmanager\.com|googlesyndication\.com|google-analytics\.com|doubleclick\.net/, (route) => {
    googleRequests.push(route.request().url());
    const isAds = route.request().url().includes('googlesyndication');
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: isAds ? 'window.__adsStubLoaded = true;' : 'window.__gaStubLoaded = true;' });
  });
  return context;
}
const consentCookie = async (context: BrowserContext) => (await context.cookies()).find((c) => c.name === 'sportingspy_consent')?.value;

let browser: import('playwright-core').Browser | undefined;
try {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server did not start. ${output}`)), 30_000);
    child.stdout.on('data', (c) => { if (String(c).includes('Server running')) { clearTimeout(timer); resolve(); } });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(`Server exited. ${output}`)); });
  });
  for (const [role, id] of Object.entries(userIds)) await prisma.user.create({ data: { id, name: `Phase F ${role}`, email: `${fixture}-${role}@example.test`, role: role === 'admin' ? 'Admin' : 'Editor', avatar: '', joinedAt: new Date(), passwordHash: hashPassword(password) } });
  const anon = new Client(), admin = new Client(), editor = new Client();
  await anon.request('/api/health');
  assert.equal((await admin.login('admin')).status, 200); assert.equal((await editor.login('editor')).status, 200);
  const article = await prisma.article.findFirstOrThrow({ where: { status: 'published', sport: { isVisible: true }, eventSlug: { not: null }, editionYear: { not: null } }, orderBy: { publishedAt: 'desc' } });
  const articlePath = `/${article.sportSlug}/${article.eventSlug}/${article.editionYear}/${article.slug}/`;

  // ── Nothing configured: original behavior ──
  const seoBefore = {
    robots: (await expect(anon, '/robots.txt', 200)).text,
    sitemap: (await expect(anon, '/sitemap.xml', 200)).text,
    canonical: (await expect(anon, articlePath, 200)).text.match(/<link rel="canonical"[^>]*>/g),
    privacyRobots: (await expect(anon, '/privacy-policy/', 200)).text.match(/<meta name="robots"[^>]*>/g),
  };
  const home0 = await expect(anon, '/', 200);
  const csp0 = home0.headers.get('content-security-policy')!;
  // PHASE G: frame-src always admits exactly the two article-embed players.
  assert(!/googletagmanager|googlesyndication|google-analytics|doubleclick/.test(csp0) && /frame-src 'self' https:\/\/www\.youtube-nocookie\.com https:\/\/player\.vimeo\.com;/.test(csp0), `no provider hosts when nothing is configured: ${csp0}`);
  assert(!home0.text.includes('consent-title') && !home0.text.includes('googletagmanager'), 'no banner and no provider script when nothing optional is configured');
  assert(home0.text.includes('Privacy choices'), 'footer offers privacy choices');
  const privacy0 = await expect(anon, '/privacy-policy/', 200);
  assert(privacy0.text.includes('No analytics service is active') && privacy0.text.includes('sportingspy_consent') && privacy0.text.includes('csrf_token'));
  assert(!/passwordHash|\/api\/cms|G-[A-Z0-9]{6}/.test(privacy0.text), 'privacy page exposes no private data');
  pass('with no provider configured: no provider hosts in the CSP, no banner, no third-party script; privacy page documents the real cookies/storage and says analytics is off');

  // ── Admin configures providers and slots (RBAC + validation) ──
  await expect(editor, '/api/settings', 403, 'PUT', { ga4MeasurementId: GA });
  await expect(admin, '/api/settings', 400, 'PUT', { ga4MeasurementId: 'UA-123' });
  await expect(admin, '/api/settings', 200, 'PUT', { ga4MeasurementId: GA, adsensePublisherId: ADS });
  await expect(editor, '/api/ads/ARTICLE_TOP', 403, 'PUT', { enabled: true });
  for (const [body, why] of [
    [{ linkUrl: 'javascript:alert(1)' }, 'script URL'], [{ linkUrl: '//evil.example' }, 'protocol-relative URL'], [{ id: 'X' }, 'identity field'],
    [{ dimensions: '1x1' }, 'layout field'], [{ enabled: 'yes' }, 'non-boolean'], [{ provider: 'evilnet' }, 'unknown provider'],
    [{ provider: 'adsense' }, 'AdSense without unit ID'], [{ provider: 'adsense', providerSlotId: '12<script>' }, 'bad unit ID'],
  ] as const) await expect(admin, '/api/ads/ARTICLE_TOP', 400, 'PUT', body).catch((e) => { throw new Error(`${why}: ${e.message}`); });
  await expect(admin, '/api/ads/ARTICLE_TOP', 200, 'PUT', { enabled: true, provider: 'house', sponsorName: 'Phase F Sponsor', bannerText: 'Fixture banner', linkUrl: 'https://example.com/sponsor' });
  await expect(admin, '/api/ads/ARTICLE_MIDDLE', 200, 'PUT', { enabled: true, provider: 'adsense', providerSlotId: '1234567890' });
  const cleared = await expect(admin, '/api/ads/ARTICLE_TOP', 200, 'PUT', { bannerText: '' });
  assert.equal(cleared.data.bannerText, null, 'an emptied field is cleared (not silently kept)');
  await expect(admin, '/api/ads/ARTICLE_TOP', 200, 'PUT', { bannerText: 'Fixture banner' });
  const csp1 = (await expect(anon, '/', 200)).headers.get('content-security-policy')!;
  assert(csp1.includes('https://www.googletagmanager.com') && csp1.includes('https://pagead2.googlesyndication.com') && csp1.includes('frame-src'), 'CSP admits exactly the configured providers (settings change applied without restart)');
  pass('only Admins configure providers and ad slots; script/relative/identity/unknown fields, bad providers and bad unit IDs are rejected; CSP follows the configuration immediately');

  // ── Browser: consent → analytics / advertising ──
  browser = await chromium.launch({ executablePath, headless: true });
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(base + articlePath, { waitUntil: 'networkidle' });
  const banner = page.getByRole('region', { name: 'Privacy choices' });
  assert(await banner.isVisible(), 'banner shown when optional providers exist and no choice was made');
  assert.equal(googleRequests.length, 0, 'nothing loads from Google before a choice');
  assert.equal(await page.evaluate('typeof window.dataLayer'), 'undefined');
  assert.equal(await page.locator('ins.adsbygoogle').count(), 0, 'AdSense slot not rendered without advertising consent');
  assert(await page.getByRole('complementary', { name: 'Sponsored' }).isVisible(), 'house sponsorship shows without consent (no third party), labelled Sponsored');
  assert(await page.locator('article h1').isVisible(), 'article readable with the banner open');
  const buttons = await banner.getByRole('button').evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
  assert.equal(buttons[0], buttons[1], 'Accept and Reject are equally prominent');
  await banner.getByRole('button', { name: 'Reject optional' }).click();
  assert.equal(await consentCookie(ctx), '1.a0.d0');
  await page.reload({ waitUntil: 'networkidle' });
  assert(!(await banner.isVisible()) && googleRequests.length === 0 && (await page.evaluate('typeof window.dataLayer')) === 'undefined', 'rejected: no banner, no Google requests, no analytics');
  pass('before a choice and after "Reject optional": no Google request, no analytics, no AdSense; house sponsorship still labelled; reading unaffected; equal-weight buttons');

  // Reopen preferences from the footer, allow analytics only.
  await page.getByRole('button', { name: 'Privacy choices' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Privacy preferences' });
  await dialog.waitFor();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(`document.activeElement && document.activeElement.textContent`), 'Privacy choices', 'Escape closes and returns focus');
  await page.getByRole('button', { name: 'Privacy choices' }).first().click();
  await dialog.getByLabel(/Analytics/).check();
  await dialog.getByRole('button', { name: 'Save choices' }).click();
  assert.equal(await consentCookie(ctx), '1.a1.d0');
  await page.waitForFunction('window.__gaStubLoaded === true');
  let ev = await events(page);
  assert.deepEqual(ev.filter((e) => e.name === 'page_view').map((e) => e.params.page_path), [articlePath], 'current page reported once when analytics is allowed');
  const av = ev.find((e) => e.name === 'article_view');
  assert(av && av.params.article_id === article.id && av.params.sport === article.sportSlug && av.params.category === article.articleType, 'article_view with public identifiers');
  assert(!JSON.stringify(ev).includes(article.content.slice(0, 40)), 'no article body in analytics');
  const config = (await page.evaluate(`window.dataLayer.map((a) => Array.from(a)).find((a) => a[0] === 'config')`)) as unknown[];
  assert.deepEqual(config[2], { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false });
  assert(!googleRequests.some((u) => u.includes('googlesyndication')), 'advertising stays off with analytics-only consent');
  pass('analytics-only consent loads GA4 (stubbed) with manual page views and signals off; the current page and its article_view are reported once, without body text; AdSense stays off');

  // Client navigation counts once per navigation.
  await page.getByRole('link', { name: 'Latest', exact: true }).first().click();
  await page.waitForURL('**/latest/');
  await page.waitForTimeout(400);
  await page.goBack(); await page.waitForURL(`**${articlePath}`); await page.waitForTimeout(400);
  ev = await events(page);
  assert.deepEqual(ev.filter((e) => e.name === 'page_view').map((e) => e.params.page_path), [articlePath, '/latest/', articlePath], 'one page_view per navigation, none duplicated');
  await page.goto(`${base}/search/?q=${encodeURIComponent('john.doe@example.com')}&sport=${article.sportSlug}`, { waitUntil: 'networkidle' });
  await page.waitForFunction('(window.dataLayer || []).some((a) => a[0] === "event" && a[1] === "search")');
  ev = await events(page);
  assert.equal(ev.find((e) => e.name === 'page_view')!.params.page_path, `/search/?sport=${article.sportSlug}`, 'search text never in the reported URL');
  assert.equal(ev.find((e) => e.name === 'search')!.params.search_term, '(redacted)', 'personal-looking search text is redacted');
  await page.goto(`${base}/search/?q=french`, { waitUntil: 'networkidle' });
  await page.waitForFunction('(window.dataLayer || []).some((a) => a[0] === "event" && a[1] === "search")');
  const search = (await events(page)).find((e) => e.name === 'search')!;
  assert(search.params.search_term === 'french' && typeof search.params.result_count === 'number' && search.params.sort === 'relevance', 'Phase E search hook reports through the analytics layer');
  pass('client-side navigation is counted once per page; search events reuse the Phase E hooks with sanitized terms and query-free paths');

  // Accept all → AdSense unit appears (server re-render) and its script loads.
  await page.goto(base + articlePath, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Privacy choices' }).first().click();
  await dialog.getByRole('button', { name: 'Accept all' }).click();
  assert.equal(await consentCookie(ctx), '1.a1.d1');
  await page.locator('ins.adsbygoogle[data-ad-slot="1234567890"]').waitFor({ state: 'attached', timeout: 10_000 }); // empty: the stub serves no creative
  await page.waitForFunction('window.__adsStubLoaded === true');
  assert(await page.getByRole('complementary', { name: 'Advertisement' }).isVisible(), 'AdSense unit labelled Advertisement');
  // House sponsor click → ad_click.
  const [popup] = await Promise.all([ctx.waitForEvent('page'), page.locator('a[data-ad-placement="ARTICLE_TOP"]').click()]);
  await popup.close();
  const click = (await events(page)).find((e) => e.name === 'ad_click');
  assert(click && click.params.ad_placement === 'ARTICLE_TOP' && click.params.ad_provider === 'house' && click.params.sponsor === 'Phase F Sponsor');
  assert.equal(await page.locator('a[data-ad-placement="ARTICLE_TOP"]').getAttribute('rel'), 'noopener noreferrer sponsored');
  pass('accepting advertising renders the AdSense unit (labelled Advertisement) and loads its script; sponsor links are rel="sponsored" and report ad_click');

  // Withdraw everything → stop sending, opt-out flag, GA cookies removed, AdSense gone.
  await page.evaluate(`document.cookie = '_ga=GA1.1.123.456; Path=/'`);
  await page.getByRole('button', { name: 'Privacy choices' }).first().click();
  await dialog.getByRole('button', { name: 'Reject optional' }).click();
  assert.equal(await consentCookie(ctx), '1.a0.d0');
  await page.locator('ins.adsbygoogle').waitFor({ state: 'detached', timeout: 10_000 });
  assert.equal(await page.evaluate(`window['ga-disable-${GA}']`), true, 'GA opt-out flag set');
  assert(!(await page.evaluate('document.cookie')).toString().includes('_ga='), 'GA cookies removed');
  const countBefore = (await events(page)).length;
  await page.getByRole('link', { name: 'Latest', exact: true }).first().click();
  await page.waitForURL('**/latest/'); await page.waitForTimeout(400);
  assert.equal((await events(page)).length, countBefore, 'no events after withdrawal');
  pass('withdrawing consent stops analytics immediately (opt-out flag, _ga cookies removed, no further events) and removes the AdSense unit');

  // Staff areas: no banner, never measured.
  const ctx2 = await newContext(browser);
  const staffPage = await ctx2.newPage();
  const before2 = googleRequests.length;
  await staffPage.goto(`${base}/admin/`, { waitUntil: 'networkidle' });
  assert(!(await staffPage.getByRole('region', { name: 'Privacy choices' }).isVisible()), 'no banner in the CMS');
  await ctx2.addCookies([{ name: 'sportingspy_consent', value: '1.a1.d1', url: base }]);
  await staffPage.goto(`${base}/admin/`, { waitUntil: 'networkidle' });
  await staffPage.waitForTimeout(300);
  assert.deepEqual((await events(staffPage)).filter((e) => e.name === 'page_view'), [], 'CMS pages are never reported');
  assert.equal(googleRequests.length, before2, 'no provider script is even loaded in the CMS');
  await ctx2.close();
  pass('staff CMS shows no banner, loads no provider script and is never measured, even with analytics consent');

  // Mobile layout + keyboard.
  const ctx3 = await newContext(browser, { width: 390, height: 844 });
  const mobile = await ctx3.newPage();
  await mobile.goto(base + articlePath, { waitUntil: 'networkidle' });
  const mBanner = mobile.getByRole('region', { name: 'Privacy choices' });
  assert(await mBanner.isVisible());
  const box = (await mBanner.boundingBox())!;
  assert(box.width <= 390 && box.height < 844 * 0.5, `banner fits and leaves most of the screen readable (${Math.round(box.height)}px)`);
  assert(await mobile.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'no horizontal overflow');
  await mobile.screenshot({ path: path.join('.codex-runtime', 'consent-banner-mobile.png') });
  await mBanner.getByRole('button', { name: 'Manage preferences' }).focus();
  await mobile.keyboard.press('Enter');
  const mDialog = mobile.getByRole('dialog', { name: 'Privacy preferences' });
  await mDialog.waitFor();
  for (let i = 0; i < 12; i++) await mobile.keyboard.press('Tab');
  assert(await mobile.evaluate(`!!document.activeElement.closest('[role=dialog]')`), 'focus stays inside the dialog');
  await ctx3.close();
  const ctx4 = await newContext(browser);
  const desk = await ctx4.newPage();
  await desk.goto(base + articlePath, { waitUntil: 'networkidle' });
  await desk.screenshot({ path: path.join('.codex-runtime', 'consent-banner-desktop.png') });
  await ctx4.close();
  pass('mobile: banner fits without overflow and covers under half the screen; preferences are keyboard-operable with focus kept inside');

  // SEO untouched by configuration or consent.
  const seoAfter = {
    robots: (await expect(anon, '/robots.txt', 200)).text,
    sitemap: (await expect(anon, '/sitemap.xml', 200)).text,
    canonical: (await expect(anon, articlePath, 200)).text.match(/<link rel="canonical"[^>]*>/g),
    privacyRobots: (await expect(anon, '/privacy-policy/', 200)).text.match(/<meta name="robots"[^>]*>/g),
  };
  assert.deepEqual(seoAfter, seoBefore, 'robots, sitemap, canonical and privacy-page robots unchanged');
  assert.equal(seoAfter.canonical?.length, 1);
  const privacy1 = await expect(anon, '/privacy-policy/', 200);
  assert(privacy1.text.includes('Google Analytics 4') && privacy1.text.includes('Google AdSense') && privacy1.text.includes('_ga'), 'privacy page names the active providers');
  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join('; ')}`);
  pass('robots.txt, sitemap, article canonical and privacy-page indexing are identical before and after enabling providers; no page errors');
} finally {
  await browser?.close();
  child.kill(); await once(child, 'exit').catch(() => undefined);
  // Restore exactly what was there.
  for (const slot of originalSlots) await prisma.adSlotConfig.update({ where: { id: slot.id }, data: slot });
  await prisma.siteSetting.deleteMany({ where: { key: { in: ['ga4MeasurementId', 'adsensePublisherId'] } } });
  for (const s of originalSettings) await prisma.siteSetting.create({ data: s });
  await prisma.session.deleteMany({ where: { userId: { in: Object.values(userIds) } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: Object.values(userIds) } } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(userIds) } } });
  const after = await snapshot();
  assert.deepEqual(after, before, 'Database changed outside disposable Phase F fixtures.');
  console.log(`PASS ${checks} Phase F verification groups`);
  console.log('PASS database integrity: all pre-existing rows unchanged; settings and ad slots restored; fixtures removed.');
  await prisma.$disconnect();
}
