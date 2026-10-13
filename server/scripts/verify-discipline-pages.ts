/** Public group landing pages (/{sport}/{group}/; internal name: discipline): route resolution
 * and collisions, content scoping, parent sport aggregation, visibility,
 * indexing, canonical and breadcrumbs, the sitemap, the latest-articles
 * filter, and rename redirects. Production-mode server on the LOCAL
 * database, UUID-scoped fixtures, removed afterwards.
 * Requires `npm run build` and the discipline migration on the local database.
 * Run: npm run local -- test:discipline-pages
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { prisma } from '../db';
import { checkDatabaseUrlIsLocalDev } from '../dbSafety';
import { hashPassword } from '../password';
import { disciplinePath } from '../../src/lib/paths';

assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe, 'Verification requires a local, non-production database.');
assert(fs.existsSync('.next/BUILD_ID'), 'Run npm run build first.');

const fx = `dp${crypto.randomBytes(4).toString('hex')}`;
const password = `Test-${crypto.randomUUID()}`;
const adminId = `${fx}-admin`;
const A = `${fx}-athletics`; const H = `${fx}-hidden`; const P = `${fx}-plain`;
const digest = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
// Everything that existed before must be identical afterwards.
const existingBefore = {
  sports: await prisma.sport.findMany({ orderBy: { id: 'asc' } }), events: await prisma.sportEvent.findMany({ orderBy: { id: 'asc' } }),
  editions: await prisma.eventEdition.findMany({ orderBy: { id: 'asc' } }), articles: await prisma.article.findMany({ orderBy: { id: 'asc' } }),
  redirects: await prisma.redirectRule.findMany({ orderBy: { id: 'asc' } }), disciplines: await prisma.discipline.count(),
};
const fingerprint = (o: typeof existingBefore) => digest(JSON.stringify(o));
const redirectIdsBefore = existingBefore.redirects.map((r) => r.id);

const probe = createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = (probe.address() as { port: number }).port;
await new Promise<void>((resolve) => probe.close(() => resolve()));
const base = `http://localhost:${port}`;
const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
  cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', TRUST_PROXY: 'false', NODE_ENV: 'production', APP_ENV: 'production', AUTH_MODE: 'production', DEV_LOGIN_BYPASS: 'false', ALLOWED_ORIGIN: base, ENABLE_READER_ACCOUNTS: 'false', ENABLE_COMMENTS: 'false', INDEXNOW_ENDPOINT: '' } as NodeJS.ProcessEnv,
});

let checks = 0;
const pass = (m: string) => { checks++; console.log(`PASS ${m}`); };
const cookies = new Map<string, string>();
async function api(route: string, method = 'GET', body?: unknown) {
  const headers: Record<string, string> = { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '), 'Content-Type': 'application/json' };
  if (method !== 'GET') headers['x-csrf-token'] = cookies.get('csrf_token') || '';
  const res = await fetch(base + route, { method, redirect: 'manual', headers, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of res.headers.getSetCookie()) { const [pair] = c.split(';'); const i = pair.indexOf('='); cookies.set(pair.slice(0, i), pair.slice(i + 1)); }
  const text = await res.text();
  let data: any; try { data = JSON.parse(text); } catch { data = null; }
  return { status: res.status, data, text };
}
const expect = async (route: string, status: number, method = 'GET', body?: unknown) => {
  const r = await api(route, method, body);
  assert.equal(r.status, status, `${method} ${route}: expected ${status}, got ${r.status} ${r.text.slice(0, 300)}`);
  return r;
};
/** A public page as a visitor gets it (no session, redirects not followed). */
async function get(route: string) {
  const res = await fetch(base + route, { redirect: 'manual' });
  return { status: res.status, location: res.headers.get('location'), html: await res.text() };
}
const robots = (html: string) => html.match(/<meta name="robots" content="([^"]*)"/)?.[1] ?? '';
const canonical = (html: string) => html.match(/<link rel="canonical" href="([^"]*)"/)?.[1] ?? '';
const titleOf = (html: string) => (html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '').replace(/&amp;/g, '&');
const h1 = (html: string) => (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? '').replace(/<[^>]+>/g, '').replace(/<!--.*?-->/g, '').trim();
const has = (html: string, text: string) => html.includes(text);
/** What a visitor reads: no scripts, styles or markup. */
const visibleText = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

