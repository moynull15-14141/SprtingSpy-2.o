/**
 * PHASE 5 — unified Article creation, browser acceptance. Production build +
 * LOCAL development database only (refuses anything else); real Chrome.
 * Fixture rows (users, profiles, event, articles, FAQ, drafts) are removed afterwards.
 *
 *   npm run build && PLAYWRIGHT_EXECUTABLE_PATH=<chrome> npm run test:article-creation-browser
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

assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe, 'Article creation browser verification requires a local development database.');
assert(fs.existsSync('.next/BUILD_ID'), 'Build before verification (npm run build).');
const chromePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
assert(fs.existsSync(chromePath), `Chrome not found at ${chromePath} (set PLAYWRIGHT_EXECUTABLE_PATH).`);

const fx = `p5${crypto.randomUUID().slice(0, 6)}`;
const password = `Phase5-${crypto.randomUUID()}`;
const U = { admin: `${fx}-admin`, editor: `${fx}-editor`, author: `${fx}-author` };
const P = { admin: `${fx}-byline-admin`, editor: `${fx}-byline-editor`, author: `${fx}-byline-author` };
const existingId = `${fx}-existing`;
const existingFaqId = `faq-${fx}-existing`;

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

class Client {
  cookies = new Map<string, string>();
  async request(path: string, method = 'GET', body?: unknown, opts: { csrf?: boolean } = {}) {
    const headers: Record<string, string> = { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET' && opts.csrf !== false) headers['x-csrf-token'] = this.cookies.get('csrf_token') ?? '';
    const res = await fetch(base + path, { method, headers, redirect: 'manual', body: body === undefined ? undefined : JSON.stringify(body) });
    for (const raw of res.headers.getSetCookie()) { const [pair] = raw.split(';'); const i = pair.indexOf('='); const v = pair.slice(i + 1); if (v) this.cookies.set(pair.slice(0, i), v); else this.cookies.delete(pair.slice(0, i)); }
    const text = await res.text(); let data: any; try { data = JSON.parse(text); } catch { /* HTML */ }
    return { status: res.status, text, data };
  }
}

