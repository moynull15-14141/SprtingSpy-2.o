/** Phase H: real production-browser workflows plus API/privacy boundaries.
 * Local DB only. UUID fixtures and settings are restored in finally; a full
 * row snapshot proves that existing editorial/user content was preserved.
 * Run after npm run build with PLAYWRIGHT_EXECUTABLE_PATH (or installed Chrome).
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { chromium, type Browser, type Page } from 'playwright-core';
import { prisma } from '../db';
import { hashPassword } from '../password';
import { checkDatabaseUrlIsLocalDev } from '../dbSafety';

assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe, 'Phase H requires a local, non-production database.');
assert(fs.existsSync('.next/BUILD_ID'), 'Run npm run build first.');
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) => fs.existsSync(p));
assert(executablePath && fs.existsSync(executablePath), 'Set PLAYWRIGHT_EXECUTABLE_PATH to installed Chromium.');
// The live scheduler must never release somebody else's scheduled content.
const safetyWindow = new Date(Date.now() + 15 * 60_000);
assert.equal(await prisma.article.count({ where: { status: 'scheduled', scheduledFor: { lte: safetyWindow } } }), 0, 'Existing articles are due soon; use an isolated database copy.');
assert.equal(await prisma.siteExperience.count({ where: { scheduledFor: { lte: safetyWindow } } }), 0, 'Existing site configuration is due soon; use an isolated database copy.');

const prefix = `phaseh-${crypto.randomUUID()}`;
const password = `Phase-H-${crypto.randomUUID()}`;
const ids = { admin: `${prefix}-admin`, editor: `${prefix}-editor`, author: `${prefix}-author` };
const articleId = `${prefix}-article`, sportId = `${prefix}-sport`, sportSlug = sportId, emptySportId = `${prefix}-empty`, eventId = `${prefix}-event`, editionId = `${prefix}-edition`;
const tables = ['sport', 'sportEvent', 'eventEdition', 'article', 'articleMedia', 'author', 'user', 'session', 'comment', 'mediaItem', 'adSlotConfig', 'adCreative', 'redirectRule', 'siteSetting', 'siteExperience', 'seoRule', 'seoScanRun', 'seoIntegrationLog', 'auditLog', 'faqEntry', 'contactMessage'] as const;
const hash = (v: unknown) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
async function snapshot() {
  return Object.fromEntries(await Promise.all(tables.map(async (table) => {
    const rows = await (prisma[table] as any).findMany();
    rows.sort((a: unknown, b: unknown) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return [table, { count: rows.length, hash: hash(rows) }];
  })));
}
const before = await snapshot();
const originalSettings = await prisma.siteSetting.findMany();
const originalFaq = await prisma.faqEntry.findMany();
const touchedSettingKeys = ['siteName', 'siteDescription', 'defaultOgImage', 'twitterHandle', 'googleSiteVerification', 'bingSiteVerification', 'globalFaqPage', 'globalFaqSchema'];
const localSchedule = (days: number) => new Date(Date.now() + days * 86_400_000 + 6 * 3600_000).toISOString().slice(0, 16);
const firstLocal = localSchedule(1), secondLocal = localSchedule(2);
const asUtc = (value: string) => new Date(`${value}:00+06:00`).toISOString();
const faqIds = new Set<string>();
const apiArticleIds = new Set<string>();
let checks = 0, completed = false;
const pass = (message: string) => { checks++; console.log(`PASS ${message}`); };
const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = (probe.address() as { port: number }).port; await new Promise<void>((r) => probe.close(() => r()));
const base = `http://127.0.0.1:${port}`;
let server: ReturnType<typeof spawn> | undefined, browser: Browser | undefined, output = '';
class Client {
  cookies = new Map<string, string>();
  async request(path: string, method = 'GET', body?: unknown) {
    const headers: Record<string, string> = { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET') headers['x-csrf-token'] = this.cookies.get('csrf_token') ?? '';
    const res = await fetch(base + path, { method, headers, redirect: 'manual', body: body === undefined ? undefined : JSON.stringify(body) });
    for (const raw of res.headers.getSetCookie()) { const [pair] = raw.split(';'); const i = pair.indexOf('='); this.cookies.set(pair.slice(0, i), pair.slice(i + 1)); }
    const text = await res.text(); let data: any; try { data = JSON.parse(text); } catch {}
    return { status: res.status, text, data };
  }
  async login(role: keyof typeof ids) { await this.request('/api/auth/me'); return this.request('/api/auth/login', 'POST', { email: `${ids[role]}@example.test`, password }); }
}
async function expect(c: Client, path: string, status = 200, method = 'GET', body?: unknown) {
  const res = await c.request(path, method, body);
  assert.equal(res.status, status, `${method} ${path}: ${res.status} ${res.text.slice(0, 300)}`);
  return res;
}
async function until<T>(read: () => Promise<T>, valid: (v: T) => boolean, description: string, timeout = 10_000): Promise<T> {
  const deadline = Date.now() + timeout;
  let value: T;
  do { value = await read(); if (valid(value)) return value; await new Promise((r) => setTimeout(r, 150)); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${description}`);
}
async function login(page: Page, role: keyof typeof ids) {
  await page.goto(base + '/admin/');
  await page.getByPlaceholder('Email', { exact: true }).fill(`${ids[role]}@example.test`);
  await page.getByPlaceholder('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.getByRole('button', { name: 'Articles', exact: true }).waitFor();
}
const row = (page: Page, title: string) => page.locator('tr').filter({ hasText: title });
const overflow = (page: Page) => page.evaluate('document.documentElement.scrollWidth <= innerWidth');
async function articleSitemapContains(client: Client, path: string) {
  const index = (await expect(client, '/sitemap.xml')).text;
  const files = [...index.matchAll(/<loc>[^<]*\/sitemaps\/(articles-\d+\.xml)<\/loc>/g)].map((m) => m[1]);
  assert(files.length, 'Sitemap index includes an articles child sitemap.');
  const documents = await Promise.all(files.map((file) => expect(client, `/sitemaps/${file}`)));
  return documents.some((doc) => doc.text.includes(path));
}
fs.mkdirSync('verification/phase-h', { recursive: true });
try {
  for (const role of Object.keys(ids) as (keyof typeof ids)[]) await prisma.user.create({ data: { id: ids[role], name: `Phase H ${role}`, email: `${ids[role]}@example.test`, role: role === 'admin' ? 'Admin' : role === 'editor' ? 'Editor' : 'Author', avatar: '', joinedAt: new Date(), passwordHash: hashPassword(password) } });
  const byline = await prisma.author.create({ data: { id: `${prefix}-byline`, slug: `${prefix}-byline`, name: 'Phase H byline', roleTitle: 'Reporter', bio: 'Verification fixture', avatar: '', userId: ids.author } });
  for (const [id, name] of [[sportId, `${prefix} Fixture Sport`], [emptySportId, `${prefix} Zero Event Sport`]]) await prisma.sport.create({ data: { id, slug: id, name, tagline: 'Test sport', description: 'Disposable verification sport.', order: 9999, isVisible: true, seo: {} } });
  await prisma.sportEvent.create({ data: { id: eventId, sportSlug, slug: eventId, name: `${prefix} Event`, shortName: 'H Event', description: 'Phase H event description.', frequency: 'Annual', defaultVenue: 'Test venue', defaultLocation: 'Test city', currentEditionYear: 2098, allEditionYears: [2098], isVisible: true, seo: {} } });
  await prisma.eventEdition.create({ data: { id: editionId, sportSlug, eventSlug: eventId, year: 2098, title: `${prefix} Edition`, startDate: '2098-05-01', endDate: '2098-05-10', venue: 'Test venue', location: 'Test city', status: 'upcoming', description: 'Phase H edition description.', featuredImage: '', seo: {} } });
  await prisma.article.create({ data: { id: articleId, slug: articleId, sportSlug, title: `${prefix} Scheduled Story`, excerpt: 'Phase H editorial summary.', content: 'The real scheduler publishes this isolated editorial fixture.', featuredImage: '', authorId: byline.id, publishedAt: new Date(), status: 'draft', readingTimeMinutes: 1, seo: {} } });
  server = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], { windowsHide: true, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production', APP_ENV: 'production', AUTH_MODE: 'production', DEV_LOGIN_BYPASS: 'false', ALLOWED_ORIGIN: base, SITE_ORIGIN: base, TRUST_PROXY: 'false', GEMINI_API_KEY: '', INDEXNOW_ENDPOINT: '', SHADOW_DATABASE_URL: '', ALLOW_DESTRUCTIVE_DB_OPS: 'false', SHOW_AD_PLACEHOLDERS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout?.on('data', (c) => output += c); server.stderr?.on('data', (c) => output += c);
  await until(async () => { if (server!.exitCode !== null) throw new Error(output); try { return (await fetch(base + '/api/health')).status; } catch { return 0; } }, (v) => v === 200, `server startup: ${output}`, 45_000);
  const anon = new Client(), admin = new Client(), editor = new Client(), author = new Client();
  for (const [role, client] of [['admin', admin], ['editor', editor], ['author', author]] as const) assert.equal((await client.login(role)).status, 200);
  await anon.request('/api/auth/me');
  await expect(anon, '/api/articles', 401);
  await expect(anon, '/api/faq', 401);
  await expect(anon, '/api/contact-messages', 401);
  await expect(author, '/api/faq', 403);
  await expect(author, '/api/contact-messages', 403);
  await expect(editor, '/api/settings', 403);
  await expect(admin, '/api/ads/SIDEBAR_TOP', 409, 'PUT', { enabled: true });
  await expect(admin, '/api/ads/SIDEBAR_MIDDLE', 409, 'PUT', { enabled: true });
  assert((await expect(admin, '/api/articles')).data.some((a: any) => a.id === articleId));
  pass('private article/FAQ/inbox APIs reject anonymous access; FAQ/inbox deny Author; settings deny Editor');

  for (const scheduledFor of [null, '', 'not-a-date', firstLocal, `${new Date().getFullYear() + 1}-02-30T08:00:00Z`, '2098-05-01T08:00:00Z', '2020-01-01T08:00:00Z']) await expect(editor, `/api/articles/${articleId}`, 400, 'PUT', { status: 'scheduled', scheduledFor });
  assert.equal((await prisma.article.findUniqueOrThrow({ where: { id: articleId } })).status, 'draft');
  pass('server rejects missing, invalid, ambiguous timezone and past scheduled dates without changing the article');
  const scheduledCreation = { title: `${prefix} API Scheduled`, slug: `${prefix}-api-scheduled`, sportSlug, authorId: byline.id, excerpt: 'Disposable creation fixture.', content: 'API schedule creation fixture.', status: 'scheduled', seo: {} };
  await expect(editor, '/api/articles', 400, 'POST', scheduledCreation);
  await expect(editor, '/api/articles', 400, 'POST', { ...scheduledCreation, scheduledFor: `${new Date().getFullYear() + 1}-02-30T09:00:00Z` });
  const apiCreated = await expect(editor, '/api/articles', 201, 'POST', { ...scheduledCreation, scheduledFor: `${firstLocal}:00+06:00` });
  apiArticleIds.add(apiCreated.data.id);
  assert.equal(apiCreated.data.status, 'scheduled');
  assert.equal(new Date(apiCreated.data.scheduledFor).toISOString(), asUtc(firstLocal));
  assert.equal((await anon.request(`/${sportSlug}/${scheduledCreation.slug}/`)).status, 404);
  await expect(admin, `/api/articles/${apiCreated.data.id}`, 200, 'DELETE');
  pass('scheduled POST creation requires a valid future timestamp; explicit ISO offset is stored as UTC and stays private');
  if (!originalFaq.some((f) => f.status === 'published')) {
    const emptyFaq = await expect(anon, '/faq/');
    assert(emptyFaq.text.includes('No questions have been published yet.'));
    assert(/<meta name="robots" content="noindex, follow"/.test(emptyFaq.text));
    assert(!emptyFaq.text.includes('"@type":"FAQPage"'));
    assert(!(await expect(anon, '/sitemaps/pages.xml')).text.includes('/faq/'));
    pass('empty public FAQ is a useful noindex page without FAQPage schema or sitemap entry');
  }

  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Dhaka' });
  await context.route(/fonts\.googleapis\.com|fonts\.gstatic\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await context.route(/google-analytics\.com|googletagmanager\.com|googlesyndication\.com/, (r) => r.abort());
  const page = await context.newPage(); const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await login(page, 'admin');
  await page.getByRole('button', { name: 'Articles', exact: true }).click();
  await page.getByPlaceholder('Title, text, slug or article ID…').fill(articleId);
  await row(page, `${prefix} Scheduled Story`).getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: '+ Add reference', exact: true }).click();
  await page.getByLabel('Title 1', { exact: true }).fill('Official tournament source');
  await page.getByLabel('Link 1', { exact: true }).fill('https://example.test/official-tournament');
  await page.getByLabel('Publishing state').selectOption('scheduled');
  await page.getByRole('button', { name: 'Schedule publication', exact: true }).click();
  await page.getByText('Choose the date and time this article should be published.', { exact: true }).waitFor();
  await page.locator('#article-scheduled-for').fill('2020-01-01T08:00');
  await page.getByRole('button', { name: 'Schedule publication', exact: true }).click();
  await page.getByText('The scheduled time must be in the future.', { exact: true }).waitFor();
  assert.equal(await page.locator('#article-title').inputValue(), `${prefix} Scheduled Story`);
  await page.locator('#article-scheduled-for').fill(firstLocal);
  assert.match(await page.locator('#article-scheduled-help').innerText(), /Asia\/Dhaka/);
  await page.getByRole('button', { name: 'Schedule publication', exact: true }).click();
  const scheduled = await until(() => prisma.article.findUniqueOrThrow({ where: { id: articleId } }), (a) => a.status === 'scheduled', 'article scheduled through editor');
  assert.equal(scheduled.scheduledFor?.toISOString(), asUtc(firstLocal));
  assert.deepEqual(scheduled.references, [{ title: 'Official tournament source', url: 'https://example.test/official-tournament' }]);
  await expect(editor, `/api/articles/${articleId}`, 400, 'PUT', { scheduledFor: null });
  assert.equal((await prisma.article.findUniqueOrThrow({ where: { id: articleId } })).scheduledFor?.toISOString(), asUtc(firstLocal));
  assert.equal((await anon.request(`/${sportSlug}/${articleId}/`)).status, 404);
  assert(!(await articleSitemapContains(anon, `/${sportSlug}/${articleId}/`)));
  await page.getByRole('button', { name: 'Save new schedule', exact: true }).waitFor();
  await page.locator('#article-scheduled-for').fill(secondLocal);
  await page.getByRole('button', { name: 'Save new schedule', exact: true }).click();
  await until(() => prisma.article.findUniqueOrThrow({ where: { id: articleId } }), (a) => a.scheduledFor?.toISOString() === asUtc(secondLocal), 'reschedule stored as UTC');
  await page.screenshot({ path: 'verification/phase-h/article-scheduled.png', fullPage: true });
  await page.getByRole('button', { name: 'Cancel schedule (keep as draft)', exact: true }).click();
  await until(() => prisma.article.findUniqueOrThrow({ where: { id: articleId } }), (a) => a.status === 'draft' && a.scheduledFor === null, 'cancel schedule');
  pass('article editor rejects missing/past dates, retains content, converts Asia/Dhaka to UTC, schedules/reschedules/cancels; private until release');
  await page.getByLabel('Publishing state').selectOption('scheduled');
  await page.locator('#article-scheduled-for').fill(secondLocal);
  await page.getByRole('button', { name: 'Schedule publication', exact: true }).click();
  await until(() => prisma.article.findUniqueOrThrow({ where: { id: articleId } }), (a) => a.status === 'scheduled', 'second schedule');
  const due = new Date(Date.now() - 1000);
  // Move only our fixture clock; the real server's 30s scheduler does the publication.
  await prisma.article.update({ where: { id: articleId }, data: { scheduledFor: due } });
  const published = await until(() => prisma.article.findUniqueOrThrow({ where: { id: articleId } }), (a) => a.status === 'published', 'real scheduler publication', 40_000);
  assert.equal(published.publishedAt.toISOString(), due.toISOString());
  assert((await expect(anon, `/${sportSlug}/${articleId}/`)).text.includes(`${prefix} Scheduled Story`));
  assert(await articleSitemapContains(anon, `/${sportSlug}/${articleId}/`));
  const articleHtml = (await expect(anon, `/${sportSlug}/${articleId}/`)).text;
  assert(articleHtml.includes('Official tournament source') && articleHtml.includes('https://example.test/official-tournament'));
  assert.equal(await prisma.auditLog.count({ where: { userId: 'system-scheduler', entityId: articleId } }), 1);
  pass('real scheduler publishes exactly once at scheduled timestamp; public article and sitemap become available');

  // PHASE R (v2.2): the site-wide /faq/ page is off by default; this suite switches it (and its FAQPage markup) on.
  await expect(admin, '/api/settings', 200, 'PUT', { globalFaqPage: 'enabled', globalFaqSchema: 'enabled' });
  await page.getByRole('button', { name: 'FAQ', exact: true }).click();
  await page.getByTestId('faq-context').selectOption('site');
  const q1 = `${prefix} First question?`, q2 = `${prefix} Second question?`, hiddenQuestion = `${prefix} Hidden question?`;
  async function createFaq(question: string, status: string) {
    await page.getByRole('button', { name: '+ New question', exact: true }).click();
    await page.locator('#faq-question').fill(question); await page.locator('#faq-answer').fill(`Answer for ${question}\n\nAnother paragraph.`);
    await page.locator('#faq-status').selectOption(status);
    await page.getByRole('button', { name: 'Create question', exact: true }).click();
    const saved = await until(() => prisma.faqEntry.findFirst({ where: { question } }), (v) => !!v, 'FAQ create');
    faqIds.add(saved!.id); return saved!;
  }
  const first = await createFaq(q1, 'published'), second = await createFaq(q2, 'published'), hidden = await createFaq(hiddenQuestion, 'draft');
  const faqItem = (question: string) => page.getByRole('list', { name: 'FAQ entries in display order' }).locator('li').filter({ has: page.getByText(question, { exact: true }) });
  await faqItem(q2).getByRole('button', { name: /Move .* up/ }).click();
  await until(async () => {
    const ordered = await prisma.faqEntry.findMany({ orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] });
    return ordered.findIndex((v) => v.id === second.id) < ordered.findIndex((v) => v.id === first.id);
  }, (v) => v, 'FAQ reorder');
  await faqItem(q1).getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('#faq-answer').fill('Edited FAQ answer, kept as plain text.');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await until(() => prisma.faqEntry.findUniqueOrThrow({ where: { id: first.id } }), (v) => v.answer.startsWith('Edited FAQ'), 'FAQ edit');
  const publicPage = await context.newPage();
  publicPage.on('pageerror', (e) => errors.push(e.message));
  await publicPage.goto(base + '/faq/');
  const summaries = (await publicPage.locator('details summary').allTextContents()).map((s) => s.trim());
  assert(summaries.includes(q1) && summaries.includes(q2));
  assert(summaries.indexOf(q2) < summaries.indexOf(q1));
  assert.equal(await publicPage.getByText(hiddenQuestion, { exact: true }).count(), 0);
  const detail = publicPage.locator(`details[id="${first.id}"]`);
  await detail.locator('summary').focus(); await publicPage.keyboard.press('Enter');
  assert(await detail.evaluate((el) => (el as HTMLDetailsElement).open));
  assert(await detail.getByText('Edited FAQ answer, kept as plain text.', { exact: true }).isVisible());
  await publicPage.keyboard.press('Space');
  assert(!(await detail.evaluate((el) => (el as HTMLDetailsElement).open)));
  const faqSchema = await publicPage.locator('script[type="application/ld+json"]').allTextContents();
  assert(faqSchema.some((s) => s.includes(q1) && s.includes(q2) && !s.includes(hiddenQuestion)));
  assert((await expect(anon, '/sitemaps/pages.xml')).text.includes('/faq/'));
  assert((await publicPage.locator('link[rel="canonical"]').getAttribute('href'))?.endsWith('/faq/'));
  await publicPage.setViewportSize({ width: 390, height: 844 }); assert(await overflow(publicPage));
  await publicPage.screenshot({ path: 'verification/phase-h/faq-mobile.png', fullPage: true });
  await publicPage.evaluate('localStorage.setItem("sportingspy_theme", "dark"); document.documentElement.classList.add("dark")');
  await publicPage.waitForTimeout(400);
  await publicPage.screenshot({ path: 'verification/phase-h/faq-mobile-dark.png', fullPage: true });
  await publicPage.evaluate('localStorage.setItem("sportingspy_theme", "light"); document.documentElement.classList.remove("dark")');
  await publicPage.waitForTimeout(400);
  await faqItem(q1).getByRole('button', { name: 'Unpublish', exact: true }).click();
  await until(() => prisma.faqEntry.findUniqueOrThrow({ where: { id: first.id } }), (v) => v.status === 'draft', 'FAQ unpublish');
  assert(!(await expect(anon, '/faq/')).text.includes(q1));
  await faqItem(q1).getByRole('button', { name: 'Publish', exact: true }).click();
  await until(() => prisma.faqEntry.findUniqueOrThrow({ where: { id: first.id } }), (v) => v.status === 'published', 'FAQ republish');
  await faqItem(q2).getByRole('button', { name: 'Archive', exact: true }).click();
  await until(() => prisma.faqEntry.findUniqueOrThrow({ where: { id: second.id } }), (v) => v.status === 'archived', 'FAQ archive');
  assert(!(await expect(anon, '/faq/')).text.includes(q2));
  // PHASE R (v2.2): Editors may delete FAQ entries (audited); Authors still cannot touch FAQ.
  await expect(author, `/api/faq/${hidden.id}`, 403, 'DELETE');
  page.once('dialog', (d) => d.accept()); await faqItem(hiddenQuestion).getByRole('button', { name: 'Delete', exact: true }).click();
  await until(() => prisma.faqEntry.findUnique({ where: { id: hidden.id } }), (v) => v === null, 'FAQ delete');
  await expect(editor, '/api/faq', 400, 'POST', { question: 'x', answer: 'y', status: 'published' });
  await expect(editor, `/api/faq/${first.id}`, 400, 'PUT', { displayOrder: -1 });
  await page.setViewportSize({ width: 390, height: 844 }); assert(await overflow(page));
  await page.screenshot({ path: 'verification/phase-h/faq-admin-mobile.png', fullPage: true }); await page.setViewportSize({ width: 1440, height: 1000 });
  pass('FAQ real admin CRUD, reorder, publish/unpublish/archive/delete; public ordering, hidden exclusion, matching schema, keyboard accordion and mobile layout');
  await page.getByRole('button', { name: 'Articles', exact: true }).click();
  await page.route('**/api/faq', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture FAQ loading failure.' }) }));
  await page.getByRole('button', { name: 'FAQ', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Fixture FAQ loading failure.' }).waitFor();
  await page.unroute('**/api/faq'); await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await faqItem(q1).waitFor();
  await faqItem(q1).getByRole('button', { name: 'Edit', exact: true }).click();
  await page.route(`**/api/faq/${first.id}`, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture FAQ saving failure.' }) }));
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Fixture FAQ saving failure.' }).waitFor();
  assert.equal(await page.locator('#faq-question').inputValue(), q1);
  await page.unroute(`**/api/faq/${first.id}`); await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  pass('FAQ load errors expose Retry; failed saves retain the editable form');

  await publicPage.goto(base + '/contact/');
  const contactEmail = `${prefix}@example.test`, subject = `${prefix} editorial correction`, message = `${prefix} Please review the tournament venue against the official source.`;
  await publicPage.getByLabel('Your name', { exact: true }).fill('Phase H visitor');
  await publicPage.getByLabel('Email address', { exact: true }).fill(contactEmail);
  await publicPage.getByLabel('Subject', { exact: true }).fill(subject); await publicPage.getByLabel('Message', { exact: true }).fill(message);
  await publicPage.route('**/api/contact', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
  await publicPage.getByRole('button', { name: 'Send message', exact: true }).click();
  await publicPage.getByRole('alert').filter({ hasText: 'Your message could not be saved.' }).waitFor();
  assert.equal(await publicPage.getByRole('heading', { name: 'Message received', exact: true }).count(), 0);
  assert.equal(await publicPage.getByLabel('Message', { exact: true }).inputValue(), message);
  assert.equal(await prisma.contactMessage.count({ where: { email: contactEmail } }), 0);
  await publicPage.unroute('**/api/contact');
  await publicPage.getByRole('button', { name: 'Send message', exact: true }).click();
  await publicPage.getByRole('heading', { name: 'Message received', exact: true }).waitFor();
  const savedMessage = await prisma.contactMessage.findFirstOrThrow({ where: { email: contactEmail } });
  assert.equal(savedMessage.message, message); assert.equal(savedMessage.status, 'open'); assert.equal(savedMessage.readAt, null);
  assert(await overflow(publicPage)); await publicPage.screenshot({ path: 'verification/phase-h/contact-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Contact Inbox', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(subject) }).click();
  await until(() => prisma.contactMessage.findUniqueOrThrow({ where: { id: savedMessage.id } }), (v) => !!v.readAt, 'inbox marks read');
  assert(await page.getByText(message, { exact: true }).isVisible());
  await page.getByRole('button', { name: 'Mark resolved', exact: true }).click();
  await until(() => prisma.contactMessage.findUniqueOrThrow({ where: { id: savedMessage.id } }), (v) => v.status === 'resolved', 'inbox resolve');
  await page.getByRole('button', { name: 'Reopen', exact: true }).click();
  await until(() => prisma.contactMessage.findUniqueOrThrow({ where: { id: savedMessage.id } }), (v) => v.status === 'open', 'inbox reopen');
  await page.getByRole('button', { name: 'Mark as spam', exact: true }).click();
  await until(() => prisma.contactMessage.findUniqueOrThrow({ where: { id: savedMessage.id } }), (v) => v.status === 'spam', 'inbox spam');
  await page.getByRole('button', { name: 'Mark unread', exact: true }).click();
  await until(() => prisma.contactMessage.findUniqueOrThrow({ where: { id: savedMessage.id } }), (v) => v.readAt === null, 'inbox unread');
  await expect(editor, `/api/contact-messages/${savedMessage.id}`, 403, 'DELETE');
  page.once('dialog', (d) => d.accept()); await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await until(() => prisma.contactMessage.findUnique({ where: { id: savedMessage.id } }), (v) => v === null, 'inbox delete');
  const contactBody = { name: 'Phase H visitor', email: contactEmail, subject, message };
  await expect(anon, '/api/contact', 400, 'POST', { ...contactBody, email: 'invalid-email' });
  await expect(anon, '/api/contact', 400, 'POST', { ...contactBody, status: 'resolved' });
  await expect(anon, '/api/contact', 400, 'POST', { ...contactBody, website: 'bot.test' });
  assert.equal(await prisma.contactMessage.count({ where: { email: contactEmail } }), 0);
  await expect(anon, '/api/contact', 400, 'POST', { ...contactBody, website: 'bot.test' });
  await expect(anon, '/api/contact', 429, 'POST', contactBody);
  pass('real contact submission persists before success; inbox read/unread/resolved/reopen/spam/delete; server validation, honeypot and rate limit');

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('form', { name: 'Site settings' });
  await settings.locator('[name="siteName"]').waitFor();
  const settingValues: Record<string, string> = { siteName: `Phase H ${prefix.slice(-8)}`, siteDescription: 'Independent sporting coverage for Phase H verification.', defaultOgImage: '/favicon.ico', twitterHandle: '@PhaseHTest', googleSiteVerification: 'PhaseHGoogleToken12345', bingSiteVerification: 'PhaseHBingToken12345' };
  for (const [key, value] of Object.entries(settingValues)) await settings.locator(`[name="${key}"]`).fill(value);
  await settings.getByRole('button', { name: 'Save changes', exact: true }).click();
  await settings.getByRole('status').filter({ hasText: 'Settings saved successfully.' }).waitFor();
  await page.reload(); await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await settings.locator('[name="siteName"]').waitFor();
  for (const [key, value] of Object.entries(settingValues)) assert.equal(await settings.locator(`[name="${key}"]`).inputValue(), value);
  await publicPage.goto(base + '/faq/');
  assert((await publicPage.title()).includes(settingValues.siteName));
  assert.equal(await publicPage.locator('meta[property="og:site_name"]').getAttribute('content'), settingValues.siteName);
  assert.equal(await publicPage.locator('meta[name="twitter:site"]').getAttribute('content'), settingValues.twitterHandle);
  assert((await publicPage.locator('meta[property="og:image"]').getAttribute('content'))?.endsWith('/favicon.ico'));
  assert.equal(await publicPage.locator('meta[name="google-site-verification"]').getAttribute('content'), settingValues.googleSiteVerification);
  assert.equal(await publicPage.locator('meta[name="msvalidate.01"]').getAttribute('content'), settingValues.bingSiteVerification);
  await publicPage.goto(base + '/');
  for (const selector of ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]']) assert.equal(await publicPage.locator(selector).getAttribute('content'), settingValues.siteDescription);
  pass('settings edited through real form survive reload and produce public title, Open Graph, Twitter and verification tags');

  await page.getByRole('button', { name: 'Events & Editions', exact: true }).click();
  await row(page, `${prefix} Event`).getByRole('button', { name: 'Edit', exact: true }).click();
  const manualSeo = { metaTitle: `${prefix} manual SEO title`, metaDescription: 'A manual description that must survive unrelated edits.', ogTitle: `${prefix} manual social title`, ogDescription: 'Manual share description.', ogImage: '/favicon.ico', keywords: ['phase h', 'manual'] };
  async function fillSeo(type: 'event' | 'edition') {
    for (const [suffix, value] of [['title', manualSeo.metaTitle], ['description', manualSeo.metaDescription], ['og-title', manualSeo.ogTitle], ['og-description', manualSeo.ogDescription], ['og-image', manualSeo.ogImage], ['keywords', manualSeo.keywords.join(', ')]]) await page.locator(`#${type}-seo-${suffix}`).fill(value);
  }
  await fillSeo('event'); await page.getByRole('button', { name: 'Save Updates', exact: true }).click();
  await until(() => prisma.sportEvent.findUniqueOrThrow({ where: { id: eventId } }), (v) => (v.seo as any).metaTitle === manualSeo.metaTitle, 'event manual SEO');
  await row(page, `${prefix} Event`).getByRole('button', { name: 'Edit', exact: true }).click();
  assert.equal(await page.locator('#event-seo-title').inputValue(), manualSeo.metaTitle);
  await page.getByPlaceholder('Permanent tournament identity and status...').fill('Updated event content with the same manual metadata.');
  await page.getByRole('button', { name: 'Save Updates', exact: true }).click();
  await until(() => prisma.sportEvent.findUniqueOrThrow({ where: { id: eventId } }), (v) => v.description.startsWith('Updated event'), 'unrelated event change');
  assert.deepEqual((await prisma.sportEvent.findUniqueOrThrow({ where: { id: eventId } })).seo, manualSeo);
  await page.getByRole('button', { name: /^Staged Editions/ }).click();
  await row(page, `${prefix} Edition`).getByRole('button', { name: 'Edit', exact: true }).click();
  await fillSeo('edition');
  await page.getByLabel('Qualification', { exact: true }).fill('Qualification through the official regional circuit.');
  await page.getByLabel('Participants', { exact: true }).fill('128');
  await page.getByRole('button', { name: '+ Add quick fact', exact: true }).click();
  await page.getByLabel('Label 1', { exact: true }).fill('Surface'); await page.getByLabel('Value 1', { exact: true }).fill('Red clay');
  await page.getByRole('button', { name: '+ Add champion', exact: true }).click();
  await page.getByLabel('Category 1', { exact: true }).fill('Singles'); await page.getByLabel('Champion 1', { exact: true }).fill('Phase H Champion');
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await until(() => prisma.eventEdition.findUniqueOrThrow({ where: { id: editionId } }), (v) => (v.seo as any).metaTitle === manualSeo.metaTitle, 'edition manual SEO');
  await row(page, `${prefix} Edition`).getByRole('button', { name: 'Edit', exact: true }).click();
  assert.equal(await page.locator('#edition-seo-title').inputValue(), manualSeo.metaTitle);
  assert.equal(await page.getByLabel('Qualification', { exact: true }).inputValue(), 'Qualification through the official regional circuit.');
  assert.equal(await page.getByLabel('Participants', { exact: true }).inputValue(), '128');
  assert.equal(await page.getByLabel('Value 1', { exact: true }).inputValue(), 'Red clay');
  assert.equal(await page.getByLabel('Champion 1', { exact: true }).inputValue(), 'Phase H Champion');
  await page.locator('#edition-description').fill('Updated edition description with manual metadata preserved.');
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await until(() => prisma.eventEdition.findUniqueOrThrow({ where: { id: editionId } }), (v) => v.description.startsWith('Updated edition'), 'unrelated edition change');
  assert.deepEqual((await prisma.eventEdition.findUniqueOrThrow({ where: { id: editionId } })).seo, manualSeo);
  const savedEdition = await prisma.eventEdition.findUniqueOrThrow({ where: { id: editionId } });
  assert.deepEqual(savedEdition.quickFacts, [{ label: 'Surface', value: 'Red clay' }]);
  assert.deepEqual(savedEdition.defendingChampions, [{ category: 'Singles', name: 'Phase H Champion' }]);
  assert.equal(savedEdition.participantsCount, 128);
  await expect(editor, `/api/editions/${editionId}`, 400, 'PUT', { participantsCount: -1 });
  await expect(editor, `/api/editions/${editionId}`, 400, 'PUT', { startDate: '2027-02-30' });
  for (const path of [`/${sportSlug}/${eventId}/`, `/${sportSlug}/${eventId}/2098/`]) {
    await publicPage.goto(base + path);
    assert.equal(await publicPage.title(), manualSeo.metaTitle);
    assert.equal(await publicPage.locator('meta[name="description"]').getAttribute('content'), manualSeo.metaDescription);
    assert.equal(await publicPage.locator('meta[property="og:title"]').getAttribute('content'), manualSeo.ogTitle);
  }
  assert(await publicPage.getByText('Red clay', { exact: true }).isVisible());
  assert(await publicPage.getByText('Phase H Champion', { exact: true }).isVisible());
  assert(await publicPage.getByText('Qualification through the official regional circuit.').isVisible());
  assert(await overflow(publicPage));
  await publicPage.screenshot({ path: 'verification/phase-h/edition-mobile.png', fullPage: true });
  pass('event and edition manual SEO/social metadata persists after real unrelated form edits and renders exactly as saved');

  await publicPage.goto(base + '/sports/');
  const emptyCard = publicPage.getByRole('link').filter({ has: publicPage.getByRole('heading', { name: `${prefix} Zero Event Sport`, exact: true }) });
  assert(await emptyCard.isVisible()); assert.match(await emptyCard.innerText(), /0 Events/);
  await publicPage.goto(`${base}/events/?sport=${emptySportId}`);
  assert.equal((await fetch(`${base}/events/?sport=${emptySportId}`)).status, 200);
  assert(await publicPage.getByRole('link', { name: `${prefix} Zero Event Sport`, exact: true }).isVisible());
  assert(await overflow(publicPage));
  await publicPage.screenshot({ path: 'verification/phase-h/events-empty-mobile.png', fullPage: true });
  assert.deepEqual(errors, [], 'No admin browser runtime errors.');
  pass('sports with zero events remain in sports directory and event filters; mobile layout fits');
  completed = true;
} finally {
  await browser?.close();
  if (server && server.exitCode === null) { const exited = once(server, 'exit'); server.kill(); await exited; }
  await prisma.article.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.article.deleteMany({ where: { id: { in: [...apiArticleIds] } } });
  // Creation IDs are server-generated; retain a UUID-slug fallback if the
  // create request succeeded but its response was interrupted.
  await prisma.article.deleteMany({ where: { slug: { startsWith: prefix } } });
  await prisma.eventEdition.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.sportEvent.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.sport.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.author.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.faqEntry.deleteMany({ where: { OR: [{ id: { in: [...faqIds] } }, { question: { startsWith: prefix } }] } });
  // Atomic ordering normalizes all entries; restore their exact initial order,
  // timestamps and actors so this suite never leaves editorial changes behind.
  for (const entry of originalFaq) await prisma.faqEntry.update({ where: { id: entry.id }, data: entry });
  await prisma.contactMessage.deleteMany({ where: { email: `${prefix}@example.test` } });
  await prisma.session.deleteMany({ where: { userId: { in: Object.values(ids) } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ userId: { in: Object.values(ids) } }, { entityId: { startsWith: prefix } }] } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
  // Restore exact timestamps/actors as well as values (including absent keys).
  await prisma.$transaction(async (tx) => {
    for (const key of touchedSettingKeys) {
      const original = originalSettings.find((entry) => entry.key === key);
      if (original) await tx.siteSetting.upsert({ where: { key }, create: original, update: original });
      else await tx.siteSetting.deleteMany({ where: { key } });
    }
  });
  assert.deepEqual(await snapshot(), before, 'Pre-existing database rows must remain unchanged.');
  pass('database integrity: all pre-existing rows and exact settings restored; fixtures removed');
  console.log(`PHASE H: ${checks} PASS, ${completed ? 0 : 1} FAIL`);
  await prisma.$disconnect();
}
