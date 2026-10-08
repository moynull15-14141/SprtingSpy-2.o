/**
 * PHASE 6 — Article editor hardening, browser acceptance. Production build +
 * LOCAL development database only (refuses anything else); real Chrome.
 * Fixture rows (users, profiles, articles, FAQ, drafts, media) are removed afterwards.
 *
 *   npm run build && PLAYWRIGHT_EXECUTABLE_PATH=<chrome> npm run test:article-editor-browser
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
import { docxFile, pdfFile } from './lib/sourceFixtures';

assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe, 'Article editor browser verification requires a local development database.');
assert(fs.existsSync('.next/BUILD_ID'), 'Build before verification (npm run build).');
const chromePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
assert(fs.existsSync(chromePath), `Chrome not found at ${chromePath} (set PLAYWRIGHT_EXECUTABLE_PATH).`);

const fx = `p6${crypto.randomUUID().slice(0, 6)}`;
const password = `Phase6-${crypto.randomUUID()}`;
const U = { admin: `${fx}-admin`, editor: `${fx}-editor`, author: `${fx}-author` };
const P = { admin: `${fx}-byline-admin`, editor: `${fx}-byline-editor`, author: `${fx}-byline-author` };
const liveId = `${fx}-live`;

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
const until = async (what: string, test: () => Promise<boolean>, ms = 15_000) => {
  for (const end = Date.now() + ms; Date.now() < end;) { if (await test()) return; await new Promise((r) => setTimeout(r, 200)); }
  assert.fail(`timed out waiting for ${what}`);
};

let browser: Browser | null = null;
try {
  for (const [role, id] of [['Admin', U.admin], ['Editor', U.editor], ['Author', U.author]] as const) {
    await prisma.user.create({ data: { id, name: `${fx} ${role}`, email: `${id}@example.test`, role, avatar: '', joinedAt: new Date(), passwordHash: hashPassword(password) } });
  }
  for (const [key, id] of Object.entries(P)) await prisma.author.create({ data: { id, slug: id, name: `${fx} ${key} byline`, roleTitle: 'Writer', bio: '', avatar: '', userId: U[key as keyof typeof U] } });
  const sport = (await prisma.sport.findFirst({ where: { isVisible: true }, orderBy: { order: 'asc' }, select: { slug: true, name: true } }))!;
  const type = (await prisma.articleType.findFirst({ where: { isActive: true }, select: { name: true } }))!;
  await prisma.article.create({ data: {
    id: liveId, slug: liveId, title: `${fx} Live Article`, sportSlug: sport.slug, articleType: type.name, excerpt: 'Live excerpt', content: 'Live body.',
    body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Live body.' }] }] }, featuredImage: '', authorId: P.admin,
    publishedAt: new Date(), readingTimeMinutes: 1, seo: {}, status: 'published', reviewStatus: 'not_required',
  } });

  for (let i = 0; i < 120 && !/Server running/.test(output); i++) await new Promise((r) => setTimeout(r, 500));
  assert.match(output, /Server running/, `server did not start:\n${output.slice(-2000)}`);

  browser = await chromium.launch({ executablePath: chromePath });
  const alerts: string[] = [];
  const pageErrors: string[] = [];
  let confirmAnswer = true;
  const confirms: string[] = [];
  const open = async (user: string, width = 1440) => {
    const ctx = await browser!.newContext({ viewport: { width, height: 1000 } });
    const page = await ctx.newPage();
    ctx.on('page', (p) => p.on('dialog', (d) => { if (d.type() === 'alert') alerts.push(d.message()); void d.dismiss(); }));
    page.on('dialog', (d) => {
      if (d.type() === 'alert') { alerts.push(d.message()); void d.dismiss(); return; }
      if (d.type() === 'confirm') { confirms.push(d.message()); void (confirmAnswer ? d.accept() : d.dismiss()); return; }
      void d.accept();
    });
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.goto(`${base}/admin/`);
    await page.getByRole('textbox', { name: 'Email' }).fill(`${user}@example.test`);
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.locator('[data-admin-shell] aside[aria-label="CMS navigation"]').waitFor({ timeout: 30_000 });
    return page;
  };
  const nav = (page: Page, name: string) => page.locator('[data-admin-shell] aside[aria-label="CMS navigation"]').getByRole('button', { name, exact: true }).first().click();
  const toArticles = async (page: Page) => { await nav(page, 'Articles'); await page.getByTestId('create-article-button').waitFor(); };
  const createManually = async (page: Page) => { await page.getByTestId('create-article-button').click(); if (await page.getByTestId('create-article-manual').count()) await page.getByTestId('create-article-manual').click(); await page.locator('#article-title').waitFor(); };
  const chooseSource = async (page: Page) => { await page.getByTestId('create-article-button').click(); await page.getByTestId('create-article-source').click(); await page.getByTestId('source-import-panel').waitFor(); };
  const byline = (page: Page, id: string) => page.getByLabel('Byline Author', { exact: true }).selectOption(id);
  const savedState = (page: Page) => page.getByTestId('article-saved-state').innerText();
  const statusSelect = (page: Page) => page.getByLabel('Publishing state');
  const articleByTitle = async (title: string) => { let found: Awaited<ReturnType<typeof prisma.article.findFirst>> = null; await until(`article "${title}"`, async () => !!(found = await prisma.article.findFirst({ where: { title } }))); return found!; };
  /** Click Preview and return the preview tab (it must show the saved article, never a changed state). */
  const preview = async (page: Page) => {
    const [tab] = await Promise.all([page.context().waitForEvent('page'), page.getByRole('button', { name: 'Preview', exact: true }).click()]);
    await until('preview URL', async () => /\/admin\/preview\/[^/]+\/$/.test(tab.url()));
    await tab.waitForLoadState('domcontentloaded');
    return tab;
  };
  const paste = (page: Page, html: string, text: string) => page.evaluate(([h, t]) => {
    const target = document.querySelector('#article-body') as HTMLElement;
    target.focus();
    const data = new DataTransfer(); data.setData('text/html', h); data.setData('text/plain', t);
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, [html, text]);
  const noHorizontalScroll = async (page: Page, what: string) => {
    const m = await page.evaluate('({ w: document.documentElement.scrollWidth, v: window.innerWidth })') as { w: number; v: number };
    assert(m.w <= m.v, `${what}: page scrolls horizontally (${m.w} > ${m.v})`);
  };

  // ── Flow A: manual → typed title (slug) → autosave → refresh → recover → preview ──
  const adminPage = await open(U.admin);
  await toArticles(adminPage);
  await createManually(adminPage);
  assert.equal(await savedState(adminPage), 'NEW · NOT SAVED YET');
  const typedTitle = `${fx} Typed preview of the final`;
  await adminPage.locator('#article-title').pressSequentially(typedTitle, { delay: 5 });
  assert.equal(await adminPage.locator('#article-slug').inputValue(), `${fx}-typed-preview-of-the-final`, 'slug follows the typed title');
  await adminPage.locator('#article-body').click();
  await adminPage.keyboard.type('Manual opening paragraph with ');
  await adminPage.keyboard.press('Control+B'); await adminPage.keyboard.type('bold words'); await adminPage.keyboard.press('Control+B');
  await adminPage.keyboard.type('. বাংলা লেখা ও English mixed.');
  await adminPage.locator('[data-autosave="saved"]').waitFor({ timeout: 15_000 });
  await adminPage.reload(); await adminPage.locator('[data-admin-shell] aside[aria-label="CMS navigation"]').waitFor({ timeout: 30_000 });
  await nav(adminPage, 'Dashboard');
  await adminPage.getByTestId('unsaved-work').locator('li', { hasText: typedTitle }).getByRole('button', { name: 'Continue editing' }).click();
  await until('recovered manual article', async () => (await adminPage.locator('#article-title').inputValue().catch(() => '')) === typedTitle);
  assert.match(await adminPage.locator('#article-body').innerText(), /বাংলা লেখা ও English mixed/);
  assert.equal(await adminPage.locator('#article-body strong').first().innerText(), 'bold words');
  await byline(adminPage, P.admin);
  const tabA = await preview(adminPage);
  const manualArticle = await articleByTitle(typedTitle);
  await tabA.getByRole('heading', { name: typedTitle }).waitFor();
  assert.equal(await tabA.locator('strong', { hasText: 'bold words' }).count(), 1, 'preview renders formatting');
  await tabA.close();
  assert.equal(manualArticle.status, 'draft'); assert.equal(manualArticle.slug, `${fx}-typed-preview-of-the-final`);
  await until('saved-state badge', async () => (await savedState(adminPage)).startsWith('DRAFT · PRIVATE'));
  pass('Flow A: typed title keeps a full slug; formatting, Bangla/English text autosave, recover after refresh and preview as a private draft');

  // ── Flow G: unsafe pasted content ──
  await adminPage.locator('#article-body').click();
  await adminPage.keyboard.press('Control+End');
  await paste(adminPage, '<p>Pasted <b>bold</b> <a href="javascript:alert(3)">bad link</a> <a href="https://example.com/ok">good link</a></p><img src="https://example.com/x.jpg" onerror="alert(1)"><script>alert(2)</script><p onclick="alert(4)">Pasted tail</p>', 'Pasted bold bad link good link Pasted tail');
  await adminPage.getByTestId('paste-notice').waitFor();
  assert.equal(await adminPage.locator('#article-body img').count(), 0, 'pasted free-URL image left out');
  assert.equal(await adminPage.locator('#article-body a[href^="javascript"]').count(), 0, 'javascript: link not kept');
  await adminPage.getByRole('button', { name: 'Save draft' }).click();
  await until('pasted content saved', async () => ((await prisma.article.findUnique({ where: { id: manualArticle.id } }))?.content ?? '').includes('Pasted tail'));
  const savedBody = JSON.stringify((await prisma.article.findUnique({ where: { id: manualArticle.id } }))!.body);
  assert(!/javascript:|onerror|onclick|<script/i.test(savedBody), 'no executable markup stored');
  assert(savedBody.includes('https://example.com/ok'));
  const tabG = await preview(adminPage);
  await tabG.getByText('Pasted tail').waitFor();
  assert.equal(await tabG.locator('script:has-text("alert(2)")').count(), 0);
  await tabG.close();
  assert.deepEqual(alerts, [], 'no pasted script ran');
  pass('Flow G: pasted web content keeps safe formatting/links, drops free-URL images and unsafe links, saves, and stays inert in preview');
  await adminPage.getByRole('button', { name: /Back to articles/ }).click();

  // ── Data safety: Preview / Save draft never change a live article by accident ──
  await adminPage.locator('tr', { hasText: `${fx} Live Article` }).getByRole('button', { name: 'Edit' }).click();
  await until('live article open', async () => (await adminPage.locator('#article-title').inputValue().catch(() => '')) === `${fx} Live Article`);
  assert.match(await savedState(adminPage), /^PUBLISHED · LIVE/);
  await adminPage.locator('#article-title').fill(`${fx} Live Article (unsaved edit)`);
  await statusSelect(adminPage).selectOption('draft');
  const tabLive = await preview(adminPage);
  await tabLive.getByRole('heading', { name: `${fx} Live Article`, exact: true }).waitFor();
  await tabLive.close();
  await adminPage.waitForTimeout(800);
  let live = (await prisma.article.findUnique({ where: { id: liveId } }))!;
  assert.equal(live.status, 'published'); assert.equal(live.title, `${fx} Live Article`, 'preview saved nothing');
  confirmAnswer = false;
  await adminPage.getByRole('button', { name: 'Save draft' }).click();
  await until('unpublish confirmation', async () => confirms.some((m) => m.includes('removes it from the public site')));
  await adminPage.waitForTimeout(800);
  live = (await prisma.article.findUnique({ where: { id: liveId } }))!;
  assert.equal(live.status, 'published', 'declining the confirmation keeps the article live');
  confirmAnswer = true;
  await adminPage.getByRole('button', { name: 'Save draft' }).click();
  await until('confirmed unpublish', async () => (await prisma.article.findUnique({ where: { id: liveId } }))!.status === 'draft');
  pass('Preview of a live article shows the saved version and changes nothing; "Save draft" on it unpublishes only after confirmation');
  await adminPage.getByRole('button', { name: /Back to articles/ }).click();
  await createManually(adminPage);
  await adminPage.locator('#article-title').fill(`${fx} Scheduled-to-be`);
  await statusSelect(adminPage).selectOption('scheduled');
  assert(await adminPage.getByRole('button', { name: 'Preview', exact: true }).isDisabled(), 'a new article set to Scheduled cannot be previewed (it would be scheduled)');
  await adminPage.getByRole('button', { name: 'Discard', exact: true }).click();
  assert.equal(await prisma.article.count({ where: { title: `${fx} Scheduled-to-be` } }), 0);
  pass('Preview of a new article set to Scheduled is unavailable until it is saved explicitly');

  // ── Flow B: PDF (with a table) → review → transfer → edit → autosave → preview ──
  const editorPage = await open(U.editor);
  await toArticles(editorPage);
  await chooseSource(editorPage);
  const pdfTitle = `${fx} PDF table article`;
  await editorPage.locator('#document-import-file').setInputFiles({ name: 'table.pdf', mimeType: 'application/pdf', buffer: pdfFile([`TITLE: ${pdfTitle}`, `SPORT: ${sport.name}`, 'CONTENT: Standings after round five.', '', 'Team | Played | Won', 'Dhaka | 10 | 7', 'Sylhet | 10 | 5']) });
  await editorPage.getByRole('button', { name: 'Extract document' }).click();
  await editorPage.getByTestId('source-transfer').waitFor({ timeout: 30_000 });
  await editorPage.getByTestId('source-transfer').click();
  await editorPage.locator('#article-title').waitFor();
  await until('imported table', async () => (await editorPage.locator('#article-body table').count()) === 1);
  assert.equal(await editorPage.locator('#article-body table tr').count(), 3);
  await editorPage.locator('#article-title').fill(`${pdfTitle} edited`);
  await editorPage.locator('[data-autosave="saved"]').waitFor({ timeout: 15_000 });
  await byline(editorPage, P.editor);
  const tabB = await preview(editorPage);
  await tabB.getByRole('heading', { name: `${pdfTitle} edited` }).waitFor();
  assert.equal(await tabB.locator('table tr').count(), 3, 'preview renders the imported table');
  await tabB.close();
  assert.equal((await articleByTitle(`${pdfTitle} edited`)).status, 'draft');
  pass('Flow B: PDF source → review → transfer → real table in the editor → edit → autosave → preview as a draft');
  await editorPage.getByRole('button', { name: /Back to articles/ }).click();

  // ── Flow C: DOCX ──
  await chooseSource(editorPage);
  const docxTitle = `${fx} DOCX article`;
  await editorPage.locator('#document-import-file').setInputFiles({ name: 'a.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docxFile([`TITLE: ${docxTitle}`, 'SUBTITLE: Imported deck', 'CONTENT:\nDOCX first paragraph.', '## Second section', 'Second section text.']) });
  await editorPage.getByRole('button', { name: 'Extract document' }).click();
  await editorPage.getByTestId('source-transfer').waitFor({ timeout: 30_000 });
  await editorPage.getByTestId('source-transfer').click();
  await editorPage.locator('#article-title').waitFor();
  await editorPage.getByPlaceholder(/Secondary editorial deck/).fill('Imported deck, edited');
  await editorPage.locator('#article-body').click(); await editorPage.keyboard.press('Control+End'); await editorPage.keyboard.type(' Added by the editor.');
  await editorPage.locator('[data-autosave="saved"]').waitFor({ timeout: 15_000 });
  await byline(editorPage, P.editor);
  const tabC = await preview(editorPage);
  await tabC.getByText('Added by the editor.').waitFor();
  await tabC.getByText('Imported deck, edited').waitFor();
  await tabC.close();
  pass('Flow C: DOCX source → transfer → editable like a manual article → autosave → preview');
  await editorPage.getByRole('button', { name: /Back to articles/ }).click();

  // ── Flow D + E: Manual Source Text (Bangla) → slug guidance → save → FAQ handoff ──
  await chooseSource(editorPage);
  await editorPage.getByTestId('source-method-manual').click();
  const banglaTitle = 'বাংলাদেশ বনাম ভারত ফাইনাল';
  await editorPage.locator('#manual-source-text').fill(`TITLE: ${banglaTitle}\nSPORT: ${sport.name}\n\nCONTENT:\nবাংলাদেশ দল ঘোষণা। Mixed English text.\n\nFAQ\n\nQ: ফাইনাল কবে?\nA: শুক্রবার।`);
  await editorPage.getByRole('button', { name: 'Process text' }).click();
  await editorPage.getByTestId('source-transfer').waitFor();
  await editorPage.getByTestId('source-transfer').click();
  await editorPage.locator('#article-title').waitFor();
  assert.equal(await editorPage.locator('#article-title').inputValue(), banglaTitle);
  assert.equal(await editorPage.locator('#article-slug').inputValue(), '');
  await byline(editorPage, P.editor);
  await editorPage.getByRole('button', { name: 'Save draft' }).click();
  await editorPage.getByText(/type a short English slug/).waitFor();
  assert(await editorPage.evaluate("document.activeElement?.id === 'article-slug'"), 'focus moves to the slug field');
  await editorPage.locator('#article-slug').fill(`${fx}-bangla-final`);
  await editorPage.getByRole('button', { name: 'Save draft' }).click();
  let banglaArticle: Awaited<ReturnType<typeof prisma.article.findFirst>> = null;
  await until('Bangla article', async () => !!(banglaArticle = await prisma.article.findFirst({ where: { slug: `${fx}-bangla-final` } })));
  assert.equal(banglaArticle!.title, banglaTitle);
  await until('Bangla FAQ handoff', async () => (await prisma.faqEntry.count({ where: { articleId: banglaArticle!.id } })) === 1);
  const faq = (await prisma.faqEntry.findFirst({ where: { articleId: banglaArticle!.id } }))!;
  assert.deepEqual([faq.question, faq.status], ['ফাইনাল কবে?', 'draft']);
  assert.match(banglaArticle!.content, /বাংলাদেশ দল ঘোষণা।/);
  const tabD = await preview(editorPage);
  await tabD.getByRole('heading', { name: banglaTitle }).waitFor();
  await tabD.close();
  pass('Flow D/E: Bangla manual source → clear slug guidance → draft saved → FAQ handed to the existing FAQ system → preview');
  await editorPage.getByRole('button', { name: /Back to articles/ }).click();

  // ── Flow F: Author boundary ──
  const authorPage = await open(U.author);
  await toArticles(authorPage);
  await createManually(authorPage);
  assert.equal(await authorPage.getByTestId('import-from-source').count(), 0);
  assert.equal(await authorPage.getByRole('button', { name: 'Publish', exact: true }).count(), 0);
  assert(await statusSelect(authorPage).isDisabled());
  const authorTitle = `${fx} Author draft`;
  await authorPage.locator('#article-title').fill(authorTitle);
  await authorPage.locator('#article-body').fill('Author body text.');
  const tabF = await preview(authorPage);
  await tabF.getByRole('heading', { name: authorTitle }).waitFor();
  await tabF.close();
  const authorArticle = await articleByTitle(authorTitle);
  assert.equal(authorArticle.status, 'draft'); assert.equal(authorArticle.reviewStatus, 'draft');
  const csrf = (await authorPage.context().cookies()).find((c) => c.name === 'csrf_token')?.value ?? '';
  const publishAttempt = await authorPage.evaluate(async ([id, token]) => (await fetch(`/api/articles/${id}`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json', 'x-csrf-token': decodeURIComponent(token) }, body: JSON.stringify({ status: 'published' }) })).status, [authorArticle.id, csrf]);
  assert.equal(publishAttempt, 403);
  const foreignEdit = await authorPage.evaluate(async ([id, token]) => (await fetch(`/api/articles/${id}`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json', 'x-csrf-token': decodeURIComponent(token) }, body: JSON.stringify({ title: 'hijack' }) })).status, [manualArticle.id, csrf]);
  assert.equal(foreignEdit, 403);
  pass('Flow F: Author creates and previews a private draft; cannot publish, import from source, or edit another byline (403)');

  // ── Flow H: smaller viewports ──
  for (const width of [1024, 768]) {
    await editorPage.setViewportSize({ width, height: 900 });
    await createManually(editorPage);
    await editorPage.locator('#article-title').fill(`${fx} viewport ${width}`);
    await editorPage.locator('[data-autosave="saved"]').waitFor({ timeout: 15_000 });
    assert(await editorPage.getByTestId('article-saved-state').isVisible(), 'saved state visible');
    assert(await editorPage.locator('[data-autosave="saved"]').isVisible(), 'autosave status visible');
    await noHorizontalScroll(editorPage, `editor @${width}`);
    await editorPage.getByRole('button', { name: 'Save draft' }).scrollIntoViewIfNeeded();
    assert(await editorPage.getByRole('button', { name: 'Save draft' }).isVisible());
    await editorPage.getByRole('button', { name: 'Discard', exact: true }).click();
    await editorPage.getByTestId('create-article-button').waitFor();
  }
  pass('Flow H: at 1024 and 768 px the editor has no horizontal overflow and keeps save status and actions reachable');
  assert.deepEqual(pageErrors, [], `browser errors: ${pageErrors.join('; ')}`);
  assert.deepEqual(alerts, []);
  pass('no uncaught browser errors or script alerts across all flows');
} finally {
  await browser?.close().catch(() => undefined);
  child.kill();
  const userIds = Object.values(U);
  const created = await prisma.article.findMany({ where: { OR: [{ id: { startsWith: fx } }, { title: { startsWith: fx } }, { slug: { startsWith: fx } }, { authorId: { in: Object.values(P) } }] }, select: { id: true } });
  const articleIds = created.map((a) => a.id);
  await prisma.faqEntry.deleteMany({ where: { articleId: { in: articleIds } } });
  await prisma.editorDraft.deleteMany({ where: { ownerId: { in: userIds } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { entityId: { in: articleIds } }] } });
  await prisma.redirectRule.deleteMany({ where: { sourceUrl: { contains: fx } } });
  await prisma.articleMedia.deleteMany({ where: { articleId: { in: articleIds } } });
  await prisma.article.deleteMany({ where: { id: { in: articleIds } } });
  await prisma.author.deleteMany({ where: { id: { startsWith: fx } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
}
console.log(`Article editor browser acceptance: ${checks} checks passed.`);
