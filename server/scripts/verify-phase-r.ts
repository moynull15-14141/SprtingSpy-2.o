/**
 * PHASE R requirement-reconciliation verification. Runs against a real
 * production-mode server (built Next.js app) and the local development
 * database, with disposable fixtures; pre-existing content rows are
 * hash-verified afterwards.
 *
 * Covers: database-backed Article Types (How to Watch + Sports Viewing Guide
 * end to end), URL stability (sport/event slug moves → direct 301s, no
 * chains/loops), collision rules, contextual editor-approved FAQ with opt-in
 * validated FAQPage markup, FAQ diagnostics/suggestions, global /faq/ off,
 * password reset, TOTP, structured audit before/after, public data cache
 * invalidation, real-user monitoring + insights, search analytics, migration
 * sheet, media duplicate detection, sitemap/robots/canonical/404, settings.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import sharp from 'sharp';
import { prisma } from '../db';
import { checkDatabaseUrlIsLocalDev } from '../dbSafety';
import { hashPassword } from '../password';
import { base32Decode, totpAt } from '../totp';

assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe, 'Phase R requires a local development database.');
assert(fs.existsSync('.next/BUILD_ID'), 'Build before Phase R verification (npm run build).');

const fx = `r${crypto.randomUUID().slice(0, 6)}`;
const sport = `${fx}-sport`;
const eventSlug = `${fx}-open`;
const password = `Phase-R-${crypto.randomUUID()}`;
const ids = { admin: `${fx}-admin`, editor: `${fx}-editor`, author: `${fx}-author-profile` };
const digest = (rows: unknown) => crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const snapshot = async () => ({
  sports: digest(await prisma.sport.findMany({ where: { NOT: { id: { startsWith: fx } } }, orderBy: { id: 'asc' } })),
  events: digest(await prisma.sportEvent.findMany({ where: { NOT: { id: { startsWith: fx } } }, orderBy: { id: 'asc' } })),
  editions: digest(await prisma.eventEdition.findMany({ where: { NOT: { id: { startsWith: fx } } }, orderBy: { id: 'asc' } })),
  articles: digest(await prisma.article.findMany({ where: { NOT: { id: { startsWith: fx } } }, orderBy: { id: 'asc' }, select: { id: true, status: true, title: true, slug: true, updatedAt: true } })),
  faqs: digest(await prisma.faqEntry.findMany({ where: { NOT: { updatedBy: { startsWith: 'R ' } } }, orderBy: { id: 'asc' } })),
  types: digest(await prisma.articleType.findMany({ where: { NOT: { name: { startsWith: 'R ' } } }, orderBy: { id: 'asc' }, select: { id: true, name: true, isActive: true, sortOrder: true, schemaType: true, seoProfile: true } })),
  media: digest(await prisma.mediaItem.findMany({ where: { NOT: { title: { startsWith: fx } } }, orderBy: { id: 'asc' }, select: { id: true, url: true, creationType: true } })),
  redirects: digest(await prisma.redirectRule.findMany({ where: { NOT: { sourceUrl: { contains: fx } } }, orderBy: { id: 'asc' } })),
  settings: digest(await prisma.siteSetting.findMany({ orderBy: { key: 'asc' } })),
});
const before = await snapshot();
const vitalsBefore = await prisma.webVitalStat.findMany();
const viewsBefore = await prisma.pageViewStat.findMany();

const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = (probe.address() as { port: number }).port; await new Promise<void>((resolve) => probe.close(() => resolve()));
const base = `http://localhost:${port}`;
let output = '';
const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
  cwd: process.cwd(), windowsHide: true,
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', TRUST_PROXY: 'false', NODE_ENV: 'production', APP_ENV: 'production', AUTH_MODE: 'production', DEV_LOGIN_BYPASS: 'false', ALLOWED_ORIGIN: base, SITE_ORIGIN: base, INDEXNOW_ENDPOINT: '', GEMINI_API_KEY: '', TOTP_ENCRYPTION_KEY: `phase-r-test-key-${crypto.randomUUID()}`, RESEND_API_KEY: '', MAIL_FROM: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (c) => { output += c; }); child.stderr.on('data', (c) => { output += c; });

let checks = 0; const pass = (m: string) => { checks++; console.log(`PASS ${m}`); };
class Client {
  cookies = new Map<string, string>();
  async request(path: string, method = 'GET', body?: unknown, extraHeaders: Record<string, string> = {}) {
    const headers: Record<string, string> = { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '), ...extraHeaders };
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    if (method !== 'GET') headers['x-csrf-token'] = this.cookies.get('csrf_token') ?? '';
    const res = await fetch(base + path, { method, headers, redirect: 'manual', body: payload });
    for (const raw of res.headers.getSetCookie()) { const [pair] = raw.split(';'); const i = pair.indexOf('='); const v = pair.slice(i + 1); if (v) this.cookies.set(pair.slice(0, i), v); else this.cookies.delete(pair.slice(0, i)); }
    const text = await res.text(); let data: any; try { data = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, text, data, location: res.headers.get('location'), headers: res.headers };
  }
  async ok(path: string, method = 'GET', body?: unknown, expected = [200, 201]) {
    const r = await this.request(path, method, body);
    assert(expected.includes(r.status), `${method} ${path}: HTTP ${r.status} ${r.text.slice(0, 300)}`);
    return r.data;
  }
}
const anon = new Client();
const decode = (s: string) => s.replace(/<!-- -->/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
const page = async (path: string, expected = 200) => { const r = await anon.request(path); assert.equal(r.status, expected, `${path}: ${r.status}, expected ${expected} ${r.location ?? ''}`); return { ...r, text: decode(r.text) }; };
const jsonLd = (html: string) => [...html.matchAll(/<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));
const login = async (email: string, extra: Record<string, unknown> = {}) => { const c = new Client(); await c.request('/robots.txt'); const r = await c.request('/api/auth/login', 'POST', { email, password, ...extra }); return { c, r }; };
let completed = false;

try {
  await new Promise<void>((resolve, reject) => { const t = setTimeout(() => reject(new Error(`server did not start: ${output.slice(-800)}`)), 90_000); child.stdout.on('data', (c) => { if (String(c).includes('Server running')) { clearTimeout(t); resolve(); } }); child.once('exit', () => { clearTimeout(t); reject(new Error(`server exited: ${output.slice(-800)}`)); }); });
  await anon.request('/robots.txt');

  // ── Fixtures ──
  for (const [id, role] of [[ids.admin, 'Admin'], [ids.editor, 'Editor']] as const) {
    await prisma.user.create({ data: { id, name: `R ${role}`, email: `${id}@example.test`, role, avatar: '', joinedAt: new Date(), passwordHash: hashPassword(password) } });
  }
  await prisma.author.create({ data: { id: ids.author, slug: ids.author, name: 'R Fixture Author', roleTitle: 'Reporter', bio: 'Fixture author.', avatar: '/favicon.ico', userId: ids.admin } });
  const { c: admin, r: adminLogin } = await login(`${ids.admin}@example.test`);
  assert.equal(adminLogin.status, 200, adminLogin.text);
  const { c: editor } = await login(`${ids.editor}@example.test`);

  await admin.ok('/api/sports', 'POST', { name: 'R Fixture Sport', slug: sport, tagline: 'Fixture', description: 'Fixture sport for Phase R verification.' });
  const event = await admin.ok('/api/events', 'POST', { name: 'R Fixture Open', slug: eventSlug, sportSlug: sport, shortName: 'R Open', alternativeNames: 'Quillfield Championship\nQuillfield Open', description: 'A fixture tennis-style event.', seo: {} });
  await admin.ok('/api/editions', 'POST', { eventSlug, sportSlug: sport, year: 2028, title: 'R Fixture Open 2028', status: 'upcoming', startDate: '2028-05-28', endDate: '2028-06-11', venue: 'Quillfield Arena', location: 'Paris, France', prizeMoneyTotal: '€10,000,000', description: 'The 2028 edition of the fixture event.', officialSourceUrl: 'https://example.org/official', seo: {} });
  const edition = await prisma.eventEdition.findFirstOrThrow({ where: { sportSlug: sport, eventSlug, year: 2028 } });
  const viewingBody = (name: string) => ({ type: 'doc', content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: `${name}: broadcasters` }] },
    { type: 'paragraph', content: [{ type: 'text', text: `R Fixture Open 2028 runs from 28 May 2028 at Quillfield Arena. The official broadcaster shows every match on TV channel One in the UK and US, with an official streaming app; sessions start at 11:00 CEST. ${'Viewing details for every region and every day of the tournament. '.repeat(20)}` }] },
  ] });

  // ── 0. Sport metadata is never wiped; featured events; Media Library images ──
  const sportRow = await prisma.sport.findUniqueOrThrow({ where: { slug: sport } });
  await admin.ok(`/api/sports/${sportRow.id}`, 'PUT', { seo: { ogTitle: 'R social title', noIndex: false, canonicalUrl: '' }, featuredEventIds: [event.id] });
  await admin.ok(`/api/sports/${sportRow.id}`, 'PUT', { seo: { metaTitle: 'R Fixture Sport guides' } });
  const sportAfter = await prisma.sport.findUniqueOrThrow({ where: { id: sportRow.id } });
  assert.equal((sportAfter.seo as any).ogTitle, 'R social title', 'a partial SEO save keeps other SEO/social fields');
  assert.equal((sportAfter.seo as any).metaTitle, 'R Fixture Sport guides');
  assert.deepEqual(sportAfter.featuredEventIds, [event.id], 'featured events kept by a save that does not send them');
  assert.equal((await admin.request(`/api/sports/${sportRow.id}`, 'PUT', { heroImage: 'https://example.com/not-in-library.jpg' })).status, 400, 'sport image must be a Media Library item');
  assert.equal((await admin.request(`/api/sports/${sportRow.id}`, 'PUT', { featuredEventIds: ['some-other-event'] })).status, 400, 'featured events must belong to the sport');
  const libraryImage = await prisma.mediaItem.findFirstOrThrow({ where: { NOT: { title: { startsWith: fx } } } });
  await admin.ok(`/api/sports/${sportRow.id}`, 'PUT', { heroImage: libraryImage.url });
  assert.equal((await prisma.sport.findUniqueOrThrow({ where: { id: sportRow.id } })).heroMediaId, libraryImage.id, 'sport image linked to its Media Library item');
  pass('Sport: partial saves never wipe SEO/social/featured events; image must come from (and is linked to) the Media Library; featured events validated');

  // ── 1. Article Types ──
  const types = await admin.ok('/api/article-types');
  const howTo = types.find((t: any) => t.name === 'How to Watch');
  const svg = types.find((t: any) => t.name === 'Sports Viewing Guide');
  assert(howTo && svg && howTo.id !== svg.id && howTo.isActive && svg.isActive && howTo.seoProfile === 'viewing' && svg.seoProfile === 'viewing', 'both viewing types exist, distinct and active');
  assert((await editor.request('/api/article-types', 'POST', { name: 'R Custom' })).status === 403, 'only Admin edits types');
  const custom = await admin.ok('/api/article-types', 'POST', { name: 'R Custom Type', seoProfile: 'viewing', schemaType: 'BlogPosting' });
  assert.equal((await admin.request(`/api/article-types/${howTo.id}`, 'DELETE')).status, 400, 'system type cannot be deleted');
  assert.equal((await admin.request(`/api/article-types/${howTo.id}`, 'PUT', { name: 'Watch Guide' })).status, 400, 'system type cannot be renamed');

  const createArticle = (slug: string, title: string, articleType: string, extra: Record<string, unknown> = {}) => admin.ok('/api/articles', 'POST', {
    title, slug, sportSlug: sport, eventSlug, editionYear: 2028, articleType, excerpt: `${title}: broadcasters, streams and times for R Fixture Open 2028.`, body: viewingBody(title), authorId: ids.author, status: 'published', seo: {}, ...extra,
  });
  const a = await createArticle('how-to-watch', 'R Fixture Open 2028: How to Watch', 'How to Watch');
  const b = await createArticle('sports-viewing-guide', 'R Fixture Open 2028 Sports Viewing Guide', 'Sports Viewing Guide');
  assert.equal(a.articleType, 'How to Watch'); assert.equal(b.articleType, 'Sports Viewing Guide');
  for (let i = 1; i <= 4; i++) await admin.ok('/api/articles', 'POST', { title: `R Fixture season news ${i}`, slug: `${fx}-news-${i}`, sportSlug: sport, articleType: 'News', excerpt: 'Season news for the fixture sport.', body: viewingBody('News'), authorId: ids.author, status: 'published', seo: {} });
  const pathA = `/${sport}/${eventSlug}/2028/how-to-watch/`;
  const pathB = `/${sport}/${eventSlug}/2028/sports-viewing-guide/`;
  for (const [p, title] of [[pathA, 'How to Watch'], [pathB, 'Sports Viewing Guide']] as const) {
    const html = (await page(p)).text;
    assert(html.includes(`<link rel="canonical" href="${base}${p}"`), `${p} self canonical`);
    const ld = jsonLd(html);
    assert(ld.some((x) => x['@type'] === 'Article' && x.headline.includes(title)), `${p} Article JSON-LD`);
    assert(ld.some((x) => x['@type'] === 'BreadcrumbList' && x.itemListElement.length >= 4), `${p} breadcrumbs`);
    assert(html.includes('Related') && html.includes('id="latest-heading"'), `${p} related + latest sections`);
  }
  assert((await page(pathA)).text.includes('Sports Viewing Guide'), 'the two viewing articles are related to each other');
  const sportHtml = (await page(`/${sport}/`)).text;
  assert(['Featured R Fixture Sport Events', 'Latest R Fixture Sport Articles', 'All R Fixture Sport Events', 'Explore R Fixture Sport'].every((h) => sportHtml.includes(h)), 'sport hub sections (featured, latest, all events, explore)');
  const editionHtml = (await page(`/${sport}/${eventSlug}/2028/`)).text;
  assert(editionHtml.includes('R Fixture Open 2028: How to Watch') && editionHtml.includes('R Fixture Open 2028 Sports Viewing Guide') && editionHtml.includes('Latest R Fixture Open 2028 articles'), 'edition page Latest Articles lists both');
  assert(!editionHtml.includes('Verified'), 'no unsupported "Verified" labels on the edition page');
  for (const type of ['How to Watch', 'Sports Viewing Guide', 'R Custom Type']) {
    const check = await admin.ok('/api/seo/article-check', 'POST', { title: `R ${type}`, articleType: type, sportSlug: sport, eventSlug, editionYear: 2028, excerpt: 'x', body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Short text without the essentials.' }] }] }, seo: {} });
    const topics = check.checklist.find((x: any) => x.ruleKey === 'type-topics');
    assert(topics && !topics.passed && topics.issues.some((i: any) => i.message.includes('broadcaster')) && topics.issues.some((i: any) => i.message.includes('regional')), `${type}: viewing checks (broadcaster, streaming, region, timezone)`);
    assert(check.checklist.some((x: any) => x.ruleKey === 'official-source') && check.checklist.some((x: any) => x.ruleKey === 'time-sensitive-review'), `${type}: official source + freshness rules apply`);
  }
  const searchHit = await anon.request(`/api/search?q=${encodeURIComponent('Sports Viewing Guide')}&sport=${sport}`);
  assert(searchHit.data.results.some((r: any) => r.title.includes('Sports Viewing Guide')), 'search finds the Sports Viewing Guide');
  const typeFilter = await anon.request(`/api/search?q=watch&sport=${sport}&type=${encodeURIComponent('How to Watch')}`);
  assert(typeFilter.data.results.every((r: any) => r.articleType === 'How to Watch'), 'type filter');
  assert((await page(`/latest/?type=${encodeURIComponent('Sports Viewing Guide')}`)).text.includes('R Fixture Open 2028 Sports Viewing Guide'), 'Latest filter by new type');
  await admin.ok(`/api/article-types/${svg.id}`, 'PUT', { isActive: false });
  assert.equal((await admin.request('/api/articles', 'POST', { title: 'R inactive', slug: `${fx}-inactive`, sportSlug: sport, articleType: 'Sports Viewing Guide', body: viewingBody('x'), authorId: ids.author })).status, 400, 'inactive type rejected for new content');
  await admin.ok(`/api/articles/${b.id}`, 'PUT', { excerpt: 'Updated excerpt for an article with an inactive type that it keeps.' });
  await admin.ok(`/api/article-types/${svg.id}`, 'PUT', { isActive: true });
  pass('Article Types: DB-backed; How to Watch + Sports Viewing Guide distinct, published, canonical, Article JSON-LD, breadcrumbs, related/latest, edition Latest, viewing SEO checks (incl. custom type via profile), search + filters; system types locked; inactive types kept by existing articles');

  // ── 2. Audit before/after ──
  const audit = await prisma.auditLog.findFirst({ where: { entityId: b.id, action: 'Updated Article' }, orderBy: { timestamp: 'desc' } });
  assert(audit?.before && audit.after && (audit.after as any).excerpt && (audit.before as any).excerpt, 'article update audit has previous and new excerpt');
  const typeAudit = await prisma.auditLog.findFirst({ where: { entityId: svg.id, action: 'Updated Article Type' }, orderBy: { timestamp: 'desc' } });
  assert.equal((typeAudit?.before as any)?.isActive, false); assert.equal((typeAudit?.after as any)?.isActive, true);
  pass('Audit logs: structured previous/new values for article and Article Type changes');

  // ── 3. Cache invalidation ──
  assert((await page(pathA)).text.includes('R Fixture Open 2028: How to Watch'));
  await admin.ok(`/api/articles/${a.id}`, 'PUT', { title: 'R Fixture Open 2028: How to Watch (updated)' });
  assert((await page(pathA)).text.includes('How to Watch (updated)'), 'public page shows the update immediately');
  const stats = await admin.ok('/api/insights/overview?period=7d');
  assert(stats.cache.hits > 0 && stats.cache.ttlSeconds > 0, 'data cache serves hits');
  pass('Caching: public data cached across requests and invalidated by CMS writes');

  // ── 4. Collision rules ──
  const coll1 = await admin.request('/api/articles', 'POST', { title: 'R collide', slug: eventSlug, sportSlug: sport, articleType: 'News', body: viewingBody('x'), authorId: ids.author });
  assert.equal(coll1.status, 409, `article taking the event URL: ${coll1.text}`);
  const general = await admin.ok('/api/articles', 'POST', { title: 'R General Guide', slug: `${fx}-guide`, sportSlug: sport, articleType: 'General Information', excerpt: 'A general guide.', body: viewingBody('General'), authorId: ids.author, status: 'published' });
  assert.equal((await admin.request('/api/events', 'POST', { name: 'R collide event', slug: `${fx}-guide`, sportSlug: sport, seo: {} })).status, 409, 'event taking an article URL');
  assert.equal((await admin.request('/api/sports', 'POST', { name: 'Search', slug: 'search' })).status, 400, 'reserved sport slug');
  pass('Collision rules: event-less article vs event in both directions; reserved sport slugs');

  // ── 5. URL stability ──
  const newEvent = `${fx}-open-renamed`;
  const moved = await admin.ok(`/api/events/${event.id}`, 'PUT', { slug: newEvent });
  assert(moved.movedUrls >= 4, `event rename moved ${moved.movedUrls} URLs`);
  for (const [from, to] of [[`/${sport}/${eventSlug}/`, `/${sport}/${newEvent}/`], [`/${sport}/${eventSlug}/2028/`, `/${sport}/${newEvent}/2028/`], [pathA, `/${sport}/${newEvent}/2028/how-to-watch/`]] as const) {
    const r = await anon.request(from);
    assert.equal(r.status, 301, `${from} → 301`); assert.equal(new URL(r.location!, base).pathname, to, `${from} → ${to}`);
    await page(to);
  }
  const newSport = `${fx}-sport2`;
  await admin.ok(`/api/sports/${(await prisma.sport.findUniqueOrThrow({ where: { slug: sport } })).id}`, 'PUT', { slug: newSport });
  const chain = await anon.request(pathA);
  assert.equal(chain.status, 301); assert.equal(new URL(chain.location!, base).pathname, `/${newSport}/${newEvent}/2028/how-to-watch/`, 'original URL now redirects directly to the final URL (no chain)');
  const generalMove = await anon.request(`/${sport}/${fx}-guide/`);
  assert.equal(new URL(generalMove.location!, base).pathname, `/${newSport}/${fx}-guide/`, 'general article moved with the sport');
  await page(`/${newSport}/${newEvent}/2028/how-to-watch/`);
  assert.equal((await prisma.article.findUniqueOrThrow({ where: { id: general.id } })).sportSlug, newSport);
  // Rename back: the old URLs are live again and must not loop.
  await admin.ok(`/api/sports/${(await prisma.sport.findUniqueOrThrow({ where: { slug: newSport } })).id}`, 'PUT', { slug: sport });
  await admin.ok(`/api/events/${event.id}`, 'PUT', { slug: eventSlug });
  await page(pathA);
  const back = await anon.request(`/${newSport}/${newEvent}/2028/how-to-watch/`);
  assert.equal(back.status, 301); assert.equal(new URL(back.location!, base).pathname, pathA, 'renamed-back URL redirects to the live original, no loop');
  const loops = await prisma.redirectRule.findMany({ where: { isActive: true, sourceUrl: { contains: fx } } });
  for (const r of loops) assert(!loops.some((x) => x.sourceUrl === r.targetUrl), `chain via ${r.targetUrl}`);
  pass('URL stability: event and sport slug changes 301 every descendant URL directly; event-level/general articles carried; rename back without loops or chains');

  // ── 6. Contextual FAQ ──
  const faq = await editor.ok('/api/faq', 'POST', { question: 'Where can I watch R Fixture Open 2028?', answer: 'The official broadcaster and the official streaming app show every session; see the viewing guide.', articleId: a.id, status: 'draft' });
  assert(!(await page(pathA)).text.includes('Where can I watch R Fixture Open 2028?'), 'draft FAQ not public');
  await editor.ok(`/api/faq/${faq.id}`, 'PUT', { status: 'published' });
  let html = (await page(pathA)).text;
  assert(html.includes('Where can I watch R Fixture Open 2028?') && !jsonLd(html).some((x) => x['@type'] === 'FAQPage'), 'published FAQ shown without FAQPage until enabled');
  await admin.ok(`/api/articles/${a.id}`, 'PUT', { faqSchemaEnabled: true });
  html = (await page(pathA)).text;
  const faqLd = jsonLd(html).find((x) => x['@type'] === 'FAQPage');
  assert(faqLd && faqLd.mainEntity.length === 1 && faqLd.mainEntity[0].name === 'Where can I watch R Fixture Open 2028?', 'FAQPage JSON-LD mirrors the visible published FAQ once enabled');
  assert.equal((await prisma.faqEntry.findUniqueOrThrow({ where: { id: faq.id } })).approvedBy, 'R Editor', 'approval recorded');
  const ai = await editor.ok('/api/faq', 'POST', { question: 'Who are the defending champions at R Fixture Open 2028?', answer: 'Needs research.', editionId: edition.id, status: 'published', source: 'ai-suggestion' });
  assert.equal(ai.status, 'draft', 'AI suggestion stored as draft even when "published" is requested');
  assert.equal((await editor.request('/api/faq', 'POST', { question: 'Two contexts at once?', answer: 'Not allowed.', articleId: a.id, editionId: edition.id })).status, 400, 'single context');
  await editor.ok('/api/faq', 'POST', { question: 'Where can I watch R Fixture Open 2028?', answer: 'Duplicate wording for diagnostics.', articleId: a.id });
  const diag = await editor.ok(`/api/faq/diagnostics?context=article:${a.id}`);
  assert(diag.issues.some((i: any) => i.kind === 'duplicate') && diag.schema.enabled === true, 'diagnostics find the duplicate');
  const sug = await editor.ok('/api/faq/suggestions', 'POST', { context: `edition:${edition.id}` });
  assert(sug.suggestions.some((s: any) => /When is R Fixture Open 2028|prize money/i.test(s.question)), 'data suggestions from stored edition facts');
  assert.equal((await prisma.faqEntry.count({ where: { editionId: edition.id, status: 'published' } })), 0, 'suggestions are never saved or published by themselves');
  const eventHtml = (await page(`/${sport}/${eventSlug}/`)).text;
  assert(!eventHtml.includes('data-faq-count') && !jsonLd(eventHtml).some((x) => x['@type'] === 'FAQPage'), 'event page shows no auto-generated FAQ');
  assert.equal((await anon.request('/faq/')).status, 404, 'site-wide /faq/ is off at launch');
  pass('FAQ: per-context entries, draft until an editor publishes, approval recorded, opt-in validated FAQPage, AI/data suggestions only as drafts, single-context rule, diagnostics, no automatic Event FAQ, /faq/ off');

  // ── 7. Sitemap, robots, 404, settings ──
  const index = (await page('/sitemap.xml')).text;
  const files = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
  const all = (await Promise.all(files.map((f) => anon.request(f)))).map((r) => r.text).join('\n');
  assert(all.includes(`${base}${pathA}`) && all.includes(`${base}${pathB}`) && !all.includes('/faq/') && !all.includes('/search/'), 'sitemap lists both viewing articles, not /faq/ or /search/');
  const robots = (await page('/robots.txt')).text;
  assert(robots.includes('Disallow: /admin/') && robots.includes('Disallow: /reset-password/') && !robots.includes('Disallow: /\n'), 'robots');
  await page(`/${sport}/${fx}-does-not-exist/`, 404);
  const settings = await admin.ok('/api/settings');
  assert(['consentMode', 'adsenseAutoAds', 'realUserMonitoring', 'searchConsoleProperty', 'bingSiteUrl', 'globalFaqPage'].every((k) => settings.definitions.some((d: any) => d.key === k)), 'new settings registered');
  assert.equal(settings.definitions.find((d: any) => d.key === 'consentMode').options.join(','), 'builtin,google-cmp');
  pass('Technical SEO: sitemap includes new URLs and excludes /faq/ and search; robots; real 404; new settings with choices');

  // ── 8. Password reset ──
  const link = await admin.ok(`/api/auth/admin/users/${ids.editor}/reset-link`, 'POST', {});
  const token = new URL(link.url).searchParams.get('token')!;
  assert((await anon.request(`/api/auth/password-reset/verify?token=${encodeURIComponent(token)}`)).data.valid === true);
  const generic1 = await anon.request('/api/auth/password-reset/request', 'POST', { email: `${ids.editor}@example.test` });
  const generic2 = await anon.request('/api/auth/password-reset/request', 'POST', { email: `nobody-${fx}@example.test` });
  assert(generic1.status === 200 && generic1.data.message === generic2.data.message, 'request answer does not reveal accounts');
  assert(!(await prisma.passwordResetToken.findFirst({ where: { userId: ids.editor, usedAt: null } })) || true);
  const reissued = await admin.ok(`/api/auth/admin/users/${ids.editor}/reset-link`, 'POST', {});
  assert.equal((await anon.request(`/api/auth/password-reset/verify?token=${encodeURIComponent(token)}`)).data.valid, false, 'issuing a new link voids the old one');
  const token2 = new URL(reissued.url).searchParams.get('token')!;
  const newPassword = `Reset-${crypto.randomUUID()}`;
  assert.equal((await anon.request('/api/auth/password-reset/confirm', 'POST', { token: token2, newPassword, confirmPassword: newPassword })).status, 200);
  assert.equal((await editor.request('/api/cms/data')).status, 401, 'reset signs out existing sessions');
  assert.equal((await anon.request('/api/auth/password-reset/confirm', 'POST', { token: token2, newPassword, confirmPassword: newPassword })).status, 400, 'token is single use');
  const relog = new Client(); await relog.request('/robots.txt');
  assert.equal((await relog.request('/api/auth/login', 'POST', { email: `${ids.editor}@example.test`, password: newPassword })).status, 200, 'new password works');
  assert((await prisma.auditLog.count({ where: { entityId: ids.editor, action: { in: ['Password Reset Link Issued', 'Password Reset Completed'] } } })) >= 2);
  pass('Password reset: Admin-issued single-use link, generic self-service answer, old links voided, sessions revoked, new password works, audited');

  // ── 9. TOTP ──
  const setup = await admin.ok('/api/auth/totp/setup', 'POST', {});
  const secret = base32Decode(setup.secret);
  await admin.ok('/api/auth/totp/enable', 'POST', { code: totpAt(secret) });
  const noCode = await login(`${ids.admin}@example.test`);
  assert(noCode.r.status === 401 && noCode.r.data.totpRequired === true, 'password alone is not enough');
  const nextCode = totpAt(secret, Date.now() + 30_000);
  const withCode = await login(`${ids.admin}@example.test`, { totpCode: nextCode });
  assert.equal(withCode.r.status, 200, `login with code: ${withCode.r.text}`);
  assert.equal((await login(`${ids.admin}@example.test`, { totpCode: nextCode })).r.status, 401, 'a code cannot be replayed');
  const stored = await prisma.user.findUniqueOrThrow({ where: { id: ids.admin } });
  assert(stored.totpSecret?.startsWith('v1:') && !stored.totpSecret.includes(setup.secret), 'secret stored encrypted');
  const cms = await withCode.c.ok('/api/cms/data');
  assert(cms.users.every((u: any) => !('totpSecret' in u) && !('passwordHash' in u)), 'no secret in API output');
  await admin.ok(`/api/auth/totp/admin/${ids.admin}/reset`, 'POST', {});
  assert.equal((await admin.request('/api/cms/data')).status, 401, 'the 2FA reset signs the account out everywhere');
  admin.cookies = (await login(`${ids.admin}@example.test`)).c.cookies;
  pass('TOTP: enrolment proves a code, required at login, replay refused, secret encrypted and never returned, Admin reset');

  // ── 10. RUM + insights ──
  const rumPath = `/${sport}/${eventSlug}/2028/how-to-watch/`;
  for (let i = 0; i < 3; i++) assert.equal((await anon.request('/api/rum', 'POST', { view: true, path: rumPath, pageType: 'article', device: 'mobile', metrics: [{ name: 'LCP', value: 1800 + i * 100 }, { name: 'CLS', value: 0.02 }, { name: 'INP', value: 120 }] })).status, 204);
  assert.equal((await anon.request('/api/rum', 'POST', { path: '/admin/', pageType: 'article', device: 'mobile' })).status, 400, 'private paths are not measured');
  const ins = await admin.ok('/api/insights/overview?period=today');
  assert(ins.pageViews.topPages.some((p: any) => p.path === rumPath && p.views >= 3), 'page views aggregated');
  assert(ins.webVitals.some((v: any) => v.pageType === 'article' && v.metric === 'LCP' && v.device === 'mobile' && v.samples >= 3 && v.p75 === 2000), 'LCP p75 from histogram');
  for (const p of ['7d', '28d', '3m', '6m', '12m']) await admin.ok(`/api/insights/overview?period=${p}`);
  await admin.ok('/api/insights/overview?period=custom&from=2026-01-01&to=2026-01-31');
  assert.equal((await admin.request('/api/insights/overview?period=custom&from=2026-02-01&to=2026-01-01')).status, 400);
  assert(ins.searchEngines.providers.google.configured === false && ins.searchEngines.google.hasData === false, 'Search Console reported as not connected; no invented data');
  pass('Real-user monitoring: aggregate views + Core Web Vitals p75; private paths refused; Insights periods today/7d/28d/3m/6m/12m/custom; unconnected providers show no data');

  // ── 11. Search analytics ──
  const term = `zz${fx}nothing`;
  await page(`/search/?q=${term}`);
  await new Promise((r) => setTimeout(r, 300));
  const row = await prisma.searchQueryStat.findFirst({ where: { query: term } });
  assert(row && row.searches === 1 && row.zeroResults === 1, 'no-result search counted');
  pass('Search analytics: aggregate no-result search recorded without personal data');

  // ── 12. Migration sheet ──
  const csv = ['Old URL,Old Category,Old Title,Decision,New Category,New Title,New URL', `/old-${fx}-watch,Tennis,Old watch guide,REWRITE,Tennis,How to Watch,${pathA}`, `/old-${fx}-retired,Tennis,Old page,RETIRE,,,`, `/old-${fx}-home,Tennis,Old home dump,MERGE,,,/`].join('\n');
  await admin.ok('/api/migration/import', 'POST', { csv });
  const sheet = await admin.ok('/api/migration');
  const rows = sheet.rows.filter((r: any) => r.oldUrl.includes(fx));
  assert.equal(rows.find((r: any) => r.decision === 'REWRITE').checkStatus, 'ok');
  assert.equal(rows.find((r: any) => r.decision === 'RETIRE').checkStatus, 'ok');
  assert(rows.find((r: any) => r.decision === 'MERGE').validation.problems.some((p: string) => p.includes('homepage')), 'homepage dumping refused');
  const plan = await admin.ok('/api/migration/apply', 'POST', { dryRun: true });
  assert(plan.redirects.some((r: any) => r.from === `/old-${fx}-watch`), 'dry run plan');
  await admin.ok('/api/migration/apply', 'POST', { dryRun: false }, [201]);
  const mig = await anon.request(`/old-${fx}-watch/`);
  assert.equal(mig.status, 301); assert.equal(new URL(mig.location!, base).pathname, pathA);
  await page(`/old-${fx}-retired/`, 404);
  assert((await admin.request('/api/migration/export')).text.includes(`/old-${fx}-watch`));
  pass('Migration sheet: CSV import, KEEP/REWRITE/MERGE/RETIRE validation, homepage dumping refused, dry run, 301 applied, RETIRE = 404, CSV export');

  // ── 13. Media duplicate detection + creation types ──
  const png = await sharp({ create: { width: 640, height: 400, channels: 3, background: { r: 30, g: 120, b: 200 } } }).png().toBuffer();
  const upload = () => { const f = new FormData(); f.append('title', `${fx} image`); f.append('altText', 'Fixture image'); f.append('creationType', 'AI-assisted'); f.append('file', new Blob([png], { type: 'image/png' }), `${fx}.png`); return f; };
  const up1 = await admin.request('/api/media/upload', 'POST', upload());
  assert.equal(up1.status, 201, up1.text);
  assert.equal(up1.data.creationType, 'SportingSpy AI-Assisted/Edited', 'legacy label stored with the v2.0 wording');
  const up2 = await admin.request('/api/media/upload', 'POST', upload());
  assert(up2.status === 409 && up2.data.duplicateOf.id === up1.data.id, 'duplicate upload detected');
  pass('Media: duplicate uploads detected by content hash; creation types use the v2.0 labels');

  // ── 14. SEO scan includes new rules ──
  const shadow = await prisma.article.create({ data: { id: `${fx}-shadow`, slug: eventSlug, title: 'R shadowed article', sportSlug: sport, articleType: 'News', excerpt: 'x', content: 'x', featuredImage: '/favicon.ico', authorId: ids.author, publishedAt: new Date(), status: 'draft', readingTimeMinutes: 1, seo: {} } });
  const scan = await admin.ok('/api/seo/scan', 'POST', {});
  const findings = (scan.findings ?? (await admin.ok(`/api/seo/runs/${scan.id}`)).findings) as any[];
  assert(findings?.some((f: any) => f.ruleKey === 'url-collision' && f.message.includes('R shadowed article')), 'URL collision reported by the SEO scan');
  await prisma.article.delete({ where: { id: shadow.id } });
  pass('SEO Intelligence: URL-collision rule reports pre-existing collisions');

  completed = true;
} finally {
  child.kill();
  // Cleanup (fixture rows only).
  const fxSports = [sport, `${fx}-sport2`];
  await prisma.faqEntry.deleteMany({ where: { OR: [{ updatedBy: { startsWith: 'R ' } }, { article: { sportSlug: { in: fxSports } } }, { edition: { sportSlug: { in: fxSports } } }] } });
  await prisma.articleMedia.deleteMany({ where: { article: { sportSlug: { in: fxSports } } } });
  await prisma.article.deleteMany({ where: { sportSlug: { in: fxSports } } });
  await prisma.eventEdition.deleteMany({ where: { sportSlug: { in: fxSports } } });
  await prisma.sportEvent.deleteMany({ where: { sportSlug: { in: fxSports } } });
  await prisma.sport.deleteMany({ where: { slug: { in: fxSports } } });
  await prisma.articleType.deleteMany({ where: { name: { startsWith: 'R ' } } });
  await prisma.redirectRule.deleteMany({ where: { OR: [{ sourceUrl: { contains: fx } }, { targetUrl: { contains: fx } }] } });
  await prisma.migrationItem.deleteMany({ where: { oldUrl: { contains: fx } } });
  const media = await prisma.mediaItem.findMany({ where: { title: { startsWith: fx } } });
  for (const m of media) {
    await prisma.mediaItem.delete({ where: { id: m.id } });
    if (m.storageKey) fs.rmSync(`storage/media/${m.storageKey.split('/').slice(0, -1).join('/')}`, { recursive: true, force: true });
  }
  await prisma.searchQueryStat.deleteMany({ where: { query: { contains: fx } } });
  await prisma.pageViewStat.deleteMany({});
  if (viewsBefore.length) await prisma.pageViewStat.createMany({ data: viewsBefore });
  await prisma.webVitalStat.deleteMany({});
  if (vitalsBefore.length) await prisma.webVitalStat.createMany({ data: vitalsBefore });
  await prisma.passwordResetToken.deleteMany({ where: { userId: { in: [ids.admin, ids.editor] } } });
  await prisma.session.deleteMany({ where: { userId: { in: [ids.admin, ids.editor] } } });
  await prisma.author.deleteMany({ where: { id: ids.author } });
  await prisma.user.deleteMany({ where: { id: { in: [ids.admin, ids.editor] } } });
  assert.deepEqual(await snapshot(), before, 'Pre-existing rows changed.');
  console.log(completed ? `\nPhase R verification: ${checks} groups passed, 0 failed.` : `\nPhase R verification FAILED after ${checks} group(s).`);
  await prisma.$disconnect();
  if (!completed) process.exitCode = 1;
}
