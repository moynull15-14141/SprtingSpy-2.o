/**
 * PHASE P verification — performance changes must not change behaviour or
 * weaken access control. Local production-mode server, local development
 * database, disposable fixtures; pre-existing rows verified unchanged.
 *
 * Covers: CMS list without article bodies + GET /api/articles/:id with the
 * same read scope (Author: own only; anonymous: 401); /api/articles list
 * without bodies; /search/?q= shares the search API's per-IP budget (429 with
 * Retry-After) while /search/ itself is never limited; cached sitemaps and
 * cached public settings are fresh right after a CMS write; the diagnostic
 * query log is off by default; redirect logs never contain query strings.
 *
 * Real Chrome (PLAYWRIGHT_EXECUTABLE_PATH or the default Windows install):
 * the CMS editor opens an article from the list and shows its full body.
 *
 * Run: npm run build && npm run test:phase-p  (stop other app instances first)
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { chromium } from 'playwright-core';
import { prisma } from '../db';
import { checkDatabaseUrlIsLocalDev } from '../dbSafety';
import { hashPassword } from '../password';

assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe, 'Phase P requires a local development database.');
assert(fs.existsSync('.next/BUILD_ID'), 'Build before Phase P verification (npm run build).');

const fx = `p${crypto.randomUUID().slice(0, 6)}`;
const sport = `${fx}-sport`;
const password = `Phase-P-${crypto.randomUUID()}`;
const ids = { admin: `${fx}-admin`, author: `${fx}-author`, ownByline: `${fx}-own-byline`, otherByline: `${fx}-other-byline` };
const digest = (rows: unknown) => crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const snapshot = async () => ({
  articles: digest(await prisma.article.findMany({ where: { NOT: { sportSlug: sport } }, orderBy: { id: 'asc' }, select: { id: true, status: true, slug: true, updatedAt: true } })),
  sports: digest(await prisma.sport.findMany({ where: { NOT: { slug: sport } }, orderBy: { id: 'asc' } })),
  redirects: digest(await prisma.redirectRule.findMany({ where: { NOT: { sourceUrl: { contains: fx } } }, orderBy: { id: 'asc' } })),
  settings: digest(await prisma.siteSetting.findMany({ orderBy: { key: 'asc' } })),
});
const before = await snapshot();
const settingsBefore = await prisma.siteSetting.findMany();

const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = (probe.address() as { port: number }).port; await new Promise<void>((r) => probe.close(() => r()));
const base = `http://localhost:${port}`;
let output = '';
const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port), HOST: '127.0.0.1', TRUST_PROXY: 'false', NODE_ENV: 'production', APP_ENV: 'production', AUTH_MODE: 'production', DEV_LOGIN_BYPASS: 'false', ALLOWED_ORIGIN: base, SITE_ORIGIN: base, INDEXNOW_ENDPOINT: '', GEMINI_API_KEY: '', TOTP_ENCRYPTION_KEY: `phase-p-${crypto.randomUUID()}`, RESEND_API_KEY: '', MAIL_FROM: '' };
delete env.PRISMA_QUERY_LOG;
delete env.PUBLIC_CACHE_TTL_SECONDS;
const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], { cwd: process.cwd(), windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
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
    return { status: res.status, text, data, headers: res.headers, location: res.headers.get('location') };
  }
  async ok(path: string, method = 'GET', body?: unknown, expected = [200, 201]) {
    const r = await this.request(path, method, body);
    assert(expected.includes(r.status), `${method} ${path}: HTTP ${r.status} ${r.text.slice(0, 300)}`);
    return r.data;
  }
}
const anon = new Client();
const login = async (email: string) => { const c = new Client(); await c.request('/robots.txt'); const r = await c.request('/api/auth/login', 'POST', { email, password }); assert.equal(r.status, 200, r.text); return c; };
const doc = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `${t} ${'Useful detail for readers of this fixture article. '.repeat(25)}` }] }] });
let completed = false;

try {
  await new Promise<void>((resolve, reject) => { const t = setTimeout(() => reject(new Error(`server did not start: ${output.slice(-800)}`)), 90_000); child.stdout.on('data', (c) => { if (String(c).includes('Server running')) { clearTimeout(t); resolve(); } }); child.once('exit', () => { clearTimeout(t); reject(new Error(`server exited: ${output.slice(-800)}`)); }); });
  await anon.request('/robots.txt');

  // ── Fixtures ──
  await prisma.user.create({ data: { id: ids.admin, name: 'P Admin', email: `${ids.admin}@example.test`, role: 'Admin', avatar: '', joinedAt: new Date(), passwordHash: hashPassword(password) } });
  await prisma.user.create({ data: { id: ids.author, name: 'P Author', email: `${ids.author}@example.test`, role: 'Author', avatar: '', joinedAt: new Date(), passwordHash: hashPassword(password) } });
  await prisma.author.create({ data: { id: ids.ownByline, slug: ids.ownByline, name: 'P Own Byline', roleTitle: 'Reporter', bio: 'Fixture.', avatar: '', userId: ids.author } });
  await prisma.author.create({ data: { id: ids.otherByline, slug: ids.otherByline, name: 'P Other Byline', roleTitle: 'Reporter', bio: 'Fixture.', avatar: '' } });
  const admin = await login(`${ids.admin}@example.test`);
  const author = await login(`${ids.author}@example.test`);
  await admin.ok('/api/sports', 'POST', { name: 'P Fixture Sport', slug: sport, tagline: 'Fixture', description: 'Fixture sport for Phase P verification.' });
  const mk = (slug: string, authorId: string, status: string) => admin.ok('/api/articles', 'POST', { title: `P ${slug}`, slug, sportSlug: sport, articleType: 'News', excerpt: `P ${slug} excerpt.`, body: doc(slug), authorId, status, seo: {}, references: [{ title: 'Official site', url: 'https://example.org/' }] });
  const own = await mk(`${fx}-own`, ids.ownByline, 'draft');
  const foreign = await mk(`${fx}-foreign`, ids.otherByline, 'draft');

  // ── 1. CMS list without bodies; one full article for the editor; same read scope ──
  const cms = await admin.ok('/api/cms/data');
  const listed = cms.articles.find((a: any) => a.id === own.id);
  assert(listed && listed.title === own.title && listed.seo && listed.excerpt, 'list keeps the fields lists, dashboards and filters use');
  for (const heavy of ['body', 'content', 'tables', 'references']) assert(!(heavy in listed), `CMS list omits ${heavy}`);
  const full = await admin.ok(`/api/articles/${own.id}`);
  assert.deepEqual(full.body, own.body, 'editor loads the full body'); assert.deepEqual(full.references, own.references); assert(full.content.length > 100);
  const list = await admin.ok(`/api/articles?sport=${sport}`);
  assert(list.length === 2 && list.every((a: any) => !('body' in a) && !('content' in a)), '/api/articles list omits heavy fields');
  assert.equal((await author.ok(`/api/articles/${own.id}`)).id, own.id, 'Author opens own article');
  assert.equal((await author.request(`/api/articles/${foreign.id}`)).status, 404, 'Author cannot read another byline');
  assert.equal((await anon.request(`/api/articles/${own.id}`)).status, 401, 'anonymous cannot read');
  assert(!(await author.ok('/api/cms/data')).articles.some((a: any) => a.id === foreign.id), 'Author CMS list stays scoped');
  assert((await admin.ok('/api/articles/reviewers')).every((u: any) => u.id && u.role), '/api/articles/reviewers still reaches the workflow route');
  pass('CMS: list carries no bodies; GET /api/articles/:id returns the full article within the same read scope (Author own only, anonymous 401); reviewers route unaffected');

  // ── 1b. Real browser: the editor loads the full article it opens ──
  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  assert(fs.existsSync(executablePath), 'Set PLAYWRIGHT_EXECUTABLE_PATH to an installed Chrome/Chromium.');
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    const articleLoads: string[] = [];
    page.on('request', (r) => { if (new URL(r.url()).pathname === `/api/articles/${own.id}` && r.method() === 'GET') articleLoads.push(r.url()); });
    await page.goto(`${base}/admin/`, { waitUntil: 'networkidle' });
    await page.getByPlaceholder('Email').fill(`${ids.admin}@example.test`);
    await page.getByPlaceholder('Password').fill(password);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.getByRole('heading', { name: 'Content Management System' }).waitFor();
    await page.getByRole('button', { name: 'Articles', exact: true }).click();
    const row = page.locator('tr', { hasText: `P ${fx}-own` });
    await row.waitFor();
    await row.getByRole('button', { name: 'Edit' }).click();
    const titleInput = page.locator('input[placeholder^="Article title (H1)"]');
    await titleInput.waitFor();
    assert.equal(await titleInput.inputValue(), `P ${fx}-own`, 'editor shows the opened article');
    await page.getByText(`${fx}-own Useful detail for readers`).first().waitFor();
    assert.equal(articleLoads.length, 1, 'exactly one full-article request when opening the editor');
    assert.deepEqual(pageErrors, [], 'no page errors');
  } finally {
    await browser.close();
  }
  pass('Real Chrome: Articles → Edit loads the full article once (title and body shown), no page errors');

  // ── 2. Cached sitemaps and public settings are fresh after a CMS write ──
  const index = await anon.request('/sitemap.xml'); assert.equal(index.status, 200);
  const files = [...index.text.matchAll(/<loc>[^<]*\/sitemaps\/([^<]+)<\/loc>/g)].map((m) => m[1]);
  const allSitemaps = async () => (await Promise.all(files.map((f) => anon.request(`/sitemaps/${f}`)))).map((r) => r.text).join('\n');
  assert(!(await allSitemaps()).includes(`/${sport}/${fx}-own/`), 'draft not in sitemap (and the sitemap is now cached)');
  await admin.ok(`/api/articles/${own.id}`, 'PUT', { status: 'published' });
  const fresh = await anon.request('/sitemap.xml');
  const freshFiles = [...fresh.text.matchAll(/<loc>[^<]*\/sitemaps\/([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert((await Promise.all(freshFiles.map((f) => anon.request(`/sitemaps/${f}`)))).some((r) => r.text.includes(`/${sport}/${fx}-own/`)), 'published article in the sitemap immediately');
  await anon.request('/'); // warm the layout's settings cache
  const token = `phaseP${fx}Token1234`;
  await admin.ok('/api/settings', 'PUT', { googleSiteVerification: token });
  assert((await anon.request('/')).text.includes(token), 'verification meta updated on the next request after saving Settings');
  pass('Caching: sitemap and public settings served from the write-invalidated cache, yet fresh immediately after a publish / settings save');

  // ── 3. /search/?q= shares the search API per-IP budget ──
  for (let i = 0; i < 120; i++) assert.equal((await anon.request(`/api/search?q=${fx}${i}`)).status, 200);
  const limited = await anon.request(`/search/?q=${fx}`);
  assert.equal(limited.status, 429, 'search page limited once the shared budget is used'); assert(Number(limited.headers.get('retry-after')) > 0);
  assert.equal((await anon.request('/api/search?q=again')).status, 429, 'API still limited');
  assert.equal((await anon.request('/search/')).status, 200, '/search/ without a query is a plain page, never limited');
  pass('Search: /search/?q= and /api/search share 120 searches/min per IP (429 + Retry-After); /search/ without a query unaffected');

  // ── 4. Diagnostics and logging ──
  await prisma.redirectRule.create({ data: { id: `${fx}-redir`, sourceUrl: `/${fx}-old`, targetUrl: `/${sport}`, statusCode: 301, createdAt: new Date(), origin: 'manual' } });
  const moved = await anon.request(`/${fx}-old/?email=reader@example.test&utm_source=x`);
  assert.equal(moved.status, 301); assert(moved.location!.includes('utm_source=x'), 'query preserved on the redirect itself');
  await new Promise((r) => setTimeout(r, 200));
  assert(output.includes(`[Redirect Engine] Serving HTTP 301 from /${fx}-old -> /${sport}/`), 'redirect logged by path');
  assert(!output.includes('reader@example.test') && !output.includes('utm_source'), 'query strings never logged');
  assert(!output.includes('[db-query]'), 'diagnostic query log is off by default');
  pass('Logging: redirect log has the path only (no query strings); PRISMA_QUERY_LOG off by default');

  completed = true;
} finally {
  child.kill();
  await prisma.redirectRule.deleteMany({ where: { OR: [{ sourceUrl: { contains: fx } }, { targetUrl: { contains: fx } }] } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: [ids.admin, ids.author] } } });
  await prisma.articleMedia.deleteMany({ where: { article: { sportSlug: sport } } });
  await prisma.article.deleteMany({ where: { sportSlug: sport } });
  await prisma.sport.deleteMany({ where: { slug: sport } });
  await prisma.siteSetting.deleteMany({});
  if (settingsBefore.length) await prisma.siteSetting.createMany({ data: settingsBefore });
  await prisma.searchQueryStat.deleteMany({ where: { query: { contains: fx } } });
  await prisma.session.deleteMany({ where: { userId: { in: [ids.admin, ids.author] } } });
  await prisma.author.deleteMany({ where: { id: { in: [ids.ownByline, ids.otherByline] } } });
  await prisma.user.deleteMany({ where: { id: { in: [ids.admin, ids.author] } } });
  assert.deepEqual(await snapshot(), before, 'Pre-existing rows changed.');
  console.log(completed ? `\nPhase P verification: ${checks} groups passed, 0 failed.` : `\nPhase P verification FAILED after ${checks} group(s).`);
  await prisma.$disconnect();
  if (!completed) process.exitCode = 1;
}
