/**
 * PHASE N verification — migration sheet and legacy URL safety, against a
 * local production-mode server and the local development database, with
 * disposable fixtures; pre-existing rows are verified unchanged afterwards.
 *
 * Covers: old/new URL host validation (cross-domain mistakes), homepage
 * query URLs refused, chains/loops/retired targets detected inside the sheet
 * before anything is applied, KEEP with an unchanged URL must be live, the
 * dry run performs no writes and reports every outcome, apply gives one
 * direct 301, an edited applied row is UPDATED (never a silent mismatch),
 * RETIRE is an error while a redirect still serves the URL and a real 404
 * once it is removed, inactive rules are reported, redirect CSV backup,
 * structured apply audit, and unmapped WordPress-style URLs return real 404s.
 *
 * Run: npm run build && npm run test:phase-n  (stop other app instances first)
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

assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe, 'Phase N requires a local development database.');
assert(fs.existsSync('.next/BUILD_ID'), 'Build before Phase N verification (npm run build).');

const fx = `n${crypto.randomUUID().slice(0, 6)}`;
const sport = `${fx}-sport`;
const eventSlug = `${fx}-open`;
const password = `Phase-N-${crypto.randomUUID()}`;
const ids = { admin: `${fx}-admin`, editor: `${fx}-editor`, author: `${fx}-author-profile` };
const digest = (rows: unknown) => crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const snapshot = async () => ({
  sports: digest(await prisma.sport.findMany({ where: { NOT: { slug: sport } }, orderBy: { id: 'asc' } })),
  events: digest(await prisma.sportEvent.findMany({ where: { NOT: { sportSlug: sport } }, orderBy: { id: 'asc' } })),
  articles: digest(await prisma.article.findMany({ where: { NOT: { sportSlug: sport } }, orderBy: { id: 'asc' }, select: { id: true, status: true, slug: true, updatedAt: true } })),
  redirects: digest(await prisma.redirectRule.findMany({ where: { NOT: { OR: [{ sourceUrl: { contains: fx } }, { targetUrl: { contains: fx } }] } }, orderBy: { id: 'asc' } })),
  migration: digest(await prisma.migrationItem.findMany({ where: { NOT: { oldUrl: { contains: fx } } }, orderBy: { id: 'asc' }, select: { id: true, oldUrl: true, decision: true, newUrl: true, redirectId: true } })),
});
const before = await snapshot();

const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = (probe.address() as { port: number }).port; await new Promise<void>((resolve) => probe.close(() => resolve()));
const base = `http://localhost:${port}`;
let output = '';
const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
  cwd: process.cwd(), windowsHide: true,
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', TRUST_PROXY: 'false', NODE_ENV: 'production', APP_ENV: 'production', AUTH_MODE: 'production', DEV_LOGIN_BYPASS: 'false', ALLOWED_ORIGIN: base, SITE_ORIGIN: base, INDEXNOW_ENDPOINT: '', GEMINI_API_KEY: '', TOTP_ENCRYPTION_KEY: `phase-n-test-key-${crypto.randomUUID()}`, RESEND_API_KEY: '', MAIL_FROM: '', LEGACY_SITE_HOSTS: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (c) => { output += c; }); child.stderr.on('data', (c) => { output += c; });

let checks = 0; const pass = (m: string) => { checks++; console.log(`PASS ${m}`); };
class Client {
  cookies = new Map<string, string>();
  async request(path: string, method = 'GET', body?: unknown) {
    const headers: Record<string, string> = { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') };
    let payload: BodyInit | undefined;
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    if (method !== 'GET') headers['x-csrf-token'] = this.cookies.get('csrf_token') ?? '';
    const res = await fetch(base + path, { method, headers, redirect: 'manual', body: payload });
    for (const raw of res.headers.getSetCookie()) { const [pair] = raw.split(';'); const i = pair.indexOf('='); const v = pair.slice(i + 1); if (v) this.cookies.set(pair.slice(0, i), v); else this.cookies.delete(pair.slice(0, i)); }
    const text = await res.text(); let data: any; try { data = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, text, data, location: res.headers.get('location'), headers: res.headers };
  }
  async ok(path: string, method = 'GET', body?: unknown, expected = [200, 201]) {
    const r = await this.request(path, method, body);
    assert(expected.includes(r.status), `${method} ${path}: HTTP ${r.status} ${r.text.slice(0, 400)}`);
    return r.data;
  }
}
const anon = new Client();
const login = async (email: string) => { const c = new Client(); await c.request('/robots.txt'); const r = await c.request('/api/auth/login', 'POST', { email, password }); assert.equal(r.status, 200, r.text); return c; };
const header = 'Old URL,Old Category,Old Title,Decision,New Category,New Title,New URL';
const old = (name: string) => `/old-${fx}-${name}`;
let completed = false;

try {
  await new Promise<void>((resolve, reject) => { const t = setTimeout(() => reject(new Error(`server did not start: ${output.slice(-800)}`)), 90_000); child.stdout.on('data', (c) => { if (String(c).includes('Server running')) { clearTimeout(t); resolve(); } }); child.once('exit', () => { clearTimeout(t); reject(new Error(`server exited: ${output.slice(-800)}`)); }); });
  await anon.request('/robots.txt');

  // ── Fixtures: one sport/event/edition with two published articles ──
  for (const [id, role] of [[ids.admin, 'Admin'], [ids.editor, 'Editor']] as const) {
    await prisma.user.create({ data: { id, name: `N ${role}`, email: `${id}@example.test`, role, avatar: '', joinedAt: new Date(), passwordHash: hashPassword(password) } });
  }
  await prisma.author.create({ data: { id: ids.author, slug: ids.author, name: 'N Fixture Author', roleTitle: 'Reporter', bio: 'Fixture author.', avatar: '/favicon.ico', userId: ids.admin } });
  const admin = await login(`${ids.admin}@example.test`);
  const editor = await login(`${ids.editor}@example.test`);
  await admin.ok('/api/sports', 'POST', { name: 'N Fixture Sport', slug: sport, tagline: 'Fixture', description: 'Fixture sport for Phase N verification.' });
  await admin.ok('/api/events', 'POST', { name: 'N Fixture Open', slug: eventSlug, sportSlug: sport, shortName: 'N Open', description: 'A fixture event.', seo: {} });
  await admin.ok('/api/editions', 'POST', { eventSlug, sportSlug: sport, year: 2028, title: 'N Fixture Open 2028', status: 'upcoming', description: 'The 2028 edition of the fixture event.', seo: {} });
  const body = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `${t}. ${'Useful fixture detail for readers of this guide. '.repeat(30)}` }] }] });
  for (const slug of ['schedule', 'results']) {
    await admin.ok('/api/articles', 'POST', { title: `N Fixture Open 2028 ${slug}`, slug, sportSlug: sport, eventSlug, editionYear: 2028, articleType: 'News', excerpt: `The ${slug} of N Fixture Open 2028.`, body: body(slug), authorId: ids.author, status: 'published', seo: {} });
  }
  const pathA = `/${sport}/${eventSlug}/2028/schedule`;
  const pathB = `/${sport}/${eventSlug}/2028/results`;
  assert.equal((await anon.request(`${pathA}/`)).status, 200);
  const rowsFor = async () => ((await admin.ok('/api/migration')).rows as any[]).filter((r) => r.oldUrl.includes(fx));
  const row = async (oldUrl: string) => (await rowsFor()).find((r) => r.oldUrl === oldUrl);

  // ── 1. Host and query validation (nothing imported when a row is wrong) ──
  const foreign = await admin.request('/api/migration/import', 'POST', { csv: [header, `https://evil.example.com/old-${fx}-x/,News,X,MERGE,,,${pathA}`].join('\n') });
  assert.equal(foreign.status, 400); assert.match(foreign.data.errors[0].error, /not this site/);
  const query = await admin.request('/api/migration/import', 'POST', { csv: [header, `/?p=${fx},News,X,MERGE,,,${pathA}`].join('\n') });
  assert.equal(query.status, 400); assert.match(query.data.errors[0].error, /query string/);
  const foreignNew = await admin.request('/api/migration/import', 'POST', { csv: [header, `${old('y')},News,Y,MERGE,,,https://evil.example.com${pathA}/`].join('\n') });
  assert.equal(foreignNew.status, 400, 'a New URL on another host is refused');
  assert.equal((await rowsFor()).length, 0, 'a rejected import writes nothing');
  await admin.ok('/api/migration/import', 'POST', { csv: [header, `${base}${old('abs')}/,News,Absolute,REWRITE,,,${base}${pathA}/`].join('\n') });
  assert.equal((await row(old('abs'))).newUrl, pathA, 'absolute URLs on this site are stored as paths');
  pass('Import: cross-domain Old/New URLs and homepage query URLs (/?p=…) refused with nothing written; same-site absolute URLs stored as paths');

  // ── 2. Chains, loops and retired targets inside the sheet; KEEP same URL must be live ──
  await admin.ok('/api/migration/import', 'POST', { csv: [header,
    `${old('a')},News,A,MERGE,,,${old('b')}`,
    `${old('b')},News,B,REWRITE,,,${pathA}`,
    `${old('l1')},News,L1,MERGE,,,${old('l2')}`,
    `${old('l2')},News,L2,MERGE,,,${old('l1')}`,
    `${old('r')},News,R,MERGE,,,${old('ret')}`,
    `${old('ret')},News,Retired,RETIRE,,,`,
    `${old('same')},News,Same,KEEP,,,${old('same')}`,
    `${pathA},News,Already new,KEEP,,,${pathA}`,
    `${old('undecided')},News,Later,,,,`,
  ].join('\n') });
  assert.match((await row(old('a'))).validation.problems.join(' '), /itself an Old URL in this sheet/, 'chain inside the sheet');
  assert.equal((await row(old('b'))).checkStatus, 'ok');
  assert.match((await row(old('l1'))).validation.problems.join(' '), /loop/, 'loop inside the sheet');
  assert.match((await row(old('r'))).validation.problems.join(' '), /RETIRED in this sheet/);
  assert.match((await row(old('same'))).validation.problems.join(' '), /not a live page/, 'KEEP with an unchanged URL that does not exist');
  assert.equal((await row(pathA)).checkStatus, 'ok'); assert.equal((await row(pathA)).validation.action, 'none');
  pass('Validation: chains, loops and retired targets inside the sheet detected before anything is applied; KEEP-same-URL must be a live page');

  // ── 3. Inactive rule at a source is reported (would otherwise fail at write time) ──
  const manual = await admin.ok('/api/redirects', 'POST', { sourceUrl: old('c'), targetUrl: `${pathB}/` });
  await admin.ok(`/api/redirects/${manual.id}`, 'PUT', { isActive: false });
  await admin.ok('/api/migration/import', 'POST', { csv: [header, `${old('c')},News,C,REWRITE,,,${pathA}`].join('\n') });
  assert.match((await row(old('c'))).validation.problems.join(' '), /inactive redirect rule/);
  pass('Validation: an inactive rule for the same Old URL is reported instead of failing the whole apply');

  // ── 4. Dry run: no writes, every outcome reported ──
  const rulesBefore = await prisma.redirectRule.count();
  const dry = await admin.ok('/api/migration/apply', 'POST', { dryRun: true });
  assert.equal(await prisma.redirectRule.count(), rulesBefore, 'dry run writes no redirect');
  assert.equal(await prisma.migrationItem.count({ where: { oldUrl: { contains: fx }, NOT: { redirectId: null } } }), 0, 'dry run links no row');
  assert.deepEqual(dry.redirects.map((r: any) => r.from).sort(), [old('abs'), old('b')].sort());
  assert(dry.redirects.every((r: any) => r.change === 'create'));
  assert.equal(dry.summary.retire, 1); assert.equal(dry.summary.unchanged, 1); assert.equal(dry.summary.undecided, 1);
  assert(dry.summary.errors >= 6 && dry.errors.some((e: any) => e.from === old('a')));
  assert.deepEqual(dry.retire, [old('ret')]); assert.deepEqual(dry.conflicts, []);
  assert.equal((await editor.request('/api/migration/apply', 'POST', { dryRun: true })).status, 403, 'apply is Admin-only');
  pass('Dry run: real redirect checks inside a rolled-back transaction; no writes; reports create/update/retire/unchanged/undecided/errors/conflicts');

  // ── 5. Apply: one direct 301 per row; chain fixed by pointing at the final URL ──
  const fixed = await row(old('a'));
  await admin.ok(`/api/migration/${fixed.id}`, 'PUT', { newUrl: `${pathA}/` });
  assert.equal((await row(old('a'))).checkStatus, 'ok');
  const applied = await admin.ok('/api/migration/apply', 'POST', { dryRun: false }, [201]);
  assert.equal(applied.created, 3); assert.equal(applied.updated, 0);
  for (const name of ['a', 'b', 'abs']) {
    const r = await anon.request(`${old(name)}/`);
    assert.equal(r.status, 301); assert.equal(new URL(r.location!, base).pathname, `${pathA}/`);
    assert.equal((await anon.request(new URL(r.location!, base).pathname)).status, 200, 'one hop reaches a live page');
  }
  const audit = await prisma.auditLog.findFirst({ where: { action: 'Applied Migration Redirects' }, orderBy: { timestamp: 'desc' } });
  assert((audit?.after as any)?.created?.some((x: string) => x.startsWith(old('b'))), 'apply audit lists the redirects');
  pass('Apply: direct single-hop 301s to live pages; structured audit of the applied redirects');

  // ── 6. Editing an applied row updates its redirect (no silent mismatch) ──
  const b = await row(old('b'));
  await admin.ok(`/api/migration/${b.id}`, 'PUT', { newUrl: pathB });
  const bAfter = await row(old('b'));
  assert.equal(bAfter.validation.applied, false); assert.equal(bAfter.validation.appliedTo, pathA);
  assert.match((await admin.request('/api/migration/export')).text, new RegExp(`${old('b')},[^\\n]*,${pathB}/,no`), 'export does not claim the stale redirect');
  const dry2 = await admin.ok('/api/migration/apply', 'POST', { dryRun: true });
  assert.deepEqual(dry2.redirects.map((r: any) => [r.from, r.change]), [[old('b'), 'update']]);
  const applied2 = await admin.ok('/api/migration/apply', 'POST', { dryRun: false }, [201]);
  assert.equal(applied2.updated, 1); assert.equal(applied2.created, 0);
  const rb = await anon.request(`${old('b')}/`);
  assert.equal(new URL(rb.location!, base).pathname, `${pathB}/`);
  assert.equal(await prisma.redirectRule.count({ where: { sourceUrl: old('b') } }), 1, 'still one rule per source');
  assert.equal((await row(old('b'))).validation.applied, true);
  pass('Edited row: shown as not applied (with its current target), dry run plans an update, apply updates the same rule');

  // ── 7. RETIRE after apply: error while the URL still redirects; real 404 once removed ──
  const a = await row(old('a'));
  await admin.ok(`/api/migration/${a.id}`, 'PUT', { decision: 'RETIRE', newUrl: '' });
  const aRetired = await row(old('a'));
  assert.equal(aRetired.checkStatus, 'error'); assert.match(aRetired.validation.problems.join(' '), /still sends/);
  assert.equal((await anon.request(`${old('a')}/`)).status, 301, 'the sheet does not silently remove redirects');
  await admin.ok(`/api/redirects/${a.redirectId}`, 'PUT', { isActive: false });
  await admin.ok('/api/migration/validate', 'POST', {});
  assert.equal((await row(old('a'))).checkStatus, 'ok');
  const gone = await anon.request(`${old('a')}/`);
  assert.equal(gone.status, 404, 'retired URL is a real 404');
  assert(!(await anon.request('/sitemaps/pages.xml')).text.includes(old('a')), 'retired URL not in the sitemap');
  const dry3 = await admin.ok('/api/migration/apply', 'POST', { dryRun: true });
  assert(!dry3.redirects.some((r: any) => r.from === old('a')), 'a retired row is never re-applied');
  pass('RETIRE: error while any active rule still redirects the URL; after deactivation a real 404, not re-applied');

  // ── 8. Redirect backup export ──
  const exp = await admin.request('/api/redirects/export');
  assert.equal(exp.status, 200); assert.match(exp.headers.get('content-type') ?? '', /text\/csv/);
  assert(exp.text.startsWith('Source URL,Target URL,Status,Active,Origin,Notes,Created,Updated,Id'));
  assert(exp.text.includes(`${old('b')},${pathB},301,yes,migration`) && exp.text.includes(`${old('a')},${pathA},301,no,migration`), 'active and inactive rules exported');
  assert.equal((await editor.request('/api/redirects/export')).status, 403);
  assert([401, 403].includes((await anon.request('/api/redirects/export')).status));
  assert(await prisma.auditLog.findFirst({ where: { action: 'Exported Redirects', userId: ids.admin } }), 'export audited');
  pass('Redirect backup: Admin-only CSV of every rule (active and inactive), audited');

  // ── 9. Unmapped WordPress-style legacy URLs are real 404s (no soft 404, no homepage dump) ──
  for (const p of [`/category/${fx}/`, `/tag/${fx}/`, `/${fx}-post/feed/`, `/author/${fx}/`, `/page/2/`, `/${fx}-post/`]) {
    const r = await anon.request(p);
    assert.equal(r.status, 404, `${p} → ${r.status}`);
    assert(!/<meta name="robots" content="index/.test(r.text), `${p} is not indexable`);
  }
  pass('Unmapped legacy URLs (category, tag, feed, author, pagination, post) return real non-indexable 404s');

  completed = true;
} finally {
  child.kill();
  await prisma.migrationItem.deleteMany({ where: { oldUrl: { contains: fx } } });
  await prisma.redirectRule.deleteMany({ where: { OR: [{ sourceUrl: { contains: fx } }, { targetUrl: { contains: fx } }] } });
  await prisma.article.deleteMany({ where: { sportSlug: sport } });
  await prisma.eventEdition.deleteMany({ where: { sportSlug: sport } });
  await prisma.sportEvent.deleteMany({ where: { sportSlug: sport } });
  await prisma.sport.deleteMany({ where: { slug: sport } });
  await prisma.session.deleteMany({ where: { userId: { in: [ids.admin, ids.editor] } } });
  await prisma.author.deleteMany({ where: { id: ids.author } });
  await prisma.user.deleteMany({ where: { id: { in: [ids.admin, ids.editor] } } });
  assert.deepEqual(await snapshot(), before, 'Pre-existing rows changed.');
  console.log(completed ? `\nPhase N verification: ${checks} groups passed, 0 failed.` : `\nPhase N verification FAILED after ${checks} group(s).`);
  await prisma.$disconnect();
  if (!completed) process.exitCode = 1;
}
