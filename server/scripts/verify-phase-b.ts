/** PHASE B verification: Next.js server rendering of the public site.
 * Starts a production-mode server (launch flags OFF) on a free port, checks
 * real HTTP status codes and the RAW server HTML (not the browser DOM), then
 * optionally drives real Chrome. Uses UUID-scoped fixtures, removes only
 * those, and compares every pre-existing row and protected file afterwards.
 * Requires `npm run build` and a local database. Run: npm run test:phase-b
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { pathToFileURL } from 'node:url';
import { prisma } from '../db';
import { checkDatabaseUrlIsLocalDev } from '../dbSafety';
import { hashPassword } from '../password';

assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe, 'Verification requires a local, non-production database.');
assert(fs.existsSync('.next/BUILD_ID'), 'Run npm run build first.');

const fixture = `phaseb-${crypto.randomUUID()}`;
const password = `Test-${crypto.randomUUID()}`;
const adminId = `${fixture}-admin`;
const authorId = `${fixture}-author`;
const hiddenSportId = `${fixture}-hidden-sport`;
const hiddenSport = `${fixture}-hs`;
const hiddenEventId = `${fixture}-hidden-event`;
const hiddenEvent = `${fixture}-he`;
const newsId = `${fixture}-news`;
const hiddenArticleId = `${fixture}-hidden-article`;
const draftArticleId = `${fixture}-draft-article`;
// Files that must stay byte-identical, where still present (both were moved to the project archive).
const protectedFiles = ['data/db.json', 'PROJECT_BRAIN.md'].filter((file) => fs.existsSync(file));
const digest = (value: string | Buffer) => crypto.createHash('sha256').update(value).digest('hex');
const filesBefore = protectedFiles.map((file) => digest(fs.readFileSync(file)));
const tables = ['sport', 'sportEvent', 'eventEdition', 'article', 'author', 'user', 'session', 'comment', 'mediaItem', 'adSlotConfig', 'redirectRule', 'auditLog'] as const;
async function snapshot() {
  const result: Record<string, { count: number; hash: string }> = {};
  for (const table of tables) {
    const rows = await (prisma[table] as any).findMany({ orderBy: { id: 'asc' } });
    result[table] = { count: rows.length, hash: digest(JSON.stringify(rows)) };
  }
  return result;
}
const before = await snapshot();
console.log('BEFORE row counts:', Object.fromEntries(Object.entries(before).map(([k, v]) => [k, v.count])));

const probe = createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = (probe.address() as { port: number }).port;
await new Promise<void>((resolve) => probe.close(() => resolve()));
const base = `http://localhost:${port}`;
const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
  cwd: process.cwd(),
  windowsHide: true,
  env: {
    ...process.env, PORT: String(port), HOST: '127.0.0.1', TRUST_PROXY: 'false', NODE_ENV: 'production', APP_ENV: 'production', AUTH_MODE: 'production',
    DEV_LOGIN_BYPASS: 'false', ALLOWED_ORIGIN: base, ENABLE_READER_ACCOUNTS: 'false', ENABLE_COMMENTS: 'false',
  } as NodeJS.ProcessEnv,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
child.stdout.on('data', (chunk) => { serverOutput += chunk; });
child.stderr.on('data', (chunk) => { serverOutput += chunk; });

let checks = 0;
const tested = (message: string) => { checks++; console.log(`PASS ${message}`); };

async function get(path: string, init: RequestInit = {}) {
  const response = await fetch(base + path, { redirect: 'manual', ...init });
  return { status: response.status, headers: response.headers, text: await response.text() };
}
async function page(path: string, expected = 200) {
  const result = await get(path);
  assert.equal(result.status, expected, `GET ${path}: expected ${expected}, got ${result.status}`);
  return result;
}

// ── Raw-HTML helpers (the initial server response, before any JavaScript) ──
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const metaContent = (html: string, attr: 'name' | 'property', key: string) => {
  const m = html.match(new RegExp(`<meta ${attr}="${key.replace(/[:]/g, '\\:')}" content="([^"]*)"`));
  return m ? decode(m[1]) : undefined;
};
const title = (html: string) => decode(html.match(/<title>([^<]*)<\/title>/)?.[1] || '');
const canonical = (html: string) => html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
const jsonLd = (html: string) =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => {
    const parsed = JSON.parse(m[1]);
    return Array.isArray(parsed) ? parsed : [parsed];
  });
const ldTypes = (html: string) => jsonLd(html).map((d: any) => d['@type']).sort();
const scripts = (html: string) => [...html.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]);
const chunkPaths = (html: string) => new Set([...html.matchAll(/src="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]));

function assertSeo(html: string, path: string, opts: { title?: string; description?: string; index?: boolean; ld: string[] }) {
  const t = title(html);
  assert(t.length > 0, `${path}: <title> present`);
  if (opts.title) assert.equal(t, opts.title, `${path}: title`);
  const description = metaContent(html, 'name', 'description');
  assert(description && description.length > 0, `${path}: meta description present`);
  if (opts.description) assert.equal(description, opts.description, `${path}: description`);
  assert.equal(canonical(html), base + path, `${path}: canonical is the absolute trailing-slash URL`);
  assert.equal(metaContent(html, 'property', 'og:url'), base + path, `${path}: og:url`);
  assert(metaContent(html, 'property', 'og:title'), `${path}: og:title`);
  assert(metaContent(html, 'property', 'og:description'), `${path}: og:description`);
  assert.equal(metaContent(html, 'name', 'twitter:card'), 'summary_large_image', `${path}: twitter:card`);
  assert.equal(metaContent(html, 'name', 'robots'), opts.index === false ? 'noindex, follow' : 'index, follow', `${path}: robots`);
  assert.deepEqual(ldTypes(html), [...opts.ld].sort(), `${path}: JSON-LD types`);
}

try {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Test server did not start.')), 60_000);
    child.stdout.on('data', (chunk) => { if (String(chunk).includes('Server running')) { clearTimeout(timeout); resolve(); } });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error('Test server exited before startup.')); });
  });

  // Fixtures: an Admin, a byline, a hidden sport and hidden event (each with a
  // published article), and a published News article with social metadata.
  const tennis = await prisma.sport.findFirstOrThrow({ where: { slug: 'tennis', isVisible: true } });
  await prisma.user.create({ data: { id: adminId, name: 'Phase B Admin', email: `${adminId}@example.test`, role: 'Admin', avatar: '/favicon.ico', joinedAt: new Date(), passwordHash: hashPassword(password) } });
  await prisma.author.create({ data: { id: authorId, slug: fixture, name: 'Phase B Byline', roleTitle: 'Correspondent', bio: 'Phase B biography', avatar: '/favicon.ico' } });
  await prisma.sport.create({ data: { id: hiddenSportId, slug: hiddenSport, name: 'Hidden Sport', tagline: 't', description: 'd', order: 999, isVisible: false, seo: {} } });
  await prisma.sportEvent.create({ data: {
    id: hiddenEventId, sportSlug: tennis.slug, slug: hiddenEvent, name: 'Hidden Open', shortName: 'Hidden', description: 'd', frequency: 'Annual',
    defaultVenue: 'v', defaultLocation: 'l', currentEditionYear: 2030, isVisible: false, seo: {},
  } });
  const articleBase = { excerpt: 'Fixture excerpt.', featuredImage: '/src/assets/images/tennis_clay_action_1790401872326.jpg', authorId, publishedAt: new Date(), status: 'published' as const, readingTimeMinutes: 1 };
  const socialSeo = { metaTitle: 'Phase B Meta Title | SportingSpy', metaDescription: 'Phase B meta description.', ogTitle: 'Phase B Share Title', ogDescription: 'Phase B share description.', ogImage: 'https://images.unsplash.com/photo-phase-b-share' };
  await prisma.article.create({ data: { ...articleBase, id: newsId, slug: `${fixture}-news`, title: 'Phase B News Fixture', sportSlug: tennis.slug, articleType: 'News', content: `UNIQUE-BODY-${fixture} first paragraph.\n\nSecond paragraph.`, seo: socialSeo } });
  await prisma.article.create({ data: { ...articleBase, id: hiddenArticleId, slug: `${fixture}-hidden`, title: 'Hidden Sport Article', sportSlug: hiddenSport, articleType: 'News', content: 'Hidden.', seo: {} } });
  await prisma.article.create({ data: { ...articleBase, id: draftArticleId, slug: `${fixture}-draft`, title: 'Phase B Draft Fixture', sportSlug: tennis.slug, articleType: 'News', content: 'Private draft.', status: 'draft', seo: {} } });

  // Representative live content.
  const edition = await prisma.eventEdition.findFirstOrThrow({ where: { sportSlug: 'tennis', eventSlug: 'french-open', year: 2027 } });
  const editionArticle = await prisma.article.findFirstOrThrow({ where: { status: 'published', sportSlug: 'tennis', eventSlug: 'french-open', editionYear: 2027, articleType: 'How to Watch' } });
  const general = await prisma.article.findFirstOrThrow({ where: { status: 'published', sportSlug: 'tennis', slug: 'tennis-scoring' } });
  const author = await prisma.author.findUniqueOrThrow({ where: { id: editionArticle.authorId } });
  const draft = await prisma.article.findFirstOrThrow({ where: { status: 'draft' } });
  const nonPublished = await prisma.article.findMany({ where: { status: { not: 'published' } } });
  const noIndexEdition = (await prisma.eventEdition.findMany()).find((e) => (e.seo as any)?.noIndex === true);

  const paths = {
    home: '/',
    sports: '/sports/',
    events: '/events/',
    latest: '/latest/',
    sport: '/tennis/',
    event: '/tennis/french-open/',
    edition: `/tennis/french-open/${edition.year}/`,
    editionArticle: `/tennis/french-open/2027/${editionArticle.slug}/`,
    general: `/tennis/${general.slug}/`,
    news: `/tennis/${fixture}-news/`,
    author: `/author/${author.slug}/`,
    about: '/about/', contact: '/contact/', privacy: '/privacy-policy/', terms: '/terms-and-conditions/', dmca: '/dmca/',
  };

  // ── 1. HTTP status: real 200s ──
  const html: Record<string, string> = {};
  for (const [key, path] of Object.entries(paths)) {
    const result = await page(path, 200);
    assert(result.headers.get('content-type')?.includes('text/html'), `${path}: text/html`);
    html[key] = result.text;
  }
  tested(`HTTP 200 for all ${Object.keys(paths).length} public page types (home, directories, sport, event, edition, edition article, general article, author, static pages)`);

  // ── 2. Real 404s (status code, not just a "not found" screen) ──
  const missing = [
    '/no-such-sport/', '/tennis/no-such-event-or-article/', '/tennis/french-open/1999/', '/tennis/french-open/abc/', '/tennis/french-open/12345/',
    '/tennis/french-open/2027/no-such-article/', '/tennis/french-open/2027/schedule/extra/', '/a/b/c/d/e/', '/author/no-such-author/', '/author/',
    `/${hiddenSport}/`, `/${hiddenSport}/${fixture}-hidden/`, `/tennis/${hiddenEvent}/`, '/events/?sport=no-such-sport', '/latest/?page=999',
    '/latest/?page=abc', '/latest/?type=Not%20A%20Type',
    ...nonPublished.map((a) => (a.eventSlug && a.editionYear ? `/${a.sportSlug}/${a.eventSlug}/${a.editionYear}/${a.slug}/` : `/${a.sportSlug}/${a.slug}/`)),
  ];
  for (const path of missing) {
    const result = await page(path, 404);
    assert(result.text.includes('The requested sports dossier or URL was not found'), `${path}: 404 page body`);
    assert(/<meta name="robots" content="noindex"/.test(result.text), `${path}: 404 is noindex`);
    assert(!canonical(result.text), `${path}: an unknown page must not declare a canonical URL`);
  }
  tested(`real HTTP 404 (noindex, no canonical) for ${missing.length} unknown, invalid, hidden, draft, scheduled and archived URLs`);

  // ── 3. Server-rendered SEO metadata + JSON-LD in the raw HTML ──
  // PHASE H: Spec v1.1 §7.1 recommended homepage title.
  assertSeo(html.home, '/', { title: 'SportingSpy – Latest Sports News, Events, Schedules & Updates', ld: ['Organization', 'WebSite'] });
  assertSeo(html.sports, '/sports/', { ld: ['BreadcrumbList'] });
  assertSeo(html.events, '/events/', { ld: ['BreadcrumbList'] });
  assertSeo(html.latest, '/latest/', { ld: ['BreadcrumbList'] });
  assertSeo(html.sport, '/tennis/', { title: (tennis.seo as any).metaTitle || undefined, ld: ['BreadcrumbList', 'CollectionPage'] });
  // E4: a permanent Event page may emit SportsEvent only for its explicitly
  // selected current Edition when that Edition has an authoritative start date.
  // PHASE R (v2.2): no automatic FAQ; FAQPage only for published editor FAQ with the per-event opt-in (off here).
  assertSeo(html.event, '/tennis/french-open/', { ld: ['BreadcrumbList', 'SportsEvent'] });
  const eventLd = jsonLd(html.event).find((d: any) => d['@type'] === 'SportsEvent');
  assert.equal(eventLd.startDate, edition.startDate); assert.equal(eventLd.endDate, edition.endDate);
  const editionSeo = edition.seo as any;
  assertSeo(html.edition, paths.edition, { title: editionSeo.metaTitle, index: !editionSeo.noIndex, ld: ['BreadcrumbList', 'SportsEvent'] });
  const editionLd = jsonLd(html.edition).find((d: any) => d['@type'] === 'SportsEvent');
  assert.equal(editionLd.startDate, edition.startDate); assert.equal(editionLd.endDate, edition.endDate);
  const eaSeo = editionArticle.seo as any;
  assertSeo(html.editionArticle, paths.editionArticle, { title: eaSeo.metaTitle, description: eaSeo.metaDescription, ld: ['Article', 'BreadcrumbList'] });
  assertSeo(html.general, paths.general, { ld: ['Article', 'BreadcrumbList'] });
  assertSeo(html.author, paths.author, { ld: ['BreadcrumbList', 'ProfilePage'] });
  for (const key of ['about', 'contact', 'privacy', 'terms', 'dmca'] as const) assertSeo(html[key], paths[key], { ld: ['BreadcrumbList'] });
  const breadcrumb = jsonLd(html.editionArticle).find((d: any) => d['@type'] === 'BreadcrumbList');
  assert.deepEqual(breadcrumb.itemListElement.map((i: any) => i.item).filter(Boolean), [`${base}/`, `${base}/tennis/`, `${base}/tennis/french-open/`, `${base}/tennis/french-open/2027/`]);
  tested('title, description, canonical, og:*, twitter:card, robots and page-appropriate JSON-LD are in the initial server HTML of every page type');

  // Type-aware article structured data + Phase A social metadata.
  assertSeo(html.news, paths.news, { title: socialSeo.metaTitle, description: socialSeo.metaDescription, ld: ['BreadcrumbList', 'NewsArticle'] });
  assert.equal(metaContent(html.news, 'property', 'og:title'), socialSeo.ogTitle);
  assert.equal(metaContent(html.news, 'property', 'og:description'), socialSeo.ogDescription);
  assert.equal(metaContent(html.news, 'property', 'og:image'), socialSeo.ogImage);
  assert.equal(metaContent(html.news, 'name', 'twitter:title'), socialSeo.ogTitle);
  assert.equal(metaContent(html.news, 'property', 'og:type'), 'article');
  const newsLd = jsonLd(html.news).find((d: any) => d['@type'] === 'NewsArticle');
  assert.equal(newsLd.headline, 'Phase B News Fixture'); assert.equal(newsLd.mainEntityOfPage, base + paths.news);
  assert.equal(newsLd.author.name, 'Phase B Byline'); assert.equal(newsLd.author.url, `${base}/author/${fixture}/`);
  const eaLd = jsonLd(html.editionArticle).find((d: any) => d['@type'] === 'Article');
  assert.equal(eaLd.image[0], `${base}${editionArticle.featuredImage}`, 'relative images become absolute URLs');
  assert.equal(metaContent(html.editionArticle, 'property', 'og:image'), `${base}${editionArticle.featuredImage}`, 'featured image is the social fallback');
  tested('News-type article -> NewsArticle, guide types -> Article; Phase A ogTitle/ogDescription/ogImage server-rendered with SEO/featured-image fallbacks');

  if (noIndexEdition) {
    const r = await page(`/${noIndexEdition.sportSlug}/${noIndexEdition.eventSlug}/${noIndexEdition.year}/`);
    assert.equal(metaContent(r.text, 'name', 'robots'), 'noindex, follow');
  }
  for (const path of ['/search/', '/search/?q=open', '/latest/?sport=tennis', '/latest/?type=Schedule', '/events/?sport=tennis']) {
    assert.equal(metaContent((await page(path)).text, 'name', 'robots'), 'noindex, follow', `${path}: noindex`);
  }
  for (const path of ['/admin/', '/account/']) assert.equal(metaContent((await page(path)).text, 'name', 'robots'), 'noindex, nofollow', `${path}: private`);
  assert.equal(canonical((await page('/latest/?sport=tennis')).text), `${base}/latest/`);
  tested('robots: editor noIndex honoured; search results and filtered listings noindex,follow; /admin and /account noindex,nofollow');

  // ── 4. Article content is in the HTML before any JavaScript runs ──
  const bodyParagraph = editionArticle.content.trim().split('\n\n').find((p) => !p.startsWith('#') && !/^[-*\d]/.test(p))!;
  assert(decode(html.editionArticle).includes(bodyParagraph.slice(0, 80)), 'article body paragraph in server HTML');
  assert(decode(html.editionArticle).includes(editionArticle.title));
  assert(html.editionArticle.includes('How to Watch'), 'article type rendered');
  assert(decode(html.editionArticle).includes(author.name), 'author rendered');
  assert(html.editionArticle.includes(editionArticle.featuredImage), 'featured image rendered');
  assert(/Published/.test(html.editionArticle), 'publication date rendered');
  tested('article title, type, author, dates, featured image and body are present in the initial server response');

  // ── 5. No full-database hydration; only route-relevant records ──
  assert.equal((await get('/api/data')).status, 404, 'public /api/data removed');
  assert.equal((await get('/api/cms/data')).status, 401, 'CMS dataset requires staff');
  for (const [key, text] of Object.entries(html)) {
    assert(!text.includes('/api/data') && !text.includes('/api/cms/data'), `${key}: no dataset endpoint referenced`);
    assert(!/passwordHash|sessionId|auditLog/i.test(text), `${key}: no private fields`);
    assert(!text.includes(draft.title), `${key}: unpublished title never rendered`);
    for (const a of nonPublished) assert(!text.includes(`/${a.slug}/`), `${key}: no link to unpublished ${a.slug}`);
    assert(!text.includes('Hidden Sport Article') && !text.includes('Hidden Open'), `${key}: hidden content never rendered`);
  }
  // Listings carry summaries only; bodies appear only on their own page.
  for (const key of ['home', 'latest', 'sport', 'event', 'edition', 'author', 'general'] as const) {
    assert(!html[key].includes(`UNIQUE-BODY-${fixture}`), `${key}: no foreign article body`);
  }
  assert(html.news.includes(`UNIQUE-BODY-${fixture}`));
  const golf = await prisma.article.findFirst({ where: { status: 'published', sportSlug: 'golf' } });
  if (golf) assert(!html.editionArticle.includes(golf.title), 'a tennis article page does not carry other sports\' articles');
  tested('no public page references /api/data (removed) or the staff CMS dataset; pages carry only route-relevant, published, visible records and no private fields');

  // ── 6. Server-side search (Phase E replaced the matcher; see verify-phase-e.ts) ──
  const searchHit = await page(`/search/?q=${encodeURIComponent('Roland')}`);
  assert(decode(searchHit.text).includes(editionArticle.title), 'search result rendered server-side');
  const searchMiss = await page(`/search/?q=${encodeURIComponent('zzqqxx-no-match')}`);
  assert(searchMiss.text.includes('No results found for'));
  const typeFiltered = await page(`/search/?q=&type=${encodeURIComponent('How to Watch')}`);
  assert(decode(typeFiltered.text).includes(editionArticle.title));
  await page(`/search/?q=${'x'.repeat(5000)}`);
  tested('search runs on the server from the URL (hits, misses, type filter, oversized query) without the browser holding the dataset');

  // ── 7. Pagination + filters are server-side ──
  const pageSize = 6;
  const totalPublished = await prisma.article.count({ where: { status: 'published', sport: { isVisible: true } } });
  const pages = Math.ceil(totalPublished / pageSize);
  if (pages > 1) {
    const p2 = await page('/latest/?page=2');
    assert(/Page (?:<!-- -->)?2(?:<!-- -->)? of/.test(p2.text));
    assert.equal(canonical(p2.text), `${base}/latest/?page=2`);
  }
  assert(decode((await page('/events/?sport=tennis')).text).includes('French Open'));
  tested(`latest-articles pagination (${totalPublished} published / ${pages} pages) and event/sport filters render on the server`);

  // ── 8. CSP nonce + admin isolation ──
  const a1 = await get('/'); const a2 = await get('/');
  const nonce = (h: Headers) => h.get('content-security-policy')!.match(/'nonce-([^']+)'/)![1];
  assert.notEqual(nonce(a1.headers), nonce(a2.headers), 'nonce differs per response');
  for (const text of Object.values(html)) {
    for (const attrs of scripts(text)) {
      if (attrs.includes('application/ld+json')) continue;
      assert(/\bnonce=/.test(attrs), `executable script without nonce: <script${attrs}>`);
    }
  }
  const forged = await get('/', { headers: { 'content-security-policy': "script-src 'nonce-attacker'" } });
  assert(!forged.text.includes('nonce-attacker') && !forged.text.includes('nonce="attacker"'), 'client cannot supply the nonce');
  const adminHtml = (await page('/admin/')).text;
  const publicChunks = new Set(Object.values(html).flatMap((t) => [...chunkPaths(t)]));
  const adminOnly = [...chunkPaths(adminHtml)].filter((c) => !chunkPaths(html.home).has(c));
  assert(adminOnly.length > 0, 'the CMS has its own route bundle');
  for (const chunk of adminOnly) assert(!publicChunks.has(chunk), `public page loads CMS chunk ${chunk}`);
  tested(`per-request CSP nonce on every executable script (not client-controllable); ${adminOnly.length} CMS-only chunk(s) never loaded by public pages`);

  // ── 9. Real Chrome ──
  if (process.env.PLAYWRIGHT_MODULE) {
    const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
    const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'chrome', headless: true });
    try {
      // JavaScript disabled: the server HTML alone must carry the content.
      const noJs = await browser.newContext({ javaScriptEnabled: false });
      const staticPage = await noJs.newPage();
      await staticPage.goto(base + paths.editionArticle);
      await staticPage.getByRole('heading', { level: 1, name: editionArticle.title }).waitFor();
      assert(await staticPage.getByText(bodyParagraph.slice(0, 60)).first().isVisible());
      await staticPage.goto(base + paths.edition);
      await staticPage.getByRole('heading', { level: 1 }).waitFor().catch(async (error: unknown) => {
        fs.mkdirSync('.codex-runtime/f1-verification', { recursive: true });
        fs.writeFileSync('.codex-runtime/f1-verification/phase-b-nojs-failure.html', await staticPage.content());
        await staticPage.screenshot({ path: '.codex-runtime/f1-verification/phase-b-nojs-failure.png', fullPage: true });
        throw error;
      });
      await noJs.close();

      const context = await browser.newContext();
      const tab = await context.newPage();
      const errors: string[] = [];
      const datasetRequests: string[] = [];
      tab.on('pageerror', (e: Error) => errors.push(String(e)));
      tab.on('console', (m: any) => { if (m.type() === 'error' && !/401|404 \(Not Found\)|Failed to load resource/.test(m.text())) errors.push(m.text()); });
      tab.on('request', (r: any) => { if (/\/api\/(?:cms\/)?data/.test(r.url())) datasetRequests.push(r.url()); });
      for (const path of [paths.home, paths.sport, paths.event, paths.edition, paths.editionArticle]) {
        const response = await tab.goto(base + path);
        assert.equal(response.status(), 200, `${path} in Chrome`);
        await tab.locator('main h1').first().waitFor();
      }
      const notFound = await tab.goto(`${base}/tennis/french-open/1999/`);
      assert.equal(notFound.status(), 404);
      await tab.getByText('The requested sports dossier or URL was not found').waitFor();

      // Client-side navigation through real links keeps canonical URLs.
      await tab.goto(base + paths.edition);
      await tab.locator('article h3 a').first().click();
      await tab.waitForURL((url: URL) => url.pathname.split('/').filter(Boolean).length === 4 && url.pathname.endsWith('/'));
      await tab.locator('main h1').first().waitFor();

      // Staff login from the public header, then the CMS.
      await tab.goto(base + '/');
      await tab.getByRole('button', { name: /Staff Login/ }).click();
      await tab.getByPlaceholder('Email').fill(`${adminId}@example.test`);
      await tab.getByPlaceholder('Password').fill(password);
      await tab.getByRole('button', { name: 'Log In', exact: true }).click();
      await tab.getByText(/Welcome back/).waitFor();
      await tab.goto(`${base}/admin/`);
      await tab.getByRole('heading', { name: 'Content Management System', exact: true }).waitFor();
      await tab.getByRole('button', { name: 'Articles', exact: true }).click();
      await tab.getByText(editionArticle.title).first().waitFor();
      assert.equal(datasetRequests.filter((u) => u.includes('/api/data')).length, 0, 'nothing requests /api/data');
      assert(datasetRequests.every((u) => new URL(u).pathname === '/api/cms/data'), 'only the CMS loads its dataset');
      assert.deepEqual(errors, [], 'no page errors, hydration errors or CSP violations');
      await context.close();
      tested('Chrome: JS-disabled article/edition readable from server HTML; home/sport/event/edition/article/404 render with correct status and no runtime/hydration errors; link navigation; header staff login; CMS loads');
    } finally {
      await browser.close();
    }
  } else console.log('SKIP browser checks: PLAYWRIGHT_MODULE not provided.');

  console.log(`PASS ${checks} Phase B verification groups`);
} finally {
  child.kill();
  if (child.exitCode === null) await once(child, 'exit');
  // Exact, generated fixture IDs only. Never remove pre-existing content.
  await prisma.article.deleteMany({ where: { id: { in: [newsId, hiddenArticleId, draftArticleId] }, authorId } });
  await prisma.sportEvent.deleteMany({ where: { id: hiddenEventId } });
  await prisma.sport.deleteMany({ where: { id: hiddenSportId } });
  await prisma.author.deleteMany({ where: { id: authorId } });
  await prisma.session.deleteMany({ where: { userId: adminId } });
  await prisma.user.deleteMany({ where: { id: adminId } });
  await prisma.auditLog.deleteMany({ where: { userId: adminId } });
  const after = await snapshot();
  assert.deepEqual(after, before, 'Pre-existing database rows changed!');
  assert.deepEqual(protectedFiles.map((file) => digest(fs.readFileSync(file))), filesBefore);
  assert(!serverOutput.includes(password));
  console.log('PASS database integrity: all 12 table counts and full-row hashes unchanged; protected files unchanged; fixtures removed.');
  await prisma.$disconnect();
}
