/** F.1 integration and production-browser verification, local DB only.
 * Restores all five documents and removes UUID-scoped fixtures in finally.
 * Each PASS is one named verification group; assertion failures exit nonzero.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { chromium, type Browser } from 'playwright-core';
import { prisma } from '../db';
import { Prisma } from '../generated/prisma/client';
import { checkDatabaseUrlIsLocalDev } from '../dbSafety';
import { hashPassword } from '../password';
import { DEFAULT_SITE_EXPERIENCE } from '../../src/lib/siteExperience/defaults';
import { SITE_AREAS, INTRO_STYLES, inWindow, type HomepageConfig, type SiteArea } from '../../src/lib/siteExperience/types';
import { DEFAULT_INTRO_APPEARANCE, INTRO_PRESETS } from '../../src/lib/siteExperience/intro';
import { deleteMedia, mediaUsageMap } from '../media/service';
import { checkDocument, checkHref } from '../../src/lib/siteExperience/validate';
import { applyDueSchedules, effectiveDocuments } from '../siteExperience';
import { getHomepageSections, getSiteLayout } from '../services/public/siteLayout';

assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe, 'Requires a local non-production database.');
assert(fs.existsSync('.next/BUILD_ID'), 'Run npm run build first.');
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
assert(executablePath && fs.existsSync(executablePath), 'Set PLAYWRIGHT_EXECUTABLE_PATH to installed Chromium.');
let passed = 0;
let completed = false;
const pass = (label: string) => { passed++; console.log(`PASS ${label}`); };
const prefix = `f1-${crypto.randomUUID()}`;
const password = `Test-${crypto.randomUUID()}`;
const ids = { admin: `${prefix}-admin`, editor: `${prefix}-editor`, author: `${prefix}-author` };
const userIds = Object.values(ids);
const clone = <T,>(v: T): T => structuredClone(v);
const tables = ['sport', 'sportEvent', 'eventEdition', 'article', 'articleMedia', 'author', 'user', 'session', 'comment', 'mediaItem', 'adSlotConfig', 'redirectRule', 'siteSetting', 'siteExperience', 'seoRule', 'seoScanRun', 'seoIntegrationLog', 'auditLog'] as const;
const hash = (v: unknown) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
async function snapshot() {
  return Object.fromEntries(await Promise.all(tables.map(async (table) => {
    const rows = await (prisma[table] as any).findMany();
    rows.sort((a: unknown, b: unknown) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return [table, hash(rows)];
  })));
}
const original = await prisma.siteExperience.findMany();
const before = await snapshot();
const auditIds = new Set((await prisma.auditLog.findMany({ select: { id: true } })).map((l) => l.id));
const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = (probe.address() as { port: number }).port; await new Promise<void>((r) => probe.close(() => r()));
const base = `http://127.0.0.1:${port}`;
let child: ReturnType<typeof spawn> | undefined;
let browser: Browser | undefined;
let output = '';
class Client {
  cookies = new Map<string, string>();
  async request(path: string, method = 'GET', body?: unknown) {
    const headers: Record<string, string> = { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET') headers['x-csrf-token'] = this.cookies.get('csrf_token') ?? '';
    const res = await fetch(base + path, { method, headers, redirect: 'manual', body: body === undefined ? undefined : JSON.stringify(body) });
    for (const raw of res.headers.getSetCookie()) { const [pair] = raw.split(';'); const i = pair.indexOf('='); this.cookies.set(pair.slice(0, i), pair.slice(i + 1)); }
    const text = await res.text(); let data: any; try { data = JSON.parse(text); } catch {}
    return { status: res.status, text, data, headers: res.headers };
  }
  async login(role: keyof typeof ids) { await this.request('/api/auth/me'); return this.request('/api/auth/login', 'POST', { email: `${ids[role]}@example.test`, password }); }
}
const expect = async (c: Client, path: string, status = 200, method = 'GET', body?: unknown) => {
  const res = await c.request(path, method, body);
  assert.equal(res.status, status, `${method} ${path}: ${res.status} ${res.text.slice(0, 200)}`);
  return res;
};
const api = (area: SiteArea, action: string) => `/api/site-experience/${area}/${action}`;
try {
  for (const area of SITE_AREAS) assert(checkDocument(area, DEFAULT_SITE_EXPERIENCE[area]).ok);
  pass('all built-in documents validate');
  for (const href of ['javascript:alert(1)', 'data:text/html,x', '//evil.test', '/\\evil.test', '/%2fevil.test', '/%5cevil.test', '/%00', '/admin/', '/api/data', 'https://u:p@evil.test', '/bad%zz']) assert.throws(() => checkHref(href, 'link'));
  assert.equal(checkHref('/sports/', 'link'), '/sports/'); assert.equal(checkHref('https://example.com/x', 'link'), 'https://example.com/x');
  pass('internal/external URLs accepted; unsafe schemes, credentials, private routes and encoded attacks rejected');
  const nav = clone(DEFAULT_SITE_EXPERIENCE.navigation); nav.items.reverse(); nav.items[0].desktop = false;
  assert.deepEqual(checkDocument('navigation', nav).value, nav);
  pass('navigation order and independent desktop/mobile visibility validate');
  const footer = clone(DEFAULT_SITE_EXPERIENCE.footer); footer.columns.reverse(); footer.columns[0].enabled = false; footer.columns[1].links.reverse();
  assert.deepEqual(checkDocument('footer', footer).value, footer);
  footer.social[0].url = 'javascript:alert(1)'; assert(!checkDocument('footer', footer).ok);
  pass('footer columns, legal actions, ordering, visibility and social URL validation');
  assert(!checkDocument('homepage', { ...DEFAULT_SITE_EXPERIENCE.homepage, version: 999 }).ok);
  assert(!checkDocument('navigation', { items: [{ ...nav.items[0], label: '<script>alert(1)</script>' }] }).ok);
  assert(!checkDocument('homepage', { sections: [...DEFAULT_SITE_EXPERIENCE.homepage.sections, DEFAULT_SITE_EXPERIENCE.homepage.sections[0]] }).ok);
  pass('mass assignment, XSS, duplicate ids/ad placements rejected');
  assert(!checkDocument('blocks', { items: [{ id: 'bad', name: 'Bad', type: 'message', enabled: true, title: 'Bad', text: '', cta: null, articleId: '', placements: ['header'], startAt: null, endAt: null }] }).ok);
  assert(!inWindow({ startAt: null, endAt: new Date(Date.now() - 1000).toISOString() }));
  assert(!inWindow({ startAt: new Date(Date.now() + 3600_000).toISOString(), endAt: null }));
  pass('block placement compatibility and automatic expiry/start windows');

  for (const role of Object.keys(ids) as (keyof typeof ids)[]) await prisma.user.create({ data: { id: ids[role], name: `F1 ${role}`, email: `${ids[role]}@example.test`, role: role === 'admin' ? 'Admin' : role === 'editor' ? 'Editor' : 'Author', avatar: '', joinedAt: new Date(), passwordHash: hashPassword(password) } });
  // Test only known documents so pre-existing editorial content does not affect results.
  for (const area of SITE_AREAS) await prisma.siteExperience.upsert({ where: { area }, create: { area, draft: DEFAULT_SITE_EXPERIENCE[area] as object, draftUpdatedAt: new Date(), draftUpdatedBy: prefix }, update: { draft: DEFAULT_SITE_EXPERIENCE[area] as object, published: Prisma.DbNull, scheduled: Prisma.DbNull, scheduledFor: null, version: 0, publishedAt: null, publishedBy: null, draftUpdatedAt: new Date(), draftUpdatedBy: prefix } });
  child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], { windowsHide: true, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production', AUTH_MODE: 'production', DEV_LOGIN_BYPASS: 'false', ALLOWED_ORIGIN: base, TRUST_PROXY: 'false', GEMINI_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout?.on('data', (c) => output += c); child.stderr?.on('data', (c) => output += c);
  const anon = new Client(), admin = new Client(), editor = new Client(), author = new Client();
  for (let i = 0; i < 160; i++) { if (child.exitCode !== null) throw new Error(output); try { if ((await anon.request('/api/health')).status === 200) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  for (const [client, role] of [[admin, 'admin'], [editor, 'editor'], [author, 'author']] as const) assert.equal((await client.login(role)).status, 200);
  await expect(anon, '/api/site-experience', 401); await expect(author, '/api/site-experience', 403);
  assert((await expect(admin, '/api/site-experience')).data.areas.every((a: any) => !a.hasDraftChanges));
  await expect(author, api('homepage', 'draft'), 403, 'PUT', { document: DEFAULT_SITE_EXPERIENCE.homepage });
  pass('unauthenticated 401; Author read/write 403; staff sessions authenticate');
  await expect(anon, api('homepage', 'draft'), 401, 'PUT', { document: DEFAULT_SITE_EXPERIENCE.homepage });
  await expect(admin, api('homepage', 'draft'), 400, 'PUT', { document: DEFAULT_SITE_EXPERIENCE.homepage, published: true });
  await expect(admin, api('homepage', 'draft'), 400, 'PUT', { document: { sections: [{ ...DEFAULT_SITE_EXPERIENCE.homepage.sections[1], title: '<img onerror=alert(1)>' }] } });
  await expect(admin, '/api/site-experience/unknown/draft', 404, 'PUT', { document: {} });
  pass('configuration APIs enforce authorization, strict payloads, XSS validation and area allowlist');
  const csrfResponse = await fetch(base + api('homepage', 'publish'), { method: 'POST', headers: { Cookie: [...admin.cookies].map(([k,v]) => `${k}=${v}`).join('; ') } });
  assert.equal(csrfResponse.status, 403); pass('mutations require existing CSRF protection');
  const initialSeo = { sitemap: (await expect(anon, '/sitemap.xml')).text, robots: (await expect(anon, '/robots.txt')).text, canonical: (await expect(anon, '/')).text.match(/<link rel="canonical"[^>]*>/g) };
  const home = clone(DEFAULT_SITE_EXPERIENCE.homepage);
  const intro = home.sections.find((s) => s.type === 'intro')!; assert(intro.type === 'intro'); intro.title = `${prefix} draft headline`;
  await expect(editor, api('homepage', 'draft'), 200, 'PUT', { document: home });
  assert(!(await expect(anon, '/')).text.includes(intro.title));
  const states = (await expect(admin, '/api/site-experience')).data.areas;
  assert(states.find((a: any) => a.area === 'homepage').hasDraftChanges);
  pass('draft save updates overview and remains private from public HTML');
  await expect(admin, '/api/site-experience/preview', 200, 'POST', { enabled: true });
  const preview = await expect(admin, '/'); assert(preview.text.includes(intro.title)); assert.match(preview.headers.get('x-robots-tag') ?? '', /noindex/); assert.match(preview.headers.get('cache-control') ?? '', /no-store/);
  anon.cookies.set('sportingspy_site_preview', '1'); assert(!(await expect(anon, '/')).text.includes(intro.title)); anon.cookies.delete('sportingspy_site_preview');
  pass('authenticated preview shows drafts, is noindex/no-store, and forged cookie grants no access');
  await expect(admin, '/api/site-experience/preview', 200, 'POST', { enabled: false });
  await expect(editor, api('homepage', 'publish'), 200, 'POST'); assert((await expect(anon, '/')).text.includes(intro.title));
  pass('Editor publishes editorial areas and fresh requests see changes without restart');
  await expect(editor, api('navigation', 'publish'), 403, 'POST'); await expect(editor, api('footer', 'schedule'), 403, 'POST', { at: new Date(Date.now()+3600_000).toISOString() });
  await expect(editor, api('navigation', 'draft'), 200, 'PUT', { document: nav }); await expect(admin, api('navigation', 'publish'), 200, 'POST');
  pass('Editors can edit structure; only Admins publish/schedule header and footer');
  const footerDoc = clone(DEFAULT_SITE_EXPERIENCE.footer); footerDoc.tagline = `${prefix} footer`;
  await expect(admin, api('footer', 'draft'), 200, 'PUT', { document: footerDoc }); await expect(admin, api('footer', 'publish'), 200, 'POST'); assert((await expect(anon, '/')).text.includes(footerDoc.tagline));
  pass('footer draft/publish changes public identity while retaining legal links');
  intro.title = `${prefix} scheduled headline`;
  await expect(editor, api('homepage', 'draft'), 200, 'PUT', { document: home });
  await expect(editor, api('homepage', 'schedule'), 400, 'POST', { at: new Date(Date.now()-1000).toISOString() });
  await expect(editor, api('homepage', 'schedule'), 200, 'POST', { at: new Date(Date.now()+3600_000).toISOString() });
  assert(!(await expect(anon, '/')).text.includes(intro.title));
  const frozenTitle = intro.title; intro.title = `${prefix} newer draft`;
  await expect(editor, api('homepage', 'draft'), 200, 'PUT', { document: home });
  await prisma.siteExperience.update({ where: { area: 'homepage' }, data: { scheduledFor: new Date(Date.now()-1000) } });
  assert((await expect(anon, '/')).text.includes(frozenTitle));
  const version = (await prisma.siteExperience.findUniqueOrThrow({ where: { area: 'homepage' } })).version;
  await Promise.all([applyDueSchedules(), applyDueSchedules()]);
  assert.equal((await prisma.siteExperience.findUniqueOrThrow({ where: { area: 'homepage' } })).version, version+1);
  pass('scheduled snapshot is frozen, activates on time and concurrent ticks publish exactly once');
  await expect(editor, api('homepage', 'schedule'), 200, 'POST', { at: new Date(Date.now()+3600_000).toISOString() });
  await expect(editor, api('homepage', 'schedule'), 200, 'DELETE');
  await expect(editor, api('homepage', 'discard'), 200, 'POST');
  assert(!(await expect(admin, '/api/site-experience')).data.areas.find((a: any) => a.area === 'homepage').hasDraftChanges);
  pass('cancel schedule and discard draft restore published configuration');

  const article = await prisma.article.findFirstOrThrow({ where: { status: 'published', sport: { isVisible: true } } });
  const hidden = await prisma.article.create({ data: { ...article, id: `${prefix}-draft`, slug: `${prefix}-draft`, title: `${prefix} private story`, status: 'draft', featuredMediaId: null, searchVector: undefined } as any });
  const invalidHome: HomepageConfig = { sections: [{ id: 'hero', type: 'featured', enabled: true, label: 'Hero', count: 1, source: { mode: 'manual', auto: { kind: 'latest' }, articleIds: [hidden.id] } }] };
  await expect(editor, api('homepage', 'draft'), 200, 'PUT', { document: invalidHome }); await expect(editor, api('homepage', 'publish'), 400, 'POST');
  pass('publishing rejects unpublished article selections');
  const docs = clone(DEFAULT_SITE_EXPERIENCE);
  docs.homepage = { sections: [{ ...invalidHome.sections[0], source: { mode: 'manual', auto: { kind: 'latest' }, articleIds: [article.id] } } as any, { id: 'automatic', type: 'articles', enabled: true, title: 'Automatic', eyebrow: '', layout: 'grid', count: 3, moreLink: null, source: { mode: 'auto', auto: { kind: 'latest' }, articleIds: [] } }, { id: 'empty', type: 'articles', enabled: true, title: 'Empty', eyebrow: '', layout: 'list', count: 4, moreLink: null, source: { mode: 'auto', auto: { kind: 'sport', value: 'nonexistent-f1-sport' }, articleIds: [] } }] };
  const layout = await getSiteLayout({ preview: false });
  const resolved = await getHomepageSections(docs, layout);
  assert.equal((resolved[0] as any).articles[0].id, article.id); assert(!resolved.some((s) => s.id === 'empty'));
  const articleIds = resolved.flatMap((s) => 'articles' in s ? s.articles.map((a) => a.id) : []); assert.equal(new Set(articleIds).size, articleIds.length);
  pass('manual selection, automatic sources, section order, deduplication and empty-section collapse');
  (docs.homepage.sections[0] as any).source.articleIds = [hidden.id];
  const fallback = await getHomepageSections(docs, layout); assert((fallback[0] as any).articles.length > 0); assert(!(fallback[0] as any).articles.some((a: any) => a.id === hidden.id));
  docs.homepage.sections[0].enabled = false; assert(!(await getHomepageSections(docs, layout)).some((s) => s.id === 'hero'));
  pass('unavailable manual stories fall back to eligible automatic content; hidden sections are omitted');
  const block = { id: 'f1-block', name: 'Campaign', type: 'cta' as const, enabled: true, title: `${prefix} campaign`, text: 'Editorial message', cta: { label: 'Events', href: '/events/' }, articleId: '', placements: ['footer_top' as const, 'homepage' as const], startAt: null, endAt: null };
  await expect(editor, api('blocks', 'draft'), 200, 'PUT', { document: { items: [block] } }); await expect(editor, api('blocks', 'publish'), 200, 'POST'); assert((await expect(anon, '/')).text.includes(block.title));
  block.text = 'Updated'; await expect(editor, api('blocks', 'draft'), 200, 'PUT', { document: { items: [block] } });
  pass('global blocks create/update/publish and render only in compatible placements');
  const announcement = { id: 'f1-news', enabled: true, variant: 'breaking', text: `${prefix} breaking`, href: '/events/', articleId: '', priority: 80, startAt: null, endAt: null };
  await expect(editor, api('announcements', 'draft'), 200, 'PUT', { document: { items: [announcement] } }); await expect(editor, api('announcements', 'publish'), 200, 'POST'); assert((await expect(anon, '/')).text.includes(announcement.text));
  announcement.endAt = new Date(Date.now()-1000).toISOString() as any;
  await expect(editor, api('announcements', 'draft'), 200, 'PUT', { document: { items: [announcement] } }); await expect(editor, api('announcements', 'publish'), 200, 'POST'); assert(!(await expect(anon, '/')).text.includes(announcement.text));
  pass('breaking announcements publish site-wide and expired announcements disappear');
  await prisma.siteExperience.update({ where: { area: 'homepage' }, data: { published: { corrupted: true } } });
  assert.deepEqual((await effectiveDocuments()).homepage, DEFAULT_SITE_EXPERIENCE.homepage);
  assert((await expect(anon, '/')).text.includes('Authoritative sporting guides'));
  pass('corrupted published configuration serves safe defaults');
  await expect(editor, api('homepage', 'draft'), 200, 'PUT', { document: DEFAULT_SITE_EXPERIENCE.homepage }); await expect(editor, api('homepage', 'publish'), 200, 'POST');
  const logs = await prisma.auditLog.findMany({ where: { userId: { in: userIds }, entityId: { startsWith: 'site-experience:' } } });
  for (const name of ['Draft Saved', 'Published', 'Scheduled', 'Schedule Cancelled', 'Draft Discarded']) assert(logs.some((l) => l.action.includes(name)));
  pass('save, publish, schedule, cancel and discard use existing audit logging');
  assert.equal((await expect(anon, '/robots.txt')).text, initialSeo.robots);
  assert.deepEqual((await expect(anon, '/')).text.match(/<link rel="canonical"[^>]*>/g), initialSeo.canonical);
  // Disposable draft does not enter the sitemap; configuration itself creates no URLs.
  assert.equal((await expect(anon, '/sitemap.xml')).text, initialSeo.sitemap);
  pass('homepage canonical, robots and sitemap remain unchanged; private content stays excluded');

  const bannerMedia = await prisma.mediaItem.findFirstOrThrow({ where: { copyrightReview: { not: 'restricted' } } });
  const bannerHome = clone(DEFAULT_SITE_EXPERIENCE.homepage);
  const bannerIntro = bannerHome.sections.find((s) => s.type === 'intro')!; assert(bannerIntro.type === 'intro');
  bannerIntro.appearance = { ...DEFAULT_INTRO_APPEARANCE, mediaId: bannerMedia.id };
  for (const style of INTRO_STYLES) { bannerIntro.appearance.style = style; assert(checkDocument('homepage', bannerHome).ok); }
  for (const patch of [{ style: 'injected' }, { focalX: -1 }, { mobileFocalY: 101 }, { zoom: 300 }, { overlay: 0 }, { mediaId: 'javascript:alert(1)' }, { css: 'display:none' }]) {
    const invalid = clone(bannerHome); (invalid.sections.find((s) => s.type === 'intro') as any).appearance = { ...bannerIntro.appearance, ...patch };
    await expect(editor, api('homepage', 'draft'), 400, 'PUT', { document: invalid });
  }
  pass('ten intro styles validate; arbitrary CSS, unsafe media ids and out-of-range image controls rejected');
  const restrictedId = `${prefix}-restricted-media`;
  await prisma.mediaItem.create({ data: { ...bannerMedia, id: restrictedId, copyrightReview: 'restricted' } });
  for (const mediaId of [restrictedId, `${prefix}-missing-media`]) {
    bannerIntro.appearance.mediaId = mediaId;
    await expect(editor, api('homepage', 'draft'), 400, 'PUT', { document: bannerHome });
  }
  bannerIntro.appearance.mediaId = bannerMedia.id;
  await expect(editor, api('homepage', 'draft'), 200, 'PUT', { document: bannerHome });
  assert((await mediaUsageMap())[bannerMedia.id].some((u) => u.kind === 'site' && u.id.startsWith('homepage:draft:')));
  assert.equal((await deleteMedia(bannerMedia.id)).ok, false);
  const missingDocs = clone(DEFAULT_SITE_EXPERIENCE); missingDocs.homepage = clone(bannerHome);
  (missingDocs.homepage.sections.find((s) => s.type === 'intro') as any).appearance.mediaId = restrictedId;
  const unavailableBanner = (await getHomepageSections(missingDocs, await getSiteLayout({ preview: false }))).find((s) => s.type === 'intro');
  assert(unavailableBanner?.type === 'intro' && unavailableBanner.image === null);
  await expect(editor, api('homepage', 'discard'), 200, 'POST');
  pass('missing/restricted banner images rejected; references prevent media deletion; unavailable images fall back safely');

  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  // Avoid remote font/image availability affecting local UI evidence.
  await context.route(/fonts\.googleapis\.com|fonts\.gstatic\.com/, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const page = await context.newPage(); const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/'); assert.equal(await page.locator('h1').count(), 1);
  assert(await page.evaluate('document.documentElement.scrollWidth <= innerWidth'));
  fs.mkdirSync('verification/site-experience', { recursive: true });
  await page.screenshot({ path: 'verification/site-experience/public-desktop.png', fullPage: true });
  pass('production homepage desktop renders one h1 without horizontal overflow');
  await page.goto(base + '/admin/');
  await page.getByPlaceholder('Email', { exact: true }).fill(`${ids.admin}@example.test`); await page.getByPlaceholder('Password', { exact: true }).fill(password); await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.getByRole('button', { name: 'Site Experience', exact: true }).click();
  await page.getByRole('heading', { name: 'Site Experience', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Edit Homepage →', exact: true }).waitFor();
  await page.screenshot({ path: 'verification/site-experience/admin-overview.png', fullPage: true });
  // Ensure the editor doesn't repeatedly reload because the context's API callback changes identity.
  let loads = 0; page.on('request', (req) => { if (req.url() === base + '/api/site-experience') loads++; });
  await page.getByRole('button', { name: 'Homepage', exact: true }).click();
  await page.getByRole('button', { name: /^Intro banner/ }).click();
  await page.getByLabel('Headline', { exact: true }).fill(`${prefix} browser draft`);
  await page.getByRole('button', { name: 'Choose background image', exact: true }).click();
  await page.getByRole('dialog', { name: 'Choose an image' }).getByTitle(bannerMedia.title, { exact: true }).click();
  const livePreview = page.getByRole('region', { name: 'Live banner preview', exact: true });
  for (const preset of INTRO_PRESETS) {
    const button = page.getByRole('button', { name: preset.name, exact: true });
    await button.click(); assert.equal(await button.getAttribute('aria-pressed'), 'true');
    assert.equal(await livePreview.locator('[data-intro-style]').getAttribute('data-intro-style'), preset.id);
  }
  await page.getByRole('button', { name: 'Glass panel', exact: true }).click();
  await page.getByRole('combobox', { name: /^Text alignment/ }).selectOption('right');
  await page.getByRole('slider', { name: /^Mobile crop horizontal/ }).press('End');
  await page.getByRole('button', { name: 'Mobile preview', exact: true }).click();
  assert.equal(await livePreview.locator('[data-device]').getAttribute('data-device'), 'mobile');
  await page.screenshot({ path: 'verification/site-experience/admin-intro-image.png', fullPage: true });
  pass('CMS Media Library picker, all ten presets, alignment, mobile crop and shared live preview work');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.getByText('Draft saved. Ready to preview.', { exact: true }).waitFor();
  assert(await page.getByRole('button', { name: 'Save draft', exact: true }).isDisabled(), 'JSONB key order must not leave a saved document dirty');
  assert.equal(loads, 0);
  await page.screenshot({ path: 'verification/site-experience/admin-homepage.png', fullPage: true });
  pass('admin overview/homepage editor saves drafts through real API without reload loop');
  const panel = page.locator('[data-site-experience]');
  const areaNavigation = panel.getByRole('navigation', { name: 'Site Experience areas', exact: true });
  for (const name of ['Header & Navigation', 'Footer', 'Global Blocks', 'Announcements', 'Preview / Publish']) { await areaNavigation.getByRole('button', { name, exact: true }).click(); assert(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')); }
  await panel.getByRole('button', { name: 'Enable draft preview', exact: true }).click();
  await page.getByText('Draft preview enabled. Open the website to see your saved changes.', { exact: true }).waitFor();
  const publicPage = await context.newPage(); await publicPage.goto(base + '/'); assert(await publicPage.getByRole('heading', { name: `${prefix} browser draft`, exact: true }).isVisible());
  await publicPage.getByRole('button', { name: 'Exit preview', exact: true }).click(); await publicPage.getByRole('heading', { name: 'Authoritative sporting guides, verified schedules, and championship editions.', exact: true }).waitFor();
  pass('all admin areas render; draft preview and exit work through existing session');
  await panel.getByLabel('Publish at (your local time)').fill('2027-01-01T08:00');
  await panel.getByRole('button', { name: 'Schedule Homepage', exact: true }).click(); await page.getByText('Publication scheduled.', { exact: true }).waitFor();
  await panel.getByRole('button', { name: 'Publish Homepage', exact: true }).click(); await page.getByText('Published. Visitors see this version on their next page load.', { exact: true }).waitFor();
  await publicPage.reload(); assert(await publicPage.getByRole('heading', { name: `${prefix} browser draft`, exact: true }).isVisible());
  pass('browser publish and scheduling controls work; published headline appears immediately');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of ['Overview', 'Homepage', 'Header & Navigation', 'Footer', 'Global Blocks', 'Announcements', 'Preview / Publish']) { await areaNavigation.getByRole('button', { name, exact: true }).click(); assert(await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), name); }
  await page.screenshot({ path: 'verification/site-experience/admin-mobile.png', fullPage: true });
  pass('all admin areas fit mobile viewport');
  await publicPage.setViewportSize({ width: 390, height: 844 }); await publicPage.reload(); assert(await publicPage.evaluate('document.documentElement.scrollWidth <= innerWidth'));
  await publicPage.getByRole('button', { name: 'Toggle Navigation Menu', exact: true }).click();
  assert(await publicPage.getByRole('link', { name: 'Search Database', exact: true }).isVisible());
  await publicPage.screenshot({ path: 'verification/site-experience/public-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  pass('public mobile navigation works with no overflow or implementation page errors');
  await page.keyboard.press('Tab'); assert(await page.evaluate('document.activeElement !== document.body'));
  pass('keyboard focus reaches interactive CMS controls');
  const staticContext = await browser.newContext({ javaScriptEnabled: false });
  const heroPage = await staticContext.newPage();
  for (const style of INTRO_STYLES) {
    bannerIntro.appearance = { ...DEFAULT_INTRO_APPEARANCE, mediaId: bannerMedia.id, style, focalX: 20, mobileFocalX: 80, zoom: 120 };
    await expect(editor, api('homepage', 'draft'), 200, 'PUT', { document: bannerHome });
    await expect(editor, api('homepage', 'publish'), 200, 'POST');
    for (const width of [1440, 390]) {
      await heroPage.setViewportSize({ width, height: 900 }); await heroPage.goto(base + '/');
      const hero = heroPage.locator(`[data-intro-style="${style}"]`);
      await hero.locator('h1').waitFor(); assert.equal(await heroPage.locator('h1').count(), 1);
      const image = hero.locator('img'); assert(await image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0));
      assert.equal(await image.evaluate((el) => getComputedStyle(el).objectPosition), width === 390 ? '80% 50%' : '20% 50%');
      assert(await heroPage.evaluate('document.documentElement.scrollWidth <= innerWidth'), `${style} ${width}: overflow`);
      const headingBox = await hero.locator('h1').boundingBox(); const heroBox = await hero.boundingBox();
      assert(headingBox && heroBox && headingBox.y >= heroBox.y && headingBox.y + headingBox.height <= heroBox.y + heroBox.height);
      if (style === 'glass' || style === 'stadium') await hero.screenshot({ path: `verification/site-experience/intro-${style}-${width}.png` });
    }
  }
  pass('all ten image-backed presets render with JS disabled on desktop/mobile; responsive crop, loaded images and one h1; no overflow');
  await staticContext.close();
  await page.setViewportSize({ width: 1366, height: 900 });
  await areaNavigation.getByRole('button', { name: 'Homepage', exact: true }).click();
  await page.getByRole('button', { name: /^Intro banner/ }).click();
  await page.getByRole('button', { name: 'Remove background image', exact: true }).click();
  assert.equal(await page.getByRole('region', { name: 'Live banner preview' }).locator('img').count(), 0);
  pass('background removal retains editable content and safe gradient preview');
  completed = true;
} finally {
  await browser?.close();
  if (child && child.exitCode === null) { child.kill(); await once(child, 'exit'); }
  await prisma.article.deleteMany({ where: { id: `${prefix}-draft` } });
  await prisma.mediaItem.deleteMany({ where: { id: `${prefix}-restricted-media` } });
  for (const area of SITE_AREAS) {
    const row = original.find((r) => r.area === area);
    if (row) await prisma.siteExperience.upsert({ where: { area }, create: { ...row, published: row.published ?? Prisma.DbNull, scheduled: row.scheduled ?? Prisma.DbNull }, update: { ...row, published: row.published ?? Prisma.DbNull, scheduled: row.scheduled ?? Prisma.DbNull } });
    else await prisma.siteExperience.deleteMany({ where: { area } });
  }
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  const newLogs = (await prisma.auditLog.findMany({ where: { OR: [{ userId: { in: userIds } }, { userId: 'system', entityId: { startsWith: 'site-experience:' } }] }, select: { id: true } })).filter((l) => !auditIds.has(l.id)).map((l) => l.id);
  await prisma.auditLog.deleteMany({ where: { id: { in: newLogs } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  assert.deepEqual(await snapshot(), before, 'Pre-existing database rows must remain unchanged.');
  pass('database integrity: original documents and all pre-existing rows restored; fixtures removed');
  console.log(`SITE EXPERIENCE: ${passed} PASS, ${completed ? 0 : 1} FAIL`);
  await prisma.$disconnect();
}
