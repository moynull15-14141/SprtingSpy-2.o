/**
 * PHASE AUTOSAVE verification. Production build + LOCAL development database
 * only (refuses anything else). Real HTTP for the drafts API, security and
 * concurrency; real Chrome for the editors (navigation, refresh, failed
 * save/retry, page-hide flush, recovery and the status chip).
 * Fixture rows are removed afterwards.
 *
 *   npm run build && PLAYWRIGHT_EXECUTABLE_PATH=<chrome> npm run test:autosave
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { chromium, type Browser, type Page as PwPage } from 'playwright-core';
import { prisma } from '../db';
import { checkDatabaseUrlIsLocalDev } from '../dbSafety';
import { hashPassword } from '../password';
import { mediaUsageMap } from '../media/service';

assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe, 'Autosave verification requires a local development database.');
assert(fs.existsSync('.next/BUILD_ID'), 'Build before verification (npm run build).');
const chromePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
assert(fs.existsSync(chromePath), `Chrome not found at ${chromePath} (set PLAYWRIGHT_EXECUTABLE_PATH).`);

const fx = `as${crypto.randomUUID().slice(0, 6)}`;
const password = `Autosave-${crypto.randomUUID()}`;
const U = { admin: `${fx}-admin`, editor: `${fx}-editor`, author: `${fx}-author`, author2: `${fx}-author2`, spam: `${fx}-spam` };
const did = (n: string) => `draft-${fx}-${n}-${crypto.randomUUID().slice(0, 8)}`;
const digest = (v: unknown) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');

const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = (probe.address() as { port: number }).port; await new Promise<void>((r) => probe.close(() => r()));
const base = `http://127.0.0.1:${port}`;
let output = '';
const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
  cwd: process.cwd(), windowsHide: true,
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', TRUST_PROXY: 'false', NODE_ENV: 'production', APP_ENV: 'production', AUTH_MODE: 'production', DEV_LOGIN_BYPASS: 'false', ALLOWED_ORIGIN: base, SITE_ORIGIN: base, INDEXNOW_ENDPOINT: '', GEMINI_API_KEY: '', MEDIA_STORAGE_PROVIDER: 'local', PUBLIC_CACHE_DEBUG: 'true' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (c) => { output += c; }); child.stderr.on('data', (c) => { output += c; });

let checks = 0; const pass = (m: string) => { checks++; console.log(`PASS ${m}`); };
class Client {
  cookies = new Map<string, string>();
  async request(path: string, method = 'GET', body?: unknown, opts: { csrf?: boolean; headers?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '), ...opts.headers };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET' && opts.csrf !== false) headers['x-csrf-token'] = this.cookies.get('csrf_token') ?? '';
    const res = await fetch(base + path, { method, headers, redirect: 'manual', body: body === undefined ? undefined : JSON.stringify(body) });
    for (const raw of res.headers.getSetCookie()) { const [pair] = raw.split(';'); const i = pair.indexOf('='); const v = pair.slice(i + 1); if (v) this.cookies.set(pair.slice(0, i), v); else this.cookies.delete(pair.slice(0, i)); }
    const text = await res.text(); let data: any; try { data = JSON.parse(text); } catch { /* HTML */ }
    return { status: res.status, text, data };
  }
  async ok(path: string, method = 'GET', body?: unknown, opts?: { headers?: Record<string, string> }) {
    const r = await this.request(path, method, body, opts);
    assert(r.status >= 200 && r.status < 300, `${method} ${path}: HTTP ${r.status} ${r.text.slice(0, 300)}`);
    return r.data;
  }
  async expect(path: string, method: string, body: unknown, status: number, opts?: { headers?: Record<string, string> }) {
    const r = await this.request(path, method, body, opts);
    assert.equal(r.status, status, `${method} ${path}: expected ${status}, got ${r.status} ${r.text.slice(0, 300)}`);
    return r.data;
  }
}
const put = (c: Client, id: string, kind: string, entityId: string | null, revision: number, payload: Record<string, unknown>, title = 'Draft') =>
  c.request(`/api/drafts/${id}`, 'PUT', { kind, entityId, revision, title, payload });
const doc = (...ps: string[]) => ({ type: 'doc', content: ps.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })) });

