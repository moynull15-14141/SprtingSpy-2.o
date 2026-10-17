/**
 * Article editor layout and comfort (laptop, desktop, tablet and phone).
 *
 *   npm run local -- test:admin-article-ui
 *
 * Local database only. Starts a production-mode server, creates disposable
 * fixtures and checks in Chrome: one scroll for the writing column with the
 * editor bar and formatting toolbar pinned, the settings panel beside it with
 * its own scroll (or hidden, remembered per browser), focus mode, the folding
 * Article setup, Ctrl+S, the Import trigger in the bar, the Author view and
 * the phone bottom bar. Every fixture is removed and pre-existing rows are
 * proven unchanged.
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

assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe, 'UI verification requires a local development database.');
assert(fs.existsSync('.next/BUILD_ID'), 'Run npm run build first.');

const fx = `ui${crypto.randomBytes(4).toString('hex')}`;
const password = `Ui-${crypto.randomUUID()}`;
const adminId = `${fx}-admin`; const authorId = `${fx}-author`;
const S = `${fx}-sport`;
const digest = (v: unknown) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const snapshot = async () => digest({ articles: await prisma.article.findMany({ orderBy: { id: 'asc' } }), sports: await prisma.sport.findMany({ orderBy: { id: 'asc' } }), authors: await prisma.author.findMany({ orderBy: { id: 'asc' } }) });
const before = await snapshot();

const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = (probe.address() as { port: number }).port;
await new Promise<void>((resolve) => probe.close(() => resolve()));
const base = `http://localhost:${port}`;
const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
  cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', TRUST_PROXY: 'false', NODE_ENV: 'production', APP_ENV: 'production', AUTH_MODE: 'production', DEV_LOGIN_BYPASS: 'false', ALLOWED_ORIGIN: base, INDEXNOW_ENDPOINT: '' } as NodeJS.ProcessEnv,
});
let output = ''; child.stdout.on('data', (c) => { output += c; }); child.stderr.on('data', (c) => { output += c; });

let checks = 0;
const pass = (m: string) => { checks++; console.log(`PASS ${m}`); };
const near = (a: number, b: number, label: string, tolerance = 1.5) => assert(Math.abs(a - b) <= tolerance, `${label}: ${a} vs ${b}`);
type Box = { top: number; bottom: number; left: number; right: number; width: number; height: number };
const box = (p: Page, selector: string) => p.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; })()`) as Promise<Box>;
const style = (p: Page, selector: string, prop: string) => p.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).${prop}`) as Promise<string>;
const until = async <T>(read: () => Promise<T>, ok: (v: T) => boolean, label: string, ms = 20_000) => { const end = Date.now() + ms; for (;;) { const v = await read(); if (ok(v)) return v; if (Date.now() > end) throw new Error(`Timed out: ${label}`); await new Promise((r) => setTimeout(r, 200)); } };

let browser: Browser | undefined;
try {
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Server did not start.\n${output}`)), 90_000);
    child.stdout.on('data', (c) => { if (String(c).includes('Server running')) { clearTimeout(t); resolve(); } });
    child.once('exit', () => { clearTimeout(t); reject(new Error(`Server exited.\n${output}`)); });
  });

  // ── Fixtures: a sport, an Admin, an Author with a byline, a long published article ──
  await prisma.sport.create({ data: { id: `${fx}-s`, slug: S, name: `${fx} Sport`, tagline: 't', description: 'd', order: 993, isVisible: true, seo: {} } });
  for (const [id, role] of [[adminId, 'Admin'], [authorId, 'Author']] as const) await prisma.user.create({ data: { id, name: `${fx} ${role}`, email: `${id}@example.test`, role, avatar: '/favicon.ico', joinedAt: new Date(), passwordHash: hashPassword(password) } });
  await prisma.author.create({ data: { id: `${fx}-byline`, slug: `${fx}-byline`, name: `${fx} Byline`, roleTitle: 'Correspondent', bio: 'Bio', avatar: '/favicon.ico', userId: authorId } });
  const paragraphs = Array.from({ length: 45 }, (_, i) => `Paragraph ${i + 1}. The race schedule, the course, the broadcasters and the live stream options are described here in enough detail to fill several lines on every screen size.`);
  const articleId = `${fx}-a-long`;
  await prisma.article.create({ data: { id: articleId, slug: 'long-guide', title: `${fx} Long guide`, sportSlug: S, articleType: 'News', excerpt: 'A long guide used by the layout test.', content: paragraphs.join('\n\n'), featuredImage: '/favicon.ico', authorId: `${fx}-byline`, publishedAt: new Date(Date.now() - 86_400_000), readingTimeMinutes: 4, seo: {}, status: 'published' } });

  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  browser = await chromium.launch({ executablePath, headless: true });
  const pageErrors: string[] = [];
  const signIn = async (userId: string, viewport: { width: number; height: number }) => {
    const ctx = await browser!.newContext({ viewport });
    const p = await ctx.newPage(); p.on('pageerror', (e) => pageErrors.push(e.message));
    await p.goto(`${base}/admin/`, { waitUntil: 'networkidle' });
    await p.getByPlaceholder('Email').fill(`${userId}@example.test`); await p.getByPlaceholder('Password').fill(password); await p.getByRole('button', { name: 'Sign In', exact: true }).click();
    await p.getByRole('heading', { name: 'Content Management System' }).waitFor();
    return p;
  };
  const openArticle = async (p: Page) => {
    await p.goto(`${base}/admin/#articles`); await p.getByTestId('create-article-button').waitFor();
    await p.getByRole('searchbox').first().fill(articleId);
    await p.getByRole('row').filter({ hasText: `${fx} Long guide` }).getByRole('button', { name: 'Edit', exact: true }).click();
    await p.getByRole('heading', { name: 'Edit Article Dossier' }).waitFor();
    await p.locator('.prose-editor').getByText('Paragraph 45.').waitFor();
  };

  // ── Laptop 1366×728 ──
  const p = await signIn(adminId, { width: 1366, height: 728 });
  await openArticle(p);
  for (const name of ['Preview', 'Save draft', 'Publish']) {
    assert.equal(await p.getByRole('button', { name, exact: true }).count(), 1, `exactly one ${name} button`);
    assert.equal(await p.getByTestId('article-editor-bar').getByRole('button', { name, exact: true }).count(), 1, `${name} lives in the editor bar`);
  }
  const consoleHeader = await box(p, '.cms-console-header');
  assert(consoleHeader.height <= 1 && consoleHeader.width <= 1, `the console header folds away while editing: ${JSON.stringify(consoleHeader)}`);
  assert.equal(await p.getByRole('heading', { name: 'Content Management System' }).count(), 1, 'its heading stays for screen readers');
  assert.equal(await p.getByRole('button', { name: 'My account' }).count(), 0, 'console links leave the page while editing');
  assert.equal(await p.evaluate(`document.documentElement.scrollHeight <= innerHeight + 1`), true, 'the browser page does not scroll on desktop');
  assert.notEqual(await style(p, '.cms-editor-column', 'overflowY'), 'auto', 'the article column has no scroll of its own');
  assert.equal(await style(p, '.cms-seo-sidebar', 'overflowY'), 'auto', 'the settings panel keeps its own scroll');
  const pane0 = await box(p, '.cms-main');
  await p.evaluate(`document.querySelector('.cms-main').scrollTop = 1600`);
  await p.waitForTimeout(150);
  const [pane, bar, toolbar, sidebar] = await Promise.all([box(p, '.cms-main'), box(p, '.cms-editor-bar'), box(p, '.cms-editor-toolbar'), box(p, '.cms-seo-sidebar')]);
  assert(await p.evaluate(`document.querySelector('.cms-main').scrollTop`) as number > 1000, 'the content pane scrolls the article');
  near(bar.top, pane.top + 1, 'the editor bar pins to the top edge of the pane (no content shows above it)');
  near(toolbar.top, bar.bottom, 'the formatting toolbar pins right under the editor bar');
  assert(sidebar.top >= bar.bottom && sidebar.bottom <= pane.bottom + 1, `the settings panel stays beside the article, below the bar and inside the pane: ${JSON.stringify({ sidebar, bar, pane })}`);
  assert(pane.bottom - toolbar.bottom > 330, `a 728px laptop keeps more than 330px for writing under the pinned bar and toolbar (${pane.bottom - toolbar.bottom})`);
  await p.evaluate(`document.querySelector('.cms-seo-sidebar').scrollTop = 300`);
  assert.equal(await p.evaluate(`document.querySelector('.cms-main').scrollTop`), await p.evaluate(`document.querySelector('.cms-main').scrollTop`));
  assert(await p.evaluate(`document.querySelector('.cms-seo-sidebar').scrollTop`) as number > 0, 'the settings panel scrolls on its own');
  near(pane0.top, pane.top, 'scrolling never moves the pane itself');
  pass('laptop 1366×728: console header folds away; one scroll for the article; editor bar (Preview, Save draft, Publish) and toolbar pinned; settings panel beside it with its own scroll; >330px left for writing');

  // Settings panel: hide, remembered after a reload, show again.
  const columnBefore = await box(p, '.cms-editor-column');
  await p.getByRole('button', { name: 'Hide settings panel' }).click();
  assert.equal(await style(p, '.cms-seo-sidebar', 'display'), 'none');
  const columnHidden = await box(p, '.cms-editor-column');
  assert(columnHidden.width > columnBefore.width && columnHidden.width <= 52 * 16 + 1, `hiding the panel widens the article to a comfortable reading width: ${columnBefore.width} → ${columnHidden.width}`);
  await p.reload({ waitUntil: 'networkidle' }); await p.getByRole('heading', { name: 'Edit Article Dossier' }).waitFor();
  assert.equal(await p.getByRole('button', { name: 'Show settings panel' }).count(), 1, 'the hidden panel is remembered in this browser');
  await p.getByRole('button', { name: 'Show settings panel' }).click();
  assert.equal(await style(p, '.cms-seo-sidebar', 'display'), 'block');
  pass('settings panel: hides for a wider (max 52rem) writing column, is remembered after a reload and comes back');

  // Focus mode: no public header, no desk navigation, no panel; Esc leaves; closing the editor always leaves.
  await p.getByRole('button', { name: 'Focus mode' }).click();
  assert.equal(await p.evaluate(`document.documentElement.hasAttribute('data-cms-focus')`), true);
  for (const selector of ['.site-header', '.cms-admin-nav', '.cms-seo-sidebar']) assert.equal(await style(p, selector, 'display'), 'none', `${selector} hidden in focus mode`);
  await p.getByRole('button', { name: 'Add block' }).click(); await p.locator('.cms-article-form [role="dialog"]').first().waitFor();
  await p.keyboard.press('Escape');
  assert.equal(await p.evaluate(`document.documentElement.hasAttribute('data-cms-focus')`), true, 'Esc with an editor menu open goes to the menu, not to focus mode');
  if (await p.locator('.cms-article-form [role="dialog"]').count()) await p.getByRole('button', { name: 'Add block' }).click();
  await p.locator('.prose-editor').click(); await p.keyboard.press('Escape');
  assert.equal(await p.evaluate(`document.documentElement.hasAttribute('data-cms-focus')`), false, 'Esc leaves focus mode');
  await p.getByRole('button', { name: 'Focus mode' }).click();
  await p.getByRole('button', { name: 'Back to articles' }).click(); await p.getByTestId('create-article-button').waitFor();
  assert.equal(await p.evaluate(`document.documentElement.hasAttribute('data-cms-focus')`), false, 'closing the editor leaves focus mode');
  assert.notEqual(await style(p, '.site-header', 'display'), 'none');
  assert.equal(await p.getByRole('button', { name: 'My account' }).count(), 1, 'the console header is back on the article list');
  await p.getByRole('row').filter({ hasText: `${fx} Long guide` }).getByRole('button', { name: 'Edit', exact: true }).click();
  await p.getByRole('heading', { name: 'Edit Article Dossier' }).waitFor();
  assert.equal(await p.evaluate(`document.documentElement.hasAttribute('data-cms-focus')`), true, 'focus mode is remembered for the next article');
  await p.getByRole('button', { name: 'Exit focus mode' }).click();
  pass('focus mode: hides the public header, desk navigation and panel; Esc and closing the editor leave it; the choice is remembered');

  // Article setup: below the writing, folds to a one-line summary that is remembered for existing articles.
  const setup = p.getByTestId('article-setup');
  assert.equal(await setup.evaluate((d) => (d as HTMLDetailsElement).open), true);
  const order = await p.evaluate(`(() => { const top = (s) => document.querySelector(s).getBoundingClientRect().top + document.querySelector('.cms-main').scrollTop; return { title: top('#article-title'), body: top('.prose-editor'), setup: top('[data-testid="article-setup"]') }; })()`) as { title: number; body: number; setup: number };
  assert(order.title < order.body && order.body < order.setup, 'the body follows the title; Article setup comes after the writing');
  const summary = await p.getByTestId('article-setup-summary').innerText();
  for (const part of [`${fx} Sport`, 'General sport guide', 'News', `${fx} Byline`]) assert(summary.includes(part), `setup summary names ${part}: ${summary}`);
  await setup.locator('summary').click();
  assert.equal(await setup.evaluate((d) => (d as HTMLDetailsElement).open), false);
  await p.getByRole('button', { name: 'Back to articles' }).click(); await p.getByTestId('create-article-button').waitFor();
  await p.getByRole('row').filter({ hasText: `${fx} Long guide` }).getByRole('button', { name: 'Edit', exact: true }).click(); await p.getByRole('heading', { name: 'Edit Article Dossier' }).waitFor();
  assert.equal(await p.getByTestId('article-setup').evaluate((d) => (d as HTMLDetailsElement).open), false, 'a folded setup stays folded for existing articles');
  await p.getByRole('button', { name: 'Back to articles' }).click(); await p.getByTestId('create-article-button').click(); await p.getByTestId('create-article-manual').click();
  await p.getByRole('heading', { name: 'New Article Guided Workflow' }).waitFor();
  assert.equal(await p.getByTestId('article-setup').evaluate((d) => (d as HTMLDetailsElement).open), true, 'a new article always starts with its setup open');
  assert.equal(await p.getByLabel('Subtitle / Deck').count(), 1, 'the subtitle sits under the title');
  await p.getByRole('button', { name: 'Back to articles' }).click(); await p.getByTestId('create-article-button').waitFor();
  pass('article setup: after the writing, folds to "sport · scope · type · byline", remembered for existing articles, always open for new ones');

  // Import from source opens below the bar; Ctrl+S saves in the current state (a live article stays live).
  await openArticle(p);
  await p.getByTestId('import-from-source').click();
  await p.getByTestId('source-import-panel').waitFor();
  const panelBox = await p.getByTestId('source-import-panel').boundingBox(); const barBox = await box(p, '.cms-editor-bar');
  assert(panelBox && panelBox.y >= barBox.bottom - 1, 'the import panel opens right under the editor bar');
  await p.getByTestId('import-from-source').click();
  assert.equal(await p.getByTestId('source-import-panel').count(), 0, 'the bar button closes it again');
  await p.locator('.prose-editor').getByText('Paragraph 45.').click(); await p.keyboard.press('End'); await p.keyboard.insertText(' Saved with Ctrl+S.');
  await p.keyboard.press('Control+s');
  const saved = await until(() => prisma.article.findUniqueOrThrow({ where: { id: articleId } }), (a) => a.content.includes('Saved with Ctrl+S.'), 'Ctrl+S save');
  assert.equal(saved.status, 'published', 'Ctrl+S never unpublishes a live article');
  await p.getByText(/Saved “.*” \(published\)\./).waitFor();
  pass('Import from source is a bar button whose panel opens under the bar; Ctrl+S saves the writing in its current state (a live article stays live)');

  // Desktop 1920×1080: two columns; tablet 1024×768: one column, the bar still pinned.
  await p.setViewportSize({ width: 1920, height: 1080 }); await p.waitForTimeout(200);
  assert.match(await style(p, '.cms-article-grid', 'gridTemplateColumns'), /^\S+ \S+$/, 'desktop shows article and settings side by side');
  await p.setViewportSize({ width: 1024, height: 768 }); await p.waitForTimeout(200);
  assert.doesNotMatch(await style(p, '.cms-article-grid', 'gridTemplateColumns'), / /, 'a 1024px screen stacks the settings under the article');
  await p.evaluate(`document.querySelector('.cms-main').scrollTop = 1600`); await p.waitForTimeout(150);
  const [tPane, tBar, tToolbar] = await Promise.all([box(p, '.cms-main'), box(p, '.cms-editor-bar'), box(p, '.cms-editor-toolbar')]);
  near(tBar.top, tPane.top + 1, 'tablet: bar pinned'); near(tToolbar.top, tBar.bottom, 'tablet: toolbar pinned under the bar');
  assert.equal(await p.evaluate(`document.documentElement.scrollWidth <= innerWidth`), true);
  pass('desktop 1920 keeps two columns; 1024 stacks them with the bar and toolbar still pinned; no horizontal overflow');

  // Phone 390×844: bottom action bar, one-row swipeable toolbar, no horizontal overflow.
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(250);
  await p.evaluate(`window.scrollTo(0, 2500)`); await p.waitForTimeout(150);
  const actions = await box(p, '.cms-editor-actions');
  near(actions.bottom, 844, 'phone: Preview / Save draft / Publish sit at the bottom of the screen'); near(actions.left, 0, 'phone: the bottom bar spans the screen'); near(actions.right, 390, 'phone: the bottom bar spans the screen');
  assert.equal(await style(p, '.cms-editor-bar', 'position'), 'static', 'phone: the bar scrolls away to leave room for writing');
  const pToolbar = await box(p, '.cms-editor-toolbar');
  near(pToolbar.top, 65, 'phone: the toolbar pins under the site header', 2);
  assert.equal(await style(p, '.cms-editor-toolbar', 'flexWrap'), 'nowrap'); assert.equal(await style(p, '.cms-editor-toolbar', 'overflowX'), 'auto');
  assert.equal(await p.evaluate(`document.documentElement.scrollWidth <= innerWidth`), true, 'phone: no horizontal page overflow');
  const prose = await box(p, '.prose-editor'); assert(prose.width >= 320, `phone: the article keeps most of the width (${prose.width}px)`);
  await p.getByRole('button', { name: 'Save draft', exact: true }).scrollIntoViewIfNeeded();
  assert(await p.getByRole('button', { name: 'Publish', exact: true }).isVisible(), 'phone: Publish is reachable');
  pass('phone 390×844: actions in a full-width bottom bar, bar scrolls away, toolbar is one pinned swipeable row, article keeps most of the width');

  // Author: no Publish, no Import; Save draft and Preview in the bar.
  const a = await signIn(authorId, { width: 1366, height: 728 });
  await a.getByRole('button', { name: /^Articles/ }).first().click(); await a.getByTestId('create-article-button').click();
  await a.getByRole('heading', { name: 'New Article Guided Workflow' }).waitFor();
  assert.equal(await a.getByRole('button', { name: 'Publish', exact: true }).count(), 0);
  assert.equal(await a.getByTestId('import-from-source').count(), 0);
  assert.equal(await a.getByTestId('article-editor-bar').getByRole('button', { name: 'Save draft', exact: true }).count(), 1);
  assert.deepEqual(pageErrors, [], `browser errors: ${pageErrors.join('; ')}`);
  pass('Author: Save draft and Preview in the bar, no Publish or Import; no browser errors anywhere');
} finally {
  await browser?.close().catch(() => undefined);
  child.kill();
  await prisma.editorDraft.deleteMany({ where: { ownerId: { in: [adminId, authorId] } } });
  await prisma.article.deleteMany({ where: { sportSlug: S } });
  await prisma.author.deleteMany({ where: { id: `${fx}-byline` } });
  await prisma.sport.deleteMany({ where: { id: `${fx}-s` } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: [adminId, authorId] } } });
  await prisma.session.deleteMany({ where: { userId: { in: [adminId, authorId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [adminId, authorId] } } });
}
assert.equal(await snapshot(), before, 'pre-existing articles, sports and authors are unchanged; no fixture is left');
pass('integrity: pre-existing data unchanged; fixtures removed');
console.log(`Article editor UI verification passed: ${checks} checks.`);
await prisma.$disconnect();
process.exit(0);
