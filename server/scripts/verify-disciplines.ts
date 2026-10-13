/** Sport groups (internal name: discipline): data model and API rules (the CMS screens and public pages have their own suites).
 * Production-mode server on the LOCAL database, UUID-scoped fixtures (two
 * temporary sports), and a full-row check that every sport, event, edition
 * and article that existed before is unchanged afterwards.
 * Requires `npm run build`, the migration 20261016090000_sport_disciplines
 * applied to the local database, and a local database.
 * Run: npm run local -- test:disciplines
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { prisma } from '../db';
import { checkDatabaseUrlIsLocalDev } from '../dbSafety';
import { hashPassword } from '../password';
import { articlePath, editionPath, eventPath, sportPath } from '../../src/lib/paths';
import { SPORT_ICONS } from '../../src/config/sportIcons';

assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe, 'Verification requires a local, non-production database.');
assert(fs.existsSync('.next/BUILD_ID'), 'Run npm run build first.');

const fixture = `disc${crypto.randomBytes(4).toString('hex')}`;
const password = `Test-${crypto.randomUUID()}`;
const ids = { admin: `${fixture}-admin`, editor: `${fixture}-editor`, author: `${fixture}-author` };
const bylines = { editor: `${fixture}-byline-editor`, author: `${fixture}-byline-author` };
const A = `${fixture}-athletics`; const B = `${fixture}-cycling`;
const digest = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const tables = ['sport', 'sportEvent', 'eventEdition', 'article', 'author', 'redirectRule'] as const;
async function snapshot() {
  const result: Record<string, { count: number; hash: string }> = {};
  for (const table of tables) {
    const rows = await (prisma[table] as any).findMany({ orderBy: { id: 'asc' } });
    result[table] = { count: rows.length, hash: digest(JSON.stringify(rows)) };
  }
  return result;
}
const before = await snapshot();
const disciplinesBefore = await prisma.discipline.count();
// The migration assigned nothing: every row that existed has no discipline.
const assignedBefore = { events: await prisma.sportEvent.count({ where: { disciplineSlug: { not: null } } }), articles: await prisma.article.count({ where: { disciplineSlug: { not: null } } }) };

const probe = createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = (probe.address() as { port: number }).port;
await new Promise<void>((resolve) => probe.close(() => resolve()));
const base = `http://localhost:${port}`;
const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
  cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', TRUST_PROXY: 'false', NODE_ENV: 'production', APP_ENV: 'production', AUTH_MODE: 'production', DEV_LOGIN_BYPASS: 'false', ALLOWED_ORIGIN: base, ENABLE_READER_ACCOUNTS: 'false', ENABLE_COMMENTS: 'false' } as NodeJS.ProcessEnv,
});

let checks = 0;
const pass = (m: string) => { checks++; console.log(`PASS ${m}`); };

class Client {
  cookies = new Map<string, string>();
  async request(route: string, method = 'GET', body?: unknown, csrf = true) {
    const headers: Record<string, string> = { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '), 'Content-Type': 'application/json' };
    if (method !== 'GET' && csrf) headers['x-csrf-token'] = this.cookies.get('csrf_token') || '';
    const res = await fetch(base + route, { method, redirect: 'manual', headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie()) { const [pair] = c.split(';'); const i = pair.indexOf('='); this.cookies.set(pair.slice(0, i), pair.slice(i + 1)); }
    const text = await res.text();
    let data: any; try { data = JSON.parse(text); } catch { data = null; }
    return { status: res.status, data, text };
  }
  async login(email: string) { await this.request('/api/auth/me'); return this.request('/api/auth/login', 'POST', { email, password }); }
}
const expect = async (client: Client, route: string, status: number, method = 'GET', body?: unknown, csrf = true) => {
  const r = await client.request(route, method, body, csrf);
  assert.equal(r.status, status, `${method} ${route}: expected ${status}, got ${r.status} ${r.text.slice(0, 300)}`);
  return r;
};
const page = async (route: string) => (await fetch(base + route, { redirect: 'manual' })).status;

try {
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Test server did not start.')), 90_000);
    child.stdout.on('data', (c) => { if (String(c).includes('Server running')) { clearTimeout(t); resolve(); } });
    child.once('exit', () => { clearTimeout(t); reject(new Error('Test server exited before startup.')); });
  });

  for (const [key, role] of [['admin', 'Admin'], ['editor', 'Editor'], ['author', 'Author']] as const) {
    await prisma.user.create({ data: { id: ids[key], name: `Discipline test ${role}`, email: `${ids[key]}@example.test`, role, avatar: '/favicon.ico', joinedAt: new Date(), passwordHash: hashPassword(password) } });
  }
  for (const key of ['editor', 'author'] as const) await prisma.author.create({ data: { id: bylines[key], userId: ids[key], slug: `${fixture}-${key}`, name: `Discipline byline ${key}`, roleTitle: 'Correspondent', bio: 'Bio', avatar: '/favicon.ico' } });
  const anon = new Client(); const admin = new Client(); const editor = new Client(); const author = new Client();
  await anon.request('/api/auth/me');
  for (const [c, k] of [[admin, 'admin'], [editor, 'editor'], [author, 'author']] as const) assert.equal((await c.login(`${ids[k]}@example.test`)).status, 200);

  // Two temporary sports, created through the existing Sports API.
  const sportA = (await expect(admin, '/api/sports', 201, 'POST', { name: `${fixture} Athletics`, slug: A })).data;
  const sportB = (await expect(admin, '/api/sports', 201, 'POST', { name: `${fixture} Cycling`, slug: B })).data;

  // ── Existing behaviour without disciplines ──
  const plainEvent = (await expect(editor, '/api/events', 201, 'POST', { name: `${fixture} Marathon`, slug: 'marathon', sportSlug: A })).data;
  assert.equal(plainEvent.disciplineSlug, null);
  const plainArticle = (await expect(editor, '/api/articles', 201, 'POST', { title: `${fixture} guide`, slug: `${fixture}-guide`, sportSlug: A, content: 'Body text.', status: 'published' })).data;
  assert.equal(plainArticle.disciplineSlug, null);
  assert.equal(sportPath(A), `/${A}/`); assert.equal(eventPath(A, 'marathon'), `/${A}/marathon/`); assert.equal(editionPath(A, 'marathon', 2027), `/${A}/marathon/2027/`);
  assert.equal(articlePath(plainArticle), `/${A}/${fixture}-guide/`);
  assert.equal(articlePath({ ...plainArticle, eventSlug: 'marathon', editionYear: 2027 }), `/${A}/marathon/2027/${fixture}-guide/`);
  assert.equal(await page(`/${A}/`), 200); assert.equal(await page(`/${A}/marathon/`), 200); assert.equal(await page(`/${A}/${fixture}-guide/`), 200);
  assert.equal((await expect(editor, `/api/events/${plainEvent.id}`, 200, 'PUT', { shortName: 'Marathon' })).data.disciplineSlug, null);
  assert.equal((await expect(editor, `/api/articles/${plainArticle.id}`, 200, 'PUT', { subtitle: 'Updated' })).data.disciplineSlug, null);
  pass('a sport with no groups works as before: events and articles are created and edited without the field, URLs and public pages are unchanged');

  // ── Management is Admin-only ──
  const draft = { sportSlug: A, slug: 'running', name: 'Running' };
  await expect(anon, '/api/disciplines', 401, 'POST', draft);
  await expect(editor, '/api/disciplines', 403, 'POST', draft);
  await expect(author, '/api/disciplines', 403, 'POST', draft);
  await expect(admin, '/api/disciplines', 403, 'POST', draft, false); // no CSRF token
  await expect(anon, '/api/disciplines', 401);
  const running = (await expect(admin, '/api/disciplines', 201, 'POST', { ...draft, description: 'Track and road running.', seo: { metaTitle: 'Running' } })).data;
  assert.deepEqual([running.sportSlug, running.slug, running.name, running.order, running.isVisible, running.isActive], [A, 'running', 'Running', 1, true, true]);
  for (const c of [editor, author]) { await expect(c, `/api/disciplines/${running.id}`, 403, 'PUT', { name: 'X' }); await expect(c, `/api/disciplines/${running.id}`, 403, 'DELETE'); }
  assert.deepEqual((await expect(editor, `/api/disciplines?sport=${A}`, 200)).data.map((d: any) => d.slug), ['running']);
  assert.equal((await expect(author, '/api/disciplines', 200)).data.filter((d: any) => d.sportSlug === A).length, 1);
  assert((await expect(author, '/api/cms/data', 200)).data.disciplines.some((d: any) => d.id === running.id), 'the CMS data contract lists disciplines');
  const created = await prisma.auditLog.findFirst({ where: { entityId: running.id, action: 'Created Group' } });
  assert(created && created.userId === ids.admin, 'creation is in the audit log');
  pass('management is Admin-only (anonymous 401, Editor/Author 403, CSRF enforced); staff can list; creation is audited');

  // ── Slugs: unique within a sport, free across sports; parent sport must exist ──
  await expect(admin, '/api/disciplines', 409, 'POST', draft);
  const runningB = (await expect(admin, '/api/disciplines', 201, 'POST', { sportSlug: B, slug: 'running', name: 'Running (cycling fixture)' })).data;
  const road = (await expect(admin, '/api/disciplines', 201, 'POST', { sportSlug: B, slug: 'road', name: 'Road Cycling' })).data;
  const jumping = (await expect(admin, '/api/disciplines', 201, 'POST', { sportSlug: A, slug: 'jumping', name: 'Jumping' })).data;
  assert.equal(jumping.order, 2);
  await expect(admin, '/api/disciplines', 400, 'POST', { sportSlug: `${fixture}-nowhere`, slug: 'x', name: 'X' });
  await expect(admin, '/api/disciplines', 400, 'POST', { sportSlug: A, slug: 'Not A Slug', name: 'X' });
  await expect(admin, '/api/disciplines', 400, 'POST', { sportSlug: A, slug: 'x', name: '' });
  await expect(admin, '/api/disciplines', 400, 'POST', { sportSlug: A, slug: 'x', name: 'X', id: 'chosen-id' });
  await expect(admin, `/api/disciplines/${running.id}`, 400, 'PUT', { sportSlug: B }); // a discipline never changes sport
  await expect(admin, `/api/disciplines/${jumping.id}`, 409, 'PUT', { slug: 'running' });
  await assert.rejects(prisma.discipline.create({ data: { id: `${fixture}-dup`, sportSlug: A, slug: 'running', name: 'Dup' } }), 'the database itself refuses a duplicate slug within a sport');
  await assert.rejects(prisma.discipline.create({ data: { id: `${fixture}-orphan`, sportSlug: `${fixture}-nowhere`, slug: 'x', name: 'Orphan' } }), 'the database itself refuses a discipline without a sport');
  pass('a slug is unique within its sport and may repeat under another sport; unknown sport, bad slug, empty name, extra fields and a change of sport are refused');

  // ── One address space: discipline, event and event-less article never share a slug in a sport ──
  await expect(admin, '/api/disciplines', 409, 'POST', { sportSlug: A, slug: 'marathon', name: 'Marathon' });
  await expect(admin, '/api/disciplines', 409, 'POST', { sportSlug: A, slug: `${fixture}-guide`, name: 'Guide' });
  await expect(admin, `/api/disciplines/${jumping.id}`, 409, 'PUT', { slug: 'marathon' });
  await expect(editor, '/api/events', 409, 'POST', { name: 'Running event', slug: 'running', sportSlug: A });
  await expect(editor, `/api/events/${plainEvent.id}`, 409, 'PUT', { slug: 'jumping' });
  await expect(editor, '/api/articles', 409, 'POST', { title: 'Running', slug: 'running', sportSlug: A, content: 'x' });
  await expect(editor, `/api/articles/${plainArticle.id}`, 409, 'PUT', { slug: 'jumping' });
  await expect(editor, '/api/events', 201, 'POST', { name: 'Road event', slug: 'road', sportSlug: A }); // "road" is a discipline of the OTHER sport only
  assert.equal(await page(`/${A}/running/`), 200, 'the discipline has its landing page');
  assert.equal(await page(`/${A}/marathon/`), 200, 'the existing event URL still resolves to the event');
  pass('collision guard in all three directions (group ↔ event ↔ event-less article); the event URL still shows the event');

  // ── Assignment: at most one discipline, of the same sport ──
  const sprint = (await expect(editor, '/api/events', 201, 'POST', { name: `${fixture} Sprint Cup`, slug: 'sprint-cup', sportSlug: A, disciplineSlug: 'running' })).data;
  assert.equal(sprint.disciplineSlug, 'running');
  await expect(editor, '/api/events', 400, 'POST', { name: 'Wrong', slug: 'wrong-event', sportSlug: A, disciplineSlug: 'road' });
  await expect(editor, '/api/events', 400, 'POST', { name: 'Wrong', slug: 'wrong-event', sportSlug: A, disciplineSlug: ['running'] });
  await expect(editor, `/api/events/${plainEvent.id}`, 400, 'PUT', { disciplineSlug: 'road' });
  assert.equal((await expect(editor, `/api/events/${plainEvent.id}`, 200, 'PUT', { disciplineSlug: 'jumping' })).data.disciplineSlug, 'jumping');
  assert.equal((await expect(editor, `/api/events/${plainEvent.id}`, 200, 'PUT', { disciplineSlug: null })).data.disciplineSlug, null);
  const mine = (await expect(author, '/api/articles', 201, 'POST', { title: `${fixture} sprint tips`, slug: `${fixture}-sprint-tips`, sportSlug: A, content: 'Body.', disciplineSlug: 'running' })).data;
  assert.equal(mine.disciplineSlug, 'running');
  await expect(author, '/api/articles', 400, 'POST', { title: 'Wrong', slug: `${fixture}-wrong`, sportSlug: A, content: 'x', disciplineSlug: 'road' });
  await expect(editor, `/api/articles/${plainArticle.id}`, 400, 'PUT', { disciplineSlug: 'road' });
  assert.equal((await expect(editor, `/api/articles/${plainArticle.id}`, 200, 'PUT', { disciplineSlug: 'jumping' })).data.disciplineSlug, 'jumping');
  await assert.rejects(prisma.article.update({ where: { id: plainArticle.id }, data: { disciplineSlug: 'road' } }), 'the database itself refuses a discipline of another sport on an article');
  await assert.rejects(prisma.sportEvent.update({ where: { id: plainEvent.id }, data: { disciplineSlug: 'road' } }), 'the database itself refuses a discipline of another sport on an event');
  const assignAudit = await prisma.auditLog.findFirst({ where: { entityId: plainArticle.id, action: { contains: 'Article' } }, orderBy: { timestamp: 'desc' } });
  assert(JSON.stringify(assignAudit?.after ?? {}).includes('jumping'), 'the assignment is recorded in the article audit entry');
  pass('events (Admin/Editor) and articles (also Authors) take one group of their own sport; another sport\'s group is refused by the API and by the database; assignments are audited');

  // ── Moving between sports ──
  await expect(editor, `/api/articles/${plainArticle.id}`, 400, 'PUT', { sportSlug: B });
  assert.equal((await expect(editor, `/api/articles/${plainArticle.id}`, 200, 'PUT', { sportSlug: B, disciplineSlug: 'road' })).data.disciplineSlug, 'road');
  assert.equal((await expect(editor, `/api/articles/${plainArticle.id}`, 200, 'PUT', { sportSlug: A, disciplineSlug: null })).data.disciplineSlug, null);
  await expect(editor, `/api/events/${sprint.id}`, 400, 'PUT', { sportSlug: B }); // never carried over, although the other sport also has a "running"
  const eventArticle = (await expect(editor, '/api/articles', 201, 'POST', { title: `${fixture} cup preview`, slug: `${fixture}-cup-preview`, sportSlug: A, eventSlug: 'sprint-cup', content: 'Body.', disciplineSlug: 'running' })).data;
  const blocked = await expect(editor, `/api/events/${sprint.id}`, 400, 'PUT', { sportSlug: B, disciplineSlug: null });
  assert.match(blocked.data.error, /1 article\(s\) of this event have a group/);
  pass('moving an article or event to another sport needs its group cleared or replaced by one of the new sport; an event does not move while its articles keep groups of the old sport');

  // ── Rename, hide, retire, delete ──
  const renamed = (await expect(admin, `/api/disciplines/${running.id}`, 200, 'PUT', { slug: 'track-running', name: 'Track Running', seo: { metaDescription: 'All running.' } })).data;
  assert.deepEqual(renamed.seo, { metaTitle: 'Running', metaDescription: 'All running.' }, 'SEO fields are merged, not replaced');
  assert.equal((await prisma.article.findUniqueOrThrow({ where: { id: mine.id } })).disciplineSlug, 'track-running');
  assert.equal((await prisma.sportEvent.findUniqueOrThrow({ where: { id: sprint.id } })).disciplineSlug, 'track-running');
  await expect(admin, `/api/disciplines/${running.id}`, 200, 'PUT', { slug: 'running', isVisible: false, order: 5 });
  const retired = (await expect(admin, `/api/disciplines/${running.id}`, 200, 'PUT', { isActive: false })).data;
  assert.deepEqual([retired.slug, retired.isVisible, retired.isActive, retired.order], ['running', false, false, 5]);
  await expect(editor, '/api/articles', 400, 'POST', { title: 'Late', slug: `${fixture}-late`, sportSlug: A, content: 'x', disciplineSlug: 'running' });
  await expect(editor, `/api/events/${plainEvent.id}`, 400, 'PUT', { disciplineSlug: 'running' });
  assert.equal((await expect(editor, `/api/articles/${mine.id}`, 200, 'PUT', { subtitle: 'Still running', disciplineSlug: 'running' })).data.disciplineSlug, 'running');
  assert.match((await expect(admin, `/api/disciplines/${running.id}`, 409, 'DELETE')).data.error, /used by 1 event\(s\) and 2 article\(s\)\. Retire it instead/);
  await assert.rejects(prisma.discipline.delete({ where: { id: running.id } }), 'the database itself refuses to delete a discipline in use');
  await expect(admin, `/api/disciplines/${jumping.id}`, 200, 'DELETE');
  await expect(admin, `/api/disciplines/${jumping.id}`, 404, 'DELETE');
  assert((await prisma.auditLog.count({ where: { entityId: { in: [running.id, jumping.id] }, action: { in: ['Updated Group', 'Deleted Group'] } } })) >= 4, 'updates and the deletion are audited');
  pass('rename cascades to the events and articles that use it; hide and reorder; a retired group keeps its assignments but takes no new ones; a used group cannot be deleted, an unused one can');

  // ── Reactivate and reorder ──
  const back = (await expect(admin, `/api/disciplines/${running.id}`, 200, 'PUT', { isActive: true, isVisible: true, order: 2 })).data;
  assert.deepEqual([back.isActive, back.isVisible, back.order], [true, true, 2]);
  const throwing = (await expect(admin, '/api/disciplines', 201, 'POST', { sportSlug: A, slug: 'throwing', name: 'Throwing', order: 1 })).data;
  const orderOf = async () => (await expect(editor, `/api/disciplines?sport=${A}`, 200)).data.map((d: any) => d.slug);
  assert.deepEqual(await orderOf(), ['throwing', 'running']);
  await expect(admin, `/api/disciplines/${throwing.id}`, 200, 'PUT', { order: 3 });
  assert.deepEqual(await orderOf(), ['running', 'throwing']);
  await expect(admin, `/api/disciplines/${throwing.id}`, 400, 'PUT', { order: -1 });
  assert.equal((await expect(editor, '/api/events', 201, 'POST', { name: `${fixture} Relay`, slug: 'relay', sportSlug: A, disciplineSlug: 'running' })).data.disciplineSlug, 'running');
  pass('a retired group can be reactivated and assigned again; order decides the list; an invalid order is refused');

  // ── An article inside an event follows the event's discipline ──
  // "sprint-cup" has the discipline "running"; its article already names the same one.
  assert.match((await expect(editor, '/api/articles', 400, 'POST', { title: 'Conflict', slug: `${fixture}-conflict`, sportSlug: A, eventSlug: 'sprint-cup', content: 'x', disciplineSlug: 'throwing' })).data.error, /whose group is "running"/);
  await expect(editor, `/api/articles/${eventArticle.id}`, 400, 'PUT', { disciplineSlug: 'throwing' });
  assert.equal((await expect(editor, `/api/articles/${eventArticle.id}`, 200, 'PUT', { disciplineSlug: null })).data.disciplineSlug, null); // empty: follows the event
  assert.equal((await expect(editor, `/api/articles/${eventArticle.id}`, 200, 'PUT', { disciplineSlug: 'running' })).data.disciplineSlug, 'running'); // the same one is allowed
  // A stand-alone article chooses freely; attaching it to an event with another discipline needs its own one cleared.
  assert.equal((await expect(editor, `/api/articles/${plainArticle.id}`, 200, 'PUT', { disciplineSlug: 'throwing' })).data.disciplineSlug, 'throwing');
  await expect(editor, `/api/articles/${plainArticle.id}`, 400, 'PUT', { eventSlug: 'sprint-cup' });
  assert.equal((await prisma.article.findUniqueOrThrow({ where: { id: plainArticle.id } })).eventSlug, null, 'the refused request changed nothing');
  // An event without a discipline lets its articles choose; it cannot then take a discipline that contradicts them.
  assert.equal((await expect(editor, `/api/articles/${plainArticle.id}`, 200, 'PUT', { eventSlug: 'marathon' })).data.disciplineSlug, 'throwing');
  assert.match((await expect(editor, `/api/events/${plainEvent.id}`, 409, 'PUT', { disciplineSlug: 'running' })).data.error, /1 article\(s\) of this event have a different group/);
  assert.equal((await prisma.article.findUniqueOrThrow({ where: { id: plainArticle.id } })).disciplineSlug, 'throwing', 'nothing was overwritten');
  assert.equal((await expect(editor, `/api/events/${plainEvent.id}`, 200, 'PUT', { disciplineSlug: 'throwing' })).data.disciplineSlug, 'throwing');
  pass('an article inside an event may leave its group empty or name the event\'s, never another; a stand-alone article chooses freely; an event cannot take a group that contradicts its articles; nothing is overwritten');

  // ── The group's own landing-page settings (the Sport form's fields, stored on the group) ──
  const media = await prisma.mediaItem.create({ data: { id: `${fixture}-media`, title: `${fixture} track`, url: `https://images.unsplash.com/photo-${fixture}-track?w=1200`, altText: 'Running track', width: 1200, height: 800, uploadedAt: new Date(), copyrightReview: 'reviewed' } });
  const rowOf = (id: string) => prisma.discipline.findUniqueOrThrow({ where: { id } });
  const stable = (row: object) => JSON.stringify({ ...row, updatedAt: null });
  const sportBefore = JSON.stringify(await prisma.sport.findUniqueOrThrow({ where: { id: sportA.id } }));
  const siblingBefore = stable(await rowOf(throwing.id));
  const icon = SPORT_ICONS[0].emoji; const seo = { metaTitle: 'Running SEO title', metaDescription: 'Running meta description.', keywords: ['running', 'marathon'], ogTitle: 'Running social', ogDescription: 'Social text.', ogImage: media.url };
  const saved = (await expect(admin, `/api/disciplines/${running.id}`, 200, 'PUT', { tagline: '  Sprints, distance and road races  ', description: 'Everything about running.', icon, heroImage: media.url, featuredEventIds: [sprint.id], seo })).data;
  assert.deepEqual([saved.tagline, saved.description, saved.icon, saved.heroImage, saved.heroMediaId, saved.featuredEventIds], ['Sprints, distance and road races', 'Everything about running.', icon, media.url, media.id, [sprint.id]]);
  assert.deepEqual(saved.seo, { metaDescription: 'Running meta description.', metaTitle: 'Running SEO title', keywords: ['running', 'marathon'], ogTitle: 'Running social', ogDescription: 'Social text.', ogImage: media.url });
  // Reloaded from the server exactly as saved.
  const reloaded = (await expect(editor, `/api/disciplines?sport=${A}`, 200)).data.find((d: any) => d.id === running.id);
  assert.deepEqual([reloaded.tagline, reloaded.icon, reloaded.heroImage, reloaded.heroMediaId, reloaded.featuredEventIds, reloaded.seo.ogImage], ['Sprints, distance and road races', icon, media.url, media.id, [sprint.id], media.url]);
  assert((await expect(admin, '/api/cms/data', 200)).data.disciplines.some((d: any) => d.id === running.id && d.tagline === 'Sprints, distance and road races'), 'the CMS data carries the settings');
  // A partial save keeps everything it does not mention.
  const partial = (await expect(admin, `/api/disciplines/${running.id}`, 200, 'PUT', { tagline: 'Track and road' })).data;
  assert.deepEqual([partial.tagline, partial.description, partial.icon, partial.heroMediaId, partial.featuredEventIds, partial.seo.metaTitle, partial.name, partial.slug], ['Track and road', 'Everything about running.', icon, media.id, [sprint.id], 'Running SEO title', saved.name, saved.slug]);
  // Nothing was written to the parent sport or to a sibling group.
  assert.equal(JSON.stringify(await prisma.sport.findUniqueOrThrow({ where: { id: sportA.id } })), sportBefore, 'the parent sport is unchanged');
  assert.equal(stable(await rowOf(throwing.id)), siblingBefore, 'the sibling group is unchanged');
  // The same reference rules as the Sport form.
  assert.match((await expect(admin, `/api/disciplines/${running.id}`, 400, 'PUT', { heroImage: 'https://example.com/not-in-library.jpg' })).data.error, /Media Library item/);
  await expect(admin, `/api/disciplines/${running.id}`, 400, 'PUT', { icon: 'not-an-icon' });
  await expect(admin, `/api/disciplines/${running.id}`, 400, 'PUT', { tagline: 'x'.repeat(301) });
  assert.match((await expect(admin, `/api/disciplines/${running.id}`, 400, 'PUT', { featuredEventIds: [plainEvent.id] })).data.error, /Events of this group/); // an event of the sibling group
  await expect(admin, `/api/disciplines/${running.id}`, 400, 'PUT', { featuredEventIds: [sprint.id, sprint.id] });
  await expect(admin, `/api/disciplines/${running.id}`, 400, 'PUT', { featuredEventIds: [`${fixture}-no-such-event`] });
  await expect(admin, `/api/disciplines/${running.id}`, 400, 'PUT', { faqSchemaEnabled: true }); // not a group setting
  await expect(admin, '/api/disciplines', 400, 'POST', { sportSlug: A, slug: 'hurdles', name: 'Hurdles', featuredEventIds: [sprint.id] });
  for (const c of [editor, author]) await expect(c, `/api/disciplines/${running.id}`, 403, 'PUT', { tagline: 'Nope' });
  assert.equal((await rowOf(running.id)).tagline, 'Track and road', 'refused requests changed nothing');
  // The image is tracked as in use and cannot be deleted from the Media Library.
  assert((await expect(admin, '/api/cms/data', 200)).data.mediaUsage[media.id].some((u: any) => /Running \(group\)$/.test(u.title)), 'the Media Library shows the group as a user of the image');
  await expect(admin, `/api/media/${media.id}`, 409, 'DELETE');
  const settingsAudit = await prisma.auditLog.findFirst({ where: { entityId: running.id, action: 'Updated Group' }, orderBy: { timestamp: 'desc' } });
  assert(JSON.stringify(settingsAudit?.after ?? {}).includes('Track and road'), 'the change is in the audit log with its new value');
  // Cleared explicitly.
  const cleared = (await expect(admin, `/api/disciplines/${running.id}`, 200, 'PUT', { icon: null, heroImage: null, featuredEventIds: [], tagline: '' })).data;
  assert.deepEqual([cleared.icon, cleared.heroImage, cleared.heroMediaId, cleared.featuredEventIds, cleared.tagline, cleared.description], [null, null, null, [], '', 'Everything about running.']);
  await expect(admin, `/api/media/${media.id}`, 200, 'DELETE');
  pass('group settings: tagline, description, icon, Media Library image, featured events and SEO/social save, reload and survive partial saves; references follow the Sport form\'s rules; the parent sport and sibling groups are untouched; Admin-only; audited; an image in use cannot be deleted');

  // ── Two levels only: Sport → Group ──
  // A group's parent is a sport, never another group; nothing in the API or the schema can nest groups.
  assert.match((await expect(admin, '/api/disciplines', 400, 'POST', { sportSlug: 'running', slug: 'sprints', name: 'Sprints' })).data.error, /must identify an existing sport/);
  for (const field of ['parentGroupId', 'parentId', 'parentSlug', 'parentDisciplineSlug', 'disciplineSlug']) {
    assert.equal((await expect(admin, '/api/disciplines', 400, 'POST', { sportSlug: A, slug: 'sprints', name: 'Sprints', [field]: 'running' })).data.error, 'Unsupported group field.');
    await expect(admin, `/api/disciplines/${running.id}`, 400, 'PUT', { [field]: 'throwing' });
  }
  assert.equal(await prisma.discipline.count({ where: { sportSlug: A, slug: 'sprints' } }), 0);
  const model = fs.readFileSync('prisma/schema.prisma', 'utf8').match(/model Discipline \{[\s\S]*?\n\}/)![0].replace(/\/\/.*$/gm, '');
  assert(!/parent/i.test(model) && !/Discipline(\?|\[\])/.test(model.replace(/^model Discipline/, '')), 'the model has no field that points at another group');
  assert.match(model, /sport\s+Sport\s+@relation\(fields: \[sportSlug\]/, 'every group belongs directly to one sport');
  assert.equal((await prisma.discipline.findMany({ where: { sportSlug: { notIn: (await prisma.sport.findMany({ select: { slug: true } })).map((s) => s.slug) } } })).length, 0);
  // Messages people read say "group".
  for (const text of [(await expect(admin, '/api/disciplines', 409, 'POST', { sportSlug: A, slug: 'running', name: 'X' })).data.error, (await expect(admin, `/api/disciplines/${fixture}-none`, 404, 'PUT', { name: 'X' })).data.error, (await expect(editor, '/api/events', 400, 'POST', { name: 'X', slug: 'x-event', sportSlug: A, disciplineSlug: 'nope' })).data.error]) {
    assert(/group/i.test(text) && !/\bdisciplines?\b/i.test(text.replace(/disciplineSlug/g, '')), `message says group: ${text}`);
  }
  pass('two levels only: a group belongs directly to one sport, a group cannot be the parent of a group, no parent field is accepted or exists in the schema; API messages say "group"');

  // ── The parent sport ──
  assert.match((await expect(admin, `/api/sports/${sportB.id}`, 400, 'DELETE')).data.error, /group\(s\)/);
  const A2 = `${fixture}-track`;
  const moved = await expect(admin, `/api/sports/${sportA.id}`, 200, 'PUT', { slug: A2 });
  assert.equal(moved.data.slug, A2);
  assert.deepEqual((await prisma.discipline.findMany({ where: { id: running.id } })).map((d) => [d.sportSlug, d.slug]), [[A2, 'running']]);
  const after = await prisma.article.findUniqueOrThrow({ where: { id: mine.id } });
  assert.deepEqual([after.sportSlug, after.disciplineSlug], [A2, 'running']);
  assert.deepEqual((await prisma.sportEvent.findUniqueOrThrow({ where: { id: sprint.id } })).disciplineSlug, 'running');
  assert.equal(await page(`/${A2}/marathon/`), 200); assert.equal(await page(`/${A}/marathon/`), 301, 'the existing sport-rename redirects still work');
  pass('a sport with groups cannot be deleted; renaming the sport carries its groups and their assignments along and still writes the 301 redirects');

  void runningB; void road; void eventArticle;
  console.log(`PASS ${checks} discipline verification groups`);
} finally {
  child.kill();
  if (child.exitCode === null) await once(child, 'exit');
  // Exact fixture cleanup, children first. Never touches pre-existing content.
  const sportSlugs = (await prisma.sport.findMany({ where: { name: { startsWith: fixture } }, select: { slug: true, id: true } }));
  const slugs = sportSlugs.map((s) => s.slug);
  const fixtureArticles = (await prisma.article.findMany({ where: { sportSlug: { in: slugs } }, select: { id: true } })).map((a) => a.id);
  const fixtureEvents = (await prisma.sportEvent.findMany({ where: { sportSlug: { in: slugs } }, select: { id: true } })).map((e) => e.id);
  const fixtureDisciplines = (await prisma.discipline.findMany({ where: { sportSlug: { in: slugs } }, select: { id: true } })).map((d) => d.id);
  await prisma.article.deleteMany({ where: { id: { in: fixtureArticles } } });
  await prisma.sportEvent.deleteMany({ where: { id: { in: fixtureEvents } } });
  await prisma.discipline.deleteMany({ where: { id: { in: fixtureDisciplines } } });
  await prisma.mediaItem.deleteMany({ where: { id: `${fixture}-media` } });
  await prisma.sport.deleteMany({ where: { id: { in: sportSlugs.map((s) => s.id) } } });
  await prisma.redirectRule.deleteMany({ where: { OR: [{ sourceUrl: { startsWith: `/${fixture}` } }, { targetUrl: { startsWith: `/${fixture}` } }] } });
  await prisma.author.deleteMany({ where: { id: { in: Object.values(bylines) } } });
  await prisma.session.deleteMany({ where: { userId: { in: Object.values(ids) } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: Object.values(ids) } } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
  const afterAll = await snapshot();
  assert.deepEqual(afterAll, before, 'every sport, event, edition, article, author and redirect that existed before is unchanged');
  assert.equal(await prisma.discipline.count(), disciplinesBefore, 'no fixture discipline is left behind');
  assert.deepEqual({ events: await prisma.sportEvent.count({ where: { disciplineSlug: { not: null } } }), articles: await prisma.article.count({ where: { disciplineSlug: { not: null } } }) }, assignedBefore, 'no existing event or article was assigned a discipline');
  console.log(`PASS integrity: ${tables.length} tables unchanged row for row; ${assignedBefore.events} events and ${assignedBefore.articles} articles had a discipline before and after; fixtures removed.`);
  await prisma.$disconnect();
}