let browser: Browser | null = null;
let failed = false;
const ids = { articleDraft: `${fx}-art-draft`, articlePub: `${fx}-art-pub`, event: `${fx}-event`, edition: `${fx}-edition`, pagePub: `${fx}-page-pub`, pageDraft: `${fx}-page-draft`, authorArt: `${fx}-art-author`, media: `${fx}-media` };
try {
  // ── Fixtures ──
  for (const [role, id] of [['Admin', U.admin], ['Editor', U.editor], ['Author', U.author], ['Author', U.author2], ['Editor', U.spam]] as const) {
    await prisma.user.create({ data: { id, name: `${fx} ${id.split('-').pop()}`, email: `${id}@example.test`, role, avatar: '', joinedAt: new Date(), passwordHash: hashPassword(password) } });
  }
  const authorProfile = await prisma.author.create({ data: { id: `${fx}-auth1`, slug: `${fx}-auth1`, name: `${fx} Author`, roleTitle: 'Writer', bio: '', avatar: '', userId: U.author } });
  const editorProfile = await prisma.author.create({ data: { id: `${fx}-auth2`, slug: `${fx}-auth2`, name: `${fx} Staff`, roleTitle: 'Editor', bio: '', avatar: '', userId: U.editor } });
  const sport = (await prisma.sport.findFirst({ where: { isVisible: true }, select: { slug: true } }))!;
  const type = (await prisma.articleType.findFirst({ where: { isActive: true }, select: { name: true } }))!;
  const art = (id: string, status: 'draft' | 'published', authorId: string, title: string) => prisma.article.create({ data: {
    id, slug: id, title, sportSlug: sport.slug, articleType: type.name, excerpt: 'Excerpt', content: 'Original body text.', body: doc('Original body text.') as object,
    featuredImage: 'https://images.unsplash.com/photo-1?w=1200', authorId, publishedAt: new Date(), readingTimeMinutes: 1, seo: {}, status, reviewStatus: 'not_required',
  } });
  await art(ids.articleDraft, 'draft', editorProfile.id, `${fx} Draft Article`);
  await art(ids.articlePub, 'published', editorProfile.id, `${fx} Published Article`);
  await art(ids.authorArt, 'draft', authorProfile.id, `${fx} Author Article`);
  await art(`${fx}-art-clean`, 'published', editorProfile.id, `${fx} Clean Article`);
  await prisma.sportEvent.create({ data: { id: ids.event, sportSlug: sport.slug, slug: `${fx}-event`, name: `${fx} Event`, shortName: `${fx} Event`, description: 'Original event description.', seo: {}, isVisible: true } });
  await prisma.eventEdition.create({ data: { id: ids.edition, sportSlug: sport.slug, eventSlug: `${fx}-event`, year: 2031, title: `${fx} Edition 2031`, description: 'Original edition description.', seo: {} } });
  await prisma.page.create({ data: { id: ids.pagePub, slug: `${fx}-pub`, title: `${fx} Published Page`, summary: 'Original summary', body: doc('Original page text.') as object, content: 'Original page text.', status: 'published', publishedAt: new Date(), createdBy: 'test', updatedBy: 'test' } });
  await prisma.page.create({ data: { id: ids.pageDraft, slug: `${fx}-draft`, title: `${fx} Draft Page`, body: doc('Draft page text.') as object, content: 'Draft page text.', status: 'draft', createdBy: 'test', updatedBy: 'test' } });
  await prisma.mediaItem.create({ data: { id: ids.media, title: `${fx} image`, url: `https://images.unsplash.com/photo-${fx}?w=1200`, altText: 'Fixture', uploadedAt: new Date(), copyrightReview: 'reviewed' } });

  for (let i = 0; i < 120 && !/Server running/.test(output); i++) await new Promise((r) => setTimeout(r, 500));
  assert.match(output, /Server running/, `server did not start:\n${output.slice(-2000)}`);
  const login = async (id: string) => { const c = new Client(); await c.request('/robots.txt'); assert.equal((await c.request('/api/auth/login', 'POST', { email: `${id}@example.test`, password })).status, 200); return c; };
  const [admin, editor, author, author2, spam] = [await login(U.admin), await login(U.editor), await login(U.author), await login(U.author2), await login(U.spam)];
  const anon = new Client(); await anon.request('/robots.txt');
  const snapshot = async () => digest({
    a: await prisma.article.findMany({ where: { id: { startsWith: fx } }, orderBy: { id: 'asc' } }),
    e: await prisma.sportEvent.findMany({ where: { id: { startsWith: fx } } }), ed: await prisma.eventEdition.findMany({ where: { id: { startsWith: fx } } }),
    p: await prisma.page.findMany({ where: { id: { startsWith: fx } }, orderBy: { id: 'asc' } }),
  });
  const before = await snapshot();
  const cacheMark = output.length;

  // ── 1–4 New content: draft only, no item row, no slug claimed ──
  const newIds: Record<string, string> = {};
  for (const [kind, client] of [['article', author], ['event', editor], ['edition', editor], ['page', editor]] as const) {
    newIds[kind] = did(`new-${kind}`);
    const r = await put(client, newIds[kind], kind, null, 0, { title: `UEFA Champions League Preview ${fx}`, slug: `ucl-preview-${fx}` }, `UEFA Champions League Preview ${fx}`);
    assert.equal(r.status, 201, `${kind} new: ${r.text}`); assert.equal(r.data.draft.revision, 1); assert.equal(r.data.draft.entityId, null);
  }
  assert.equal(await prisma.article.count({ where: { slug: `ucl-preview-${fx}` } }), 0);
  assert.equal(await prisma.page.count({ where: { slug: `ucl-preview-${fx}` } }), 0);
  assert.equal((await anon.request(`/ucl-preview-${fx}/`)).status, 404);
  pass('1-4 new Article/Event/Edition/Page autosave creates a private draft only (no item row, no slug, nothing public)');

  // ── 5–8 Existing items: one shared working copy each, revision-checked ──
  const work: Record<string, string> = {};
  for (const [kind, entityId] of [['article', ids.articleDraft], ['event', ids.event], ['edition', ids.edition], ['page', ids.pageDraft]] as const) {
    work[kind] = did(`work-${kind}`);
    const r1 = await put(editor, work[kind], kind, entityId, 0, { description: 'Edited once', body: doc('Edited once') });
    assert.equal(r1.status, 201, `${kind}: ${r1.text}`);
    const r2 = await put(editor, work[kind], kind, entityId, 1, { description: 'Edited twice', body: doc('Edited twice') });
    assert.equal(r2.status, 200); assert.equal(r2.data.draft.revision, 2);
    const dup = await put(admin, did(`dup-${kind}`), kind, entityId, 0, { description: 'Someone else' });
    assert.equal(dup.status, 409); assert.equal(dup.data.code, 'stale_draft'); assert.equal(dup.data.draft.id, work[kind]);
    const shared = await admin.ok(`/api/drafts/for/${kind}/${entityId}`);
    assert.equal(shared.draft.id, work[kind]); assert.equal(shared.draft.payload.description, 'Edited twice'); assert.ok(shared.currentVersion);
  }
  assert.equal(await prisma.editorDraft.count({ where: { entityId: { in: [ids.articleDraft, ids.event, ids.edition, ids.pageDraft] } } }), 4);
  pass('5-8 existing Article/Event/Edition/Page drafts: one shared working copy each, visible to other editors, revisions advance');

  // ── 9–12 Published content is untouched by autosave ──
  const pubBefore = (await anon.request(`/${sport.slug}/${ids.articlePub}/`)).text;
  const pagePubBefore = (await anon.request(`/${fx}-pub/`)).text;
  const pubArticleRow = await prisma.article.findUnique({ where: { id: ids.articlePub } });
  const wPubArt = did('pub-art'); const wPubPage = did('pub-page');
  assert.equal((await put(editor, wPubArt, 'article', ids.articlePub, 0, { title: 'LIVE CHANGE?', body: doc('Autosaved, not published') })).status, 201);
  assert.equal((await put(editor, wPubPage, 'page', ids.pagePub, 0, { summary: 'Autosaved summary', body: doc('Autosaved page') })).status, 201);
  assert.equal(await snapshot(), before, 'no Article/Event/Edition/Page row changed');
  const pubArticleAfter = await prisma.article.findUnique({ where: { id: ids.articlePub } });
  assert.equal(pubArticleAfter!.reviewVersion, pubArticleRow!.reviewVersion); assert.equal(pubArticleAfter!.status, 'published');
  assert.ok(pubBefore.includes('Original body text.')); assert.equal((await anon.request(`/${sport.slug}/${ids.articlePub}/`)).text.includes('Autosaved, not published'), false);
  assert.ok(pagePubBefore.includes('Original summary')); const pageNow = (await anon.request(`/${fx}-pub/`)).text;
  assert.ok(pageNow.includes('Original summary') && !pageNow.includes('Autosaved summary'));
  pass('9-12 published Article/Page and Event/Edition rows, reviewVersion and public pages are unchanged by autosave');
  assert.ok(!output.slice(cacheMark).includes('/api/drafts'), 'autosave must not clear the public cache');
  pass('32 autosave does not clear the public cache');

  // ── 18 Duplicate request / 19 draft revision conflict ──
  const retry = await put(editor, work.page, 'page', ids.pageDraft, 1, { description: 'Edited twice', body: doc('Edited twice') });
  assert.equal(retry.status, 200); assert.equal(retry.data.unchanged, true);
  assert.equal(await prisma.editorDraft.count({ where: { id: work.page } }), 1);
  const replayCreate = await put(editor, newIds.page, 'page', null, 0, { title: `UEFA Champions League Preview ${fx}`, slug: `ucl-preview-${fx}` }, `UEFA Champions League Preview ${fx}`);
  assert.equal(replayCreate.status, 200); assert.equal(replayCreate.data.unchanged, true);
  pass('18 duplicate autosave requests are idempotent (no duplicate drafts, no conflict)');
  const stale = await put(admin, work.page, 'page', ids.pageDraft, 1, { description: 'Overwrite attempt' });
  assert.equal(stale.status, 409); assert.equal(stale.data.code, 'stale_draft'); assert.equal(stale.data.draft.payload.description, 'Edited twice');
  pass('19 a stale draft revision is refused (409 with the newer draft); nothing is overwritten');

  // ── 20 Live item changed since editing began (X-Expected-Version) ──
  const pageV = (await editor.ok(`/api/drafts/for/page/${ids.pageDraft}`)).currentVersion;
  await prisma.page.update({ where: { id: ids.pageDraft }, data: { summary: 'Changed by someone else' } });
  const stalePage = await editor.request(`/api/pages/${ids.pageDraft}`, 'PUT', { summary: 'Mine' }, { headers: { 'X-Expected-Version': pageV } });
  assert.equal(stalePage.status, 409); assert.equal(stalePage.data.code, 'stale_version'); assert.match(stalePage.data.error, /changed by another editor/);
  assert.equal((await prisma.page.findUnique({ where: { id: ids.pageDraft } }))!.summary, 'Changed by someone else');
  const artV = (await editor.ok(`/api/drafts/for/article/${ids.articleDraft}`)).currentVersion;
  await editor.ok(`/api/articles/${ids.articleDraft}`, 'PUT', { excerpt: 'Changed meanwhile' });
  assert.equal((await editor.request(`/api/articles/${ids.articleDraft}`, 'PUT', { excerpt: 'Mine' }, { headers: { 'X-Expected-Version': artV } })).status, 409);
  for (const [path, kind, id, field] of [['events', 'event', ids.event, 'description'], ['editions', 'edition', ids.edition, 'description']] as const) {
    const v = (await editor.ok(`/api/drafts/for/${kind}/${id}`)).currentVersion;
    await editor.ok(`/api/${path}/${id}`, 'PUT', { [field]: `Changed meanwhile ${kind}` });
    assert.equal((await editor.request(`/api/${path}/${id}`, 'PUT', { [field]: 'Mine' }, { headers: { 'X-Expected-Version': v } })).status, 409, kind);
    const now = (await editor.ok(`/api/drafts/for/${kind}/${id}`)).currentVersion;
    await editor.ok(`/api/${path}/${id}`, 'PUT', { [field]: `Current ${kind}` }, { headers: { 'X-Expected-Version': now } });
  }
  await editor.ok(`/api/pages/${ids.pageDraft}`, 'PUT', { summary: 'No header still works' });
  pass('20 saves carrying a stale X-Expected-Version get 409 (page, article, event, edition); current version and no header still save');

  // ── 31 Review workflow unaffected ──
  const authorWork = did('author');
  const a0 = await prisma.article.findUnique({ where: { id: ids.authorArt } });
  assert.equal((await put(author, authorWork, 'article', ids.authorArt, 0, { title: 'Author autosave', body: doc('Author text') })).status, 201);
  assert.equal((await put(author, authorWork, 'article', ids.authorArt, 1, { title: 'Author autosave 2', body: doc('Author text 2') })).status, 200);
  const a1 = await prisma.article.findUnique({ where: { id: ids.authorArt } });
  assert.equal(a1!.reviewVersion, a0!.reviewVersion); assert.equal(a1!.reviewStatus, a0!.reviewStatus); assert.equal(a1!.status, 'draft');
  const reviewer = await author.ok('/api/articles/reviewers');
  await author.ok(`/api/articles/${ids.authorArt}/submit-review`, 'POST', { reviewerId: reviewer.find((r: any) => r.id === U.editor)?.id ?? reviewer[0].id, version: a1!.reviewVersion });
  assert.equal((await prisma.article.findUnique({ where: { id: ids.authorArt } }))!.reviewStatus, 'in_review');
  pass('31 autosave never bumps reviewVersion or changes review/publish state; submit-for-review still works with the same version');

  // ── 23–25 Permissions ──
  assert.equal((await put(author, did('a-locked'), 'article', ids.authorArt, 0, { title: 'x' })).status, 403, 'in review: the Author cannot autosave a read-only article');
  assert.equal((await author.request(`/api/drafts/for/article/${ids.authorArt}`)).status, 403, 'in review: read-only for the Author');
  assert.equal((await author2.request(`/api/drafts/for/article/${ids.authorArt}`)).status, 404, 'another Author cannot see it');
  assert.equal((await put(author2, did('a2'), 'article', ids.authorArt, 0, { title: 'x' })).status, 404);
  assert.equal((await put(author, did('a-event'), 'event', null, 0, { name: 'x' })).status, 403, 'Authors have no event editor');
  assert.equal((await author.request(`/api/drafts/for/page/${ids.pageDraft}`)).status, 403);
  assert.equal((await editor.request(`/api/drafts/${newIds.article}`)).status, 404, "an Author's new draft is private");
  assert.ok(!(await editor.ok('/api/drafts')).drafts.some((d: any) => d.id === newIds.article));
  assert.ok((await author.ok('/api/drafts')).drafts.some((d: any) => d.id === newIds.article));
  assert.ok(!(await author.ok('/api/drafts')).drafts.some((d: any) => d.kind !== 'article'), 'Authors list only article drafts');
  const adminList = (await admin.ok('/api/drafts')).drafts;
  assert.ok(adminList.some((d: any) => d.id === work.event) && adminList.some((d: any) => d.id === wPubArt) && !adminList.some((d: any) => d.id === newIds.page), 'Admin sees shared copies, not others\' new drafts');
  assert.equal((await put(editor, newIds.page, 'event', null, 1, { x: 1 })).status, 400, 'a draft cannot change kind');
  assert.equal((await put(admin, newIds.page, 'page', null, 1, { x: 1 })).status, 404, "nobody else can write a user's new draft");
  pass('23-25 Author (own, editable articles only; private new drafts), Editor and Admin access rules hold; ids/kind/owner never trusted');

  // ── 26 CSRF, anonymous, validation ──
  assert.equal((await editor.request(`/api/drafts/${did('csrf')}`, 'PUT', { kind: 'page', entityId: null, revision: 0, title: 'x', payload: {} }, { csrf: false })).status, 403);
  assert.equal((await anon.request('/api/drafts')).status, 401);
  assert.equal((await put(editor, did('bad'), 'page', null, 0, { body: { type: 'doc', content: [{ type: 'script' }] } })).status, 400, 'body allow-list enforced');
  assert.equal((await editor.request(`/api/drafts/${did('big')}`, 'PUT', { kind: 'page', entityId: null, revision: 0, title: 'x', payload: { blob: 'x'.repeat(800_000) } })).status, 413);
  assert.equal((await editor.request(`/api/drafts/${did('extra')}`, 'PUT', { kind: 'page', entityId: null, revision: 0, title: 'x', payload: {}, ownerId: U.admin })).status, 400);
  pass('26 CSRF required, anonymous refused, body allow-list, size cap and unknown fields enforced');

  // ── 27 Rate limiting ──
  let limited = 0; const spamId = did('spam');
  for (let i = 0; i < 125; i++) { const r = await put(spam, spamId, 'page', null, i === 0 ? 0 : i, { n: i }); if (r.status === 429) { limited++; break; } }
  assert.equal(limited, 1, 'autosave writes are rate limited per user');
  pass('27 runaway autosave is rate limited (429 with Retry-After)');

  // ── 28 Media referenced by a draft cannot be deleted ──
  const mediaWork = did('media');
  assert.equal((await put(editor, mediaWork, 'page', null, 0, { ogMediaId: ids.media }, 'Media draft')).status, 201);
  assert.deepEqual((await mediaUsageMap())[ids.media].map((u) => u.kind), ['draft']);
  assert.equal((await admin.request(`/api/media/${ids.media}`, 'DELETE')).status, 409);
  await editor.ok(`/api/drafts/${mediaWork}?revision=1`, 'DELETE');
  assert.equal((await mediaUsageMap())[ids.media].length, 0);
  pass('28 media referenced only by a draft is protected; after discard it is free again');

  // ── 21–22 Discard and recovery (audited); 29–30 applying removes the copy without a discard audit ──
  assert.equal((await editor.request(`/api/drafts/${work.event}?revision=1`, 'DELETE')).status, 409, 'stale discard keeps the copy');
  await editor.ok(`/api/drafts/${work.event}/recovered`, 'POST', {});
  await editor.ok(`/api/drafts/${work.event}?revision=2`, 'DELETE');
  assert.equal(await prisma.editorDraft.count({ where: { id: work.event } }), 0);
  await editor.ok(`/api/drafts/${work.edition}?revision=2&applied=1`, 'DELETE');
  const audits = await prisma.auditLog.findMany({ where: { userId: { in: Object.values(U) }, action: { startsWith: 'Draft' } }, select: { action: true, entityId: true } });
  assert.ok(audits.some((a) => a.action === 'Draft Recovered' && a.entityId === ids.event));
  assert.ok(audits.some((a) => a.action === 'Draft Discarded' && a.entityId === ids.event));
  assert.ok(!audits.some((a) => a.action === 'Draft Discarded' && a.entityId === ids.edition), 'applying is not a discard');
  const createdAudits = audits.filter((a) => a.action === 'Draft Created').length;
  assert.ok(createdAudits >= 8 && audits.length < 40, `audit stays quiet (${audits.length} draft entries for many autosaves)`);
  assert.equal(await prisma.auditLog.count({ where: { userId: U.editor, action: { in: ['Updated Page', 'Updated Event', 'Updated Event Edition', 'Updated Article'] }, timestamp: { gte: new Date(Date.now() - 600_000) }, entityId: ids.pageDraft } }), 1, 'only the one successful manual page save is a content audit');
  pass('21-22, 29-30 discard (revision-checked) and recovery are audited; removing an applied copy is not; autosaves add no content audit entries');

  // ── Browser: editors, status chip, navigation/refresh recovery, failure/retry, hide flush ──
  browser = await chromium.launch({ executablePath: chromePath });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page: PwPage = await ctx.newPage();
  page.on('dialog', (d) => void d.accept());
  await page.goto(`${base}/admin/`);
  await page.getByRole('textbox', { name: 'Email' }).fill(`${U.editor}@example.test`);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  const nav = (name: string) => page.locator('[data-admin-shell] nav').getByRole('button', { name, exact: true }).first().click();
  await page.locator('[data-admin-shell] nav').waitFor({ timeout: 30_000 });

  // New article: typing a title autosaves a private draft (13: navigation recovery via Unsaved Work).
  await nav('Articles');
  await page.getByTestId('create-article-button').click();
  await page.getByTestId('create-article-manual').click();
  const browserTitle = `Browser autosave ${fx}`;
  await page.locator('#article-title').fill(browserTitle);
  await page.locator('[data-autosave="saved"]').waitFor({ timeout: 15_000 });
  const b1 = await prisma.editorDraft.findFirst({ where: { kind: 'article', entityId: null, ownerId: U.editor, title: browserTitle } });
  assert.ok(b1, 'new article draft saved by the editor');
  assert.equal(await prisma.article.count({ where: { title: browserTitle } }), 0);
  pass('browser: new article title autosaves (status chip "Saved"), no article row created');
  await page.locator('#article-title').fill(`${browserTitle} more`);
  await nav('Dashboard'); // leave without saving: the unmount flushes
  const panel = page.getByTestId('unsaved-work');
  await panel.getByText(`${browserTitle} more`).waitFor({ timeout: 15_000 });
  await panel.locator('li', { hasText: `${browserTitle} more` }).getByRole('button', { name: 'Continue editing' }).click();
  await page.locator('#article-title').waitFor();
  assert.equal(await page.locator('#article-title').inputValue(), `${browserTitle} more`);
  pass('13 browser: leaving the editor keeps the latest edit; Dashboard → Unsaved Work → Continue editing restores it');
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  for (let i = 0; i < 20 && await prisma.editorDraft.count({ where: { title: { startsWith: browserTitle } } }); i++) await page.waitForTimeout(250);
  assert.equal(await prisma.editorDraft.count({ where: { title: { startsWith: browserTitle } } }), 0);
  pass('21 browser: Discard (confirmed) removes the working copy');

  // 14 Refresh recovery + 30 publish/save applies and removes the copy (published page).
  await nav('Pages');
  await page.getByRole('button', { name: `${fx} Published Page` }).click();
  await page.getByTestId('page-editor').waitFor();
  const subtitle = page.getByRole('textbox', { name: /Subtitle/ });
  // The API checks above left a working copy on this page: the editor offers it and does not autosave over it.
  await page.getByTestId('draft-recovery').waitFor({ timeout: 15_000 });
  await subtitle.fill('Typed before choosing');
  await page.waitForTimeout(2600);
  assert.equal(((await prisma.editorDraft.findFirst({ where: { kind: 'page', entityId: ids.pagePub } }))!.payload as any).summary, 'Autosaved summary', 'an undecided recovery is never overwritten');
  pass('O browser: while "Unsaved work found" is undecided, autosave does not overwrite the existing working copy');
  await page.getByRole('button', { name: 'Discard Draft' }).click();
  for (let i = 0; i < 20 && await prisma.editorDraft.count({ where: { kind: 'page', entityId: ids.pagePub } }); i++) await page.waitForTimeout(250);
  assert.equal(await prisma.editorDraft.count({ where: { kind: 'page', entityId: ids.pagePub } }), 0);
  await subtitle.fill('Autosaved subtitle via browser');
  await page.locator('[data-autosave="saved"]').waitFor({ timeout: 15_000 });
  assert.ok((await anon.request(`/${fx}-pub/`)).text.includes('Original summary'), 'live page unchanged while editing');
  await page.reload();
  await page.locator('[data-admin-shell] nav').waitFor({ timeout: 30_000 });
  await nav('Pages');
  await page.locator('tr', { hasText: `${fx} Published Page` }).getByTestId('unsaved-badge').waitFor({ timeout: 15_000 });
  await page.getByRole('button', { name: `${fx} Published Page` }).click();
  await page.getByTestId('draft-recovery').waitFor({ timeout: 15_000 });
  assert.equal(await subtitle.inputValue(), 'Original summary', 'the saved version is shown until the user chooses');
  await page.getByRole('button', { name: 'Continue Draft' }).click();
  for (let i = 0; i < 20 && (await subtitle.inputValue()) !== 'Autosaved subtitle via browser'; i++) await page.waitForTimeout(100);
  assert.equal(await subtitle.inputValue(), 'Autosaved subtitle via browser');
  pass('14 browser: after a refresh the list shows "Unsaved changes" and the editor offers recovery; Continue Draft restores it');
  await page.getByRole('button', { name: 'Save changes' }).click();
  for (let i = 0; i < 40 && !(await anon.request(`/${fx}-pub/`)).text.includes('Autosaved subtitle via browser'); i++) await page.waitForTimeout(250);
  assert.ok((await anon.request(`/${fx}-pub/`)).text.includes('Autosaved subtitle via browser'), 'manual save publishes the change');
  for (let i = 0; i < 20 && await prisma.editorDraft.count({ where: { kind: 'page', entityId: ids.pagePub } }); i++) await page.waitForTimeout(250);
  assert.equal(await prisma.editorDraft.count({ where: { kind: 'page', entityId: ids.pagePub } }), 0);
  pass('29-30 browser: manual Save of the published page updates it and removes the working copy');

  // 16–17 Network failure keeps the state locally and retries.
  await page.getByRole('button', { name: /All pages/ }).click();
  await page.getByRole('button', { name: `${fx} Draft Page` }).click();
  await page.getByTestId('page-editor').waitFor();
  await page.waitForTimeout(800); // recovery lookup
  if (await page.getByTestId('draft-recovery').count()) await page.getByRole('button', { name: 'Continue Draft' }).click();
  await page.route('**/api/drafts/**', (route) => (route.request().method() === 'PUT' ? route.abort('internetdisconnected') : route.continue()));
  await subtitle.fill('Typed while offline');
  await page.locator('[data-autosave="retrying"]').waitFor({ timeout: 15_000 });
  const buffered = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('sportingspy_draftbuf:')).map((k) => localStorage.getItem(k)!).join('\n'));
  assert.ok(buffered.includes('Typed while offline'), 'unsynced state kept in the local buffer');
  assert.equal(await subtitle.inputValue(), 'Typed while offline', 'editor content intact');
  pass('16 browser: a failed autosave shows "Save failed — retrying…", keeps the editor content and a local copy');
  await page.unroute('**/api/drafts/**');
  await page.locator('[data-autosave="saved"]').waitFor({ timeout: 30_000 });
  const wd = await prisma.editorDraft.findFirst({ where: { kind: 'page', entityId: ids.pageDraft } });
  assert.equal((wd!.payload as any).summary, 'Typed while offline');
  const left = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('sportingspy_draftbuf:')).length);
  assert.equal(left, 0, 'local buffer cleared after the server confirmed');
  pass('17 browser: when the connection returns the retry saves it once, and the local buffer is cleared');

  // 15 Tab hidden/closed: saves immediately (before the 2 s debounce).
  await subtitle.fill('Saved on hide');
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(900);
  const hidden = await prisma.editorDraft.findFirst({ where: { kind: 'page', entityId: ids.pageDraft } });
  assert.equal((hidden!.payload as any).summary, 'Saved on hide');
  pass('15 browser: hiding/closing the tab sends pending changes immediately (keepalive), before the debounce');

  // A trip to the public site and browser Back must leave the server copy recoverable.
  await page.goto(`${base}/`);
  await page.goBack();
  await page.locator('[data-admin-shell] nav').waitFor({ timeout: 30_000 });
  await nav('Pages');
  await page.locator('tr', { hasText: `${fx} Draft Page` }).getByTestId('unsaved-badge').waitFor({ timeout: 15_000 });
  await page.getByRole('button', { name: `${fx} Draft Page` }).click();
  await page.getByTestId('draft-recovery').waitFor({ timeout: 15_000 });
  pass('browser: public-site navigation and browser Back keep the working copy available for recovery');

  // Opening an item without typing must not create a working copy (the editor settling is not an edit);
  // typing then autosaves. Event, Edition and Article editors in the real UI.
  const quiet = async (kind: string, entityId: string) => {
    await page.waitForTimeout(3500);
    assert.equal(await prisma.editorDraft.count({ where: { kind, entityId } }), 0, `${kind}: opening alone created a working copy`);
    assert.equal(await page.evaluate((k) => Object.keys(localStorage).filter((x) => x.startsWith('sportingspy_draftbuf:') && x.endsWith(`:${k}`)).length, `${kind}:${entityId}`), 0);
  };
  const savedAs = async (kind: string, entityId: string, field: string, value: string) => {
    for (let i = 0; i < 60; i++) { const d = await prisma.editorDraft.findFirst({ where: { kind, entityId } }); if ((d?.payload as any)?.[field] === value) return; await page.waitForTimeout(250); }
    assert.fail(`${kind}: typed value was not autosaved`);
  };
  await nav('Events & Editions');
  await page.locator('tr', { hasText: `${fx} Event` }).getByRole('button', { name: 'Edit' }).click();
  await page.locator('#event-editor-field-9').waitFor();
  await quiet('event', ids.event);
  await page.locator('#event-editor-field-9').fill('Event typed in the browser');
  await savedAs('event', ids.event, 'description', 'Event typed in the browser');
  assert.equal((await prisma.sportEvent.findUnique({ where: { id: ids.event } }))!.description, 'Current event', 'live event unchanged');
  await page.getByRole('button', { name: 'Cancel', exact: true }).first().click();
  await page.getByRole('button', { name: /Staged Editions/ }).click();
  await page.locator('tr', { hasText: `${fx} Edition 2031` }).getByRole('button', { name: 'Edit' }).click();
  await page.locator('#edition-description').waitFor();
  await quiet('edition', ids.edition);
  await page.locator('#edition-description').fill('Edition typed in the browser');
  await savedAs('edition', ids.edition, 'description', 'Edition typed in the browser');
  assert.equal((await prisma.eventEdition.findUnique({ where: { id: ids.edition } }))!.description, 'Current edition', 'live edition unchanged');
  pass('browser: Event and Edition editors — opening creates nothing, typing autosaves a working copy, the live rows stay unchanged');
  await nav('Articles');
  await page.getByPlaceholder(/Search/).first().fill(`${fx} Clean Article`).catch(() => undefined);
  await page.locator('tr', { hasText: `${fx} Clean Article` }).getByRole('button', { name: /Edit/ }).first().click();
  await page.locator('#article-title').waitFor();
  await quiet('article', `${fx}-art-clean`);
  await page.locator('#article-title').fill(`${fx} Clean Article edited`);
  await savedAs('article', `${fx}-art-clean`, 'title', `${fx} Clean Article edited`);
  const clean = await prisma.article.findUnique({ where: { id: `${fx}-art-clean` } });
  assert.equal(clean!.title, `${fx} Clean Article`); assert.equal(clean!.status, 'published');
  pass('browser: Article editor — opening a published article creates nothing; typing autosaves without touching the live article');
  await ctx.close();
} catch (err) {
  failed = true;
  console.error(err);
  console.error(output.slice(-3000));
} finally {
  await browser?.close().catch(() => undefined);
  child.kill();
  await prisma.editorDraft.deleteMany({ where: { OR: [{ ownerId: { in: Object.values(U) } }, { entityId: { startsWith: fx } }] } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: Object.values(U) } } });
  await prisma.redirectRule.deleteMany({ where: { sourceUrl: { contains: fx } } });
  await prisma.article.deleteMany({ where: { id: { startsWith: fx } } });
  await prisma.eventEdition.deleteMany({ where: { id: { startsWith: fx } } });
  await prisma.sportEvent.deleteMany({ where: { id: { startsWith: fx } } });
  await prisma.page.deleteMany({ where: { id: { startsWith: fx } } });
  await prisma.mediaItem.deleteMany({ where: { id: { startsWith: fx } } });
  await prisma.author.deleteMany({ where: { id: { startsWith: fx } } });
  await prisma.session.deleteMany({ where: { userId: { in: Object.values(U) } } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(U) } } });
  await prisma.$disconnect();
}
if (failed) process.exit(1);
console.log(`Autosave: ${checks} checks passed.`);
