/** PHASE A verification (launch configuration: reader accounts + comments OFF).
 * Starts a production-mode server on a free port, uses UUID-scoped fixtures,
 * cleans up only those fixtures, then compares every pre-existing row and
 * protected file. Requires a current frontend build and a local database.
 * Run: npm run test:phase-a
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { prisma } from '../db';
import { checkDatabaseUrlIsLocalDev } from '../dbSafety';
import { hashPassword, verifyPassword } from '../password';
import { ARTICLE_TYPES, EDITION_STATUSES } from '../../src/types';

assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe, 'Verification requires a local, non-production database.');
assert(fs.existsSync('.next/BUILD_ID'), 'Run npm run build first.');

const fixture = `phasea-${crypto.randomUUID()}`;
const password = `Test-${crypto.randomUUID()}`;
const ids = { admin: `${fixture}-admin`, editor: `${fixture}-editor`, reader: `${fixture}-reader` };
const userIds = Object.values(ids);
const authorId = `${fixture}-author`;
const redirectId = `${fixture}-redirect`;
const readerSessionId = crypto.randomBytes(32).toString('hex');
const createdArticleIds: string[] = [];
const createdEventIds: string[] = [];
const createdEditionIds: string[] = [];
// Files that must stay byte-identical, where still present (both were moved to the project archive).
const protectedFiles = ['data/db.json', 'PROJECT_BRAIN.md'].filter((file) => fs.existsSync(file));
const digest = (value: string | Buffer) => crypto.createHash('sha256').update(value).digest('hex');
const filesBefore = protectedFiles.map((file) => digest(fs.readFileSync(file)));
const tables = ['sport', 'sportEvent', 'eventEdition', 'article', 'author', 'user', 'session', 'comment', 'mediaItem', 'adSlotConfig', 'redirectRule', 'auditLog'] as const;
async function snapshot() {
  const result: Record<string, { count: number; hash: string }> = {};
  for (const table of tables) {
    const rows = await (prisma[table] as any).findMany({ orderBy: { id: 'asc' } });
    result[table] = { count: rows.length, hash: digest(JSON.stringify(rows)) };
  }
  return result;
}
const before = await snapshot();

const probe = createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = (probe.address() as { port: number }).port;
await new Promise<void>((resolve) => probe.close(() => resolve()));
const base = `http://localhost:${port}`;
const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
  cwd: process.cwd(),
  windowsHide: true,
  env: {
    ...process.env, PORT: String(port), HOST: '127.0.0.1', TRUST_PROXY: 'false', NODE_ENV: 'production', APP_ENV: 'production', AUTH_MODE: 'production',
    DEV_LOGIN_BYPASS: 'false', ALLOWED_ORIGIN: base, ENABLE_READER_ACCOUNTS: 'false', ENABLE_COMMENTS: 'false',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
child.stdout.on('data', (chunk) => { serverOutput += chunk; });
child.stderr.on('data', (chunk) => { serverOutput += chunk; });

let checks = 0;
const tested = (message: string) => { checks++; console.log(`PASS ${message}`); };

class Client {
  cookies = new Map<string, string>();
  async request(route: string, method = 'GET', body?: unknown, extra: Record<string, string> = {}, csrf: 'valid' | 'missing' = 'valid') {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '), ...extra };
    if (method !== 'GET' && method !== 'HEAD' && csrf === 'valid') headers['x-csrf-token'] = this.cookies.get('csrf_token') || '';
    const response = await fetch(base + route, { method, headers, redirect: 'manual', body: body === undefined ? undefined : JSON.stringify(body) });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const index = pair.indexOf('=');
      this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    const text = await response.text();
    let data: any;
    try { data = JSON.parse(text); } catch { data = null; }
    return { status: response.status, headers: response.headers, data, text };
  }
  async login(email: string, pw = password) {
    await this.request('/api/auth/me'); // issues the CSRF cookie
    return this.request('/api/auth/login', 'POST', { email, password: pw });
  }
}
async function status(client: Client, route: string, expected: number, method = 'GET', body?: unknown, extra: Record<string, string> = {}, csrf: 'valid' | 'missing' = 'valid') {
  const result = await client.request(route, method, body, extra, csrf);
  assert.equal(result.status, expected, `${method} ${route}: expected ${expected}, got ${result.status} ${result.text.slice(0, 200)}`);
  return result;
}
async function redirectsTo(client: Client, route: string, location: string) {
  const result = await status(client, route, 301);
  assert.equal(result.headers.get('location'), location, `${route} should 301 to ${location}`);
  // Exactly one hop: the target itself must answer 200.
  await status(client, location, 200);
}

try {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Test server did not start.')), 20_000);
    child.stdout.on('data', (chunk) => { if (String(chunk).includes('Server running')) { clearTimeout(timeout); resolve(); } });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error('Test server exited before startup.')); });
  });

  for (const [key, role] of [['admin', 'Admin'], ['editor', 'Editor'], ['reader', 'Reader']] as const) {
    await prisma.user.create({ data: {
      id: ids[key], name: `Phase A ${role}`, email: `${ids[key]}@example.test`, role,
      avatar: '/favicon.ico', joinedAt: new Date(), passwordHash: hashPassword(password),
    } });
  }
  await prisma.author.create({ data: { id: authorId, userId: ids.editor, slug: fixture, name: 'Phase A Byline', roleTitle: 'Correspondent', bio: 'Test biography', avatar: '/favicon.ico' } });
  // A pre-existing Reader session, as created before reader accounts were disabled.
  await prisma.session.create({ data: { id: readerSessionId, userId: ids.reader, createdAt: new Date(), expiresAt: new Date(Date.now() + 3_600_000) } });

  const anon = new Client();
  const admin = new Client();
  const editor = new Client();
  await anon.request('/api/health');
  assert.equal((await admin.login(`${ids.admin}@example.test`)).status, 200);
  assert.equal((await editor.login(`${ids.editor}@example.test`)).status, 200);

  // ── 1. Static page URLs + trailing-slash policy ──
  await redirectsTo(anon, '/privacy', '/privacy-policy/');
  await redirectsTo(anon, '/privacy/', '/privacy-policy/');
  await redirectsTo(anon, '/privacy-policy', '/privacy-policy/');
  await redirectsTo(anon, '/terms', '/terms-and-conditions/');
  await redirectsTo(anon, '/terms/', '/terms-and-conditions/');
  await redirectsTo(anon, '/terms-and-conditions', '/terms-and-conditions/');
  const legacyWithQuery = await status(anon, '/privacy?ref=footer', 301);
  assert.equal(legacyWithQuery.headers.get('location'), '/privacy-policy/?ref=footer');
  tested('legacy /privacy and /terms (with and without slash) 301 in one hop to /privacy-policy/ and /terms-and-conditions/, query preserved');

  const sport = await prisma.sport.findFirstOrThrow({ where: { isVisible: true }, orderBy: { order: 'asc' } });
  const edition = await prisma.eventEdition.findFirstOrThrow({ orderBy: { id: 'asc' } });
  const article = await prisma.article.findFirstOrThrow({ where: { status: 'published', eventSlug: { not: null }, editionYear: { not: null } }, orderBy: { id: 'asc' } });
  const general = await prisma.article.findFirst({ where: { status: 'published', eventSlug: null }, orderBy: { id: 'asc' } });
  const pagePaths = [
    '/sports', '/events', '/latest', '/search', '/about', '/contact', '/dmca', '/admin', '/account',
    `/${sport.slug}`,
    `/${edition.sportSlug}/${edition.eventSlug}`,
    `/${edition.sportSlug}/${edition.eventSlug}/${edition.year}`,
    `/${article.sportSlug}/${article.eventSlug}/${article.editionYear}/${article.slug}`,
    ...(general ? [`/${general.sportSlug}/${general.slug}`] : []),
  ];
  for (const path of pagePaths) await redirectsTo(anon, path, `${path}/`);
  await status(anon, '/', 200);
  const withQuery = await status(anon, '/search?q=tennis', 301);
  assert.equal(withQuery.headers.get('location'), '/search/?q=tennis');
  const head = await anon.request(`/${sport.slug}`, 'HEAD');
  assert.equal(head.status, 301);
  tested(`trailing-slash policy: ${pagePaths.length} representative page URLs 301 once to the slash form (GET and HEAD), slash form 200, query preserved`);

  // Exceptions: API, files, sitemap, robots, non-GET methods.
  // PHASE H: /api/articles is staff-only (Spec §2.2: no public API) — still never redirected.
  await status(anon, '/api/articles', 401);
  const apiArticles = await status(editor, '/api/articles', 200);
  assert(Array.isArray(apiArticles.data));
  await status(anon, '/api/health', 200);
  await status(editor, '/api/articles/', 200);
  await status(anon, '/api/does-not-exist', 404);
  const sitemap = await status(anon, '/sitemap.xml', 200);
  assert(sitemap.headers.get('content-type')?.includes('application/xml'));
  const robots = await status(anon, '/robots.txt', 200);
  assert(robots.text.includes('Sitemap:'));
  await status(anon, '/assets/not-found.js', 404);
  await status(anon, '/favicon-missing.png', 404);
  await status(anon, '/api/auth/login', 400, 'POST', {});
  await status(anon, '/api/auth/login/', 400, 'POST', {});
  tested('trailing-slash exceptions: /api (GET and POST), sitemap.xml, robots.txt and static files are never redirected');

  // Phase D upgrades the root sitemap to a sitemap index. Resolve its child
  // files before asserting Phase A's canonical-page invariant.
  const sitemapLocs = [...sitemap.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
  const sitemapBodies = sitemap.text.includes('<sitemapindex')
    ? await Promise.all(sitemapLocs.map(async (path) => (await status(anon, path, 200)).text))
    : [sitemap.text];
  const locs = sitemapBodies.flatMap((xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname));
  assert(locs.length > 0 && locs.every((p) => p.endsWith('/')), 'every sitemap URL is canonical (trailing slash)');
  assert(locs.includes('/privacy-policy/') && locs.includes('/terms-and-conditions/'));
  assert(!locs.includes('/privacy/') && !locs.includes('/terms/'));
  tested(`sitemap: all ${locs.length} URLs use the trailing-slash canonical form and the new static page URLs`);

  await prisma.redirectRule.create({ data: { id: redirectId, sourceUrl: `/${fixture}-old`, targetUrl: `/${sport.slug}`, statusCode: 301, createdAt: new Date(), isActive: true } });
  await redirectsTo(anon, `/${fixture}-old`, `/${sport.slug}/`);
  await redirectsTo(anon, `/${fixture}-old/`, `/${sport.slug}/`);
  tested('editor-managed redirect rules resolve to the canonical target in a single hop (no slash-policy chain)');

  // ── 2. Article type + social metadata ──
  assert(ARTICLE_TYPES.includes('Sports Viewing Guide') && ARTICLE_TYPES.includes('How to Watch'));
  assert.equal(ARTICLE_TYPES.length, 20);
  const databaseTypes = (await status(editor, '/api/article-types', 200)).data;
  assert(databaseTypes.some((t: any) => t.name === 'How to Watch' && t.isActive));
  assert(databaseTypes.some((t: any) => t.name === 'Sports Viewing Guide' && t.isActive));
  // PHASE B: public data is server-rendered HTML; the CMS dataset is staff-only.
  const publicData = (await status(admin, '/api/cms/data', 200)).data;
  const published = publicData.articles.filter((a: any) => a.status === 'published');
  assert(published.some((a: any) => a.articleType === 'How to Watch'));
  assert(publicData.articles.every((a: any) => databaseTypes.some((t: any) => t.name === a.articleType)));
  const howToWatch = published.find((a: any) => a.articleType === 'How to Watch');
  const howToWatchHtml = (await status(anon, `/${howToWatch.sportSlug}/${howToWatch.eventSlug}/${howToWatch.editionYear}/${howToWatch.slug}/`, 200)).text;
  assert(howToWatchHtml.includes('How to Watch') && !howToWatchHtml.includes('Sports Viewing Guide'));
  const byType = await status(editor, `/api/articles?type=${encodeURIComponent('How to Watch')}`, 200);
  assert(byType.data.length >= 1 && byType.data.every((a: any) => a.articleType === 'How to Watch'));
  tested('article type: both viewing types exist as separate database rows; migrated How to Watch article remains served and filterable');

  const articleBase = { title: `${fixture} How to Watch`, sportSlug: edition.sportSlug, eventSlug: edition.eventSlug, editionYear: edition.year, content: 'Broadcasters and streams.', authorId, status: 'draft' };
  const viewing = await status(editor, '/api/articles', 201, 'POST', { ...articleBase, slug: `${fixture}-viewing`, articleType: 'Sports Viewing Guide' });
  createdArticleIds.push(viewing.data.id);
  await status(editor, '/api/articles', 400, 'POST', { ...articleBase, slug: `${fixture}-a`, articleType: 'Streaming Guide' });
  await status(editor, '/api/articles', 400, 'POST', { ...articleBase, slug: `${fixture}-a`, articleType: 'How to Watch', seo: { ogImage: 'javascript:alert(1)' } });
  await status(editor, '/api/articles', 400, 'POST', { ...articleBase, slug: `${fixture}-a`, articleType: 'How to Watch', seo: { ogTitle: 'x'.repeat(201) } });
  await status(editor, '/api/articles', 400, 'POST', { ...articleBase, slug: `${fixture}-a`, articleType: 'How to Watch', seo: { twitterSite: '@x' } });
  await status(editor, '/api/articles', 400, 'POST', { ...articleBase, slug: `${fixture}-a`, articleType: 'How to Watch', seo: 'not-an-object' });
  const social = { metaTitle: 'Meta', metaDescription: 'Meta description', ogTitle: 'Share title', ogDescription: 'Share description', ogImage: 'https://example.com/share.jpg' };
  const created = await status(editor, '/api/articles', 201, 'POST', { ...articleBase, slug: `${fixture}-a`, articleType: 'How to Watch', seo: social });
  createdArticleIds.push(created.data.id);
  assert.equal(created.data.articleType, 'How to Watch');
  assert.deepEqual(created.data.seo, social);
  const plain = await status(editor, '/api/articles', 201, 'POST', { ...articleBase, slug: `${fixture}-b`, articleType: 'News' });
  createdArticleIds.push(plain.data.id);
  await status(editor, `/api/articles/${plain.data.id}`, 200, 'PUT', { articleType: 'Sports Viewing Guide' });
  await status(editor, `/api/articles/${created.data.id}`, 400, 'PUT', { articleType: '' });
  await status(editor, `/api/articles/${created.data.id}`, 400, 'PUT', { seo: { ...social, ogImage: 'data:text/html,x' } });
  const updated = await status(editor, `/api/articles/${created.data.id}`, 200, 'PUT', { seo: { ...social, ogTitle: 'Updated share title' } });
  assert.equal(updated.data.seo.ogTitle, 'Updated share title');
  const stored = await prisma.article.findUniqueOrThrow({ where: { id: created.data.id } });
  assert.equal((stored.seo as any).ogDescription, 'Share description');
  tested('article API: both viewing types accepted, unknown type rejected; social metadata validated, saved and updated');

  // ── 3. Event fields ──
  const eventBase = { name: `${fixture} Open`, sportSlug: sport.slug, description: 'Fixture event.' };
  await status(editor, '/api/events', 400, 'POST', { ...eventBase, slug: `${fixture}-e`, officialSourceUrl: 'javascript:alert(1)' });
  await status(editor, '/api/events', 400, 'POST', { ...eventBase, slug: `${fixture}-e`, officialSourceUrl: '/relative/path' });
  await status(editor, '/api/events', 400, 'POST', { ...eventBase, slug: `${fixture}-e`, officialSourceUrl: 'not a url' });
  await status(editor, '/api/events', 400, 'POST', { ...eventBase, slug: `${fixture}-e`, eventType: 'x'.repeat(81) });
  await status(editor, '/api/events', 400, 'POST', { ...eventBase, slug: `${fixture}-e`, eventType: 42 });
  const event = await status(editor, '/api/events', 201, 'POST', { ...eventBase, slug: `${fixture}-e`, officialSourceUrl: 'https://www.example.com/official', eventType: 'Grand Slam' });
  createdEventIds.push(event.data.id);
  assert.equal(event.data.officialSourceUrl, 'https://www.example.com/official');
  assert.equal(event.data.eventType, 'Grand Slam');
  const noExtras = await status(editor, '/api/events', 201, 'POST', { ...eventBase, name: `${fixture} Cup`, slug: `${fixture}-f` });
  createdEventIds.push(noExtras.data.id);
  assert.equal(noExtras.data.officialSourceUrl, null);
  assert.equal(noExtras.data.eventType, null);
  await status(editor, `/api/events/${event.data.id}`, 400, 'PUT', { officialSourceUrl: 'ftp://example.com' });
  await status(editor, `/api/events/${event.data.id}`, 400, 'PUT', { seo: { unknownKey: true } });
  const evUpdated = await status(editor, `/api/events/${event.data.id}`, 200, 'PUT', { eventType: 'Major', officialSourceUrl: 'https://example.org/' });
  assert.equal(evUpdated.data.eventType, 'Major');
  const evCleared = await status(editor, `/api/events/${event.data.id}`, 200, 'PUT', { eventType: '', officialSourceUrl: '' });
  assert.equal(evCleared.data.eventType, null);
  assert.equal(evCleared.data.officialSourceUrl, null);
  await status(anon, '/api/events', 401, 'POST', { ...eventBase, slug: `${fixture}-g` });
  tested('event API: officialSourceUrl (absolute http/https only) and eventType (≤80 chars) validated server-side, created, updated and cleared');

  // ── 4. Edition status ──
  assert.deepEqual([...EDITION_STATUSES], ['upcoming', 'active', 'completed', 'archived']);
  const dbStatuses = await prisma.$queryRawUnsafe<{ v: string }[]>(`SELECT unnest(enum_range(NULL::"EditionStatus"))::text AS v`);
  assert.deepEqual(dbStatuses.map((r) => r.v), ['upcoming', 'active', 'completed', 'archived']);
  assert.equal((await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(*)::int AS n FROM "EventEdition" WHERE status::text = 'ongoing'`))[0].n, 0);
  const editionBase = { sportSlug: sport.slug, eventSlug: `${fixture}-e`, title: `${fixture} Edition`, description: 'Fixture edition.' };
  await status(editor, '/api/editions', 400, 'POST', { ...editionBase, year: 2031, status: 'ongoing' });
  await status(editor, '/api/editions', 400, 'POST', { ...editionBase, year: 2031, status: 'live' });
  for (const [i, st] of EDITION_STATUSES.entries()) {
    const ed = await status(editor, '/api/editions', 201, 'POST', { ...editionBase, year: 2031 + i, status: st });
    createdEditionIds.push(ed.data.id);
    assert.equal(ed.data.status, st);
  }
  await status(editor, `/api/editions/${createdEditionIds[0]}`, 400, 'PUT', { status: 'ongoing' });
  for (const st of EDITION_STATUSES) {
    assert.equal((await status(editor, `/api/editions/${createdEditionIds[0]}`, 200, 'PUT', { status: st })).data.status, st);
  }
  const afterData = (await status(admin, '/api/cms/data', 200)).data;
  assert(afterData.editions.some((e: any) => e.id === createdEditionIds[3] && e.status === 'archived'));
  assert((await status(anon, `/${sport.slug}/${fixture}-e/2034/`, 200)).text.includes('ARCHIVED'));
  tested('edition status: DB enum is exactly upcoming/active/completed/archived; "ongoing" rejected; create and update work for all four');

  // ── 5. Launch feature flags ──
  assert.deepEqual(publicData.features, { readerAccounts: false, comments: false });
  assert.deepEqual(publicData.comments, []);
  const adminData = publicData;
  const approvedComment = await prisma.comment.findFirst({ where: { status: 'approved' } });
  if (approvedComment) {
    const commentArticle = await prisma.article.findUniqueOrThrow({ where: { id: approvedComment.articleId } });
    if (commentArticle.status === 'published' && commentArticle.eventSlug && commentArticle.editionYear) {
      const html = (await status(anon, `/${commentArticle.sportSlug}/${commentArticle.eventSlug}/${commentArticle.editionYear}/${commentArticle.slug}/`, 200)).text;
      assert(!html.includes('comments-heading') && !html.includes(approvedComment.content.slice(0, 40)), 'no comments in public HTML');
    }
  }
  assert.equal(await prisma.comment.count(), before.comment.count, 'stored comments preserved');
  const commentTarget = publicData.articles[0].id;
  await status(admin, '/api/comments', 404, 'POST', { articleId: commentTarget, content: 'Should be blocked' });
  await status(admin, '/api/comments', 404, 'POST', { articleId: commentTarget, content: 'Forged flag' }, { 'x-enable-comments': 'true', 'x-features': '{"comments":true}' });
  const someComment = await prisma.comment.findFirst();
  if (someComment) {
    await status(admin, `/api/comments/${someComment.id}`, 404, 'PUT', { status: 'rejected' });
    await status(admin, `/api/comments/${someComment.id}`, 404, 'DELETE', {});
  }
  tested('comments OFF: none served (public or Admin), creation/moderation APIs 404 even with forged client flags, stored comments preserved');

  const readerLogin = new Client();
  const readerResult = await readerLogin.login(`${ids.reader}@example.test`);
  assert.equal(readerResult.status, 401);
  assert.equal(readerResult.data.error, 'Invalid email or password.');
  const oldReader = new Client();
  oldReader.cookies.set('sid', readerSessionId);
  await status(oldReader, '/api/auth/me', 401);
  await status(oldReader, '/api/auth/sessions', 401);
  assert(await prisma.session.findUnique({ where: { id: readerSessionId } }), 'existing Reader session row preserved');
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: ids.reader } })).role, 'Reader');
  await status(admin, '/api/users', 400, 'POST', { name: 'New Reader', email: `${fixture}-new@example.test`, role: 'Reader', password });
  await status(admin, `/api/users/${ids.editor}/role`, 400, 'PUT', { role: 'Reader' });
  // No registration route exists; /api/auth/* sits behind the auth wall (401) or 404s.
  const register = await anon.request('/api/auth/register', 'POST', { name: 'Reader', email: `${fixture}-reg@example.test`, password });
  assert([401, 404].includes(register.status), `register must not be accepted, got ${register.status}`);
  assert.equal(await prisma.user.count({ where: { email: `${fixture}-reg@example.test` } }), 0);
  tested('reader accounts OFF: Reader login fails like a bad password, existing Reader sessions stop authenticating (rows kept), Reader role cannot be granted, no registration endpoint');

  const adminMe = await status(admin, '/api/auth/me', 200);
  assert.equal(adminMe.data.user.role, 'Admin');
  await status(admin, '/api/auth/sessions', 200);
  const editorMe = await status(editor, '/api/auth/me', 200);
  assert.equal(editorMe.data.user.role, 'Editor');
  const logs = await status(admin, '/api/audit-logs', 200);
  assert(logs.data.some((l: any) => l.userId === ids.editor && l.action === 'Created Article'));
  assert(adminData.users.some((u: any) => u.id === ids.admin));
  await status(anon, '/admin/', 200);
  tested('staff unaffected: Admin/Editor login, account/session APIs, CMS writes, user directory and audit logs work');

  // ── 6. Security regression ──
  await status(anon, '/api/users', 401, 'POST', { name: 'x', email: 'x@example.test', role: 'Admin', password });
  await status(anon, '/api/audit-logs', 401, 'GET', undefined, { 'x-user-id': ids.admin, 'x-user-role': 'Admin' });
  const forged = await anon.request('/api/auth/me', 'GET', undefined, { 'x-user-id': ids.admin, 'x-user-role': 'Admin' });
  assert.equal(forged.status, 401);
  await status(editor, '/api/users', 403, 'POST', { name: 'x', email: `${fixture}-y@example.test`, role: 'Admin', password });
  await status(editor, '/api/articles', 403, 'POST', { ...articleBase, slug: `${fixture}-c`, articleType: 'News' }, {}, 'missing');
  const hostile = await editor.request('/api/articles', 'POST', { ...articleBase, slug: `${fixture}-d`, articleType: 'News' }, { Origin: 'https://evil.example' });
  assert(hostile.status === 403, `hostile origin mutation must fail, got ${hostile.status}`);
  const headers = (await anon.request('/', 'GET')).headers;
  assert(headers.get('content-security-policy') && headers.get('x-content-type-options') === 'nosniff');
  for (const payload of [publicData, adminData]) assert(!JSON.stringify(payload).includes('passwordHash'));
  assert(verifyPassword(password, (await prisma.user.findUniqueOrThrow({ where: { id: ids.admin } })).passwordHash));
  assert(!serverOutput.includes(password));
  tested('security: forged role headers, missing CSRF, hostile origin and Editor privilege escalation rejected; headers present; no password hashes in API output or logs');

  // ── 7. Optional real-browser UI checks (set PLAYWRIGHT_MODULE) ──
  if (process.env.PLAYWRIGHT_MODULE) {
    const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
    const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'chrome', headless: true });
    try {
      const page = await browser.newPage();
      const pageErrors: string[] = [];
      page.on('pageerror', (error: Error) => pageErrors.push(String(error)));
      const articlePath = `/${article.sportSlug}/${article.eventSlug}/${article.editionYear}/${article.slug}`;
      await page.goto(base + articlePath);
      await page.locator('article h1').first().waitFor();
      assert.equal(new URL(page.url()).pathname, `${articlePath}/`);
      assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), `${base}${articlePath}/`);
      assert.equal(await page.locator('#comments-heading').count(), 0);
      await page.locator('footer a', { hasText: /privacy/i }).first().click();
      await page.waitForURL((url: URL) => url.pathname === '/privacy-policy/');
      assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), `${base}/privacy-policy/`);
      await page.locator('footer a', { hasText: /terms/i }).first().click();
      await page.waitForURL((url: URL) => url.pathname === '/terms-and-conditions/');
      tested('browser: canonical trailing-slash URLs and canonical tags, no public comments section, footer links reach the new static URLs');

      await page.goto(`${base}/account/`);
      await page.getByRole('heading', { name: 'Staff account', exact: true }).waitFor();
      assert.equal(await page.locator('input[type="password"]').count(), 0);
      await page.goto(`${base}/admin/`);
      await page.getByRole('heading', { name: 'Staff Sign In Required', exact: true }).waitFor();
      await page.getByPlaceholder('Email').fill(`${ids.admin}@example.test`);
      await page.getByPlaceholder('Password').fill(password);
      await page.getByRole('button', { name: 'Sign In', exact: true }).click();
      await page.getByRole('heading', { name: 'Content Management System', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: /^Comments/ }).count(), 0, 'no Comments tab in the CMS');
      assert.equal(await page.getByText('Pending Review', { exact: true }).count(), 0);

      await page.getByRole('button', { name: 'Articles', exact: true }).click();
      await page.getByRole('button', { name: '+ Create New Article' }).click();
      assert.equal(await page.locator('select option[value="How to Watch"]').count(), 1);
      assert.equal(await page.locator('select option[value="Sports Viewing Guide"]').count(), 1);
      await page.getByText('Social Metadata', { exact: true }).waitFor();
      await page.getByText('Social Metadata', { exact: true }).click();
      for (const label of ['Social Title', 'Social Image URL', 'Social Description']) await page.getByText(label, { exact: true }).waitFor();

      await page.getByRole('button', { name: 'Events & Editions', exact: true }).click();
      await page.getByRole('button', { name: '+ New Permanent Event' }).click();
      await page.getByText('Event Type', { exact: true }).waitFor();
      await page.getByText('Official Website / Source', { exact: true }).waitFor();
      await page.locator('button', { hasText: 'Staged Editions' }).click();
      await page.getByRole('button', { name: '+ Stage Yearly Edition' }).click();
      for (const value of ['upcoming', 'active', 'completed', 'archived']) {
        assert(await page.locator(`select option[value="${value}"]`).count() >= 1, `edition status option ${value}`);
      }
      assert.equal(await page.locator('select option[value="ongoing"]').count(), 0);
      assert.deepEqual(pageErrors, []);
      tested('browser: /account has no public sign-in; CMS shows How to Watch, Social Metadata, Event Type/Official Source, four edition statuses, no Comments tab; no runtime errors');
    } finally {
      await browser.close();
    }
  } else console.log('SKIP browser checks: PLAYWRIGHT_MODULE not provided.');

  console.log(`PASS ${checks} Phase A verification groups`);
} finally {
  child.kill();
  if (child.exitCode === null) await once(child, 'exit');
  // Exact, generated fixture IDs only. Never remove pre-existing content.
  await prisma.article.deleteMany({ where: { id: { in: createdArticleIds }, authorId } });
  await prisma.eventEdition.deleteMany({ where: { id: { in: createdEditionIds }, eventSlug: `${fixture}-e` } });
  await prisma.sportEvent.deleteMany({ where: { id: { in: createdEventIds }, slug: { startsWith: fixture } } });
  await prisma.redirectRule.deleteMany({ where: { id: redirectId } });
  await prisma.author.deleteMany({ where: { id: authorId, userId: ids.editor } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  const after = await snapshot();
  assert.deepEqual(after, before, 'Pre-existing database rows changed!');
  assert.deepEqual(protectedFiles.map((file) => digest(fs.readFileSync(file))), filesBefore);
  console.log('PASS database integrity: all 12 table counts and full-row hashes unchanged; protected files unchanged; fixtures removed.');
  await prisma.$disconnect();
}