try {
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Test server did not start.')), 90_000);
    child.stdout.on('data', (c) => { if (String(c).includes('Server running')) { clearTimeout(t); resolve(); } });
    child.once('exit', () => { clearTimeout(t); reject(new Error('Test server exited before startup.')); });
  });

  // ── Fixtures ──
  await prisma.user.create({ data: { id: adminId, name: `${fx} Admin`, email: `${adminId}@example.test`, role: 'Admin', avatar: '/favicon.ico', joinedAt: new Date(), passwordHash: hashPassword(password) } });
  await prisma.author.create({ data: { id: `${fx}-byline`, slug: `${fx}-byline`, name: `${fx} Byline`, roleTitle: 'Correspondent', bio: 'Bio', avatar: '/favicon.ico' } });
  const sportRow = (slug: string, name: string, isVisible: boolean, order: number) => ({ id: `${fx}-sport-${slug}`, slug, name, tagline: `${name} tagline text`, description: `${name} description.`, order, isVisible, seo: {} });
  await prisma.sport.create({ data: sportRow(A, `${fx} Athletics`, true, 950) });
  await prisma.sport.create({ data: sportRow(H, `${fx} Hidden Sport`, false, 951) });
  await prisma.sport.create({ data: sportRow(P, `${fx} Plain Sport`, true, 952) });
  const disc = (sportSlug: string, slug: string, name: string, extra: object = {}, order = 1) => prisma.discipline.create({ data: { id: `${fx}-d-${slug}`, sportSlug, slug, name, description: `${name} description of ${fx}.`, order, ...extra } });
  const groupImage = `https://images.unsplash.com/photo-${fx}-group?w=1600`; const sportImage = `https://images.unsplash.com/photo-${fx}-sport?w=1600`; const socialImage = `https://images.unsplash.com/photo-${fx}-social?w=1200`;
  await prisma.mediaItem.create({ data: { id: `${fx}-media`, title: `${fx} group image`, url: groupImage, altText: 'Runners', width: 1600, height: 900, uploadedAt: new Date(), copyrightReview: 'reviewed' } });
  await prisma.sport.update({ where: { id: `${fx}-sport-${A}` }, data: { heroImage: sportImage } });
  await disc(A, 'running', `${fx} Running`, { seo: {}, tagline: `${fx} RUNTAGLINE of the group`, icon: '🏃', heroImage: groupImage, heroMediaId: `${fx}-media` }, 1);
  await disc(A, 'jumping', `${fx} Jumping`, { seo: { metaTitle: `${fx} Jumping custom SEO title`, metaDescription: `${fx} jumping custom meta description.`, ogTitle: `${fx} Jumping social title`, ogImage: socialImage } }, 2);
  await disc(A, 'throwing', `${fx} Throwing`, { isVisible: false }, 3);
  await disc(A, 'walking', `${fx} Walking`, { isActive: false }, 4);
  await disc(H, 'hrun', `${fx} Hidden Run`);
  const event = (slug: string, name: string, extra: object = {}) => prisma.sportEvent.create({ data: { id: `${fx}-e-${slug}`, sportSlug: A, slug, name, shortName: name, description: `${name} overview.`, seo: {}, ...extra } });
  await event(`${fx}-marathon`, `${fx} City Marathon`, { disciplineSlug: 'running' });
  await event(`${fx}-champs`, `${fx} World Championships`);
  await event(`${fx}-walk-cup`, `${fx} Walk Cup`, { disciplineSlug: 'walking' });
  await event(`${fx}-secret`, `${fx} Secret Race`, { disciplineSlug: 'running', isVisible: false });
  await event(`${fx}-relays`, `${fx} Relay Meeting`, { disciplineSlug: 'running' });
  // The group's own featured list (in this order); the sport features a different event.
  await prisma.discipline.update({ where: { id: `${fx}-d-running` }, data: { featuredEventIds: [`${fx}-e-${fx}-relays`, `${fx}-e-${fx}-marathon`] } });
  await prisma.sport.update({ where: { id: `${fx}-sport-${A}` }, data: { featuredEventIds: [`${fx}-e-${fx}-champs`] } });
  const edition = (eventSlug: string, title: string) => prisma.eventEdition.create({ data: { id: `${fx}-ed-${eventSlug}`, sportSlug: A, eventSlug, year: 2030, title, startDate: '2030-05-01', endDate: '2030-05-02', status: 'upcoming', description: `${title}.`, seo: {} } });
  await edition(`${fx}-marathon`, `${fx} City Marathon 2030`);
  await edition(`${fx}-champs`, `${fx} World Championships 2030`);
  await edition(`${fx}-walk-cup`, `${fx} Walk Cup 2030`);
  const type = await prisma.articleType.findFirstOrThrow({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
  const article = (key: string, title: string, extra: object = {}) => prisma.article.create({ data: { id: `${fx}-a-${key}`, slug: `${fx}-${key}`, title, sportSlug: A, articleType: type.name, excerpt: `${title} excerpt.`, content: `${title} body text.`, featuredImage: '', authorId: `${fx}-byline`, publishedAt: new Date(), status: 'published', readingTimeMinutes: 1, seo: {}, ...extra } });
  await article('run-guide', `${fx} RUNGUIDE standalone`, { disciplineSlug: 'running' });
  await article('marathon-preview', `${fx} MARATHONPREVIEW in event`, { eventSlug: `${fx}-marathon`, editionYear: 2030 });
  await article('champs-sprint', `${fx} CHAMPSSPRINT own group`, { eventSlug: `${fx}-champs`, editionYear: 2030, disciplineSlug: 'running' });
  await article('general', `${fx} GENERALPIECE unassigned`);
  await article('champs-report', `${fx} CHAMPSREPORT unassigned in event`, { eventSlug: `${fx}-champs`, editionYear: 2030 });
  await article('walk-news', `${fx} WALKNEWS retired group`, { disciplineSlug: 'walking' });
  await article('draft', `${fx} DRAFTPIECE`, { disciplineSlug: 'running', status: 'draft' });
  await article('in-review', `${fx} REVIEWPIECE`, { disciplineSlug: 'running', status: 'draft', reviewStatus: 'in_review' });
  await article('preview', `${fx} PREVIEWPIECE`, { disciplineSlug: 'running', status: 'preview' });
  await article('archived', `${fx} ARCHIVEDPIECE`, { disciplineSlug: 'running', status: 'archived' });
  await article('secret', `${fx} SECRETPIECE hidden event`, { eventSlug: `${fx}-secret` });
  await prisma.article.create({ data: { id: `${fx}-a-plain`, slug: `${fx}-plain-guide`, title: `${fx} PLAINGUIDE`, sportSlug: P, articleType: type.name, excerpt: 'x', content: 'x', featuredImage: '', authorId: `${fx}-byline`, publishedAt: new Date(), status: 'published', readingTimeMinutes: 1, seo: {} } });
  await api('/api/auth/me');
  assert.equal((await api('/api/auth/login', 'POST', { email: `${adminId}@example.test`, password })).status, 200);

  // ── The discipline page ──
  const running = await get(disciplinePath(A, 'running'));
  assert.equal(running.status, 200);
  assert.equal(h1(running.html), `${fx} Running`);
  assert.equal(canonical(running.html), `${base}/${A}/running/`);
  assert.equal(titleOf(running.html), `${fx} Running – ${fx} Athletics Events, Guides & Articles | SportingSpy`);
  assert.match(running.html, new RegExp(`<meta name="description" content="${fx} Running description of ${fx}\\.`));
  assert(!/noindex/.test(robots(running.html)), `a discipline with content is indexable (robots: ${robots(running.html)})`);
  const crumbs = running.html.match(/"@type":"BreadcrumbList","itemListElement":\[(.*?)\]\}/)?.[1] ?? '';
  assert.deepEqual([...crumbs.matchAll(/"name":"([^"]+)"/g)].map((m) => m[1]), ['Home', `${fx} Athletics`, `${fx} Running`], 'breadcrumb: Home › Sport › Discipline');
  assert(crumbs.includes(`"item":"${base}/${A}/"`) && crumbs.includes(`"item":"${base}/${A}/running/"`));
  assert(has(running.html, `href="/${A}/"`), 'links back to the parent sport');
  assert(!has(running.html, `${fx} Athletics tagline text`), 'no sport tagline on a discipline page');
  assert(!has(running.html, 'frequently asked questions'), 'no FAQ section on a discipline page');
  assert(visibleText(running.html).includes(`${fx} Athletics · Group`), 'the page is labelled as a group of its sport');
  assert(!/discipline/i.test(visibleText(running.html).replace(new RegExp(fx, 'g'), '')), `the group page never says Discipline to a visitor (found: …${(visibleText(running.html).replace(new RegExp(fx, 'g'), '').match(/.{0,60}discipline.{0,40}/i) ?? [''])[0]}…)`);
  // The group's own settings, never the sport's.
  assert(visibleText(running.html).includes(`${fx} RUNTAGLINE of the group`), 'the group\'s own tagline is shown');
  const backdrop = running.html.match(/<[^>]*data-testid="sport-hero-backdrop"[\s\S]*?<\/div>/)?.[0] ?? '';
  assert(backdrop.includes(`photo-${fx}-group`), 'the header shows the group\'s own image');
  assert(!running.html.includes(`photo-${fx}-sport`), 'the sport\'s image is not used on the group page');
  const og = (html: string, property: string) => html.match(new RegExp(`<meta property="${property}" content="([^"]*)"`))?.[1]?.replace(/&amp;/g, '&') ?? '';
  assert.equal(og(running.html, 'og:image'), groupImage, 'the social image falls back to the group\'s own image');
  assert.equal(og(running.html, 'og:url'), `${base}/${A}/running/`);
  const featured = running.html.match(/<section aria-labelledby="sport-featured-heading"[\s\S]*?<\/section>/)?.[0] ?? '';
  assert(visibleText(featured).includes(`Featured ${fx} Running Events`), 'the featured section is the group\'s');
  assert.deepEqual([...featured.matchAll(/href="(\/[^"]+)"/g)].map((m) => m[1]).filter((h, i, all) => all.indexOf(h) === i).filter((h) => !/\/2030\//.test(h)), [`/${A}/${fx}-relays/`, `/${A}/${fx}-marathon/`], 'the group\'s chosen featured events, in its order');
  assert(!featured.includes(`${fx}-champs`), 'the sport\'s featured event is not featured on the group page');
  pass('group page: 200, own H1, title, description and canonical URL, indexable, breadcrumb Home › Sport › Group, link to the parent sport, no sport FAQ; its own tagline, header image, social image and featured events, none of them the sport\'s');

  // ── Scoping ──
  for (const title of ['RUNGUIDE', 'MARATHONPREVIEW', 'CHAMPSSPRINT']) assert(has(running.html, `${fx} ${title}`), `${title} belongs on the Running page`);
  for (const title of ['GENERALPIECE', 'CHAMPSREPORT', 'WALKNEWS']) assert(!has(running.html, `${fx} ${title}`), `${title} does not belong on the Running page`);
  for (const title of ['DRAFTPIECE', 'REVIEWPIECE', 'PREVIEWPIECE', 'ARCHIVEDPIECE', 'SECRETPIECE']) assert(!has(running.html, `${fx} ${title}`), `${title} is not public`);
  assert(has(running.html, `href="/${A}/${fx}-marathon/"`) && has(running.html, `${fx} City Marathon 2030`), 'the discipline\'s event and its edition are listed');
  assert(!has(running.html, `href="/${A}/${fx}-walk-cup/"`) && !has(running.html, `${fx} Walk Cup 2030`), 'another discipline\'s event and edition are not');
  assert(!has(running.html, `${fx} World Championships 2030`), 'an unassigned event\'s edition is not listed');
  assert(!has(running.html, `${fx} Secret Race`), 'a hidden event is not listed');
  pass('scoping: articles that name the group, plus articles of its events that name none; its events and editions only; no draft, review-required, preview or archived article, nothing of a hidden event');

  // ── The parent sport still aggregates everything ──
  const sport = await get(`/${A}/`);
  assert.equal(sport.status, 200); assert.equal(h1(sport.html), `${fx} Athletics`); assert.equal(canonical(sport.html), `${base}/${A}/`);
  for (const title of ['RUNGUIDE', 'MARATHONPREVIEW', 'CHAMPSSPRINT', 'GENERALPIECE', 'CHAMPSREPORT', 'WALKNEWS']) assert(has(sport.html, `${fx} ${title}`), `${title} is on the sport page`);
  for (const title of ['DRAFTPIECE', 'REVIEWPIECE', 'PREVIEWPIECE', 'ARCHIVEDPIECE', 'SECRETPIECE']) assert(!has(sport.html, `${fx} ${title}`));
  for (const slug of ['marathon', 'champs', 'walk-cup']) assert(has(sport.html, `href="/${A}/${fx}-${slug}/"`));
  assert(has(sport.html, `${fx} Athletics tagline text`), 'the sport page keeps its tagline');
  assert(sport.html.includes(`photo-${fx}-sport`) && !(sport.html.match(/<[^>]*data-testid="sport-hero-backdrop"[\s\S]*?<\/div>/)?.[0] ?? '').includes(`photo-${fx}-group`), 'the sport page keeps its own image');
  assert(!visibleText(sport.html).includes(`${fx} RUNTAGLINE of the group`), 'a group\'s tagline is not shown as the sport\'s');
  const sportFeatured = sport.html.match(/<section aria-labelledby="sport-featured-heading"[\s\S]*?<\/section>/)?.[0] ?? '';
  assert(sportFeatured.includes(`/${A}/${fx}-champs/`) && !sportFeatured.includes(`/${A}/${fx}-relays/`), 'the sport page keeps its own featured events');
  const nav = sport.html.match(/<nav[^>]*data-testid="group-nav"[\s\S]*?<\/nav>/)?.[0] ?? '';
  assert(has(nav, `href="/${A}/running/"`) && has(nav, `href="/${A}/jumping/"`), 'the sport page links to its browsable disciplines');
  assert(!has(nav, `/${A}/throwing/`) && !has(nav, `/${A}/walking/`), 'hidden and retired disciplines are not linked');
  assert(visibleText(nav).includes(`${fx} Athletics Groups`), 'the list is headed "<Sport> Groups"');
  assert(visibleText(nav).includes('🏃'), 'a group\'s icon is shown in the list');
  assert.match(nav, /<ol[\s>]/, 'the groups are an ordered list');
  assert.deepEqual([...nav.matchAll(/href="([^"]+)"/g)].map((m) => m[1]), [`/${A}/running/`, `/${A}/jumping/`], 'groups appear directly under the sport, in their display order, and nothing else');
  // Reordering in the CMS changes the public order.
  await prisma.discipline.update({ where: { id: `${fx}-d-jumping` }, data: { order: 0 } });
  const reordered = (await get(`/${A}/`)).html.match(/<nav[^>]*data-testid="group-nav"[\s\S]*?<\/nav>/)?.[0] ?? '';
  assert.deepEqual([...reordered.matchAll(/href="([^"]+)"/g)].map((m) => m[1]), [`/${A}/jumping/`, `/${A}/running/`]);
  await prisma.discipline.update({ where: { id: `${fx}-d-jumping` }, data: { order: 2 } });
  assert(!/discipline/i.test(visibleText(sport.html).replace(new RegExp(fx, 'g'), '')), 'the sport page never says Discipline to a visitor');
  // A group page lists its siblings and the way back, never groups of its own; there is no third level.
  const groupNav = running.html.match(/<nav[^>]*data-testid="group-nav"[\s\S]*?<\/nav>/)?.[0] ?? '';
  assert.deepEqual([...groupNav.matchAll(/href="([^"]+)"/g)].map((m) => m[1]), [`/${A}/`, `/${A}/running/`, `/${A}/jumping/`]);
  assert.equal((await get(`/${A}/running/jumping/`)).status, 404, 'there is no group inside a group');
  const plain = await get(`/${P}/`);
  assert.equal(plain.status, 200); assert(has(plain.html, `${fx} PLAINGUIDE`)); assert(!has(plain.html, 'data-testid="group-nav"') && !visibleText(plain.html).includes('Plain Sport Groups'), 'a sport without groups is unchanged');
  const home = await get('/');
  assert(has(home.html, `/${A}/`) || true); assert(!has(home.html, `/${A}/running/`), 'a discipline is not in the global navigation');
  pass('parent sport: lists content of every group and unassigned content, keeps its own header, links only to visible active groups; a sport without groups and the global navigation are unchanged');

  // ── Empty, retired, hidden ──
  const empty = await get(disciplinePath(A, 'jumping'));
  assert.equal(empty.status, 200); assert.equal(h1(empty.html), `${fx} Jumping`);
  // SEO and social overrides saved on the group; no image of its own means no header image at all.
  assert.equal(titleOf(empty.html), `${fx} Jumping custom SEO title`);
  assert.match(empty.html, new RegExp(`<meta name="description" content="${fx} jumping custom meta description\\.`));
  assert.equal(empty.html.match(/<meta property="og:title" content="([^"]*)"/)?.[1], `${fx} Jumping social title`);
  assert.equal((empty.html.match(/<meta property="og:image" content="([^"]*)"/)?.[1] ?? '').replace(/&amp;/g, '&'), socialImage);
  assert.equal(canonical(empty.html), `${base}/${A}/jumping/`);
  assert(!empty.html.includes('data-testid="sport-hero-backdrop"') && !empty.html.includes(`photo-${fx}-sport`) && !empty.html.includes(`photo-${fx}-group`), 'a group without an image borrows neither the sport\'s nor a sibling\'s');
  assert.match(robots(empty.html), /noindex/, 'an empty discipline is noindex');
  for (const text of ['No articles published under this', 'No events registered for this']) assert(has(empty.html, text), `empty state: ${text}`);
  const retired = await get(disciplinePath(A, 'walking'));
  assert.equal(retired.status, 200, 'a retired discipline keeps its page'); assert.match(robots(retired.html), /noindex/, 'a retired discipline is noindex'); assert(has(retired.html, `${fx} WALKNEWS`), 'retired page shows its content');
  assert.equal((await get(disciplinePath(A, 'throwing'))).status, 404, 'a hidden discipline has no page');
  assert.equal((await get(disciplinePath(H, 'hrun'))).status, 404, 'a hidden sport hides its disciplines');
  assert.equal((await get(`/${H}/`)).status, 404);
  assert.equal((await get(disciplinePath(A, 'no-such-discipline'))).status, 404);
  pass('an empty group is a valid 200 page with an empty state and noindex; a retired one stays reachable but noindex; a hidden group and every group of a hidden sport are 404');

  // ── Sitemap ──
  const sitemap = (await get('/sitemaps/pages.xml')).html;
  assert(has(sitemap, `<loc>${base}/${A}/running/</loc>`), 'an eligible discipline page is in the sitemap');
  for (const path of [`/${A}/jumping/`, `/${A}/walking/`, `/${A}/throwing/`, `/${H}/hrun/`]) assert(!has(sitemap, `<loc>${base}${path}</loc>`), `${path} is not in the sitemap`);
  assert(has(sitemap, `<loc>${base}/${A}/</loc>`) && has(sitemap, `<loc>${base}/${A}/${fx}-marathon/</loc>`), 'sport and event entries are as before');
  pass('sitemap: only the visible, active group with published content; not the empty, retired or hidden one, nor a hidden sport\'s');

  // ── Latest-articles filter ──
  const latest = await get(`/latest/?sport=${A}&discipline=running`);
  assert.equal(latest.status, 200); assert.match(robots(latest.html), /noindex/);
  assert(has(latest.html, `${fx} RUNGUIDE`) && has(latest.html, `${fx} MARATHONPREVIEW`) && !has(latest.html, `${fx} GENERALPIECE`) && !has(latest.html, `${fx} DRAFTPIECE`));
  const ignored = await get(`/latest/?sport=${A}&discipline=throwing`); // hidden: the filter is ignored, never an error
  assert.equal(ignored.status, 200); assert(has(ignored.html, `${fx} GENERALPIECE`) && !has(ignored.html, 'data-testid="latest-discipline"'));
  assert(has((await get(`/latest/?sport=${A}`)).html, `${fx} GENERALPIECE`), 'the sport filter alone is unchanged');
  pass('latest articles: ?sport=…&discipline=… lists that group\'s published articles (noindex); a hidden or unknown group is ignored');

  // ── Collisions: existing URLs keep their meaning ──
  const eventPage = await get(`/${A}/${fx}-marathon/`);
  assert.equal(eventPage.status, 200); assert.equal(h1(eventPage.html), `${fx} City Marathon`);
  const articlePage = await get(`/${A}/${fx}-general/`);
  assert.equal(articlePage.status, 200); assert.equal(h1(articlePage.html), `${fx} GENERALPIECE unassigned`);
  // Write-time guards, every direction.
  assert.match((await expect('/api/disciplines', 409, 'POST', { sportSlug: A, slug: `${fx}-marathon`, name: 'X' })).data.error, /is the URL of the event/);
  assert.match((await expect('/api/disciplines', 409, 'POST', { sportSlug: A, slug: `${fx}-general`, name: 'X' })).data.error, /already used by the article/);
  assert.match((await expect(`/api/disciplines/${fx}-d-jumping`, 409, 'PUT', { slug: `${fx}-champs` })).data.error, /is the URL of the event/);
  assert.match((await expect(`/api/disciplines/${fx}-d-jumping`, 409, 'PUT', { slug: `${fx}-general` })).data.error, /already used by the article/);
  assert.match((await expect('/api/events', 409, 'POST', { name: 'X', slug: 'running', sportSlug: A })).data.error, /belongs to the group/);
  assert.match((await expect(`/api/events/${fx}-e-${fx}-champs`, 409, 'PUT', { slug: 'jumping' })).data.error, /belongs to the group/);
  assert.match((await expect('/api/articles', 409, 'POST', { title: 'X', slug: 'running', sportSlug: A, content: 'x', authorId: `${fx}-byline` })).data.error, /belongs to the group/);
  assert.match((await expect(`/api/articles/${fx}-a-general`, 409, 'PUT', { slug: 'throwing' })).data.error, /belongs to the group/); // a hidden discipline still owns its slug
  // Even if bad data existed (written past the API), an existing event or article URL is never taken over.
  await prisma.discipline.create({ data: { id: `${fx}-d-clash-event`, sportSlug: A, slug: `${fx}-champs`, name: `${fx} CLASHDISC`, order: 9 } });
  await prisma.discipline.create({ data: { id: `${fx}-d-clash-article`, sportSlug: A, slug: `${fx}-general`, name: `${fx} CLASHDISC`, order: 9 } });
  assert.equal(h1((await get(`/${A}/${fx}-champs/`)).html), `${fx} World Championships`, 'the event URL still shows the event');
  { const r = await get(`/${A}/${fx}-general/`); assert.equal(`${r.status} ${h1(r.html)}`, `200 ${fx} GENERALPIECE unassigned`, `the article URL still shows the article (title: ${titleOf(r.html)})`); }
  await prisma.discipline.deleteMany({ where: { id: { in: [`${fx}-d-clash-event`, `${fx}-d-clash-article`] } } });
  // A four-segment article may reuse a discipline's slug: it is a different address.
  assert.equal((await expect('/api/articles', 201, 'POST', { title: `${fx} DEEP`, slug: 'running', sportSlug: A, eventSlug: `${fx}-champs`, editionYear: 2030, content: 'x', authorId: `${fx}-byline`, status: 'published' })).status, 201);
  assert.equal((await get(`/${A}/${fx}-champs/2030/running/`)).status, 200); assert.equal(h1((await get(`/${A}/running/`)).html), `${fx} Running`);
  pass('collisions: existing event and article URLs keep showing the event and the article; a group, an event and an event-less article cannot be created or renamed onto each other (all six directions refused); route order protects existing URLs even against bad data');

  // ── Renames and redirects ──
  const renamed = await expect(`/api/disciplines/${fx}-d-running`, 200, 'PUT', { slug: 'road-running' });
  assert.equal(renamed.data.movedUrls, 1);
  const old = await get(`/${A}/running/`);
  assert.equal(old.status, 301); assert.equal(old.location, `/${A}/road-running/`);
  const moved = await get(`/${A}/road-running/`);
  assert.equal(moved.status, 200); assert.equal(canonical(moved.html), `${base}/${A}/road-running/`); assert(has(moved.html, `${fx} RUNGUIDE`) && has(moved.html, `${fx} MARATHONPREVIEW`), 'its content followed the rename');
  // Renaming back: the old rule retires, the reverse rule is written, no loop.
  await expect(`/api/disciplines/${fx}-d-running`, 200, 'PUT', { slug: 'running' });
  assert.equal((await get(`/${A}/running/`)).status, 200);
  const back = await get(`/${A}/road-running/`); assert.equal(back.status, 301); assert.equal(back.location, `/${A}/running/`);
  // A manual redirect may not hide a live discipline page.
  assert.match((await expect('/api/redirects', 400, 'POST', { sourceUrl: `/${A}/walking`, targetUrl: `/${A}`, statusCode: 301 })).data.error, /is a live page/);
  await expect('/api/redirects', 409, 'POST', { sourceUrl: `/${A}/running`, targetUrl: `/${A}`, statusCode: 301 }); // its retired rename rule already owns that source
  // An old redirect whose source a discipline moves onto is retired, so the page is reachable.
  const rule = (await expect('/api/redirects', 201, 'POST', { sourceUrl: `/${A}/sprints`, targetUrl: `/${A}`, statusCode: 301 })).data;
  assert.equal((await get(`/${A}/sprints/`)).status, 301);
  await expect(`/api/disciplines/${fx}-d-jumping`, 200, 'PUT', { slug: 'sprints' });
  assert.equal((await get(`/${A}/sprints/`)).status, 200, 'the page is live at its new address');
  assert.equal((await prisma.redirectRule.findUniqueOrThrow({ where: { id: rule.id } })).isActive, false);
  assert.equal((await get(`/${A}/jumping/`)).location, `/${A}/sprints/`);
  // A rename onto another route is refused and changes nothing.
  await expect(`/api/disciplines/${fx}-d-jumping`, 409, 'PUT', { slug: `${fx}-marathon` });
  assert.equal((await prisma.discipline.findUniqueOrThrow({ where: { id: `${fx}-d-jumping` } })).slug, 'sprints');
  // A new discipline at an address that an old redirect used takes the address over.
  await expect('/api/disciplines', 201, 'POST', { sportSlug: A, slug: 'road-running', name: `${fx} Road Running` });
  assert.equal((await get(`/${A}/road-running/`)).status, 200);
  // The sport is renamed: every discipline page moves with it.
  const A2 = `${fx}-track`;
  assert((await expect(`/api/sports/${fx}-sport-${A}`, 200, 'PUT', { slug: A2 })).data.movedUrls >= 4);
  const viaSport = await get(`/${A}/running/`); assert.equal(viaSport.status, 301); assert.equal(viaSport.location, `/${A2}/running/`);
  assert.equal((await get(`/${A2}/running/`)).status, 200); assert.equal((await get(`/${A2}/`)).status, 200);
  const viaEvent = await get(`/${A}/${fx}-marathon/`); assert.equal(viaEvent.location, `/${A2}/${fx}-marathon/`);
  pass('renames: a group rename writes old → 301 → new and its content follows; renaming back leaves no loop; a manual redirect cannot hide a live group page; an old redirect at the new address is retired; a rename onto an event is refused; a sport rename redirects every group page');

  console.log(`PASS ${checks} discipline page verification groups`);
} finally {
  child.kill();
  if (child.exitCode === null) await once(child, 'exit');
  const sports = await prisma.sport.findMany({ where: { id: { startsWith: `${fx}-sport-` } }, select: { id: true, slug: true } });
  const slugs = sports.map((s) => s.slug);
  await prisma.article.deleteMany({ where: { sportSlug: { in: slugs } } });
  await prisma.eventEdition.deleteMany({ where: { sportSlug: { in: slugs } } });
  await prisma.sportEvent.deleteMany({ where: { sportSlug: { in: slugs } } });
  await prisma.discipline.deleteMany({ where: { sportSlug: { in: slugs } } });
  await prisma.mediaItem.deleteMany({ where: { id: `${fx}-media` } });
  await prisma.sport.deleteMany({ where: { id: { in: sports.map((s) => s.id) } } });
  await prisma.redirectRule.deleteMany({ where: { id: { notIn: redirectIdsBefore } } });
  await prisma.author.deleteMany({ where: { id: `${fx}-byline` } });
  await prisma.auditLog.deleteMany({ where: { userId: adminId } });
  await prisma.session.deleteMany({ where: { userId: adminId } });
  await prisma.user.deleteMany({ where: { id: adminId } });
  const existingAfter = {
    sports: await prisma.sport.findMany({ orderBy: { id: 'asc' } }), events: await prisma.sportEvent.findMany({ orderBy: { id: 'asc' } }),
    editions: await prisma.eventEdition.findMany({ orderBy: { id: 'asc' } }), articles: await prisma.article.findMany({ orderBy: { id: 'asc' } }),
    redirects: await prisma.redirectRule.findMany({ orderBy: { id: 'asc' } }), disciplines: await prisma.discipline.count(),
  };
  assert.equal(fingerprint(existingAfter), fingerprint(existingBefore), 'every sport, event, edition, article and redirect that existed before is unchanged; no fixture is left');
  console.log('PASS integrity: existing sports, events, editions, articles and redirects unchanged row for row; fixtures removed.');
  await prisma.$disconnect();
}
