/**
 * Edition and Permanent Event editors: rich description/overview (same editor as the Article
 * body, no images) and the Media Library picker/upload button for their image. Production build + LOCAL
 * development database only; real Chrome. Fixture rows and uploaded files are removed afterwards.
 *
 *   npm run build && PLAYWRIGHT_EXECUTABLE_PATH=<chrome> npm run test:event-edition-editor-browser
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import sharp from 'sharp';
import { chromium, type Browser } from 'playwright-core';
import { prisma } from '../db';
import { checkDatabaseUrlIsLocalDev } from '../dbSafety';
import { hashPassword } from '../password';

assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe, 'Edition editor verification requires a local development database.');
assert(fs.existsSync('.next/BUILD_ID'), 'Build before verification (npm run build).');
const chromePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
assert(fs.existsSync(chromePath), `Chrome not found at ${chromePath} (set PLAYWRIGHT_EXECUTABLE_PATH).`);

const fx = `ed${crypto.randomUUID().slice(0, 6)}`;
const password = `Edition-${crypto.randomUUID()}`;
const adminId = `${fx}-admin`, editorId = `${fx}-editor`, authorId = `${fx}-author`;
const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-edition-media-'));

const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = (probe.address() as { port: number }).port; await new Promise<void>((r) => probe.close(() => r()));
const base = `http://127.0.0.1:${port}`;
let output = '';
const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
  cwd: process.cwd(), windowsHide: true,
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', TRUST_PROXY: 'false', NODE_ENV: 'production', APP_ENV: 'production', AUTH_MODE: 'production', DEV_LOGIN_BYPASS: 'false', ALLOWED_ORIGIN: base, SITE_ORIGIN: base, INDEXNOW_ENDPOINT: '', GEMINI_API_KEY: '', MEDIA_STORAGE_PROVIDER: 'local', MEDIA_LOCAL_DIR: mediaDir },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (c) => { output += c; }); child.stderr.on('data', (c) => { output += c; });

let checks = 0; const pass = (m: string) => { checks++; console.log(`PASS ${m}`); };
const until = async (what: string, test: () => Promise<boolean>, ms = 15_000) => {
  for (const end = Date.now() + ms; Date.now() < end;) { if (await test()) return; await new Promise((r) => setTimeout(r, 200)); }
  assert.fail(`timed out waiting for ${what}`);
};
class Client {
  cookies = new Map<string, string>();
  async request(p: string, method = 'GET', body?: unknown) {
    const headers: Record<string, string> = { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET') headers['x-csrf-token'] = this.cookies.get('csrf_token') ?? '';
    const res = await fetch(base + p, { method, headers, redirect: 'manual', body: body === undefined ? undefined : JSON.stringify(body) });
    for (const raw of res.headers.getSetCookie()) { const [pair] = raw.split(';'); const i = pair.indexOf('='); const v = pair.slice(i + 1); if (v) this.cookies.set(pair.slice(0, i), v); else this.cookies.delete(pair.slice(0, i)); }
    const text = await res.text(); let data: any; try { data = JSON.parse(text); } catch { /* HTML */ }
    return { status: res.status, text, data };
  }
}
const text = (t: string, marks?: object[]) => ({ type: 'text', text: t, ...(marks ? { marks } : {}) });

