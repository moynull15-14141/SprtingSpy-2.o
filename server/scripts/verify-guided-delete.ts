/**
 * Guided Event/Edition deletion (the CMS Delete dialog).
 *
 *   npm run local -- test:guided-delete
 *
 * Local database only. Creates disposable fixtures, starts a production-mode
 * server, checks the plan/delete API and the real dialog in Chrome, then
 * removes every fixture and proves that pre-existing rows are unchanged.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { chromium, type Browser } from 'playwright-core';
import { prisma } from '../db';
import { checkDatabaseUrlIsLocalDev } from '../dbSafety';
import { hashPassword } from '../password';

assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe, 'Verification requires a local, non-production database.');
assert(fs.existsSync('.next/BUILD_ID'), 'Run npm run build first.');

const fx = `gd${crypto.randomBytes(4).toString('hex')}`;
const password = `Test-${crypto.randomUUID()}`;
const adminId = `${fx}-admin`; const editorId = `${fx}-editor`;
const S = `${fx}-sport`; const S2 = `${fx}-gone`;
const digest = (v: unknown) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const snapshot = async () => digest({
  sports: await prisma.sport.findMany({ orderBy: { id: 'asc' } }), events: await prisma.sportEvent.findMany({ orderBy: { id: 'asc' } }),
  editions: await prisma.eventEdition.findMany({ orderBy: { id: 'asc' } }), articles: await prisma.article.findMany({ orderBy: { id: 'asc' } }),
  faqs: await prisma.faqEntry.findMany({ orderBy: { id: 'asc' } }), disciplines: await prisma.discipline.findMany({ orderBy: { id: 'asc' } }),
});
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
class Client {
  cookies = new Map<string, string>();
  async req(route: string, method = 'GET', body?: unknown) {
    const headers: Record<string, string> = { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '), 'Content-Type': 'application/json' };
    if (method !== 'GET') headers['x-csrf-token'] = this.cookies.get('csrf_token') || '';
    const res = await fetch(base + route, { method, redirect: 'manual', headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie()) { const [pair] = c.split(';'); const i = pair.indexOf('='); this.cookies.set(pair.slice(0, i), pair.slice(i + 1)); }
    const text = await res.text(); let data: any; try { data = JSON.parse(text); } catch { data = null; }
    return { status: res.status, data, text };
  }
  async login(id: string) { await this.req('/api/auth/me'); assert.equal((await this.req('/api/auth/login', 'POST', { email: `${id}@example.test`, password })).status, 200); }
}
const expectStatus = async (c: Client, route: string, status: number, method = 'GET', body?: unknown) => {
  const r = await c.req(route, method, body); assert.equal(r.status, status, `${method} ${route}: expected ${status}, got ${r.status} ${r.text.slice(0, 300)}`); return r;
};
const page = async (path: string) => (await fetch(base + path, { redirect: 'manual' })).status;

let browser: Browser | undefined;
try {
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Server did not start.\n${output}`)), 90_000);
    child.stdout.on('data', (c) => { if (String(c).includes('Server running')) { clearTimeout(t); resolve(); } });
    child.once('exit', () => { clearTimeout(t); reject(new Error(`Server exited.\n${output}`)); });
  });

  // ── Fixtures ──
  for (const [id, role] of [[adminId, 'Admin'], [editorId, 'Editor']] as const) await prisma.user.create({ data: { id, name: `${fx} ${role}`, email: `${id}@example.test`, role, avatar: '/favicon.ico', joinedAt: new Date(), passwordHash: hashPassword(password) } });
  await prisma.author.create({ data: { id: `${fx}-byline`, slug: `${fx}-byline`, name: `${fx} Byline`, roleTitle: 'Correspondent', bio: 'Bio', avatar: '/favicon.ico' } });
  await prisma.sport.create({ data: { id: `${fx}-s`, slug: S, name: `${fx} Sport`, tagline: 't', description: 'd', order: 990, isVisible: true, seo: {} } });
  const ev = (slug: string, extra: object = {}, sport = S) => prisma.sportEvent.create({ data: { id: `${fx}-e-${slug}`, sportSlug: sport, slug, name: `${fx} ${slug}`, shortName: slug, description: 'Event.', seo: {}, isVisible: true, ...extra } });
  const ed = (event: string, year: number, sport = S) => prisma.eventEdition.create({ data: { id: `${fx}-ed-${event}-${year}`, sportSlug: sport, eventSlug: event, year, title: `${fx} ${event} ${year}`, description: 'Edition.', seo: {} } });
  const art = (slug: string, status: string, event: string | null, year: number | null, sport = S, discipline: string | null = null) => prisma.article.create({ data: { id: `${fx}-a-${slug}`, slug, title: `${fx} ${slug}`, sportSlug: sport, eventSlug: event, editionYear: year, disciplineSlug: discipline, articleType: 'News', excerpt: 'Excerpt.', content: 'Body text.', featuredImage: '/favicon.ico', authorId: `${fx}-byline`, publishedAt: new Date(Date.now() - 86_400_000), scheduledFor: status === 'scheduled' ? new Date(Date.now() + 86_400_000) : null, readingTimeMinutes: 1, seo: {}, status: status as never } });
  const faq = (id: string, ctx: object) => prisma.faqEntry.create({ data: { id: `${fx}-f-${id}`, question: `${fx} question ${id}?`, answer: 'Answer.', updatedBy: 'test', status: 'published', ...ctx } });

  const E = `${fx}-open`;
  await ev(E, { currentEditionYear: 2027 }); await ed(E, 2026); await ed(E, 2027);
  await art('draft-ed', 'draft', E, 2026); await art('draft-event', 'draft', E, null); await art('archived-ed', 'archived', E, 2027);
  await art('pub-keep', 'published', E, 2026); await art('pub-drop', 'published', E, 2027); await art('sched', 'scheduled', E, 2027);
  await art('general', 'published', null, null);
  await faq('event', { eventId: `${fx}-e-${E}` }); await faq('edition', { editionId: `${fx}-ed-${E}-2026` }); await faq('article', { articleId: `${fx}-a-pub-drop` }); await faq('kept-article', { articleId: `${fx}-a-draft-ed` });
  await prisma.sport.update({ where: { id: `${fx}-s` }, data: { featuredEventIds: [`${fx}-e-${E}`] } });

  const admin = new Client(); const editor = new Client(); const anon = new Client();
  await admin.login(adminId); await editor.login(editorId);
  const eventId = `${fx}-e-${E}`;

  // ── Plan ──
  await expectStatus(anon, `/api/events/${eventId}/delete-plan`, 401);
  await expectStatus(editor, `/api/events/${eventId}/delete-plan`, 403);
  await expectStatus(editor, `/api/events/${eventId}/delete`, 403, 'POST', {});
  const plan = (await expectStatus(admin, `/api/events/${eventId}/delete-plan`, 200)).data;
  assert.deepEqual(plan.editions.map((e: any) => e.year).sort(), [2026, 2027]);
  assert.deepEqual(plan.articles.map((a: any) => a.id).sort(), ['archived-ed', 'draft-ed', 'draft-event', 'pub-drop', 'pub-keep', 'sched'].map((s) => `${fx}-a-${s}`).sort(), 'every article of the event and its editions, general articles excluded');
  assert.deepEqual(plan.articles.filter((a: any) => a.needsChoice).map((a: any) => a.id).sort(), [`${fx}-a-pub-drop`, `${fx}-a-pub-keep`, `${fx}-a-sched`].sort(), 'only published and scheduled articles need a choice');
  assert.equal(plan.articles.find((a: any) => a.id === `${fx}-a-pub-drop`).faqCount, 1);
  assert.equal(plan.articles.find((a: any) => a.id === `${fx}-a-draft-ed`).newPath, `/${S}/draft-ed/`);
  assert.deepEqual(plan.faqs.map((f: any) => f.id).sort(), [`${fx}-f-edition`, `${fx}-f-event`]);
  pass('plan: Admin only; lists both editions, all six linked articles (any status) with their new address, which ones need a choice, and the event and edition FAQ entries');

  // ── Refusals leave everything as it was ──
  const expect = { editions: plan.editions.map((e: any) => e.id), articles: plan.articles.map((a: any) => a.id), faqs: plan.faqs.map((f: any) => f.id) };
  const fixtureState = async () => digest({ a: await prisma.article.findMany({ where: { sportSlug: S }, orderBy: { id: 'asc' } }), e: await prisma.sportEvent.findMany({ where: { sportSlug: S } }), ed: await prisma.eventEdition.findMany({ where: { sportSlug: S }, orderBy: { id: 'asc' } }), f: await prisma.faqEntry.findMany({ where: { id: { startsWith: fx } }, orderBy: { id: 'asc' } }) });
  const untouched = await fixtureState();
  const choices = { [`${fx}-a-pub-keep`]: 'unpublish', [`${fx}-a-pub-drop`]: 'delete', [`${fx}-a-sched`]: 'unpublish' };
  assert.match((await expectStatus(admin, `/api/events/${eventId}/delete`, 400, 'POST', { expect, publishedActions: { [`${fx}-a-pub-keep`]: 'unpublish' } })).data.error, /Choose what happens/);
  await expectStatus(admin, `/api/events/${eventId}/delete`, 400, 'POST', { expect, publishedActions: { ...choices, [`${fx}-a-draft-ed`]: 'delete' } });
  await expectStatus(admin, `/api/events/${eventId}/delete`, 400, 'POST', { expect, publishedActions: { ...choices, [`${fx}-a-pub-keep`]: 'archive' } });
  assert.match((await expectStatus(admin, `/api/events/${eventId}/delete`, 409, 'POST', { expect: { ...expect, articles: expect.articles.slice(1) }, publishedActions: choices })).data.error, /changed after the dialog opened/);
  // A kept article would move onto an address that is already used.
  await prisma.article.update({ where: { id: `${fx}-a-general` }, data: { slug: 'draft-ed' } });
  const clash = (await expectStatus(admin, `/api/events/${eventId}/delete`, 409, 'POST', { expect, publishedActions: choices })).data.error;
  assert.match(clash, /draft-ed.*cannot be kept.*already used by the article/s, clash);
  await prisma.article.update({ where: { id: `${fx}-a-general` }, data: { slug: 'general' } });
  assert.equal(await fixtureState(), untouched, 'every refused request changed nothing (the URL clash rolled back the whole transaction)');
  pass('refusals: a missing or invalid choice, a choice for a private article, a stale list and a URL clash of a kept article are refused and change nothing');

  // ── Delete ──
  const done = (await expectStatus(admin, `/api/events/${eventId}/delete`, 200, 'POST', { expect, publishedActions: choices })).data;
  assert.deepEqual({ deleted: done.deleted, detached: done.detached, unpublished: done.unpublished, faqsDeleted: done.faqsDeleted, editionsDeleted: done.editionsDeleted }, { deleted: 1, detached: 3, unpublished: 2, faqsDeleted: 2, editionsDeleted: 2 });
  assert.equal(await prisma.sportEvent.count({ where: { id: eventId } }), 0); assert.equal(await prisma.eventEdition.count({ where: { sportSlug: S, eventSlug: E } }), 0);
  const rows = Object.fromEntries((await prisma.article.findMany({ where: { sportSlug: S } })).map((a) => [a.id.slice(fx.length + 3), a]));
  for (const k of ['draft-ed', 'draft-event', 'archived-ed', 'pub-keep', 'sched']) { assert.equal(rows[k].eventSlug, null, `${k} detached`); assert.equal(rows[k].editionYear, null, `${k} detached`); }
  assert.equal(rows['draft-ed'].status, 'draft'); assert.equal(rows['archived-ed'].status, 'archived', 'a private article keeps its status');
  assert.equal(rows['pub-keep'].status, 'draft'); assert.equal(rows['sched'].status, 'draft'); assert.equal(rows['sched'].scheduledFor, null, 'unpublished articles are drafts with no schedule');
  assert(!rows['pub-drop'], 'the article chosen for deletion is gone'); assert.equal(await prisma.faqEntry.count({ where: { id: `${fx}-f-article` } }), 0, 'with its FAQ entry');
  assert.equal(await prisma.faqEntry.count({ where: { id: `${fx}-f-kept-article` } }), 1, 'a kept article keeps its own FAQ entry');
  assert.equal(await prisma.faqEntry.count({ where: { id: { in: [`${fx}-f-event`, `${fx}-f-edition`] } } }), 0);
  assert.deepEqual((await prisma.sport.findUniqueOrThrow({ where: { id: `${fx}-s` } })).featuredEventIds, [], 'the sport no longer features the deleted event');
  assert.equal(rows['general'].status, 'published', 'an unrelated article of the sport is untouched');
  assert.equal(await page(`/${S}/${E}/`), 404); assert.equal(await page(`/${S}/${E}/2026/pub-keep/`), 404); assert.equal(await page(`/${S}/pub-keep/`), 404, 'an unpublished article is not public at its new address');
  const logs = await prisma.auditLog.findMany({ where: { userId: adminId } });
  assert(logs.some((l) => l.action === 'Deleted Permanent Event' && l.details.includes('2 edition(s)')) && logs.some((l) => l.action === 'Deleted Article') && logs.filter((l) => l.action === 'Updated Article').length === 5 && logs.some((l) => l.action === 'Deleted FAQ Entries'));
  pass('delete: event and editions gone; drafts, archived and event-level articles kept and detached with their status; chosen published articles unpublished or deleted (with their FAQ); event FAQs deleted; sport featured list cleaned; old URLs 404; every step in the audit log');

  // ── Edition ──
  const E2 = `${fx}-cup`;
  await ev(E2, { currentEditionYear: 2026 }); await ed(E2, 2026); await ed(E2, 2025); await art('cup-draft', 'draft', E2, 2026);
  const edId = `${fx}-ed-${E2}-2026`;
  const edPlan = (await expectStatus(admin, `/api/editions/${edId}/delete-plan`, 200)).data;
  assert.deepEqual(edPlan.articles.map((a: any) => a.id), [`${fx}-a-cup-draft`]); assert.equal(edPlan.articles[0].newPath, `/${S}/cup-draft/`);
  await expectStatus(admin, `/api/editions/${edId}/delete`, 200, 'POST', { expect: { editions: [edId], articles: [`${fx}-a-cup-draft`], faqs: [] }, publishedActions: {} });
  const cup = await prisma.article.findUniqueOrThrow({ where: { id: `${fx}-a-cup-draft` } });
  assert.equal(cup.eventSlug, E2, 'an edition delete keeps the article in its event'); assert.equal(cup.editionYear, null);
  assert.equal((await prisma.sportEvent.findUniqueOrThrow({ where: { id: `${fx}-e-${E2}` } })).currentEditionYear, null, 'the event no longer points at the deleted edition');
  assert.equal(await prisma.eventEdition.count({ where: { id: `${fx}-ed-${E2}-2025` } }), 1, 'the other edition stays');
  pass('edition delete: its draft stays in the event without an edition; the event\'s current edition is cleared; sibling editions stay');

  // ── Sport ──
  await prisma.sport.create({ data: { id: `${fx}-s2`, slug: S2, name: `${fx} Gone Sport`, tagline: 't', description: 'd', order: 991, isVisible: true, seo: {} } });
  await prisma.discipline.create({ data: { id: `${fx}-d-g2`, sportSlug: S2, slug: 'g2', name: `${fx} G2`, order: 1 } });
  const E4 = `${fx}-tour`;
  await ev(E4, { disciplineSlug: 'g2' }, S2); await ed(E4, 2026, S2);
  await art('s2-draft', 'draft', null, null, S2); await art('s2-ed-draft', 'draft', E4, 2026, S2); await art('s2-archived', 'archived', null, null, S2, 'g2');
  await art('s2-live', 'published', null, null, S2); await art('s2-live-ed', 'published', E4, 2026, S2);
  await faq('sport', { sportId: `${fx}-s2` }); await faq('tour', { eventId: `${fx}-e-${E4}` }); await faq('s2-live-ed', { articleId: `${fx}-a-s2-live-ed` });
  const sportPlan = (await expectStatus(admin, `/api/sports/${fx}-s2/delete-plan`, 200)).data;
  assert.deepEqual(Object.keys(sportPlan.expect).sort(), ['articles', 'editions', 'events', 'faqs', 'groups']);
  assert.equal(sportPlan.expect.articles.length, 5); assert.deepEqual([...sportPlan.expect.faqs].sort(), [`${fx}-f-sport`, `${fx}-f-tour`].sort());
  assert(sportPlan.moveTargets.some((t: any) => t.slug === S) && !sportPlan.moveTargets.some((t: any) => t.slug === S2), 'kept articles can move to any other sport');
  assert.deepEqual(sportPlan.removed.map((r: any) => r.key), ['events', 'groups', 'faqs']);
  const sportChoices = { [`${fx}-a-s2-live`]: 'unpublish', [`${fx}-a-s2-live-ed`]: 'delete' };
  const sportBody = (extra: object = {}) => ({ expect: sportPlan.expect, publishedActions: sportChoices, ...extra });
  const s2State = async () => digest({ a: await prisma.article.findMany({ where: { sportSlug: { in: [S, S2, `${fx}-ui-sport`] } }, orderBy: { id: 'asc' } }), s: await prisma.sport.findMany({ where: { id: { startsWith: fx } }, orderBy: { id: 'asc' } }), d: await prisma.discipline.findMany({ where: { sportSlug: S2 } }), f: await prisma.faqEntry.findMany({ where: { id: { startsWith: fx } }, orderBy: { id: 'asc' } }) });
  const s2Before = await s2State();
  assert.match((await expectStatus(admin, `/api/sports/${fx}-s2/delete`, 400, 'POST', sportBody())).data.error, /Choose the sport that keeps 4 articles/);
  await expectStatus(admin, `/api/sports/${fx}-s2/delete`, 400, 'POST', sportBody({ moveTo: S2 }));
  await expectStatus(admin, `/api/sports/${fx}-s2/delete`, 400, 'POST', sportBody({ moveTo: `${fx}-nowhere` }));
  await art('s2-draft-twin', 'draft', null, null, S); await prisma.article.update({ where: { id: `${fx}-a-s2-draft-twin` }, data: { slug: 's2-draft' } });
  const s2Before2 = await s2State();
  assert.match((await expectStatus(admin, `/api/sports/${fx}-s2/delete`, 409, 'POST', sportBody({ moveTo: S }))).data.error, /s2-draft.*cannot be kept.*already used/s);
  assert.equal(await s2State(), s2Before2, 'the URL clash rolled the whole sport deletion back');
  await prisma.article.delete({ where: { id: `${fx}-a-s2-draft-twin` } });
  assert.equal(await s2State(), s2Before, 'refused sport deletions changed nothing');
  const sportDone = (await expectStatus(admin, `/api/sports/${fx}-s2/delete`, 200, 'POST', sportBody({ moveTo: S }))).data;
  assert.deepEqual({ kept: sportDone.kept, unpublished: sportDone.unpublished, deleted: sportDone.deleted, faqs: sportDone.faqsDeleted, removed: sportDone.removed, movedTo: sportDone.movedTo }, { kept: 3, unpublished: 1, deleted: 1, faqs: 2, removed: { events: 1, groups: 1 }, movedTo: `${fx} Sport` });
  assert.equal(await prisma.sport.count({ where: { id: `${fx}-s2` } }), 0); assert.equal(await prisma.sportEvent.count({ where: { sportSlug: S2 } }), 0); assert.equal(await prisma.discipline.count({ where: { sportSlug: S2 } }), 0); assert.equal(await prisma.eventEdition.count({ where: { sportSlug: S2 } }), 0);
  for (const k of ['s2-draft', 's2-ed-draft', 's2-archived', 's2-live']) {
    const a = await prisma.article.findUniqueOrThrow({ where: { id: `${fx}-a-${k}` } });
    assert.equal(a.sportSlug, S, `${k} moved`); assert.equal(a.eventSlug, null); assert.equal(a.editionYear, null); assert.equal(a.disciplineSlug, null, `${k} lost its group`);
  }
  assert.equal((await prisma.article.findUniqueOrThrow({ where: { id: `${fx}-a-s2-archived` } })).status, 'archived');
  assert.equal((await prisma.article.findUniqueOrThrow({ where: { id: `${fx}-a-s2-live` } })).status, 'draft');
  assert.equal(await prisma.article.count({ where: { id: `${fx}-a-s2-live-ed` } }), 0); assert.equal(await prisma.faqEntry.count({ where: { id: { in: [`${fx}-f-sport`, `${fx}-f-tour`, `${fx}-f-s2-live-ed`] } } }), 0);
  assert.equal(await page(`/${S2}/`), 404); assert.equal(await page(`/${S}/s2-live/`), 404, 'the unpublished article is private in its new sport');
  pass('sport delete: needs a target sport for kept articles (not itself, must exist, no URL clash; every refusal changes nothing); events, editions, groups and FAQ entries go; drafts and archived move with their status, losing event, edition and group; published ones unpublished or deleted as chosen');

  // ── Group ──
  await prisma.discipline.create({ data: { id: `${fx}-d-g3`, sportSlug: S, slug: 'g3', name: `${fx} G3`, order: 1 } });
  const E5 = `${fx}-meet`;
  await ev(E5, { disciplineSlug: 'g3' }); await art('g3-live', 'published', null, null, S, 'g3'); await art('g3-draft', 'draft', null, null, S, 'g3');
  const groupPlan = (await expectStatus(admin, `/api/disciplines/${fx}-d-g3/delete-plan`, 200)).data;
  assert.deepEqual({ events: groupPlan.expect.events, articles: [...groupPlan.expect.articles].sort() }, { events: [`${fx}-e-${E5}`], articles: [`${fx}-a-g3-draft`, `${fx}-a-g3-live`] });
  assert(groupPlan.articles.every((a: any) => !a.needsChoice && a.newPath === a.path), 'a group does not change any address, so nothing needs a choice');
  await expectStatus(admin, `/api/disciplines/${fx}-d-g3/delete`, 400, 'POST', { expect: groupPlan.expect, publishedActions: { [`${fx}-a-g3-live`]: 'delete' } });
  await expectStatus(admin, `/api/disciplines/${fx}-d-g3/delete`, 400, 'POST', { expect: groupPlan.expect, publishedActions: {}, moveTo: S });
  await expectStatus(editor, `/api/disciplines/${fx}-d-g3/delete`, 403, 'POST', { expect: groupPlan.expect, publishedActions: {} });
  await expectStatus(admin, `/api/disciplines/${fx}-d-g3/delete`, 200, 'POST', { expect: groupPlan.expect, publishedActions: {} });
  assert.equal(await prisma.discipline.count({ where: { id: `${fx}-d-g3` } }), 0);
  assert.equal((await prisma.sportEvent.findUniqueOrThrow({ where: { id: `${fx}-e-${E5}` } })).disciplineSlug, null);
  const g3live = await prisma.article.findUniqueOrThrow({ where: { id: `${fx}-a-g3-live` } });
  assert.equal(g3live.disciplineSlug, null); assert.equal(g3live.status, 'published', 'a group delete never unpublishes');
  assert.equal(await page(`/${S}/g3-live/`), 200, 'its article stays public at the same address');
  pass('group delete: Admin only; its events and articles (any status) stay at their addresses and lose the group; no choice is needed or accepted');

  // ── Browser ──
  const E3 = `${fx}-ui`;
  await ev(E3); await ed(E3, 2026); await art('ui-draft', 'draft', E3, 2026); await art('ui-live', 'published', E3, 2026);
  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  browser = await chromium.launch({ executablePath, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const p = await ctx.newPage();
  const pageErrors: string[] = []; p.on('pageerror', (e) => pageErrors.push(e.message));
  await p.goto(`${base}/admin/`, { waitUntil: 'networkidle' });
  await p.getByPlaceholder('Email').fill(`${adminId}@example.test`); await p.getByPlaceholder('Password').fill(password); await p.getByRole('button', { name: 'Sign In', exact: true }).click();
  await p.getByRole('heading', { name: 'Content Management System' }).waitFor();
  await p.getByRole('button', { name: /^Events/ }).first().click();
  await p.getByRole('row').filter({ hasText: `${fx} ${E3}` }).getByRole('button', { name: 'Delete', exact: true }).click();
  const dialog = p.getByTestId('delete-dialog'); await dialog.waitFor();
  await dialog.getByText(`${fx} ui-draft`).waitFor(); await dialog.getByText(`${fx} ui-live`).waitFor();
  assert.equal(await dialog.getByTestId('dd-kept-article').count(), 1); assert.equal(await dialog.getByTestId('dd-published-article').count(), 1);
  assert(await dialog.getByTestId('dd-confirm').isDisabled(), 'Delete waits for a choice on the published article');
  assert.equal(await dialog.getByTestId('dd-kept-article').getByRole('link', { name: 'Open' }).getAttribute('href'), `/admin/preview/${fx}-a-ui-draft/`);
  assert.equal(await dialog.getByTestId('dd-published-article').getByRole('link', { name: 'Open' }).getAttribute('href'), `/admin/preview/${fx}-a-ui-live/`);
  await dialog.getByLabel('Unpublish and keep as draft').check();
  await dialog.getByTestId('dd-confirm').click();
  await p.getByText(new RegExp(`Deleted event "${fx} ${E3}"`)).waitFor();
  assert.equal(await prisma.sportEvent.count({ where: { id: `${fx}-e-${E3}` } }), 0);
  assert.equal((await prisma.article.findUniqueOrThrow({ where: { id: `${fx}-a-ui-live` } })).status, 'draft');
  // Sport: the kept articles need a target sport before Delete is possible.
  const S3 = `${fx}-ui-sport`;
  await prisma.sport.create({ data: { id: `${fx}-s3`, slug: S3, name: `${fx} UI Sport`, tagline: 't', description: 'd', order: 992, isVisible: true, seo: {} } });
  await art('s3-draft', 'draft', null, null, S3); await art('s3-live', 'published', null, null, S3);
  await p.goto(`${base}/admin/#sports`, { waitUntil: 'networkidle' }); await p.reload({ waitUntil: 'networkidle' });
  await p.locator('tr', { hasText: `${fx} UI Sport` }).getByRole('button', { name: 'Delete', exact: true }).click();
  const sportDialog = p.getByTestId('delete-dialog'); await sportDialog.getByText(`${fx} s3-live`).waitFor();
  await sportDialog.getByLabel('Unpublish and keep as draft').check();
  assert(await sportDialog.getByTestId('dd-confirm').isDisabled(), 'Delete waits for the target sport');
  await sportDialog.getByTestId('dd-move-to').selectOption(S);
  await sportDialog.getByText(`→ /${S}/s3-draft/`).waitFor();
  await sportDialog.getByTestId('dd-confirm').click();
  await p.getByText(new RegExp(`Deleted sport "${fx} UI Sport"`)).waitFor();
  assert.equal(await prisma.sport.count({ where: { id: `${fx}-s3` } }), 0);
  for (const k of ['s3-draft', 's3-live']) { const a = await prisma.article.findUniqueOrThrow({ where: { id: `${fx}-a-${k}` } }); assert.equal(a.sportSlug, S); assert.equal(a.status, 'draft'); }
  // Group: Delete is available while the group is in use; the dialog lists what loses it.
  await prisma.discipline.create({ data: { id: `${fx}-d-g4`, sportSlug: S, slug: 'g4', name: `${fx} G4`, order: 2 } });
  await ev(`${fx}-g4-event`, { disciplineSlug: 'g4' });
  await p.reload({ waitUntil: 'networkidle' });
  await p.locator('tr', { hasText: `${fx} Sport` }).first().getByRole('button', { name: 'Edit', exact: true }).click();
  const manager = p.getByTestId('discipline-manager');
  const groupDelete = manager.getByRole('button', { name: `Delete ${fx} G4` });
  assert(await groupDelete.isEnabled(), 'a group in use can be deleted through the dialog');
  await groupDelete.click();
  const groupDialog = p.getByTestId('delete-dialog'); await groupDialog.getByTestId('dd-detached-events').getByText(`${fx} ${fx}-g4-event`).waitFor();
  await groupDialog.getByTestId('dd-confirm').click();
  await manager.getByText(new RegExp(`Deleted group "${fx} G4"`)).waitFor();
  assert.equal(await prisma.discipline.count({ where: { id: `${fx}-d-g4` } }), 0);
  assert.equal((await prisma.sportEvent.findUniqueOrThrow({ where: { id: `${fx}-e-${fx}-g4-event` } })).disciplineSlug, null);
  await p.setViewportSize({ width: 390, height: 844 });
  assert.deepEqual(pageErrors, []);
  // An Editor sees no Delete buttons.
  const p2 = await (await browser.newContext()).newPage();
  await p2.goto(`${base}/admin/`, { waitUntil: 'networkidle' });
  await p2.getByPlaceholder('Email').fill(`${editorId}@example.test`); await p2.getByPlaceholder('Password').fill(password); await p2.getByRole('button', { name: 'Sign In', exact: true }).click();
  await p2.getByRole('heading', { name: 'Content Management System' }).waitFor(); await p2.getByRole('button', { name: /^Events/ }).first().click();
  await p2.getByRole('row').filter({ hasText: `${fx} ${E2}` }).waitFor();
  assert.equal(await p2.getByRole('row').filter({ hasText: `${fx} ${E2}` }).getByRole('button', { name: 'Delete', exact: true }).count(), 0);
  pass('browser: event, sport and group Delete open the dialog (kept and published articles with Open links, events losing a group); Delete waits for every choice and the target sport; confirming deletes and reports; Editors see no Delete; no browser errors');
} finally {
  await browser?.close().catch(() => undefined);
  child.kill();
  await prisma.faqEntry.deleteMany({ where: { id: { startsWith: fx } } });
  await prisma.article.deleteMany({ where: { sportSlug: { in: [S, S2, `${fx}-ui-sport`] } } });
  await prisma.eventEdition.deleteMany({ where: { sportSlug: { in: [S, S2, `${fx}-ui-sport`] } } });
  await prisma.sportEvent.deleteMany({ where: { sportSlug: { in: [S, S2, `${fx}-ui-sport`] } } });
  await prisma.discipline.deleteMany({ where: { sportSlug: { in: [S, S2, `${fx}-ui-sport`] } } });
  await prisma.sport.deleteMany({ where: { id: { in: [`${fx}-s`, `${fx}-s2`, `${fx}-s3`] } } });
  await prisma.author.deleteMany({ where: { id: `${fx}-byline` } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: [adminId, editorId] } } });
  await prisma.editorDraft.deleteMany({ where: { ownerId: { in: [adminId, editorId] } } });
  await prisma.session.deleteMany({ where: { userId: { in: [adminId, editorId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [adminId, editorId] } } });
}
assert.equal(await snapshot(), before, 'every pre-existing sport, event, edition, article, FAQ entry and group is unchanged; no fixture is left');
pass('integrity: pre-existing data unchanged row for row; fixtures removed');
console.log(`Guided delete verification passed: ${checks} checks.`);
await prisma.$disconnect();
process.exit(0);
