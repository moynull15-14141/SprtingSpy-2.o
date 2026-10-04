/**
 * E5 Event discovery, contextual FAQ, SEO and structured data: timing rule
 * parity (JS ↔ SQL), discovery/pagination/indexability, data-backed FAQ
 * suggestions and editor-approved FAQ with opt-in FAQPage JSON-LD, scope rules,
 * Event/Edition metadata and schema, search suggestions, admin FAQ scope UI
 * and real-Chrome responsive checks. Disposable fixtures; original rows are
 * hash-verified afterwards.
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
import { editionTimingWhere } from '../services/public/content';
import { editionTiming, utcToday, type EditionTiming } from '../../src/lib/eventTiming';
import { buildEventFaq } from '../../src/lib/eventFaq';
import { parseFaqInput } from '../faq';

assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe, 'E5 requires a local development database.');
assert(fs.existsSync('.next/BUILD_ID'), 'Build before E5 verification.');
const fixture = `e5-${crypto.randomUUID().slice(0, 8)}`;
const password = `Phase-E5-${crypto.randomUUID()}`;
const adminId = `${fixture}-admin`;
const digest = (rows: unknown) => crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const snapshot = async () => ({
  sports: digest(await prisma.sport.findMany({ orderBy: { id: 'asc' } })),
  events: digest(await prisma.sportEvent.findMany({ orderBy: { id: 'asc' } })),
  editions: digest(await prisma.eventEdition.findMany({ orderBy: { id: 'asc' } })),
  faqs: digest(await prisma.faqEntry.findMany({ orderBy: { id: 'asc' } })),
  articles: digest(await prisma.article.findMany({ orderBy: { id: 'asc' }, select: { id: true, status: true, updatedAt: true } })),
});
const before = await snapshot();

const today = utcToday();
const shift = (days: number) => new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = (probe.address() as { port: number }).port; await new Promise<void>((resolve) => probe.close(() => resolve()));
const base = `http://localhost:${port}`;
let output = '';
const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], { cwd: process.cwd(), windowsHide: true, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', TRUST_PROXY: 'false', NODE_ENV: 'production', APP_ENV: 'production', AUTH_MODE: 'production', DEV_LOGIN_BYPASS: 'false', ALLOWED_ORIGIN: base, SITE_ORIGIN: base }, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => { output += chunk; });

const get = async (path: string, expected = 200) => { const response = await fetch(base + path, { redirect: 'manual' }); const text = await response.text(); assert.equal(response.status, expected, `${path}: ${response.status}, expected ${expected}`); return text; };
const jsonLd = (html: string) => [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((match) => JSON.parse(match[1]));
const decode = (s: string) => s.replace(/<!-- -->/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
const meta = (html: string, pattern: RegExp) => html.match(pattern)?.[1];
let checks = 0; const pass = (message: string) => { checks++; console.log(`PASS ${message}`); };

class Client {
  cookies = new Map<string, string>();
  async request(path: string, method = 'GET', body?: unknown) {
    const headers: Record<string, string> = { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET') headers['x-csrf-token'] = this.cookies.get('csrf_token') ?? '';
    const res = await fetch(base + path, { method, headers, redirect: 'manual', body: body === undefined ? undefined : JSON.stringify(body) });
    for (const raw of res.headers.getSetCookie()) { const [pair] = raw.split(';'); const i = pair.indexOf('='); this.cookies.set(pair.slice(0, i), pair.slice(i + 1)); }
    const text = await res.text(); let data: any; try { data = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, text, data };
  }
}

const sport = fixture;
const ev = (slug: string) => `${fixture}-${slug}`;
let completed = false;

try {
  await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`E5 server did not start: ${output.slice(-500)}`)), 60_000); child.stdout.on('data', (chunk) => { if (String(chunk).includes('Server running')) { clearTimeout(timer); resolve(); } }); child.once('exit', () => { clearTimeout(timer); reject(new Error(`E5 server exited: ${output.slice(-500)}`)); }); });

  // ── Fixtures ──
  await prisma.user.create({ data: { id: adminId, name: 'E5 Admin', email: `${adminId}@example.test`, role: 'Admin', avatar: '', joinedAt: new Date(), passwordHash: hashPassword(password) } });
  await prisma.sport.create({ data: { id: sport, slug: sport, name: 'E5 Fixture Sport', tagline: 'Fixture', description: 'Fixture', order: 998, isVisible: true, seo: {}, eventConfiguration: { terminology: { event: 'Cup', participant: 'Teams' }, fields: [] } } });
  const mk = (slug: string, data: Record<string, unknown> = {}) => prisma.sportEvent.create({ data: { id: ev(slug), sportSlug: sport, slug: ev(slug), name: `E5 ${slug} Cup`, shortName: `E5 ${slug}`, description: '', allEditionYears: [], seo: {}, ...data } });
  // A complete Event: every FAQ fact present; current Edition is upcoming.
  await mk('full', { name: 'E5 Full Cup', description: 'An authoritative E5 Cup overview. '.repeat(12), frequency: 'Every two years', defaultVenue: 'Default Arena', defaultLocation: 'Sylhet, Bangladesh', currentEditionYear: 2099, featured: true });
  await mk('sparse', { name: 'E5 Sparse Cup' });
  await mk('hidden', { name: 'E5 Hidden Cup', isVisible: false, currentEditionYear: 2099 });
  await mk('noindex', { name: 'E5 Noindex Cup', seo: { noIndex: true } });
  for (let i = 0; i < 10; i++) await mk(`bulk-${String(i).padStart(2, '0')}`);
  const ed = (eventSlug: string, year: number, data: Record<string, unknown>) => prisma.eventEdition.create({ data: { id: `${ev(eventSlug)}-${year}`, sportSlug: sport, eventSlug: ev(eventSlug), year, title: `E5 ${eventSlug} ${year}`, description: '', seo: {}, status: 'upcoming', ...data } });
  await ed('full', 2099, { title: 'E5 Full Cup 2099', startDate: shift(30), endDate: shift(34), venue: 'Edition Stadium', location: 'Dhaka, Bangladesh', participantsCount: 16, defendingChampions: [{ name: 'Fixture United', category: 'Champions' }] });
  await ed('full', 2098, { title: 'E5 Full Cup 2098', startDate: shift(-2), endDate: shift(2), status: 'active' });
  await ed('full', 2097, { title: 'E5 Full Cup 2097', startDate: shift(-60), endDate: shift(-55), status: 'upcoming' }); // stale status, past dates
  await ed('full', 2096, { title: 'E5 Full Cup 2096', status: 'completed' });
  await ed('full', 2095, { title: 'E5 Full Cup 2095', status: 'upcoming' }); // undated upcoming
  await ed('full', 2094, { title: 'E5 Full Cup 2094', status: 'active' }); // undated active
  await ed('full', 2093, { title: 'E5 Full Cup 2093', startDate: today, status: 'upcoming' }); // single date today
  await ed('full', 2092, { title: 'E5 Full Cup 2092', endDate: shift(5), status: 'upcoming' }); // end date only, future
  await ed('full', 2091, { title: 'E5 Full Cup 2091', startDate: shift(10), endDate: shift(12), status: 'archived' });
  await ed('hidden', 2099, { title: 'E5 Hidden Cup 2099', startDate: shift(30), endDate: shift(31) });
  await ed('noindex', 2099, { title: 'E5 Noindex Cup 2099', startDate: shift(40) });
  const expected: Record<string, EditionTiming> = { 2099: 'upcoming', 2098: 'ongoing', 2097: 'past', 2096: 'past', 2095: 'upcoming', 2094: 'ongoing', 2093: 'ongoing', 2092: 'upcoming', 2091: 'past' };

  // ── 1. Timing rule parity ──
  const fullEditions = await prisma.eventEdition.findMany({ where: { sportSlug: sport, eventSlug: ev('full') } });
  for (const row of fullEditions) assert.equal(editionTiming(row, today), expected[row.year], `JS timing for ${row.year}`);
  for (const timing of ['upcoming', 'ongoing', 'past'] as const) {
    const years = (await prisma.eventEdition.findMany({ where: { AND: [{ sportSlug: sport, eventSlug: ev('full') }, editionTimingWhere(timing, today)] }, select: { year: true } })).map((r) => r.year).sort();
    assert.deepEqual(years, Object.entries(expected).filter(([, t]) => t === timing).map(([y]) => Number(y)).sort(), `SQL timing ${timing}`);
  }
  pass('Edition timing: JS and SQL rules agree for dated, single-date, end-only, undated, stale-status, completed and archived editions');

  // ── 2. Discovery ──
  const directory = decode(await get(`/events/?sport=${sport}`));
  assert(directory.includes('Happening now') && directory.includes('Upcoming editions') && directory.includes('Recently completed'));
  assert(directory.includes('E5 Full Cup 2099') && directory.includes('E5 Full Cup 2098') && !directory.includes('E5 Hidden Cup'));
  assert(directory.includes(`E5 Fixture Sport events`) && directory.includes('Page 1 of 2'), 'event index paginates 13 visible events at 12 per page');
  assert(directory.includes('Upcoming (4)') && directory.includes('Happening now (3)') && directory.includes('Past (3)'), 'timing counts exclude hidden events and match the rules');
  assert.equal(meta(directory, /<meta name="robots" content="([^"]+)"/), 'noindex, follow');
  const page2 = decode(await get(`/events/?sport=${sport}&page=2`));
  assert(page2.includes('Page 2 of 2') && !page2.includes('Happening now</h2>'), 'previews appear on the first page only');
  await get(`/events/?sport=${sport}&page=3`, 404);
  const upcoming = decode(await get(`/events/?sport=${sport}&when=upcoming`));
  // Dated editions by start date; editions without a start date follow (end-date-only before fully undated).
  const order = ['E5 Full Cup 2099', 'E5 Noindex Cup 2099', 'E5 Full Cup 2092', 'E5 Full Cup 2095'].map((t) => upcoming.indexOf(t));
  assert(order.every((i) => i > 0) && order.every((v, i) => i === 0 || v > order[i - 1]), `upcoming is soonest-first with undated last: ${order}`);
  assert(!upcoming.includes('E5 Full Cup 2097') && !upcoming.includes('E5 Hidden Cup'));
  const past = decode(await get(`/events/?sport=${sport}&when=past`));
  assert(past.includes('E5 Full Cup 2097') && past.includes('E5 Full Cup 2096') && past.includes('E5 Full Cup 2091') && !past.includes('E5 Full Cup 2099'));
  await get('/events/?when=soon', 404);
  await get('/events/?sport=Bad_Slug', 404);
  const index = await get('/events/');
  assert.equal(meta(index, /<meta name="robots" content="([^"]+)"/), 'index, follow');
  assert(index.includes(`rel="canonical" href="${base}/events/"`));
  pass('Discovery: sport + timing filters, bounded pagination, ordering, counts, hidden-event exclusion, noindex filtered views, 404 for invalid params');

  // ── 3. Event FAQ suggestions must never publish themselves ──
  const fullPath = `/${sport}/${ev('full')}/`;
  const full = decode(await get(fullPath));
  const visibleQuestions = [...full.matchAll(/<details[^>]*data-faq-source="[^"]+"[^>]*>.*?<h3[^>]*>(.*?)<\/h3>/gs)].map((m) => m[1]);
  const schemas = jsonLd(full);
  const faqLd = schemas.filter((s) => s['@type'] === 'FAQPage');
  assert.equal(faqLd.length, 0, 'FAQ structured data is off by default');
  assert.deepEqual(visibleQuestions, [], 'stored facts suggest questions but never publish them');
  const sparse = decode(await get(`/${sport}/${ev('sparse')}/`));
  assert(!sparse.includes('frequently asked questions') && !jsonLd(sparse).some((s) => s['@type'] === 'FAQPage'), 'no facts → no FAQ and no FAQPage');
  const pastFaq = buildEventFaq({ event: { name: 'X', eventType: null, frequency: null, defaultVenue: null, defaultLocation: null } as any, sport: { name: 'S' }, terminology: { event: 'Event', participant: 'Participants' }, currentEdition: { title: 'X 2020', status: 'completed', startDate: '2020-01-01', endDate: '2020-01-02', venue: 'V', location: null } as any, editorFaqs: [], today });
  assert.deepEqual(pastFaq.map((f) => f.question), ['When was X 2020?', 'Where was X 2020 held?', 'What sport is X?']);
  assert(pastFaq[0].answer.includes('took place') && pastFaq[1].answer.includes('was held at V.'));
  pass('Event FAQ: facts produce suggestions with the right tense, but no public question or FAQPage before editor approval');

  // ── 4. Editor Event FAQ via API (+ scope rules) ──
  assert.equal(parseFaqInput({ question: 'Valid question?', answer: 'Yes', eventId: 5 }, false).ok, false);
  assert.equal(parseFaqInput({ question: 'Valid question?', answer: 'Yes', eventId: null }, false).ok, true);
  const anon = new Client();
  await anon.request('/api/auth/me');
  assert.equal((await anon.request('/api/faq', 'POST', { question: 'Anonymous event question?', answer: 'No', eventId: ev('full') })).status, 401);
  const admin = new Client();
  await admin.request('/api/auth/me');
  assert.equal((await admin.request('/api/auth/login', 'POST', { email: `${adminId}@example.test`, password })).status, 200);
  assert.equal((await admin.request('/api/faq', 'POST', { question: `${fixture} bad scope?`, answer: 'No', eventId: 'no-such-event' })).status, 400);
  const published = await admin.request('/api/faq', 'POST', { question: 'How often is E5 Full Cup held?', answer: `Editor answer ${fixture}.\n\nSecond paragraph.`, status: 'published', eventId: ev('full') });
  assert.equal(published.status, 201, published.text);
  const draft = await admin.request('/api/faq', 'POST', { question: `${fixture} draft event question?`, answer: 'Hidden draft.', status: 'draft', eventId: ev('full') });
  const hiddenFaq = await admin.request('/api/faq', 'POST', { question: `${fixture} hidden event question?`, answer: 'Hidden event.', status: 'published', eventId: ev('hidden') });
  assert.equal(draft.status, 201); assert.equal(hiddenFaq.status, 201);
  const withEditor = decode(await get(fullPath));
  const editorQs = [...withEditor.matchAll(/<details[^>]*>\s*<summary[^>]*>\s*<h3[^>]*>(.*?)<\/h3>/gs)].map((m) => m[1]);
  assert.equal(editorQs[0], 'How often is E5 Full Cup held?', 'editor-approved entry is visible');
  assert.equal(editorQs.length, 1, 'only the editor-approved question is public');
  assert(withEditor.includes(`Editor answer ${fixture}.`) && !withEditor.includes(`${fixture} draft event question?`));
  assert(!jsonLd(withEditor).some((s) => s['@type'] === 'FAQPage'), 'published FAQ alone does not enable structured data');
  assert.equal((await admin.request(`/api/events/${ev('full')}`, 'PUT', { faqSchemaEnabled: true })).status, 200);
  const withSchema = decode(await get(fullPath));
  const ld = jsonLd(withSchema).find((s) => s['@type'] === 'FAQPage');
  assert.deepEqual(ld.mainEntity.map((q: any) => q.name), editorQs);
  assert.equal(ld.mainEntity[0].acceptedAnswer.text, `Editor answer ${fixture}.\n\nSecond paragraph.`);
  const globalFaqResponse = await fetch(`${base}/faq/`);
  assert([200, 404].includes(globalFaqResponse.status), 'optional site-wide FAQ is either enabled or a real 404');
  const globalFaq = decode(await globalFaqResponse.text());
  assert(!globalFaq.includes(`Editor answer ${fixture}`) && !globalFaq.includes(`${fixture} hidden event question?`), 'Event-scoped entries never appear on the site-wide FAQ page');
  await get(`/${sport}/${ev('hidden')}/`, 404);
  const blocked = await admin.request(`/api/events/${ev('sparse')}`, 'DELETE');
  assert.equal(blocked.status, 200, 'an Event without FAQ/editions can still be deleted');
  const scoped = await admin.request('/api/faq', 'POST', { question: `${fixture} delete guard question?`, answer: 'Guard.', eventId: ev('bulk-00') });
  assert.equal(scoped.status, 201);
  const guard = await admin.request(`/api/events/${ev('bulk-00')}`, 'DELETE');
  assert(guard.status === 400 && /FAQ/.test(guard.data.error), 'Event delete is refused while FAQ entries reference it');
  pass('Editor Event FAQ: auth + scope validation, published only, opt-in synchronized JSON-LD, no scope leakage, hidden Event excluded, delete guard');

  // ── 5. SEO + schema ──
  const fullLd = jsonLd(withEditor);
  const sportsEvent = fullLd.filter((s) => s['@type'] === 'SportsEvent');
  assert.equal(sportsEvent.length, 1);
  assert.deepEqual(Object.keys(sportsEvent[0]).sort(), ['@context', '@id', '@type', 'description', 'endDate', 'eventStatus', 'location', 'name', 'sport', 'startDate', 'url'].sort(), 'only fact-backed properties');
  assert.equal(sportsEvent[0]['@id'], `${base}/${sport}/${ev('full')}/2099/#event`);
  assert(!JSON.stringify(fullLd).match(/offers|organizer|eventAttendanceMode|price/));
  const crumbs = fullLd.find((s) => s['@type'] === 'BreadcrumbList');
  assert.deepEqual(crumbs.itemListElement.map((i: any) => i.name), ['Home', 'Sports', 'E5 Fixture Sport', 'E5 Full Cup']);
  const description = meta(withEditor, /<meta name="description" content="([^"]+)"/)!;
  assert(description.length <= 160 && description.startsWith('An authoritative E5 Cup overview.') && description.endsWith('…'), `long description capped: ${description.length}`);
  assert.equal(meta(sparse, /<meta name="description" content="([^"]+)"/), 'E5 Sparse Cup – E5 Fixture Sport event guide on SportingSpy.');
  assert(withEditor.includes(`rel="canonical" href="${base}${fullPath}"`) && withEditor.includes('property="og:title"') && withEditor.includes('name="twitter:card"'));
  assert.equal((withEditor.match(/rel="canonical"/g) || []).length, 1, 'single canonical');
  assert.equal((withEditor.match(/<title>/g) || []).length, 1, 'single title');
  const edition = decode(await get(`/${sport}/${ev('full')}/2099/`));
  const editionLd = jsonLd(edition);
  const editionEvent = editionLd.find((s) => s['@type'] === 'SportsEvent');
  assert.equal(editionEvent['@id'], sportsEvent[0]['@id'], 'Event and Edition pages describe one entity');
  assert.equal(editionEvent.eventStatus, 'https://schema.org/EventScheduled');
  assert.deepEqual(editionLd.find((s) => s['@type'] === 'BreadcrumbList').itemListElement.map((i: any) => i.name), ['Home', 'Sports', 'E5 Fixture Sport', 'E5 Full Cup', '2099 Edition']);
  const undated = decode(await get(`/${sport}/${ev('full')}/2095/`));
  assert(!jsonLd(undated).some((s) => s['@type'] === 'SportsEvent'), 'undated edition has no SportsEvent');
  assert.equal(meta(await get(`/${sport}/${ev('noindex')}/2099/`), /<meta name="robots" content="([^"]+)"/), 'noindex, follow', 'Edition of a noindexed Event is noindex (matches sitemap)');
  assert.equal(meta(await get(`/${sport}/${ev('noindex')}/`), /<meta name="robots" content="([^"]+)"/), 'noindex, follow');
  pass('SEO/schema: fact-only SportsEvent with shared @id, no offers/organizer/attendance, breadcrumbs, capped/fallback descriptions, single canonical/title, Edition robots follow Event noindex');

  // ── 6. Search ──
  const suggest = await (await fetch(`${base}/api/search/suggestions?q=${encodeURIComponent('E5 Full')}`)).json();
  assert(suggest.events.some((e: any) => e.name === 'E5 Full Cup' && e.url === fullPath));
  const hiddenSuggest = await (await fetch(`${base}/api/search/suggestions?q=${encodeURIComponent('E5 Hidden')}`)).json();
  assert.equal(hiddenSuggest.events.length, 0);
  const searchHtml = decode(await get(`/search/?q=${encodeURIComponent('Sylhet')}`));
  assert(searchHtml.includes('E5 Full Cup'), 'event location is searchable');
  pass('Search: visible Events in suggestions, hidden Events excluded, Event location matched in search results');

  // ── 7. Browser ──
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const context = await browser.newContext(); const page = await context.newPage(); const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      for (const path of [`/events/?sport=${sport}`, `/events/?sport=${sport}&when=upcoming`, fullPath]) {
        await page.goto(base + path); await page.locator('h1').waitFor();
        assert.equal(await page.locator('h1').count(), 1, `${path} one H1`);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), `Horizontal overflow at ${viewport.width}px on ${path}`);
      }
      await page.goto(base + fullPath);
      const question = page.getByRole('heading', { level: 3, name: 'How often is E5 Full Cup held?' });
      await question.scrollIntoViewIfNeeded();
      await page.locator('details summary').filter({ hasText: 'How often is E5 Full Cup held?' }).focus();
      await page.keyboard.press('Enter');
      assert(await page.getByText(`Editor answer ${fixture}.`).isVisible(), 'editor-approved FAQ opens with the keyboard');
    }
    await page.goto(`${base}/events/?sport=${sport}`);
    await page.getByRole('link', { name: /^Upcoming \(4\)$/ }).click();
    await page.waitForURL(/when=upcoming/);
    assert(await page.getByRole('heading', { name: /Upcoming editions in E5 Fixture Sport/ }).isVisible());

    // Admin FAQ scope picker.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(base + '/admin/');
    await page.getByPlaceholder('Email', { exact: true }).fill(`${adminId}@example.test`);
    await page.getByPlaceholder('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await page.getByRole('button', { name: 'Articles', exact: true }).waitFor();
    await page.getByRole('button', { name: 'FAQ', exact: true }).click();
    await page.getByTestId('faq-context').selectOption(`event:${ev('full')}`);
    await page.getByText(`${fixture} draft event question?`, { exact: true }).waitFor();
    assert.equal(await page.getByTestId('faq-context').inputValue(), `event:${ev('full')}`, 'the selected context is the Event');
    await page.getByRole('button', { name: '+ New question' }).click();
    const options = await page.getByTestId('faq-context').locator('option').allTextContents();
    assert(options.some((o) => o.includes('E5 Fixture Sport · E5 Full Cup')) && options.some((o) => o.includes('E5 Fixture Sport · E5 Hidden Cup')) && options.some((o) => o.includes('Site-wide /faq/ page')));
    await page.locator('#faq-question').fill(`${fixture} browser scoped question?`);
    await page.locator('#faq-answer').fill('Browser answer.');
    await page.locator('form select').last().selectOption('published');
    await page.getByRole('button', { name: 'Create question' }).click();
    await page.getByRole('status').filter({ hasText: 'Created' }).waitFor();
    const saved = await prisma.faqEntry.findFirstOrThrow({ where: { question: `${fixture} browser scoped question?` } });
    assert.equal(saved.eventId, ev('full'));
    assert(decode(await get(fullPath)).includes(`${fixture} browser scoped question?`));
    assert.deepEqual(errors, []);
    pass('Real Chrome: discovery + Event page at 1440/390 px with one H1 and no overflow, keyboard FAQ, timing filter navigation, admin Event-scope picker saves and publishes');
  } finally { await browser.close(); }
  completed = true;
  console.log(`PASS ${checks} E5 integration groups`);
} finally {
  child.kill(); if (child.exitCode === null) await once(child, 'exit');
  await prisma.faqEntry.deleteMany({ where: { OR: [{ eventId: { startsWith: fixture } }, { question: { startsWith: fixture } }] } });
  await prisma.eventEdition.deleteMany({ where: { sportSlug: sport } });
  await prisma.sportEvent.deleteMany({ where: { sportSlug: sport } });
  await prisma.sport.deleteMany({ where: { slug: sport } });
  await prisma.session.deleteMany({ where: { userId: adminId } });
  await prisma.auditLog.deleteMany({ where: { userId: adminId } });
  await prisma.user.deleteMany({ where: { id: adminId } });
  assert.deepEqual(await snapshot(), before, 'Pre-existing Sport/Event/Edition/FAQ/Article rows changed.');
  console.log('PASS original Sport/Event/Edition/FAQ/Article full-row hashes restored');
  await prisma.$disconnect();
  if (!completed) process.exitCode = 1;
}
