/**
 * CMS workspace restore after a page refresh: the desk is kept in the URL (/admin/#desk), Back
 * and Forward move between desks, and the editor that was open (new or existing Article, Event,
 * Edition, Page) reopens. Production build + LOCAL development database only; real Chrome.
 * Fixture rows are removed afterwards.
 *
 *   npm run build && PLAYWRIGHT_EXECUTABLE_PATH=<chrome> npm run test:workspace-restore-browser
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
import { checkDatabaseUrlIsLocalDev } from '../dbSafety';
import { hashPassword } from '../password';

assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe, 'Workspace restore verification requires a local development database.');
assert(fs.existsSync('.next/BUILD_ID'), 'Build before verification (npm run build).');
const chromePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
assert(fs.existsSync(chromePath), `Chrome not found at ${chromePath} (set PLAYWRIGHT_EXECUTABLE_PATH).`);

const fx = `ws${crypto.randomUUID().slice(0, 6)}`;
const password = `Workspace-${crypto.randomUUID()}`;
const U = { admin: `${fx}-admin`, author: `${fx}-author` };
const ids = { article: `${fx}-article`, event: `${fx}-event`, edition: `${fx}-edition`, page: `${fx}-page` };

const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = (probe.address() as { port: number }).port; await new Promise<void>((r) => probe.close(() => r()));
const base = `http://127.0.0.1:${port}`;
let output = '';
const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
  cwd: process.cwd(), windowsHide: true,
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', TRUST_PROXY: 'false', NODE_ENV: 'production', APP_ENV: 'production', AUTH_MODE: 'production', DEV_LOGIN_BYPASS: 'false', ALLOWED_ORIGIN: base, SITE_ORIGIN: base, INDEXNOW_ENDPOINT: '', GEMINI_API_KEY: '', MEDIA_STORAGE_PROVIDER: 'local' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (c) => { output += c; }); child.stderr.on('data', (c) => { output += c; });

let checks = 0; const pass = (m: string) => { checks++; console.log(`PASS ${m}`); };
const until = async (what: string, test: () => Promise<boolean>, ms = 20_000) => {
  for (const end = Date.now() + ms; Date.now() < end;) { if (await test()) return; await new Promise((r) => setTimeout(r, 200)); }
  assert.fail(`timed out waiting for ${what}`);
};
const doc = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });

let browser: Browser | null = null;
try {
  for (const [role, id] of [['Admin', U.admin], ['Author', U.author]] as const) {
    await prisma.user.create({ data: { id, name: `${fx} ${role}`, email: `${id}@example.test`, role, avatar: '', joinedAt: new Date(), passwordHash: hashPassword(password) } });
  }
  await prisma.author.create({ data: { id: `${fx}-byline`, slug: `${fx}-byline`, name: `${fx} byline`, roleTitle: 'Writer', bio: '', avatar: '', userId: U.admin } });
  const sport = (await prisma.sport.findFirst({ where: { isVisible: true }, orderBy: { order: 'asc' }, select: { slug: true } }))!;
  const type = (await prisma.articleType.findFirst({ where: { isActive: true }, select: { name: true } }))!;
  await prisma.article.create({ data: { id: ids.article, slug: ids.article, title: `${fx} Existing Article`, sportSlug: sport.slug, articleType: type.name, excerpt: 'Excerpt', content: 'Body.', body: doc('Body.') as object, featuredImage: '', authorId: `${fx}-byline`, publishedAt: new Date(), readingTimeMinutes: 1, seo: {}, status: 'draft', reviewStatus: 'not_required' } });
  await prisma.sportEvent.create({ data: { id: ids.event, sportSlug: sport.slug, slug: `${fx}-cup`, name: `${fx} Cup`, shortName: `${fx} Cup`, description: 'Event overview.', seo: {}, isVisible: true } });
  await prisma.eventEdition.create({ data: { id: ids.edition, sportSlug: sport.slug, eventSlug: `${fx}-cup`, year: 2042, title: `${fx} Cup 2042`, description: 'Edition text.', seo: {}, status: 'upcoming' } });
  await prisma.page.create({ data: { id: ids.page, slug: `${fx}-page`, title: `${fx} Page`, body: doc('Page text.') as object, content: 'Page text.', status: 'draft', createdBy: 'test', updatedBy: 'test' } });

  for (let i = 0; i < 120 && !/Server running/.test(output); i++) await new Promise((r) => setTimeout(r, 500));
  assert.match(output, /Server running/, `server did not start:\n${output.slice(-2000)}`);

  browser = await chromium.launch({ executablePath: chromePath });
  const errors: string[] = [];
  const open = async (user: string) => {
    const page = await (await browser!.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => void d.accept());
    await page.goto(`${base}/admin/`);
    await page.getByRole('textbox', { name: 'Email' }).fill(`${user}@example.test`);
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.locator('[data-admin-shell] aside[aria-label="CMS navigation"]').waitFor({ timeout: 30_000 });
    return page;
  };
  const nav = (page: Page, name: string) => page.locator('[data-admin-shell] aside[aria-label="CMS navigation"]').getByRole('button', { name, exact: true }).first().click();
  const refresh = async (page: Page) => { await page.reload(); await page.locator('[data-admin-shell] aside[aria-label="CMS navigation"]').waitFor({ timeout: 30_000 }); };
  const current = (page: Page) => page.locator('[data-admin-shell] aside[aria-label="CMS navigation"] [aria-current="page"]').innerText();

  const page = await open(U.admin);
  // ── Desks ──
  await nav(page, 'Articles');
  await until('#articles', async () => page.url().endsWith('#articles'));
  await refresh(page);
  await page.getByTestId('create-article-button').waitFor();
  assert.match(await current(page), /Articles/);
  await nav(page, 'Media Library');
  await until('#media', async () => page.url().endsWith('#media'));
  await page.goBack();
  await page.getByTestId('create-article-button').waitFor();
  assert(page.url().endsWith('#articles'));
  await page.goForward();
  await until('forward to media', async () => /Media Library/.test(await current(page)));
  pass('the desk is in the URL: refresh stays on it (not the Dashboard); Back/Forward move between desks');

  await nav(page, 'Events & Editions');
  await page.getByRole('button', { name: /Staged Editions/ }).click();
  await refresh(page);
  await page.locator('tr', { hasText: `${fx} Cup 2042` }).waitFor();
  pass('Events & Editions keeps the Staged Editions sub-tab after a refresh');

  // ── New article with content: reopens with its text, no clicks needed ──
  await nav(page, 'Articles');
  await page.getByTestId('create-article-button').click();
  await page.getByTestId('create-article-manual').click();
  await page.locator('#article-title').fill(`${fx} New article in progress`);
  await page.locator('#article-body').fill('Typed before the refresh.');
  await page.locator('[data-autosave="saved"]').waitFor({ timeout: 15_000 });
  await refresh(page);
  await until('new article reopened', async () => (await page.locator('#article-title').inputValue().catch(() => '')) === `${fx} New article in progress`);
  assert.match(await page.locator('#article-body').innerText(), /Typed before the refresh\./);
  // Typing right before a refresh (before the debounced server save) is kept by the local buffer.
  await page.locator('#article-title').fill(`${fx} New article edited just now`);
  await refresh(page);
  await until('latest typing restored', async () => (await page.locator('#article-title').inputValue().catch(() => '')) === `${fx} New article edited just now`);
  pass('a new article being written reopens after a refresh with its latest text');
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await page.getByTestId('create-article-button').waitFor();
  await refresh(page);
  await page.getByTestId('create-article-button').waitFor();
  await page.waitForTimeout(1000);
  assert.equal(await page.locator('#article-title').count(), 0, 'a discarded editor is not reopened');

  // ── Existing article: reopens; unsaved changes come back through the recovery banner ──
  await page.locator('tr', { hasText: `${fx} Existing Article` }).getByRole('button', { name: 'Edit' }).click();
  await until('existing open', async () => (await page.locator('#article-title').inputValue().catch(() => '')) === `${fx} Existing Article`);
  await refresh(page);
  await until('existing reopened', async () => (await page.locator('#article-title').inputValue().catch(() => '')) === `${fx} Existing Article`);
  assert.equal(await page.getByTestId('draft-recovery').count(), 0, 'nothing to recover when nothing changed');
  await page.locator('#article-title').fill(`${fx} Existing Article (edited)`);
  await page.locator('[data-autosave="saved"]').waitFor({ timeout: 15_000 });
  await refresh(page);
  await page.getByTestId('draft-recovery').waitFor({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Continue Draft' }).click();
  await until('edit restored', async () => (await page.locator('#article-title').inputValue()) === `${fx} Existing Article (edited)`);
  assert.equal((await prisma.article.findUnique({ where: { id: ids.article } }))!.title, `${fx} Existing Article`, 'the saved article is unchanged');
  pass('an existing article reopens after a refresh; unsaved edits are offered through the existing recovery banner');
  await page.getByRole('button', { name: /Back to articles/ }).click();
  await page.getByTestId('create-article-button').waitFor();
  await refresh(page);
  await page.getByTestId('create-article-button').waitFor();
  await page.waitForTimeout(1000);
  assert.equal(await page.locator('#article-title').count(), 0);
  pass('after "Back to articles" a refresh shows the article list, not the editor');

  // ── Event, Edition and Page editors ──
  await nav(page, 'Events & Editions');
  await page.getByRole('button', { name: /Permanent Events/ }).click();
  await page.locator('tr', { hasText: `${fx} Cup` }).first().getByRole('button', { name: 'Edit' }).click();
  await page.locator('#event-editor-field-9').waitFor();
  await refresh(page);
  await page.locator('#event-editor-field-9').waitFor({ timeout: 20_000 });
  assert.match(await page.locator('#event-editor-field-9').innerText(), /Event overview\./);
  await page.getByRole('button', { name: 'Cancel', exact: true }).first().click();
  await page.getByRole('button', { name: /Staged Editions/ }).click();
  await page.locator('tr', { hasText: `${fx} Cup 2042` }).getByRole('button', { name: 'Edit' }).click();
  await page.locator('#edition-description').waitFor();
  await refresh(page);
  await page.locator('#edition-description').waitFor({ timeout: 20_000 });
  assert.match(await page.locator('#edition-description').innerText(), /Edition text\./);
  await page.getByRole('button', { name: 'Cancel', exact: true }).first().click();
  await nav(page, 'Pages');
  await page.getByRole('button', { name: `${fx} Page` }).click();
  await page.getByTestId('page-editor').waitFor();
  await refresh(page);
  await page.getByTestId('page-editor').waitFor({ timeout: 20_000 });
  pass('an open Event, Edition or Page editor reopens after a refresh');

  // ── Clicking the desk you are on returns to its list (the editor closes, its working copy is kept) ──
  await nav(page, 'Articles');
  await page.locator('tr', { hasText: `${fx} Existing Article` }).getByRole('button', { name: 'Edit' }).click();
  await page.locator('#article-title').waitFor();
  await nav(page, 'Articles');
  await page.getByTestId('create-article-button').waitFor();
  assert.equal(await page.locator('#article-title').count(), 0);
  pass('clicking the current desk in the navigation returns from an editor to its list');

  // ── Role boundary: a desk this role cannot open falls back to the Dashboard ──
  const authorPage = await open(U.author);
  await authorPage.goto(`${base}/admin/#settings`);
  await authorPage.locator('[data-admin-shell] aside[aria-label="CMS navigation"]').waitFor({ timeout: 30_000 });
  await until('author dashboard', async () => /Dashboard/.test(await current(authorPage)));
  assert.equal(await authorPage.locator('[data-admin-shell] aside[aria-label="CMS navigation"]').getByRole('button', { name: 'Settings', exact: true }).count(), 0);
  pass('a desk the role may not open (Author → #settings) falls back to the Dashboard');

  // ── Public header: "Admin panel" in the account menu for staff only ──
  // The header learns the session asynchronously: open the account menu only once it shows the signed-in user.
  const accountButton = (p: Page) => p.locator('header button[aria-haspopup="true"]').last();
  const menu = async (p: Page) => {
    await p.goto(`${base}/`);
    await until('signed-in header', async () => !/Staff Login/.test(await accountButton(p).innerText().catch(() => 'Staff Login')));
    await accountButton(p).click();
    await p.getByText('Log Out').waitFor();
  };
  await menu(page);
  await page.getByTestId('admin-panel-link').click();
  await page.locator('[data-admin-shell] aside[aria-label="CMS navigation"]').waitFor({ timeout: 30_000 });
  assert(new URL(page.url()).pathname.startsWith('/admin'));
  await menu(authorPage);
  assert.equal(await authorPage.getByTestId('admin-panel-link').count(), 1, 'Author is staff');
  // Visitors (and Readers, who cannot sign in since Phase A) get the sign-in form, never the CMS entry.
  const anon = await (await browser!.newContext()).newPage();
  await anon.goto(`${base}/`);
  await accountButton(anon).click();
  await anon.getByPlaceholder('Email').waitFor();
  assert.equal(await anon.getByTestId('admin-panel-link').count(), 0, 'no Admin panel entry for visitors');
  assert.equal(await anon.locator('header a[href^="/admin"]').count(), 0);
  pass('public header account menu shows "Admin panel" to signed-in staff (Admin, Author) and opens the CMS; visitors never see it');
  assert.deepEqual(errors, [], `browser errors: ${errors.join('; ')}`);
} finally {
  await browser?.close().catch(() => undefined);
  child.kill();
  const userIds = Object.values(U);
  const articles = await prisma.article.findMany({ where: { OR: [{ id: { startsWith: fx } }, { title: { startsWith: fx } }] }, select: { id: true } });
  await prisma.editorDraft.deleteMany({ where: { ownerId: { in: userIds } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.article.deleteMany({ where: { id: { in: articles.map((a) => a.id) } } });
  await prisma.eventEdition.deleteMany({ where: { id: ids.edition } });
  await prisma.sportEvent.deleteMany({ where: { id: ids.event } });
  await prisma.page.deleteMany({ where: { id: ids.page } });
  await prisma.author.deleteMany({ where: { id: { startsWith: fx } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
}
console.log(`Workspace restore browser acceptance: ${checks} checks passed.`);
