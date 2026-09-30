/** Phase E1 integration: truthful Event/Edition writes and public rendering. Disposable local fixtures only. */
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

assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe, 'E1 verification requires a local development database.');
assert(fs.existsSync('.next/BUILD_ID'), 'Run npm run build before E1 verification.');
const fixture = `e1-${crypto.randomUUID()}`;
const password = `Test-${crypto.randomUUID()}`;
const userId = `${fixture}-admin`;
const slug = fixture;
const digest = (rows: unknown) => crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
async function snapshot() {
  return {
    events: digest(await prisma.sportEvent.findMany({ orderBy: { id: 'asc' } })),
    editions: digest(await prisma.eventEdition.findMany({ orderBy: { id: 'asc' } })),
    media: digest(await prisma.mediaItem.findMany({ orderBy: { id: 'asc' } })),
  };
}
const before = await snapshot();
const sport = await prisma.sport.findFirstOrThrow({ where: { isVisible: true }, orderBy: { order: 'asc' } });
const media = await prisma.mediaItem.findFirstOrThrow({ orderBy: { id: 'asc' } });
const probe = createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = (probe.address() as { port: number }).port;
await new Promise<void>((resolve) => probe.close(() => resolve()));
const base = `http://localhost:${port}`;
const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
  cwd: process.cwd(), windowsHide: true,
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', TRUST_PROXY: 'false', NODE_ENV: 'production', APP_ENV: 'production', AUTH_MODE: 'production', DEV_LOGIN_BYPASS: 'false', ALLOWED_ORIGIN: base, ENABLE_READER_ACCOUNTS: 'false', ENABLE_COMMENTS: 'false' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (chunk) => { output += chunk; });
child.stderr.on('data', (chunk) => { output += chunk; });
const cookies = new Map<string, string>();
async function request(path: string, method = 'GET', body?: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; ') };
  if (method !== 'GET') headers['x-csrf-token'] = cookies.get('csrf_token') || '';
  const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  for (const cookie of response.headers.getSetCookie()) {
    const [pair] = cookie.split(';');
    const split = pair.indexOf('=');
    cookies.set(pair.slice(0, split), pair.slice(split + 1));
  }
  const text = await response.text();
  let data: Record<string, unknown> | null = null;
  try { data = JSON.parse(text); } catch { /* HTML response */ }
  return { status: response.status, text, data };
}
async function expect(path: string, code: number, method = 'GET', body?: unknown) {
  const result = await request(path, method, body);
  assert.equal(result.status, code, `${method} ${path}: ${result.status}, expected ${code}: ${result.text.slice(0, 300)}`);
  return result;
}
let count = 0;
const pass = (message: string) => { count++; console.log(`PASS ${message}`); };
async function waitForImage(kind: 'event' | 'edition', id: string, expected: string | null) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const row = kind === 'event' ? await prisma.sportEvent.findUniqueOrThrow({ where: { id } }) : await prisma.eventEdition.findUniqueOrThrow({ where: { id } });
    if (row.featuredImage === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${kind} image did not update to the selected Media Library value.`);
}
try {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`E1 server did not start: ${output.slice(-500)}`)), 30_000);
    if (output.includes('Server running')) { clearTimeout(timer); resolve(); return; }
    child.stdout.on('data', (chunk) => { if (String(chunk).includes('Server running')) { clearTimeout(timer); resolve(); } });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(`E1 server exited: ${output.slice(-500)}`)); });
  });
  await prisma.user.create({ data: { id: userId, name: 'E1 Test Admin', email: `${userId}@example.test`, role: 'Admin', avatar: '/favicon.ico', joinedAt: new Date(), passwordHash: hashPassword(password) } });
  await expect('/api/auth/me', 401); // Still issues the CSRF cookie for login.
  await expect('/api/auth/login', 200, 'POST', { email: `${userId}@example.test`, password });

  await expect('/api/events', 400, 'POST', { slug, sportSlug: sport.slug });
  await expect('/api/events', 400, 'POST', { name: 'E1 Fixture Event', slug, sportSlug: sport.slug, currentEditionYear: 2098 });
  await expect('/api/events', 400, 'POST', { name: 'E1 Fixture Event', slug, sportSlug: sport.slug, featuredImage: 'https://images.unsplash.com/stock.jpg' });
  const event = (await expect('/api/events', 201, 'POST', { name: 'E1 Fixture Event', slug, sportSlug: sport.slug })).data!;
  const eventId = String(event.id);
  const storedEvent = await prisma.sportEvent.findUniqueOrThrow({ where: { id: eventId } });
  for (const key of ['frequency', 'defaultVenue', 'defaultLocation', 'currentEditionYear', 'featuredImage'] as const) assert.equal(storedEvent[key], null, key);
  assert.equal(storedEvent.description, '');
  assert.deepEqual(storedEvent.allEditionYears, []);
  pass('Event create rejects missing identity, fabricated year and unmanaged image; optional facts remain null/empty');

  const eventPath = `/${sport.slug}/${slug}/`;
  const eventHtml = (await expect(eventPath, 200)).text;
  for (const bad of ['Championship Venue', 'Championship Host City', 'images.unsplash.com', 'Current Edition:', 'Permanent Ground:']) assert(!eventHtml.includes(bad), bad);
  pass('Event public HTML omits unconfirmed venue, current edition and stock image');

  await expect(`/api/events/${eventId}`, 400, 'PUT', { currentEditionYear: 2098 });
  const eventFilled = (await expect(`/api/events/${eventId}`, 200, 'PUT', { defaultVenue: 'Verified Ground', defaultLocation: 'Verified City', featuredImage: media.url, description: 'Confirmed description.' })).data!;
  await expect(`/api/events/${eventId}`, 200, 'PUT', { name: 'E1 Updated Event' });
  const eventPreserved = await prisma.sportEvent.findUniqueOrThrow({ where: { id: eventId } });
  assert.equal(eventPreserved.defaultVenue, 'Verified Ground');
  assert.equal(eventPreserved.defaultLocation, 'Verified City');
  assert.equal(eventPreserved.featuredImage, media.url);
  assert.equal(eventPreserved.description, eventFilled.description);
  await expect(`/api/events/${eventId}`, 200, 'PUT', { defaultVenue: null, defaultLocation: '', featuredImage: null, description: null });
  const eventCleared = await prisma.sportEvent.findUniqueOrThrow({ where: { id: eventId } });
  assert.equal(eventCleared.defaultVenue, null);
  assert.equal(eventCleared.defaultLocation, null);
  assert.equal(eventCleared.featuredImage, null);
  assert.equal(eventCleared.description, '');
  pass('Event partial update preserves other facts; explicit null/empty clears optional facts');

  await expect('/api/editions', 400, 'POST', { sportSlug: sport.slug, eventSlug: slug, year: 2098, status: 'upcoming' });
  await expect('/api/editions', 400, 'POST', { sportSlug: sport.slug, eventSlug: slug, year: 2098, title: 'E1 Edition' });
  const edition = (await expect('/api/editions', 201, 'POST', { sportSlug: sport.slug, eventSlug: slug, year: 2098, title: 'E1 Edition', status: 'upcoming' })).data!;
  const editionId = String(edition.id);
  const storedEdition = await prisma.eventEdition.findUniqueOrThrow({ where: { id: editionId } });
  for (const key of ['startDate', 'endDate', 'venue', 'location', 'featuredImage'] as const) assert.equal(storedEdition[key], null, key);
  assert.equal(storedEdition.description, '');
  pass('Edition create requires title/status and stores no invented date, place, image or description');

  const editionPath = `/${sport.slug}/${slug}/2098/`;
  const editionHtml = (await expect(editionPath, 200)).text;
  for (const bad of ['2098-05-01', '2098-05-15', 'Championship Venue', 'Official Location', '"@type":"SportsEvent"']) assert(!editionHtml.includes(bad), bad);
  pass('Edition public HTML and structured data omit unknown dates and location');

  await expect(`/api/editions/${editionId}`, 400, 'PUT', { startDate: '2098-02-30' });
  await expect(`/api/editions/${editionId}`, 400, 'PUT', { featuredImage: 'https://images.unsplash.com/stock.jpg' });
  await expect(`/api/editions/${editionId}`, 200, 'PUT', { startDate: '2098-04-01', endDate: '2098-04-08', venue: 'Verified Arena', location: 'Verified City', featuredImage: media.url, description: 'Confirmed edition description.' });
  await expect(`/api/editions/${editionId}`, 200, 'PUT', { status: 'active' });
  const editionPreserved = await prisma.eventEdition.findUniqueOrThrow({ where: { id: editionId } });
  assert.equal(editionPreserved.startDate, '2098-04-01');
  assert.equal(editionPreserved.venue, 'Verified Arena');
  assert.equal(editionPreserved.featuredImage, media.url);
  await expect(`/api/editions/${editionId}`, 200, 'PUT', { startDate: null, endDate: null, venue: null, location: '', featuredImage: null, description: '' });
  const editionCleared = await prisma.eventEdition.findUniqueOrThrow({ where: { id: editionId } });
  assert.equal(editionCleared.startDate, null);
  assert.equal(editionCleared.endDate, null);
  assert.equal(editionCleared.venue, null);
  assert.equal(editionCleared.location, null);
  assert.equal(editionCleared.featuredImage, null);
  assert.equal(editionCleared.description, '');
  pass('Edition dates validated; status-only edit preserves other facts; null clears optional fields');

  await expect(`/api/events/${eventId}`, 200, 'PUT', { currentEditionYear: 2098 });
  const selectedHtml = (await expect(eventPath, 200)).text;
  assert(selectedHtml.includes(`href="${editionPath}"`) && selectedHtml.includes('Current Edition:'), 'Explicit current edition link should render.');
  await expect(`/api/events/${eventId}`, 200, 'PUT', { currentEditionYear: null });
  assert(!(await expect(eventPath, 200)).text.includes('Current Edition:'), 'Cleared current edition should not render.');
  pass('Current edition requires a real explicit selection and can be cleared without a fallback');

  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  assert(fs.existsSync(executablePath), 'Chrome is required for the E1 admin form check.');
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const context = await browser.newContext();
    await context.addCookies([...cookies].map(([name, value]) => ({ name, value, url: base })));
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(base + '/admin/');
    await page.getByRole('button', { name: 'Events & Editions', exact: true }).click();
    await page.getByRole('button', { name: '+ New Permanent Event' }).click();
    assert.equal(await page.locator('#event-editor-field-5').inputValue(), '');
    assert.equal(await page.locator('#event-editor-field-6').inputValue(), '');
    assert.equal(await page.locator('#event-editor-field-9').inputValue(), '');
    assert.equal(await page.locator('#event-image').inputValue(), '');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('row').filter({ hasText: 'E1 Updated Event' }).getByRole('button', { name: 'Edit', exact: true }).click();
    await page.locator('#event-image').selectOption(media.url);
    await page.getByRole('button', { name: 'Save Updates', exact: true }).click();
    await page.getByText('Permanent event "E1 Updated Event" updated.').waitFor();
    await waitForImage('event', eventId, media.url);
    await page.getByRole('row').filter({ hasText: 'E1 Updated Event' }).getByRole('button', { name: 'Edit', exact: true }).click();
    await page.locator('#event-image').selectOption('');
    await page.getByRole('button', { name: 'Save Updates', exact: true }).click();
    await page.getByText('Permanent event "E1 Updated Event" updated.').waitFor();
    await waitForImage('event', eventId, null);
    await page.getByRole('button', { name: /^Staged Editions/ }).click();
    await page.getByRole('button', { name: '+ Stage Yearly Edition' }).click();
    assert.equal(await page.locator('#event-editor-field-11').inputValue(), '');
    assert.equal(await page.locator('#event-editor-field-12').inputValue(), '');
    assert.equal(await page.locator('#event-editor-field-14').inputValue(), '');
    assert.equal(await page.locator('#event-editor-field-15').inputValue(), '');
    assert.equal(await page.locator('#edition-venue').inputValue(), '');
    assert.equal(await page.locator('#edition-location').inputValue(), '');
    assert.equal(await page.locator('#edition-image').inputValue(), '');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('row').filter({ hasText: 'E1 Edition' }).getByRole('button', { name: 'Edit', exact: true }).click();
    await page.locator('#edition-image').selectOption(media.url);
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await page.getByText('Edition 2098 updated.').waitFor();
    await waitForImage('edition', editionId, media.url);
    await page.getByRole('row').filter({ hasText: 'E1 Edition' }).getByRole('button', { name: 'Edit', exact: true }).click();
    await page.locator('#edition-image').selectOption('');
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await page.getByText('Edition 2098 updated.').waitFor();
    await waitForImage('edition', editionId, null);
    assert.deepEqual(errors, []);
    pass('Real Admin browser: blank Event/Edition forms and Media Library image selection/clearing');
  } finally {
    await browser.close();
  }
  console.log(`PASS ${count} E1 integration groups`);
} finally {
  child.kill();
  if (child.exitCode === null) await once(child, 'exit');
  await prisma.eventEdition.deleteMany({ where: { eventSlug: slug, sportSlug: sport.slug } });
  await prisma.sportEvent.deleteMany({ where: { slug, sportSlug: sport.slug } });
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.auditLog.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  assert.deepEqual(await snapshot(), before, 'Pre-existing Event/Edition/Media rows changed.');
  console.log('PASS original Event/Edition/Media row hashes restored');
  await prisma.$disconnect();
}
