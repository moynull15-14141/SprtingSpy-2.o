/**
 * PHASE M unified search: Article + Event full-text ranking, multi-word and
 * typo handling, Edition matches, filters, pagination, autocomplete,
 * visibility, validation, indexes, SEO and real-Chrome UX. Disposable
 * fixtures use invented words so pre-existing content cannot interfere;
 * original rows are hash-verified afterwards.
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
import { searchEventIds } from '../services/search/eventSearch';

assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe, 'Phase M requires a local development database.');
assert(fs.existsSync('.next/BUILD_ID'), 'Build before Phase M verification.');
const fixture = `m-${crypto.randomUUID().slice(0, 8)}`;
const hiddenSport = `${fixture}-hidden`;
const authorId = `${fixture}-author`;
const digest = (rows: unknown) => crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const snapshot = async () => ({
  sports: digest(await prisma.sport.findMany({ orderBy: { id: 'asc' } })),
  events: digest(await prisma.sportEvent.findMany({ orderBy: { id: 'asc' } })),
  editions: digest(await prisma.eventEdition.findMany({ orderBy: { id: 'asc' } })),
  articles: digest(await prisma.article.findMany({ orderBy: { id: 'asc' }, select: { id: true, status: true, title: true, updatedAt: true } })),
  authors: digest(await prisma.author.findMany({ orderBy: { id: 'asc' } })),
});
const before = await snapshot();

const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = (probe.address() as { port: number }).port; await new Promise<void>((resolve) => probe.close(() => resolve()));
const base = `http://localhost:${port}`;
let output = '';
const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], { cwd: process.cwd(), windowsHide: true, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', TRUST_PROXY: 'false', NODE_ENV: 'production', APP_ENV: 'production', AUTH_MODE: 'production', DEV_LOGIN_BYPASS: 'false', ALLOWED_ORIGIN: base, SITE_ORIGIN: base }, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => { output += chunk; });

let checks = 0; const pass = (message: string) => { checks++; console.log(`PASS ${message}`); };
const api = async (path: string, expected = 200) => {
  const res = await fetch(base + path);
  const data = await res.json();
  assert.equal(res.status, expected, `${path}: ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  return data;
};
const search = (params: Record<string, string>) => api(`/api/search?${new URLSearchParams({ sport: fixture, ...params })}`);
const titles = (d: any) => d.results.map((r: any) => r.title);
const names = (d: any) => d.events.map((e: any) => e.name);
let completed = false;

try {
  await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`Phase M server did not start: ${output.slice(-500)}`)), 60_000); child.stdout.on('data', (chunk) => { if (String(chunk).includes('Server running')) { clearTimeout(timer); resolve(); } }); child.once('exit', () => { clearTimeout(timer); reject(new Error(`Phase M server exited: ${output.slice(-500)}`)); }); });

  // ── Fixtures (invented words: halvorsen, zylophant, quellmark, brindlewood, glacierfield, arcticdome) ──
  await prisma.sport.create({ data: { id: fixture, slug: fixture, name: 'Mfixture Sport', tagline: 'Fixture', description: 'Fixture', order: 997, isVisible: true, seo: {} } });
  await prisma.sport.create({ data: { id: hiddenSport, slug: hiddenSport, name: 'Mfixture Hidden Sport', tagline: 'Fixture', description: 'Fixture', order: 996, isVisible: false, seo: {} } });
  const ev = (slug: string, data: Record<string, unknown>) => prisma.sportEvent.create({ data: { id: `${fixture}-${slug}`, sportSlug: fixture, slug: `${fixture}-${slug}`, description: '', allEditionYears: [], seo: {}, ...data } as any });
  await ev('grand', { name: 'Halvorsen Grand Trophy', shortName: 'Halvorsen Trophy', defaultVenue: 'Arcticdome', defaultLocation: 'Tromsø, Norway', description: 'The northern zylophant championship.', currentEditionYear: 2031 });
  await ev('junior', { name: 'Halvorsen Junior Series', shortName: 'Halvorsen Junior Series', description: 'A development circuit.' });
  await ev('secret', { name: 'Halvorsen Secret Cup', shortName: 'Halvorsen Secret Cup', isVisible: false });
  await prisma.sportEvent.create({ data: { id: `${hiddenSport}-ghost`, sportSlug: hiddenSport, slug: `${hiddenSport}-ghost`, name: 'Halvorsen Ghost Cup', shortName: 'Halvorsen Ghost Cup', description: '', allEditionYears: [], seo: {} } });
  await prisma.eventEdition.create({ data: { id: `${fixture}-grand-2031`, sportSlug: fixture, eventSlug: `${fixture}-grand`, year: 2031, title: '2031 Halvorsen Grand Trophy', venue: 'Glacierfield Arena', location: 'Bergen', description: '', seo: {}, status: 'upcoming' } });
  await prisma.author.create({ data: { id: authorId, slug: authorId, name: 'M Fixture Author', roleTitle: 'Reporter', bio: 'Fixture.', avatar: '/favicon.ico' } });
  const art = (id: string, data: Record<string, unknown>) => prisma.article.create({ data: { id: `${fixture}-${id}`, slug: `${fixture}-${id}`, sportSlug: fixture, articleType: 'News', excerpt: 'Fixture excerpt.', content: 'Fixture body.', featuredImage: '/favicon.ico', authorId, publishedAt: new Date('2030-01-01T00:00:00Z'), status: 'published', readingTimeMinutes: 2, seo: {}, ...data } as any });
  await art('exact', { title: 'Halvorsen Grand Trophy preview', excerpt: 'Who will lift the trophy.', publishedAt: new Date('2030-01-02T00:00:00Z') });
  await art('later', { title: 'Notes from the north', excerpt: 'Halvorsen notes.', publishedAt: new Date('2030-03-01T00:00:00Z') });
  await art('body', { title: 'Tactics explained', content: 'A deep look at the quellmark formation used by champions.', articleType: 'Analysis' });
  await art('draft', { title: 'Halvorsen draft quellmark secret', status: 'draft' });
  await art('hidden-event', { title: 'Halvorsen secret cup coverage', eventSlug: `${fixture}-secret` });
  for (let i = 1; i <= 15; i++) await art(`bulk-${String(i).padStart(2, '0')}`, { title: `Brindlewood report ${i}`, publishedAt: new Date(Date.UTC(2029, 0, i)) });

  // ── 1. Article search ──
  const exact = await search({ q: 'Halvorsen Grand Trophy preview' });
  assert.equal(titles(exact)[0], 'Halvorsen Grand Trophy preview', 'exact title first');
  assert((await search({ q: 'halvors' })).results.some((r: any) => r.title === 'Halvorsen Grand Trophy preview'), 'prefix');
  assert.deepEqual(titles(await search({ q: 'grand trophy preview' })), ['Halvorsen Grand Trophy preview'], 'multi-word AND');
  assert.deepEqual(titles(await search({ q: 'quellmark' })), ['Tactics explained'], 'body match; draft excluded');
  assert.deepEqual(titles(await search({ q: 'quellmark', type: 'News' })), [], 'category filter combines with query');
  assert.deepEqual(titles(await search({ q: 'quellmark', type: 'Analysis' })), ['Tactics explained']);
  const typo = await search({ q: 'Halvorsn Grand' });
  assert(typo.mode === 'fuzzy' && titles(typo).includes('Halvorsen Grand Trophy preview'), 'article typo fallback');
  const browse = await search({});
  assert(browse.mode === 'browse' && browse.total === 18 && titles(browse)[0] === 'Notes from the north', 'empty query lists newest visible articles (no drafts, no hidden-event articles)');
  pass('Articles: exact title first, prefix, multi-word AND, body, category filter, typo fallback, empty-query browse; drafts and hidden-event articles excluded');

  // ── 2. Event search ──
  const evExact = await search({ q: 'Halvorsen Grand Trophy', kind: 'event' });
  assert.deepEqual(names(evExact), ['Halvorsen Grand Trophy'], 'exact name; multi-word excludes the Junior Series');
  const partial = await search({ q: 'halvor', kind: 'event' });
  assert.deepEqual(names(partial).sort(), ['Halvorsen Grand Trophy', 'Halvorsen Junior Series'], 'partial name; hidden/hidden-sport Events excluded');
  assert.equal(partial.eventTotal, 2);
  const ranked = await search({ q: 'Halvorsen Junior Series', kind: 'event' });
  assert.equal(names(ranked)[0], 'Halvorsen Junior Series');
  assert.deepEqual(names(await search({ q: 'tromsø', kind: 'event' })), ['Halvorsen Grand Trophy'], 'location');
  assert.deepEqual(names(await search({ q: 'arcticdome', kind: 'event' })), ['Halvorsen Grand Trophy'], 'venue');
  assert.deepEqual(names(await search({ q: 'zylophant', kind: 'event' })), ['Halvorsen Grand Trophy'], 'description');
  assert.equal((await api(`/api/search?q=halvorsen&kind=event&sport=${hiddenSport}`)).eventTotal, 0, 'hidden sport');
  const evTypo = await search({ q: 'halvorsem trophy', kind: 'event' });
  assert(evTypo.mode === 'fuzzy' && names(evTypo)[0] === 'Halvorsen Grand Trophy' && evTypo.eventTotal === 1, 'event typo');
  const byYear = await search({ q: 'halvorsen 2031', kind: 'event' });
  assert.deepEqual(byYear.events.map((e: any) => [e.name, e.matchedEdition?.year]), [['Halvorsen Grand Trophy', 2031]], 'Edition year → Event with matched Edition');
  const byVenue = await search({ q: 'glacierfield', kind: 'event' });
  assert.equal(byVenue.events[0].matchedEdition.url, `/${fixture}/${fixture}-grand/2031/`, 'Edition venue → Event (Edition as detail)');
  assert.equal((await search({ q: 'halvorsen', kind: 'event' })).events.filter((e: any) => e.name === 'Halvorsen Grand Trophy').length, 1, 'one result per Event even when Event and Edition both match');
  assert.equal((await search({ q: 'halvorsen', kind: 'event' })).events.find((e: any) => e.name === 'Halvorsen Grand Trophy').matchedEdition, null, 'Edition not shown when the Event itself matched and no year was named');
  assert.equal((await search({ q: 'secret cup', kind: 'event' })).eventTotal, 0);
  pass('Events: exact/partial/multi-word name, ranking, location/venue/description, typo, Edition year/venue as a detail, no duplicates, hidden Events and hidden sports excluded');

  // ── 3. Unified search, filters, pagination ──
  const all = await search({ q: 'halvorsen' });
  assert(all.kind === 'all' && all.events.length === 2 && all.results.length >= 2, 'All: Articles + Events');
  assert(!titles(all).includes('Halvorsen draft quellmark secret') && !titles(all).includes('Halvorsen secret cup coverage'));
  const onlyEvents = await search({ q: 'halvorsen', kind: 'event' });
  assert(onlyEvents.results.length === 0 && onlyEvents.events.length === 2 && onlyEvents.total === all.total, 'Events view returns Events; Article count kept for tabs');
  const onlyArticles = await search({ q: 'halvorsen', kind: 'article' });
  assert(onlyArticles.events.length === 0 && onlyArticles.eventTotal === 2 && onlyArticles.total === all.total, 'Articles view returns Articles; Event count kept for tabs');
  assert.equal((await search({ q: 'halvorsen', type: 'News' })).events.length, 0, 'article-only filters omit the Event group');
  assert.equal((await api(`/api/search?q=halvorsen&sport=tennis&kind=event`)).events.filter((e: any) => e.name.startsWith('Halvorsen')).length, 0, 'sport filter applies to Events');
  const pages = await Promise.all([1, 2, 3, 4].map((page) => search({ q: 'brindlewood', limit: '5', page: String(page) })));
  const seen = pages.flatMap((p) => titles(p));
  assert.equal(pages[0].total, 15); assert.equal(pages[0].totalPages, 3);
  assert.equal(seen.length, 15); assert.equal(new Set(seen).size, 15, 'no duplicates across pages');
  assert.equal(pages[3].results.length, 0, 'page past the end is empty, not an error');
  assert.deepEqual(titles(await search({ q: 'brindlewood', limit: '5', page: '2' })), titles(pages[1]), 'stable order');
  const evPages = await Promise.all([1, 2].map((page) => search({ q: 'halvorsen', kind: 'event', limit: '1', page: String(page) })));
  assert.equal(evPages[0].totalPages, 2); assert.notEqual(names(evPages[0])[0], names(evPages[1])[0], 'Event pagination');
  pass('Unified: All / Articles / Events views, counts for tabs, sport + type filters combine, Article and Event pagination stable without duplicates');

  // ── 4. Autocomplete ──
  const sugArticle = await api('/api/search/suggestions?q=brindlew');
  assert(sugArticle.articles.some((a: any) => a.title.startsWith('Brindlewood report')));
  const sugEvent = await api('/api/search/suggestions?q=halvors');
  assert(sugEvent.events.some((e: any) => e.name === 'Halvorsen Grand Trophy' && e.sportName === 'Mfixture Sport'));
  assert(!sugEvent.events.some((e: any) => /Secret|Ghost/.test(e.name)) && !sugEvent.articles.some((a: any) => /draft|secret/i.test(a.title)), 'hidden content excluded');
  assert((await api('/api/search/suggestions?q=halvorsem')).events.some((e: any) => e.name.startsWith('Halvorsen')), 'near-match Event suggestion');
  const urls = [...sugEvent.sports, ...sugEvent.events, ...sugEvent.articles].map((x: any) => x.url);
  assert.equal(new Set(urls).size, urls.length, 'no duplicate suggestion URLs');
  assert(sugEvent.events.length <= 3 && sugEvent.articles.length <= 6);
  pass('Autocomplete: Article + Event suggestions, partial and near matches, hidden content excluded, unique URLs, limits');

  // ── 5. Validation + edge cases ──
  for (const bad of ['page=0', 'page=501', 'limit=0', 'limit=51', 'kind=video', 'kind=event&kind=article', `q=${'x'.repeat(201)}`, 'unknown=1']) await api(`/api/search?${bad}`, 400);
  const longQ = await api(`/api/search?q=${'halvorsen '.repeat(15)}`);
  assert(longQ.query.length <= 100, 'long queries are capped');
  assert.equal((await api('/api/search?q=%20%20%20')).mode, 'browse', 'whitespace-only = empty query');
  const punct = await search({ q: '!!!' });
  assert(punct.total === 0 && punct.eventTotal === 0, 'punctuation-only matches nothing');
  assert.deepEqual(names(await search({ q: 'halvorsen!!! grand   trophy', kind: 'event' })), ['Halvorsen Grand Trophy'], 'punctuation and repeated spaces normalized');
  assert.equal((await search({ q: 'zzqqxxnothing' })).total, 0);
  const cms = await fetch(`${base}/api/cms/articles/search?kind=event`);
  assert([400, 401].includes(cms.status), 'kind is not a CMS parameter');
  assert.equal((await searchEventIds({ q: 'halvorsen', limit: 999 })).pageSize, 50, 'service caps the page size');
  pass('Validation: page/limit/kind/repeated/unknown params rejected; long, blank, punctuation-only and spaced queries normalized; no-result path');

  // ── 6. Indexes + SEO ──
  const indexes = await prisma.$queryRaw<{ tablename: string; indexname: string; indexdef: string }[]>`SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('Article', 'SportEvent', 'EventEdition')`;
  for (const name of ['SportEvent_searchVector_idx', 'EventEdition_searchVector_idx', 'SportEvent_name_trgm_idx', 'Article_searchVector_idx', 'Article_title_trgm_idx']) assert(indexes.some((i) => i.indexname === name), `${name} exists`);
  const defs = indexes.map((i) => `${i.tablename}:${i.indexdef.replace(/INDEX "?[^" ]+"? ON/, 'INDEX ON')}`);
  assert.equal(new Set(defs).size, defs.length, 'no duplicate index definitions');
  const plan = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
    return tx.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(`EXPLAIN SELECT id FROM "SportEvent" WHERE "searchVector" @@ to_tsquery('english', 'halvorsen:*')`);
  });
  assert(plan.some((r) => r['QUERY PLAN'].includes('SportEvent_searchVector_idx')), 'Event full-text uses its GIN index');
  const html = await (await fetch(`${base}/search/?q=halvorsen&kind=event&sport=${fixture}`)).text();
  assert(html.includes('name="robots" content="noindex, follow"') && html.includes(`rel="canonical" href="${base}/search/"`), 'search URLs stay noindex with the /search/ canonical');
  pass('Indexes: Event/Edition GIN + Event name trigram present, used by the planner, no duplicates; search pages noindex with /search/ canonical');

  // ── 7. Browser ──
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await (await browser.newContext()).newPage(); const errors: string[] = [];
    // /search streams its results through a Suspense boundary; while React swaps the
    // streamed content in, a hidden copy briefly coexists. Every step waits for the
    // network to go idle (swap finished) and then expects exactly one visible match.
    const streamed = () => page.waitForFunction(() => {
      const headings = document.querySelectorAll('#search-results-heading');
      return headings.length === 1 && !headings[0].closest('[hidden]') && document.querySelectorAll('#event-results-heading').length <= 1;
    }, undefined, { timeout: 20_000 });
    const go = async (url: string) => { await page.goto(url); await streamed(); };
    const settled = async (text: string | RegExp) => {
      await streamed();
      const visible = page.getByText(text).locator('visible=true');
      await visible.first().waitFor();
      assert.equal(await visible.count(), 1, `one visible "${text}"`);
    };
    page.on('pageerror', (error) => errors.push(error.message));
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await go(`${base}/search/?q=halvorsen&sport=${fixture}`);
      await page.locator('#event-results-heading').waitFor();
      assert.equal(await page.locator('[data-result-kind="event"]').count(), 2, 'Event group');
      assert(await page.getByRole('link', { name: 'Halvorsen Grand Trophy preview' }).isVisible(), 'Article list');
      assert(await page.getByRole('link', { name: /^Events \(2\)$/ }).isVisible() && await page.getByRole('link', { name: /^Articles \(\d+\)$/ }).isVisible());
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), `overflow at ${viewport.width}px`);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole('link', { name: /^Events \(2\)$/ }).click();
    await page.waitForURL(/kind=event/);
    await streamed();
    await page.locator('#search-results-heading').waitFor();
    assert((await page.locator('#search-results-heading').textContent())!.includes('2 events for'));
    assert.equal(await page.locator('[data-result-kind="event"]').count(), 2);
    assert.equal(await page.getByRole('combobox', { name: /Category/ }).count(), 0, 'Article-only filters hidden in the Events view');
    await go(`${base}/search/?q=halvorsem+trophy&kind=event&sport=${fixture}`);
    await settled('Showing close matches instead');
    assert(await page.getByRole('link', { name: 'Halvorsen Grand Trophy' }).isVisible(), 'typo result rendered');
    await go(`${base}/search/?q=glacierfield&kind=event&sport=${fixture}`);
    assert(await page.getByRole('link', { name: '2031 Halvorsen Grand Trophy' }).isVisible(), 'matched Edition link');
    await go(`${base}/search/?q=brindlewood&sport=${fixture}`);
    await settled('Page 1 of 2');
    await page.getByRole('link', { name: 'Next →' }).click();
    await settled('Page 2 of 2');
    assert.equal(await page.locator('ol li').filter({ hasText: 'Brindlewood report' }).count(), 3, 'second page has the remaining 3');
    await go(`${base}/search/?q=zzqqxxnothing`);
    await settled(/No results found for/);
    // Autocomplete: typed, typed result types, keyboard selection.
    await go(`${base}/search/`);
    await page.getByRole('combobox', { name: 'Search SportingSpy' }).fill('halvors');
    await page.getByRole('option', { name: /Halvorsen Grand Trophy.*Mfixture Sport · Event/ }).waitFor();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForURL(new RegExp(`/${fixture}/`));
    assert.deepEqual(errors, []);
    pass('Real Chrome: grouped Events + Articles at 1440/390 px, type tabs, Events view, typo notice, Edition link, pagination, no-result state, typed autocomplete with keyboard');
  } finally { await browser.close(); }
  completed = true;
  console.log(`PASS ${checks} Phase M integration groups`);
} finally {
  child.kill(); if (child.exitCode === null) await once(child, 'exit');
  await prisma.article.deleteMany({ where: { id: { startsWith: fixture } } });
  await prisma.eventEdition.deleteMany({ where: { sportSlug: { in: [fixture, hiddenSport] } } });
  await prisma.sportEvent.deleteMany({ where: { sportSlug: { in: [fixture, hiddenSport] } } });
  await prisma.sport.deleteMany({ where: { slug: { in: [fixture, hiddenSport] } } });
  await prisma.author.deleteMany({ where: { id: authorId } });
  assert.deepEqual(await snapshot(), before, 'Pre-existing Sport/Event/Edition/Article/Author rows changed.');
  console.log('PASS original Sport/Event/Edition/Article/Author full-row hashes restored');
  await prisma.$disconnect();
  if (!completed) process.exitCode = 1;
}