let browser: Browser | null = null;
const eventSlug = `${fx}-open`;
try {
  for (const [role, id] of [['Admin', adminId], ['Editor', editorId], ['Author', authorId]] as const) {
    await prisma.user.create({ data: { id, name: `${fx} ${role}`, email: `${id}@example.test`, role, avatar: '', joinedAt: new Date(), passwordHash: hashPassword(password) } });
  }
  const sport = (await prisma.sport.findFirst({ where: { isVisible: true }, orderBy: { order: 'asc' }, select: { slug: true } }))!;
  await prisma.sportEvent.create({ data: { id: `${fx}-event`, sportSlug: sport.slug, slug: eventSlug, name: `${fx} Open`, shortName: `${fx} Open`, description: 'Fixture event.', seo: {}, isVisible: true } });
  await prisma.eventEdition.create({ data: { id: `${fx}-legacy`, sportSlug: sport.slug, eventSlug, year: 2040, title: `${fx} Open 2040`, description: 'Legacy plain description.\nSecond line.', seo: {}, status: 'upcoming' } });

  for (let i = 0; i < 120 && !/Server running/.test(output); i++) await new Promise((r) => setTimeout(r, 500));
  assert.match(output, /Server running/, `server did not start:\n${output.slice(-2000)}`);
  const login = async (id: string) => { const c = new Client(); await c.request('/robots.txt'); assert.equal((await c.request('/api/auth/login', 'POST', { email: `${id}@example.test`, password })).status, 200); return c; };
  const [admin, author] = [await login(adminId), await login(authorId)];

  // ── API: validation, derived plain text, permissions ──
  const create = (year: number, descriptionBody: unknown, as = admin) => as.request('/api/editions', 'POST', { sportSlug: sport.slug, eventSlug, year, title: `${fx} Open ${year}`, status: 'upcoming', descriptionBody });
  const withImage = await create(2041, { type: 'doc', content: [{ type: 'image', attrs: { mediaId: 'x1' } }] });
  assert.equal(withImage.status, 400);
  const unsafe = await create(2041, { type: 'doc', content: [{ type: 'paragraph', content: [text('x', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }])] }] });
  assert.equal(unsafe.status, 400); assert.match(unsafe.text, /unsafe or invalid link/);
  const html = await create(2041, { type: 'doc', content: [{ type: 'html', content: [text('<script>')] }] });
  assert.equal(html.status, 400);
  const tooLong = await create(2041, { type: 'doc', content: [{ type: 'paragraph', content: [text('a'.repeat(5001))] }] });
  assert.equal(tooLong.status, 400); assert.match(tooLong.text, /limited to 5,000 characters/);
  assert.equal((await create(2041, { type: 'doc', content: [{ type: 'paragraph', content: [text('Author')] }] }, author)).status, 403);
  const rich = { type: 'doc', content: [
    { type: 'paragraph', content: [text('The '), text('2041 edition', [{ type: 'bold' }]), text(' returns to '), text('Paris', [{ type: 'link', attrs: { href: 'https://example.com/paris', target: null, rel: null } }]), text('.')] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [text('বাংলা point')] }] }] },
  ] };
  const created = await create(2041, rich);
  assert.equal(created.status, 201, created.text);
  const row = (await prisma.eventEdition.findUnique({ where: { id: created.data.id } }))!;
  assert.equal(row.description, 'The 2041 edition returns to Paris.\n\nবাংলা point', 'plain text is derived from the document');
  assert.equal((row.descriptionBody as any).content[0].content[1].marks[0].type, 'bold');
  pass('API: rich description is validated (no images, unsafe links, unknown nodes, >5,000 chars), Author is refused, and plain text is derived for search/SEO');

  const publicHtml = await (await fetch(`${base}/${sport.slug}/${eventSlug}/2041/`)).text();
  assert.match(publicHtml, /<strong[^>]*>2041 edition<\/strong>/);
  assert.match(publicHtml, /href="https:\/\/example\.com\/paris"/);
  assert.match(publicHtml, /বাংলা point/);
  const legacyHtml = await (await fetch(`${base}/${sport.slug}/${eventSlug}/2040/`)).text();
  assert.match(legacyHtml, /Legacy plain description\./);
  pass('public edition page renders the rich description (bold, link, list, Bangla); legacy plain descriptions still render');

  // ── Browser: rich editor + image picker/upload in the edition form ──
  browser = await chromium.launch({ executablePath: chromePath });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  const apiErrors: string[] = [];
  page.on('response', async (r) => { if (r.url().includes('/api/editions') && r.status() >= 400) apiErrors.push(`${r.status()} ${await r.text()}`); });
  await page.goto(`${base}/admin/`);
  await page.getByRole('textbox', { name: 'Email' }).fill(`${editorId}@example.test`);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.locator('[data-admin-shell] aside[aria-label="CMS navigation"]').getByRole('button', { name: 'Events & Editions', exact: true }).first().click();
  await page.getByRole('button', { name: /Staged Editions/ }).click();

  // Legacy plain description opens as editable text.
  await page.locator('tr', { hasText: `${fx} Open 2040` }).getByRole('button', { name: 'Edit' }).click();
  const desc = page.locator('#edition-description');
  await desc.waitFor();
  assert.match(await desc.innerText(), /Legacy plain description\.\s+Second line\./);
  const form = page.locator('form', { has: desc });
  assert.equal(await form.getByRole('button', { name: /Insert Image/ }).count(), 0, 'no image tool in the description editor');
  assert(await form.getByRole('button', { name: /Bold/ }).first().isVisible(), 'formatting toolbar present');

  // Formatting typed in the editor.
  await desc.click(); await page.keyboard.press('Control+End'); await page.keyboard.press('Enter');
  await page.keyboard.press('Control+B'); await page.keyboard.type('Bold addition'); await page.keyboard.press('Control+B');
  await page.keyboard.type(' and plain words.');
  // Pasted images are left out.
  await page.evaluate(() => {
    const target = document.querySelector('#edition-description') as HTMLElement; target.focus();
    const data = new DataTransfer(); data.setData('text/html', '<p>Pasted line</p><img src="https://example.com/x.jpg">'); data.setData('text/plain', 'Pasted line');
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await form.getByTestId('paste-notice').waitFor();
  assert.equal(await desc.locator('img').count(), 0);

  // Edition image: upload a new image straight from the edition form.
  await form.getByTestId('edition-image-pick').click();
  const picker = page.getByRole('dialog', { name: 'Choose an image' });
  await picker.getByRole('button', { name: 'Upload new' }).click();
  const png = await sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: 200, g: 120, b: 40 } } }).png().toBuffer();
  await picker.locator('input[type="file"]').setInputFiles({ name: `${fx}-cover.png`, mimeType: 'image/png', buffer: png });
  await picker.getByLabel(/^Title \*/).fill(`${fx} cover`);
  await picker.getByLabel(/^Alt text \*/).fill('Fixture edition cover');
  await picker.getByRole('button', { name: 'Upload image' }).click();
  await picker.waitFor({ state: 'detached', timeout: 30_000 });
  const uploaded = (await prisma.mediaItem.findFirst({ where: { title: `${fx} cover` } }))!;
  assert.ok(uploaded, 'image uploaded to the Media Library');
  await until('edition image selected', async () => (await page.locator('#edition-image').inputValue()) === uploaded.url);
  assert.equal((await prisma.eventEdition.findUnique({ where: { id: `${fx}-legacy` } }))!.featuredImage, null, 'uploading did not save the edition form');
  assert(await desc.isVisible(), 'the edition form stays open after uploading');
  pass('editor: legacy description opens as rich text; toolbar has formatting but no image tool; pasted images are dropped; "Choose or upload image" uploads to the Media Library and selects it without submitting the form');

  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await until('edition saved', async () => !!(await prisma.eventEdition.findUnique({ where: { id: `${fx}-legacy` } }))!.descriptionBody).catch((e) => { console.log('API errors:', apiErrors); throw e; });
  const saved = (await prisma.eventEdition.findUnique({ where: { id: `${fx}-legacy` } }))!;
  assert.equal(saved.featuredImage, uploaded.url); assert.equal(saved.featuredMediaId, uploaded.id);
  assert.match(saved.description, /Legacy plain description\.\nSecond line\.[\s\S]*Bold addition and plain words\.[\s\S]*Pasted line/);
  assert(JSON.stringify(saved.descriptionBody).includes('"bold"'));
  const savedHtml = await (await fetch(`${base}/${sport.slug}/${eventSlug}/2040/`)).text();
  assert.match(savedHtml, /<strong[^>]*>Bold addition<\/strong>/);
  pass('Save Changes stores the rich description and the uploaded edition image; the public page shows both');

  // Picking an existing library image through the same button.
  await page.locator('tr', { hasText: `${fx} Open 2041` }).getByRole('button', { name: 'Edit' }).click();
  await page.locator('#edition-description').waitFor();
  assert.match(await page.locator('#edition-description strong').first().innerText(), /2041 edition/);
  await page.getByTestId('edition-image-pick').click();
  await page.getByRole('dialog', { name: 'Choose an image' }).getByRole('button', { name: new RegExp(`${fx} cover`) }).click();
  await until('picked image', async () => (await page.locator('#edition-image').inputValue()) === uploaded.url);
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await until('picked image saved', async () => (await prisma.eventEdition.findUnique({ where: { id: created.data.id } }))!.featuredMediaId === uploaded.id);
  pass('"Choose or upload image" also picks an existing Media Library image');

  // ── Permanent Event: same rich overview and image picker ──
  const eventWithImage = await admin.request(`/api/events/${fx}-event`, 'PUT', { descriptionBody: { type: 'doc', content: [{ type: 'image', attrs: { mediaId: uploaded.id } }] } });
  assert.equal(eventWithImage.status, 400); assert.match(eventWithImage.text, /event description cannot contain images/);
  assert.equal((await author.request(`/api/events/${fx}-event`, 'PUT', { descriptionBody: rich })).status, 403);
  await page.getByRole('button', { name: /Permanent Events/ }).click();
  await page.locator('tr', { hasText: `${fx} Open` }).first().getByRole('button', { name: 'Edit' }).click();
  const overview = page.locator('#event-editor-field-9');
  await overview.waitFor();
  assert.match(await overview.innerText(), /Fixture event\./, 'legacy plain overview opens as editable text');
  const eventForm = page.locator('form', { has: overview });
  assert.equal(await eventForm.getByRole('button', { name: /Insert Image/ }).count(), 0, 'no image tool in the overview editor');
  await page.waitForTimeout(500); // the overview editor mounts with the loaded event
  await overview.locator('p').last().click(); await page.keyboard.press('End'); await page.keyboard.press('Enter');
  await page.keyboard.press('Control+B'); await page.keyboard.type('Event bold line'); await page.keyboard.press('Control+B');
  await eventForm.getByTestId('event-image-pick').click();
  await page.getByRole('dialog', { name: 'Choose an image' }).getByRole('button', { name: new RegExp(`${fx} cover`) }).click();
  await until('event image picked', async () => (await page.locator('#event-image').inputValue()) === uploaded.url);
  await eventForm.getByRole('button', { name: 'Save Updates', exact: true }).click();
  await until('event saved', async () => !!(await prisma.sportEvent.findUnique({ where: { id: `${fx}-event` } }))!.descriptionBody).catch((e) => { console.log('API errors:', apiErrors); throw e; });
  const savedEvent = (await prisma.sportEvent.findUnique({ where: { id: `${fx}-event` } }))!;
  assert.equal(savedEvent.featuredMediaId, uploaded.id);
  // The saved content (both texts and the bold mark) is what matters, not where the test's caret landed.
  assert.match(savedEvent.description, /Fixture event\./); assert.match(savedEvent.description, /Event bold line/);
  assert(JSON.stringify(savedEvent.descriptionBody).includes('"bold"'), 'bold kept in the overview');
  const eventHtml = await (await fetch(`${base}/${sport.slug}/${eventSlug}/`)).text();
  assert.match(eventHtml, /<strong[^>]*>Event bold line<\/strong>/);
  pass('Permanent Event: overview uses the rich editor (no image tool), image picker selects a library image, save stores both, public event page renders the formatting; images in the overview and Author edits are refused');
  assert.deepEqual(errors, []);
} finally {
  await browser?.close().catch(() => undefined);
  child.kill();
  await prisma.eventEdition.deleteMany({ where: { eventSlug } });
  await prisma.redirectRule.deleteMany({ where: { sourceUrl: { contains: fx } } });
  await prisma.sportEvent.deleteMany({ where: { id: `${fx}-event` } });
  await prisma.mediaItem.deleteMany({ where: { title: { startsWith: fx } } });
  await prisma.editorDraft.deleteMany({ where: { ownerId: { in: [adminId, editorId, authorId] } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: [adminId, editorId, authorId] } } });
  await prisma.session.deleteMany({ where: { userId: { in: [adminId, editorId, authorId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [adminId, editorId, authorId] } } });
  await prisma.$disconnect();
  fs.rmSync(mediaDir, { recursive: true, force: true });
}
console.log(`Event/Edition description and image browser acceptance: ${checks} checks passed.`);