let browser: Browser | null = null;
try {
  // ── Fixtures ──
  for (const [role, id] of [['Admin', U.admin], ['Editor', U.editor], ['Author', U.author]] as const) {
    await prisma.user.create({ data: { id, name: `${fx} ${role}`, email: `${id}@example.test`, role, avatar: '', joinedAt: new Date(), passwordHash: hashPassword(password) } });
  }
  for (const [key, id] of Object.entries(P)) await prisma.author.create({ data: { id, slug: id, name: `${fx} ${key} byline`, roleTitle: 'Writer', bio: '', avatar: '', userId: U[key as keyof typeof U] } });
  const sport = (await prisma.sport.findFirst({ where: { isVisible: true }, orderBy: { order: 'asc' }, select: { slug: true, name: true } }))!;
  const type = (await prisma.articleType.findFirst({ where: { isActive: true }, select: { name: true } }))!;
  const eventName = `${fx} Fixture Cup`;
  await prisma.sportEvent.create({ data: { id: `${fx}-event`, sportSlug: sport.slug, slug: `${fx}-cup`, name: eventName, shortName: eventName, description: 'Fixture event.', seo: {}, isVisible: true } });
  await prisma.article.create({ data: {
    id: existingId, slug: existingId, title: `${fx} Existing Article`, sportSlug: sport.slug, articleType: type.name, excerpt: 'Existing excerpt', content: 'Existing body.',
    body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Existing body.' }] }] }, featuredImage: '', authorId: P.admin,
    publishedAt: new Date(), readingTimeMinutes: 1, seo: {}, status: 'draft', reviewStatus: 'not_required',
  } });
  await prisma.faqEntry.create({ data: { id: existingFaqId, question: 'Existing question about the fixture?', answer: 'Existing answer.', displayOrder: 0, status: 'published', source: 'editor', articleId: existingId, updatedBy: 'fixture' } });

  for (let i = 0; i < 120 && !/Server running/.test(output); i++) await new Promise((r) => setTimeout(r, 500));
  assert.match(output, /Server running/, `server did not start:\n${output.slice(-2000)}`);
  const login = async (id: string) => { const c = new Client(); await c.request('/robots.txt'); assert.equal((await c.request('/api/auth/login', 'POST', { email: `${id}@example.test`, password })).status, 200); return c; };
  const [admin, editor, author] = [await login(U.admin), await login(U.editor), await login(U.author)];
  const anon = new Client(); await anon.request('/robots.txt');

  // ── 34–36 Security: role and CSRF enforcement on the existing endpoints ──
  assert.equal((await author.request('/api/document-import/extract-text', 'POST', { text: 'TITLE: x' })).status, 403);
  assert.equal((await anon.request('/api/document-import/extract-text', 'POST', { text: 'TITLE: x' })).status, 401);
  assert.equal((await admin.request('/api/document-import/extract-text', 'POST', { text: 'TITLE: x' }, { csrf: false })).status, 403);
  assert.equal((await editor.request('/api/document-import/extract-text', 'POST', { text: 'TITLE: Editor allowed' })).status, 200);
  assert.equal((await author.request('/api/faq/import', 'POST', { articleId: existingId, faqs: [{ question: 'Author question?', answer: 'No.' }] })).status, 403);
  assert.equal((await anon.request('/api/faq/import', 'POST', { articleId: existingId, faqs: [{ question: 'Anon question?', answer: 'No.' }] })).status, 401);
  pass('34–36 Author and anonymous cannot source-import or hand off FAQ; CSRF is enforced; Editor is allowed');

  browser = await chromium.launch({ executablePath: chromePath });
  const alerts: string[] = [];
  const pageErrors: string[] = [];
  const open = async (user: string, width = 1440) => {
    const ctx = await browser!.newContext({ viewport: { width, height: 1000 } });
    const page = await ctx.newPage();
    page.on('dialog', (d) => { if (d.type() === 'alert') alerts.push(d.message()); void d.accept(); });
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
  const chooseSource = async (page: Page) => {
    await page.getByTestId('create-article-button').click();
    await page.getByTestId('create-article-source').click();
    await page.getByTestId('source-import-panel').waitFor();
  };
  const byline = (page: Page, id: string) => page.getByLabel('Byline Author', { exact: true }).selectOption(id);
  const noHorizontalScroll = async (page: Page, what: string) => {
    const m = await page.evaluate('({ w: document.documentElement.scrollWidth, v: window.innerWidth })') as { w: number; v: number };
    assert(m.w <= m.v, `${what}: page scrolls horizontally (${m.w} > ${m.v})`);
  };
  const newArticle = async (title: string) => { let found: Awaited<ReturnType<typeof prisma.article.findFirst>> = null; await until(`article "${title}"`, async () => !!(found = await prisma.article.findFirst({ where: { title } }))); return found!; };

  // ── Flow A: Create Article → Create manually → existing editor → save → reload ──
  const adminPage = await open(U.admin);
  await toArticles(adminPage);
  await adminPage.getByTestId('create-article-button').click();
  const choice = adminPage.getByTestId('create-article-choice');
  await choice.waitFor();
  assert.equal(await choice.getByRole('button').count(), 3, 'Cancel + exactly two creation options');
  assert.equal(await choice.getByTestId('create-article-manual').count() + await choice.getByTestId('create-article-source').count(), 2);
  await noHorizontalScroll(adminPage, 'creation choice');
  await adminPage.getByTestId('create-article-manual').click();
  await adminPage.getByRole('heading', { name: 'New Article Guided Workflow' }).waitFor();
  assert.equal(await adminPage.getByTestId('source-import-panel').count(), 0, 'manual creation opens the editor, not the source flow');
  assert.equal(await adminPage.locator('form.cms-article-form').count(), 1);
  const manualTitle = `${fx} Manual article`;
  await adminPage.locator('#article-title').fill(manualTitle);
  await adminPage.locator('#article-body').fill('Manual body written in the existing editor.');
  await adminPage.locator('[data-autosave="saved"]').waitFor({ timeout: 15_000 });
  assert.ok(await prisma.editorDraft.findFirst({ where: { ownerId: U.admin, kind: 'article', title: manualTitle } }), 'manual work autosaved');
  await byline(adminPage, P.admin);
  await adminPage.getByRole('button', { name: 'Save draft' }).click();
  const manual = await newArticle(manualTitle);
  assert.equal(manual.status, 'draft');
  await adminPage.reload(); await adminPage.locator('[data-admin-shell] aside[aria-label="CMS navigation"]').waitFor({ timeout: 30_000 });
  await toArticles(adminPage);
  await adminPage.locator('tr', { hasText: manualTitle }).getByRole('button', { name: 'Edit' }).click();
  await until('manual article reopened', async () => (await adminPage.locator('#article-title').inputValue().catch(() => '')) === manualTitle);
  await adminPage.getByRole('button', { name: /Back to articles/ }).click();
  pass('1–6 Flow A: Create Article → Create manually opens the existing editor; autosave, Save draft and reload keep the article');

  // ── Flow B: Create from source → PDF → review → transfer → editor → autosave/recovery → save ──
  const editorPage = await open(U.editor);
  await toArticles(editorPage);
  await chooseSource(editorPage);
  const panel = editorPage.getByTestId('source-import-panel');
  assert.equal(await editorPage.getByTestId('source-method-document').getAttribute('aria-pressed'), 'true');
  await panel.getByText(/up to 10 MB/).waitFor();
  const pdfTitle = `${fx} PDF article`;
  await editorPage.locator('#document-import-file').setInputFiles({ name: 'source.pdf', mimeType: 'application/pdf', buffer: pdfFile([`TITLE: ${pdfTitle}`, 'SUBTITLE: Deselected subtitle', `SPORT: ${sport.name}`, 'CONTENT: PDF body line.', '', 'FAQ', 'Q: Who hosts the fixture?', 'A: The fixture club.', 'Q: When does it start?', 'A: In June.']) });
  await panel.getByRole('button', { name: 'Extract document' }).click();
  await editorPage.getByTestId('source-transfer').waitFor({ timeout: 30_000 });
  await panel.getByText('PDF', { exact: true }).waitFor();
  assert.equal(await panel.locator('#source-faq-heading').count(), 1);
  await noHorizontalScroll(editorPage, 'source review');
  await panel.locator('article', { hasText: 'Subtitle' }).first().getByRole('checkbox').uncheck();
  await panel.locator('article', { hasText: 'FAQ 2' }).getByRole('checkbox').uncheck();
  await editorPage.getByTestId('source-transfer').click();
  await editorPage.getByRole('heading', { name: 'New Article Guided Workflow' }).waitFor();
  assert.equal(await editorPage.getByTestId('source-import-panel').count(), 0, 'the source step closes after transfer');
  assert.equal(await editorPage.locator('#article-title').inputValue(), pdfTitle);
  assert.equal(await editorPage.getByPlaceholder(/Secondary editorial deck/).inputValue(), '', 'deselected subtitle stays unchanged');
  await editorPage.getByText('1 reviewed source question is pending').waitFor();
  pass('7, 9–14 Flow B: PDF extracts into the shared review; field/FAQ selection transfers into the existing editor only');
  // No typing after transfer: the transferred working copy itself must autosave (Phase 5 fix).
  await editorPage.locator('[data-autosave="saved"]').waitFor({ timeout: 15_000 });
  const pdfDraft = await prisma.editorDraft.findFirst({ where: { ownerId: U.editor, kind: 'article', title: pdfTitle } });
  assert.ok(pdfDraft, 'transferred content autosaved without further edits');
  assert.equal((pdfDraft!.payload as any).pendingFaqs.length, 1);
  assert.equal(await prisma.article.count({ where: { title: pdfTitle } }), 0, 'transfer creates no Article');
  await editorPage.reload(); await editorPage.locator('[data-admin-shell] aside[aria-label="CMS navigation"]').waitFor({ timeout: 30_000 });
  await nav(editorPage, 'Dashboard');
  const unsaved = editorPage.getByTestId('unsaved-work');
  await unsaved.locator('li', { hasText: pdfTitle }).getByRole('button', { name: 'Continue editing' }).click();
  await until('recovered PDF working copy', async () => (await editorPage.locator('#article-title').inputValue().catch(() => '')) === pdfTitle);
  await editorPage.getByText('1 reviewed source question is pending').waitFor();
  pass('Autosave/recovery: transferred content and pending FAQ autosave immediately and survive a refresh');
  await byline(editorPage, P.editor);
  await editorPage.getByRole('button', { name: 'Save draft' }).click();
  const pdfArticle = await newArticle(pdfTitle);
  await until('PDF FAQ handoff', async () => (await prisma.faqEntry.count({ where: { articleId: pdfArticle.id } })) === 1);
  const pdfFaq = (await prisma.faqEntry.findFirst({ where: { articleId: pdfArticle.id } }))!;
  assert.deepEqual([pdfFaq.question, pdfFaq.status, pdfFaq.source], ['Who hosts the fixture?', 'draft', 'editor']);
  assert.equal(pdfArticle.sportSlug, sport.slug);
  assert.equal(pdfArticle.subtitle ?? '', '');
  assert.equal(pdfArticle.status, 'draft'); assert.equal(pdfArticle.scheduledFor, null);
  await until('pending notice cleared', async () => (await editorPage.getByText(/reviewed source question/).count()) === 0);
  await until('working copy applied', async () => !(await prisma.editorDraft.count({ where: { ownerId: U.editor, title: pdfTitle } })));
  pass('15, 27, 31 Flow B: Save draft creates a draft Article and turns the selected FAQ into an ordinary draft FaqEntry');
  await editorPage.getByRole('button', { name: /Back to articles/ }).click();

  // ── DOCX + unknown taxonomy ──
  await chooseSource(editorPage);
  const docxTitle = `${fx} DOCX article`;
  await editorPage.locator('#document-import-file').setInputFiles({ name: 'source.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docxFile([`TITLE: ${docxTitle}`, 'EVENT: Nonexistent Phase Five Event', 'CONTENT:\nDOCX body paragraph.', 'FAQ', 'Q: Docx question one?\nA: Docx answer one.']) });
  await editorPage.getByRole('button', { name: 'Extract document' }).click();
  await editorPage.getByTestId('source-transfer').waitFor({ timeout: 30_000 });
  const eventCard = editorPage.getByTestId('source-import-panel').locator('article', { hasText: 'Unable to map this value automatically' }).first();
  await eventCard.waitFor();
  assert(await eventCard.getByRole('checkbox').isDisabled(), 'unmapped taxonomy cannot be selected');
  await editorPage.getByTestId('source-transfer').click();
  await editorPage.locator('#article-title').waitFor();
  assert.equal(await editorPage.locator('#article-title').inputValue(), docxTitle);
  await byline(editorPage, P.editor);
  await editorPage.getByRole('button', { name: 'Save draft' }).click();
  const docxArticle = await newArticle(docxTitle);
  await until('DOCX FAQ handoff', async () => (await prisma.faqEntry.count({ where: { articleId: docxArticle.id } })) === 1);
  assert.equal(await prisma.sportEvent.count({ where: { name: 'Nonexistent Phase Five Event' } }), 0);
  assert.equal(docxArticle.status, 'draft');
  pass('8 DOCX source follows the same review/transfer/save path; unknown taxonomy is flagged and never created');
  await editorPage.getByRole('button', { name: /Back to articles/ }).click();

  // ── 24–26 Switching never carries a stale proposal ──
  await chooseSource(editorPage);
  await editorPage.locator('#document-import-file').setInputFiles({ name: 'switch.pdf', mimeType: 'application/pdf', buffer: pdfFile(['TITLE: Stale PDF proposal', 'CONTENT: stale.']) });
  await editorPage.getByRole('button', { name: 'Extract document' }).click();
  await editorPage.getByTestId('source-transfer').waitFor({ timeout: 30_000 });
  await editorPage.getByTestId('source-method-manual').click();
  assert.equal(await editorPage.getByTestId('source-transfer').count(), 0, 'PDF proposal discarded on switch');
  await editorPage.locator('#manual-source-text').fill('TITLE: Stale manual proposal\n\nCONTENT:\nstale.');
  await editorPage.getByRole('button', { name: 'Process text' }).click();
  await editorPage.getByTestId('source-transfer').waitFor();
  await editorPage.getByTestId('source-method-document').click();
  assert.equal(await editorPage.getByTestId('source-transfer').count(), 0, 'manual proposal discarded on switch');
  // A slow extraction that finishes after switching must not appear in the other method's review.
  await editorPage.route('**/api/document-import/extract', async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue(); });
  await editorPage.getByRole('button', { name: /Extract (document|again)/ }).click();
  await editorPage.getByTestId('source-method-manual').click();
  await editorPage.waitForTimeout(3500);
  assert.equal(await editorPage.getByTestId('source-transfer').count(), 0, 'late PDF response ignored after switching');
  assert.equal(await editorPage.getByTestId('source-import-panel').getByRole('alert').count(), 0);
  await editorPage.unroute('**/api/document-import/extract');
  await editorPage.getByRole('button', { name: /Back to options/ }).click();
  await editorPage.getByTestId('create-article-choice').waitFor();
  await editorPage.getByTestId('create-article-choice').getByRole('button', { name: 'Cancel' }).click();
  assert.equal(await prisma.article.count({ where: { title: { startsWith: 'Stale ' } } }), 0);
  pass('24–26 switching PDF/DOCX ↔ Manual Source discards the previous proposal, including a late in-flight response');

  // ── Flow C: Manual Source Text → review → transfer → editor → save → reload (Admin) ──
  await chooseSource(adminPage);
  await adminPage.getByTestId('source-method-manual').click();
  await adminPage.getByText(/Characters: 0 \/ 500,000/).waitFor();
  const manualSourceTitle = `${fx} Manual <script>alert(1)</script> source`;
  await adminPage.locator('#manual-source-text').fill(`TITLE: ${manualSourceTitle}\nSPORT: ${sport.name}\nEVENT: ${eventName}\n\nCONTENT:\nManual body <img src=x onerror=alert(2)> text.\n\nFAQ\n\nQ: Manual question one?\nA: Manual answer <b>one</b>.`);
  await adminPage.getByRole('button', { name: 'Process text' }).click();
  await adminPage.getByTestId('source-transfer').waitFor();
  await adminPage.getByTestId('source-import-panel').getByText('Manual Text', { exact: true }).waitFor();
  await adminPage.getByTestId('source-transfer').click();
  await adminPage.locator('#article-title').waitFor();
  assert.equal(await adminPage.locator('#article-title').inputValue(), manualSourceTitle, 'markup stays literal text');
  assert.equal(await adminPage.locator('#article-body img').count(), 0, 'pasted markup is inert');
  assert.match(await adminPage.locator('#article-body').innerText(), /onerror=alert\(2\)/);
  await byline(adminPage, P.admin);
  await adminPage.getByRole('button', { name: 'Save draft' }).click();
  const manualSource = await newArticle(manualSourceTitle);
  assert.equal(manualSource.eventSlug, `${fx}-cup`, 'exact taxonomy match mapped to the existing Event');
  await until('manual FAQ handoff', async () => (await prisma.faqEntry.count({ where: { articleId: manualSource.id } })) === 1);
  await adminPage.reload(); await adminPage.locator('[data-admin-shell] aside[aria-label="CMS navigation"]').waitFor({ timeout: 30_000 });
  await toArticles(adminPage);
  await adminPage.locator('tr', { hasText: `${fx} Manual` }).filter({ hasText: 'source' }).getByRole('button', { name: 'Edit' }).click();
  await until('manual-source article reopened', async () => (await adminPage.locator('#article-title').inputValue().catch(() => '')) === manualSourceTitle);
  // 8 continuity: the editor stays fully editable after a source transfer.
  await adminPage.locator('#article-excerpt').fill('Edited after source transfer.');
  await adminPage.locator('#seo-title').fill('Edited SEO title');
  await adminPage.getByRole('button', { name: 'Save draft' }).click();
  await until('post-transfer edits saved', async () => (await prisma.article.findUnique({ where: { id: manualSource.id } }))?.excerpt === 'Edited after source transfer.');
  assert.deepEqual(alerts, [], 'no script ran from source content');
  pass('16–23, 37 Flow C: Manual Source Text maps taxonomy, transfers inert content, saves, reloads and stays editable');
  await adminPage.getByRole('button', { name: /Back to articles/ }).click();

  // ── Flow D: import into an existing Article with existing FAQ; overwrite protection; FAQ system ops ──
  await adminPage.locator('tr', { hasText: `${fx} Existing Article` }).getByRole('button', { name: 'Edit' }).click();
  await adminPage.getByTestId('import-from-source').click();
  await adminPage.getByTestId('source-method-manual').click();
  await adminPage.locator('#manual-source-text').fill('TITLE: Replacement title must not win\n\nFAQ\n\nQ: Existing question about the fixture?\nA: Existing answer.\n\nQ: A brand new imported question?\nA: Brand new answer.');
  await adminPage.getByRole('button', { name: 'Process text' }).click();
  await adminPage.getByRole('button', { name: 'Transfer selected fields' }).click();
  await adminPage.getByRole('heading', { name: 'Review existing values' }).waitFor();
  await adminPage.getByText('Replace Title').waitFor();
  await adminPage.getByRole('button', { name: 'Continue transfer' }).click();
  assert.equal(await adminPage.locator('#article-title').inputValue(), `${fx} Existing Article`, 'kept existing title');
  await adminPage.getByText('2 reviewed source questions are pending').waitFor();
  await adminPage.getByRole('button', { name: 'Save draft' }).click();
  await until('existing-article FAQ handoff', async () => (await prisma.faqEntry.count({ where: { articleId: existingId } })) === 2);
  const faqs = await prisma.faqEntry.findMany({ where: { articleId: existingId }, orderBy: { displayOrder: 'asc' } });
  assert.equal(faqs[0].id, existingFaqId); assert.equal(faqs[0].status, 'published', 'existing FAQ untouched');
  assert.equal(faqs[1].question, 'A brand new imported question?'); assert.equal(faqs[1].status, 'draft');
  assert.equal((await prisma.article.findUnique({ where: { id: existingId } }))!.title, `${fx} Existing Article`);
  pass('28 Flow D: in-editor import keeps unconfirmed fields, preserves existing FAQ, skips exact duplicates and appends the new one');
  assert.equal((await admin.request(`/api/faq/${faqs[1].id}`, 'PUT', { question: 'An edited imported question?' })).status, 200);
  assert.equal((await admin.request('/api/faq/reorder', 'POST', { ids: [faqs[1].id, existingFaqId] })).status, 200);
  assert.equal((await prisma.faqEntry.findUnique({ where: { id: faqs[1].id } }))!.displayOrder, 0);
  assert.equal((await admin.request(`/api/faq/${faqs[1].id}`, 'DELETE')).status, 200);
  assert.deepEqual((await prisma.faqEntry.findMany({ where: { articleId: existingId } })).map((f) => f.id), [existingFaqId]);
  pass('29 imported FAQ is an ordinary FaqEntry: edit, reorder and remove through the existing FAQ API');
  await adminPage.getByRole('button', { name: /Back to articles/ }).click();

  // ── Flow E: roles in the UI; responsive widths ──
  const authorPage = await open(U.author);
  await toArticles(authorPage);
  await authorPage.getByTestId('create-article-button').click();
  await authorPage.getByRole('heading', { name: 'New Article Guided Workflow' }).waitFor();
  assert.equal(await authorPage.getByTestId('create-article-choice').count(), 0);
  assert.equal(await authorPage.getByTestId('import-from-source').count(), 0);
  assert.equal(await authorPage.getByTestId('source-import-panel').count(), 0);
  pass('34 Flow E: Author keeps the existing manual workflow with no source import; Admin and Editor used every source path above');

  for (const width of [1024, 768]) {
    await editorPage.setViewportSize({ width, height: 900 });
    await editorPage.getByTestId('create-article-button').click();
    await editorPage.getByTestId('create-article-choice').waitFor(); await noHorizontalScroll(editorPage, `choice @${width}`);
    await editorPage.getByTestId('create-article-source').click();
    await editorPage.getByTestId('source-method-manual').click();
    await editorPage.locator('#manual-source-text').fill('TITLE: Responsive check\n\nCONTENT:\nBody.\n\nFAQ\n\nQ: Responsive question?\nA: Yes.');
    await editorPage.getByRole('button', { name: 'Process text' }).click();
    await editorPage.getByTestId('source-transfer').waitFor(); await noHorizontalScroll(editorPage, `review @${width}`);
    assert(await editorPage.getByTestId('source-transfer').isVisible());
    await editorPage.getByTestId('source-transfer').click();
    await editorPage.locator('#article-title').waitFor(); await noHorizontalScroll(editorPage, `editor @${width}`);
    await editorPage.getByRole('button', { name: 'Discard', exact: true }).click();
    await editorPage.getByTestId('create-article-button').waitFor();
  }
  pass('Responsive: choice, source review and editor have no horizontal overflow at 1024 and 768 px');
  assert.deepEqual(pageErrors, [], `browser errors: ${pageErrors.join('; ')}`);
  pass('no uncaught browser errors across all flows');
} finally {
  await browser?.close().catch(() => undefined);
  child.kill();
  const userIds = Object.values(U);
  const created = await prisma.article.findMany({ where: { OR: [{ id: { startsWith: fx } }, { title: { startsWith: fx } }] }, select: { id: true } });
  const articleIds = created.map((a) => a.id);
  await prisma.faqEntry.deleteMany({ where: { articleId: { in: articleIds } } });
  await prisma.editorDraft.deleteMany({ where: { ownerId: { in: userIds } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { entityId: { in: articleIds } }] } });
  await prisma.redirectRule.deleteMany({ where: { sourceUrl: { contains: fx } } });
  await prisma.article.deleteMany({ where: { id: { in: articleIds } } });
  await prisma.sportEvent.deleteMany({ where: { id: { startsWith: fx } } });
  await prisma.author.deleteMany({ where: { id: { startsWith: fx } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
}
console.log(`Article creation browser acceptance: ${checks} checks passed.`);
