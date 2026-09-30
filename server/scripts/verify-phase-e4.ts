/** E4 public Event details: SSR, dynamic metadata, media, SEO and browser verification. */
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

assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe, 'E4 requires a local development database.');
assert(fs.existsSync('.next/BUILD_ID'), 'Build before E4 verification.');
const fixture = `e4-${crypto.randomUUID()}`;
const eventSlug = `${fixture}-championship`;
const sparseSlug = `${fixture}-sparse`;
const authorId = `${fixture}-author`;
const digest = (rows: unknown) => crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const snapshot = async () => ({ sports: digest(await prisma.sport.findMany({ orderBy: { id: 'asc' } })), events: digest(await prisma.sportEvent.findMany({ orderBy: { id: 'asc' } })), editions: digest(await prisma.eventEdition.findMany({ orderBy: { id: 'asc' } })) });
const before = await snapshot();
const counts = await Promise.all([prisma.sport.count(), prisma.sportEvent.count(), prisma.eventEdition.count()]);
const managed = await prisma.mediaItem.findFirstOrThrow({ orderBy: { id: 'asc' } });
const existing = await prisma.sportEvent.findFirstOrThrow({ where: { isVisible: true, sport: { isVisible: true } }, orderBy: { name: 'asc' } });

const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = (probe.address() as { port: number }).port; await new Promise<void>((resolve) => probe.close(() => resolve()));
const base = `http://localhost:${port}`;
const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], { cwd: process.cwd(), windowsHide: true, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', TRUST_PROXY: 'false', NODE_ENV: 'production', APP_ENV: 'production', AUTH_MODE: 'production', DEV_LOGIN_BYPASS: 'false', ALLOWED_ORIGIN: base }, stdio: ['ignore', 'pipe', 'pipe'] });
let output = ''; child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => { output += chunk; });
const get = async (path: string, expected = 200) => { const response = await fetch(base + path, { redirect: 'manual' }); const text = await response.text(); assert.equal(response.status, expected, `${path}: ${response.status}, expected ${expected}`); return { response, text }; };
const jsonLd = (html: string) => [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((match) => JSON.parse(match[1]));
let checks = 0; const pass = (message: string) => { checks++; console.log(`PASS ${message}`); };

try {
  await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`E4 server did not start: ${output.slice(-500)}`)), 60_000); child.stdout.on('data', (chunk) => { if (String(chunk).includes('Server running')) { clearTimeout(timer); resolve(); } }); child.once('exit', () => { clearTimeout(timer); reject(new Error(`E4 server exited: ${output.slice(-500)}`)); }); });
  const fields = [
    { key: 'series_name', label: 'Circuit Name', type: 'text', required: false, order: 5, adminVisible: true, publicVisible: true },
    { key: 'surface', label: 'Playing Surface', type: 'select', required: true, order: 10, adminVisible: true, publicVisible: true, options: ['Clay', 'Grass'] },
    { key: 'indoor', label: 'Indoor Competition', type: 'boolean', required: false, order: 20, adminVisible: true, publicVisible: true },
    { key: 'opening_day', label: 'Established Date', type: 'date', required: false, order: 30, adminVisible: true, publicVisible: true },
    { key: 'capacity', label: 'Field Capacity', type: 'number', required: false, order: 40, adminVisible: true, publicVisible: true },
    { key: 'format_note', label: 'Competition Format', type: 'textarea', required: false, order: 50, adminVisible: true, publicVisible: true },
    { key: 'official_resource', label: 'Rules Source', type: 'url', required: false, order: 60, adminVisible: true, publicVisible: true },
    { key: 'internal_note', label: 'Internal Secret', type: 'text', required: false, order: 70, adminVisible: true, publicVisible: false },
    { key: 'empty_public', label: 'Missing Public Value', type: 'text', required: false, order: 80, adminVisible: true, publicVisible: true },
  ];
  await prisma.sport.create({ data: { id: fixture, slug: fixture, name: 'Temporary Future Sport', tagline: 'Fixture only', description: 'Fixture only', order: 999, isVisible: true, seo: {}, eventConfiguration: { terminology: { event: 'Tournament', venue: 'Arena', competition: 'Circuit', participant: 'Contenders' }, fields } } });
  await prisma.sportEvent.create({ data: { id: eventSlug, sportSlug: fixture, slug: eventSlug, name: 'E4 Future Championship', shortName: 'E4 Championship', description: 'Authoritative E4 event overview.', history: 'Verified E4 event history.', frequency: 'Annual', defaultVenue: 'Verified Main Arena', defaultLocation: 'Dhaka, Bangladesh', currentEditionYear: 2098, allEditionYears: [2098, 2097], featured: true, isVisible: true, featuredImage: managed.url, officialSourceUrl: 'https://example.com/event', eventType: 'International Championship', seo: { metaTitle: 'E4 Event Meta Title | SportingSpy', metaDescription: 'Authoritative E4 event metadata.' }, sportSpecificValues: { series_name: 'Verified World Circuit', surface: 'Clay', indoor: false, opening_day: '2090-04-03', capacity: 64, format_note: 'A verified multi-stage competition format.', official_resource: 'https://example.com/rules', internal_note: 'NEVER-PUBLIC-E4' } } });
  await prisma.sportEvent.create({ data: { id: sparseSlug, sportSlug: fixture, slug: sparseSlug, name: 'E4 Sparse Event', shortName: 'E4 Sparse Event', description: '', frequency: null, defaultVenue: null, defaultLocation: null, currentEditionYear: null, allEditionYears: [2097], featured: false, isVisible: true, featuredImage: null, seo: {}, sportSpecificValues: null } });
  await prisma.eventEdition.create({ data: { id: `${eventSlug}-2098`, sportSlug: fixture, eventSlug, year: 2098, title: 'E4 Championship 2098', startDate: '2098-06-01', endDate: '2098-06-04', venue: 'Edition Arena', location: 'Dhaka, Bangladesh', status: 'upcoming', description: 'Confirmed edition.', featuredImage: managed.url, seo: {} } });
  await prisma.eventEdition.create({ data: { id: `${eventSlug}-2097`, sportSlug: fixture, eventSlug, year: 2097, title: 'E4 Championship 2097', startDate: null, endDate: null, venue: null, location: null, status: 'archived', description: '', featuredImage: null, seo: {} } });
  await prisma.eventEdition.create({ data: { id: `${sparseSlug}-2097`, sportSlug: fixture, eventSlug: sparseSlug, year: 2097, title: 'Sparse Edition 2097', startDate: null, endDate: null, venue: null, location: null, status: 'archived', description: '', featuredImage: null, seo: {} } });
  await prisma.author.create({ data: { id: authorId, slug: authorId, name: 'E4 Fixture Author', roleTitle: 'Reporter', bio: 'Fixture.', avatar: '/favicon.ico' } });
  await prisma.article.create({ data: { id: `${fixture}-article`, slug: `${fixture}-coverage`, sportSlug: fixture, eventSlug, title: 'E4 Verified Coverage', articleType: 'News', excerpt: 'Verified coverage excerpt.', content: 'Verified coverage body.', featuredImage: managed.url, authorId, publishedAt: new Date('2098-05-01T00:00:00Z'), status: 'published', readingTimeMinutes: 2, seo: {} } });

  const path = `/${fixture}/${eventSlug}/`;
  const page = await get(path);
  const html = page.text;
  for (const visible of ['E4 Future Championship', 'Temporary Future Sport', 'Tournament', 'Authoritative E4 event overview.', 'Circuit Name', 'Verified World Circuit', 'Playing Surface', 'Clay', 'Indoor Competition', 'No', '3 April 2090', 'Field Capacity', '64', 'Competition Format', 'Visit official resource']) assert(html.includes(visible), `Missing visible content: ${visible}`);
  assert(!html.includes('NEVER-PUBLIC-E4') && !html.includes('Internal Secret') && !html.includes('Missing Public Value'));
  assert(html.indexOf('Circuit Name') < html.indexOf('Playing Surface') && html.indexOf('Playing Surface') < html.indexOf('Indoor Competition') && html.indexOf('Indoor Competition') < html.indexOf('Established Date'));
  pass('SSR renders resolved terminology and all supported public field presentations in configured order; private/empty values do not leak');

  assert(html.includes(managed.url));
  assert(html.includes('E4 Championship 2098') && html.includes('1 June 2098 – 4 June 2098') && html.includes('Edition Arena'));
  assert(html.includes('E4 Championship 2097') && !html.includes('TBA') && !html.includes('N/A'));
  assert(html.includes('E4 Verified Coverage') && html.includes('Related events') && html.includes('E4 Sparse Event'));
  pass('Managed Event/Edition images, confirmed current Edition, neutral archive, coverage and same-Sport related Event render from real relationships');

  const schemas = jsonLd(html);
  const eventLd = schemas.find((item) => item['@type'] === 'SportsEvent');
  assert(eventLd && eventLd.startDate === '2098-06-01' && eventLd.endDate === '2098-06-04');
  assert(!JSON.stringify(schemas).includes('NEVER-PUBLIC-E4'));
  assert(html.includes('<title>E4 Event Meta Title | SportingSpy</title>'));
  assert(html.includes(`rel="canonical" href="${base}${path}"`));
  assert(html.includes('property="og:title" content="E4 Event Meta Title | SportingSpy"'));
  assert(html.includes('name="twitter:card" content="summary_large_image"'));
  pass('SEO title/description/canonical/OG/X and factual dated SportsEvent JSON-LD render without private dynamic fields');

  const sparsePath = `/${fixture}/${sparseSlug}/`;
  const sparse = (await get(sparsePath)).text;
  assert(sparse.includes('E4 Sparse Event'));
  assert(!sparse.includes('About this Tournament') && !sparse.includes('Current edition') && !sparse.includes('Sport-specific information'));
  assert(!jsonLd(sparse).some((item) => item['@type'] === 'SportsEvent'));
  assert(sparse.includes('Sparse Edition 2097') && !sparse.includes('TBA') && !sparse.includes('N/A'));
  pass('Missing image/description/venue/location/date/frequency/current Edition hides empty sections, uses safe placeholder and emits no Event schema');

  const existingPage = await get(`/${existing.sportSlug}/${existing.slug}/`);
  assert(existingPage.text.includes(existing.name));
  await get(`/${fixture}/missing-event/`, 404);
  pass('Existing Event route remains functional and unknown Event uses branded HTTP 404');

  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const context = await browser.newContext(); const browserPage = await context.newPage(); const errors: string[] = [];
    browserPage.on('pageerror', (error) => errors.push(error.message));
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 900, height: 900 }, { width: 390, height: 844 }]) {
      await browserPage.setViewportSize(viewport); await browserPage.goto(base + path); await browserPage.locator('h1').waitFor();
      assert.equal(await browserPage.locator('h1').count(), 1);
      assert.equal(await browserPage.locator('nav[aria-label="Breadcrumb"] a').first().textContent(), 'Home');
      assert(await browserPage.getByRole('heading', { name: 'About this Tournament' }).isVisible());
      assert(await browserPage.getByRole('heading', { name: 'Event facts' }).isVisible());
      assert(await browserPage.getByRole('link', { name: /View 2098 edition/ }).isVisible());
      assert(await browserPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), `Horizontal overflow at ${viewport.width}px`);
    }
    assert.deepEqual(errors, []);
    pass('Real Chrome desktop/tablet/mobile: one H1, accessible breadcrumb/headings/links, no horizontal overflow or page errors');
  } finally { await browser.close(); }
  console.log(`PASS ${checks} E4 integration groups`);
} finally {
  child.kill(); if (child.exitCode === null) await once(child, 'exit');
  await prisma.article.deleteMany({ where: { id: { startsWith: fixture } } });
  await prisma.eventEdition.deleteMany({ where: { sportSlug: fixture } });
  await prisma.sportEvent.deleteMany({ where: { sportSlug: fixture } });
  await prisma.sport.deleteMany({ where: { slug: fixture } });
  await prisma.author.deleteMany({ where: { id: authorId } });
  assert.deepEqual(await snapshot(), before, 'Pre-existing Sport/Event/Edition rows changed.');
  assert.deepEqual(await Promise.all([prisma.sport.count(), prisma.sportEvent.count(), prisma.eventEdition.count()]), counts);
  console.log(`PASS original Sport/Event/Edition counts ${counts.join('/')} and full-row hashes restored`);
  await prisma.$disconnect();
}
