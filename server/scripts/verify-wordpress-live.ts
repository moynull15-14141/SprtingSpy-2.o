/**
 * End-to-end test of the LIVE import mode, entirely on this machine.
 *
 * The "live site" is a CMS server started here against a disposable local
 * database (sportingspy_wp_pilot_livetest, recreated on every run as a copy of
 * the local development database). The live importer talks to it exactly as
 * it would to the real site: over HTTP, through the Admin API, with a signed-in
 * Admin. The populated pilot database is not touched, and every address the
 * importer contacts is recorded and must be this machine.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { NEW_SPORTS } from '../wordpressImport/decisions';
import { confirmationPhrase, openLiveSession, resolveLiveTarget, runLiveImport, runLiveRollback, verifyLive, LiveApi, LiveTargetError, LIVE_TARGETS } from '../wordpressImport/live';
import { recreateDisposableDatabase } from '../wordpressImport/localDb';
import { assertIsolated, deactivatePilotStaff, DestinationUnavailable, ensurePilotStaff, loadManifest, openPilotDb, startPilotServer, LoginError, PilotApi, PilotIsolationError, type Transport } from '../wordpressImport/pilot';
import { hashPassword } from '../password';

let checks = 0;
const pass = (name: string) => { checks++; console.log(`PASS ${name}`); };
const TEST_DB = 'sportingspy_wp_pilot_livetest';
const PORT = 3112;
const ORIGIN = `http://127.0.0.1:${PORT}`;

// ── Target allow-list (no network) ──
assert.deepEqual([...LIVE_TARGETS], ['https://sportingspy.com']);
assert.equal(resolveLiveTarget('https://sportingspy.com').local, false);
assert.equal(resolveLiveTarget('https://sportingspy.com/').origin, 'https://sportingspy.com');
for (const bad of ['http://sportingspy.com', 'https://www.sportingspy.com', 'https://sportingspy.com.evil.example', 'https://sprtingspy-2-o.onrender.com', 'https://sportingspy.com/admin', 'https://user:pw@sportingspy.com', 'https://sportingspy.com?x=1', ORIGIN, 'http://localhost:3000', 'https://127.0.0.1:3112', 'not a url', '']) {
  assert.throws(() => resolveLiveTarget(bad), LiveTargetError, `${bad} must not be a target`);
}
assert.throws(() => resolveLiveTarget('http://192.168.1.10:3112', { allowLocalTest: true }), LiveTargetError);
assert.throws(() => resolveLiveTarget('https://example.com', { allowLocalTest: true }), LiveTargetError);
const target = resolveLiveTarget(ORIGIN, { allowLocalTest: true });
assert.equal(target.local, true);
assert.equal(confirmationPhrase('IMPORT', 3, target), `IMPORT 3 POSTS INTO 127.0.0.1:${PORT}`);
assert.equal(confirmationPhrase('IMPORT', 1, resolveLiveTarget('https://sportingspy.com')), 'IMPORT 1 POST INTO sportingspy.com');
pass('target allow-list: only https://sportingspy.com, or this machine with the explicit test flag');

// ── The importer's own code never opens a database or reads an env file ──
for (const file of ['server/wordpressImport/live.ts', 'server/scripts/wordpress-live.ts']) {
  const source = fs.readFileSync(file, 'utf8');
  assert(!/from 'pg'|from '[^']*\/db'|dotenv|DATABASE_URL|generated\/prisma|MEDIA_S3|r2\.dev|onrender|aiven/i.test(source.replace(/^\s*(\/\/|\*).*$/gm, '')), `${file} must hold no database, storage or hosting access`);
}
pass('live mode source: no database driver, no env file, no storage or hosting address');

// ── A disposable local "live site" ──
fs.rmSync(target.dir, { recursive: true, force: true });
const env = await recreateDisposableDatabase({ name: TEST_DB, envFile: 'migration-inventory/livetest.env', port: PORT, mediaDir: 'migration-inventory/livetest-media', extraEnv: { TOTP_ENCRYPTION_KEY: crypto.randomBytes(30).toString('hex') } });
assertIsolated(env, 'live-mode test');
assert.equal(decodeURIComponent(new URL(env.DATABASE_URL).pathname.slice(1)), TEST_DB);
assert.throws(() => assertIsolated({ ...env, DATABASE_URL: env.DATABASE_URL.replace(TEST_DB, 'sportingspy') }, 'x'), PilotIsolationError);
await assert.rejects(recreateDisposableDatabase({ name: 'sportingspy_wp_pilot', envFile: 'migration-inventory/never.env', port: 3999, mediaDir: 'migration-inventory/never' }), /never recreated/);
await assert.rejects(recreateDisposableDatabase({ name: 'sportingspy', envFile: 'migration-inventory/never.env', port: 3999, mediaDir: 'migration-inventory/never' }), /not a disposable/);
assert(!fs.existsSync('migration-inventory/never.env'));
const db = await openPilotDb(env, 'live-mode test');
const one = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0];
const count = async (table: string) => (await one(`select count(*)::int as n from "${table}"`)).n as number;
const TABLES = ['Article', 'ArticleImport', 'MediaItem', 'FaqEntry', 'Author', 'Sport', 'SportEvent', 'EventEdition', 'RedirectRule', 'SiteSetting'];
const counts = async () => { const out: Record<string, number> = {}; for (const t of TABLES) out[t] = await count(t); return out; };
/** A fingerprint of everything that existed before the import. It must be identical afterwards. */
const existing = { articles: (await db.query('select id from "Article"')).rows.map((r) => r.id), sports: (await db.query('select id from "Sport"')).rows.map((r) => r.id), authors: (await db.query('select id from "Author"')).rows.map((r) => r.id), users: (await db.query('select id from "User"')).rows.map((r) => r.id), faq: (await db.query('select id from "FaqEntry"')).rows.map((r) => r.id), media: (await db.query('select id from "MediaItem"')).rows.map((r) => r.id) };
const fingerprint = async () => {
  const hash = async (table: string, ids: string[] | null, columns = 't') => (await one(`select coalesce(md5(string_agg(${columns}::text, '|' order by t.id)), '') as h from "${table}" t ${ids ? 'where t.id = any($1)' : ''}`, ids ? [ids] : [])).h;
  return { articles: await hash('Article', existing.articles), sports: await hash('Sport', existing.sports), authors: await hash('Author', existing.authors), users: await hash('User', existing.users), faq: await hash('FaqEntry', existing.faq), media: await hash('MediaItem', existing.media), redirects: await hash('RedirectRule', null), settings: (await one(`select coalesce(md5(string_agg(t::text, '|' order by t.key)), '') as h from "SiteSetting" t`)).h, events: await hash('SportEvent', null), editions: await hash('EventEdition', null) };
};
const before = await fingerprint();
const baseline = await counts();

const staff = await ensurePilotStaff(db);
await db.query(`insert into "User" (id, name, email, role, avatar, "joinedAt", "updatedAt", status, "passwordHash") values ('user-wp-livetest-editor', 'Live Test Editor', 'livetest-editor@pilot.invalid', 'Editor', '', now(), now(), 'active', $1)`, [hashPassword('Editor-pass-for-test-9a')]);
const server = await startPilotServer(env);
assert.equal(server.base, ORIGIN);

// Every request the live importer makes is recorded here; a fault can be injected to simulate a broken connection.
const contacted: string[] = [];
let fault: ((url: URL, init: RequestInit) => 'lose-answer' | 'fail-before' | Response | null) | null = null;
/** Lets a test hold an answer back until something else has happened. */
let beforeAnswer: ((url: URL, init: RequestInit) => Promise<void> | void) | null = null;
const transport: Transport = async (url, init) => {
  const u = new URL(url);
  contacted.push(u.host);
  const f = fault?.(u, init);
  if (f === 'fail-before') throw new Error('simulated: connection dropped before the request was sent');
  if (f instanceof Response) return f;
  const res = await fetch(url, init);
  await beforeAnswer?.(u, init);
  if (f === 'lose-answer') { await res.arrayBuffer(); throw new Error('simulated: connection dropped before the answer arrived'); }
  return res;
};
const totp = (secretB32: string, at = Date.now()) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = '';
  for (const c of secretB32.replace(/=+$/, '')) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const mac = crypto.createHmac('sha1', key).update(msg).digest(); const o = mac[mac.length - 1] & 0xf;
  return String((((mac[o] & 0x7f) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3]) % 1e6).padStart(6, '0');
};
const nextTotpStep = () => new Promise((r) => setTimeout(r, 30000 - (Date.now() % 30000) + 1200));

try {
  // ── Sign-in: password, role, two-factor ──
  await assert.rejects(openLiveSession(target, { email: staff[0].email, password: 'wrong-password' }, transport), LoginError);
  await assert.rejects(openLiveSession(target, { email: 'livetest-editor@pilot.invalid', password: 'Editor-pass-for-test-9a' }, transport), /needs an Admin/);
  const enrol = new PilotApi(ORIGIN);
  await enrol.login(staff[1]);
  const setup = await enrol.request('POST', '/api/auth/totp/setup', {});
  assert.equal(setup.status, 200);
  assert.equal((await enrol.request('POST', '/api/auth/totp/enable', { code: totp(setup.data.secret) })).status, 200);
  const needsCode = await openLiveSession(target, { email: staff[1].email, password: staff[1].password }, transport).then(() => null, (e) => e);
  assert(needsCode instanceof LoginError && needsCode.totpRequired, 'an account with two-factor authentication cannot sign in without its code');
  await assert.rejects(openLiveSession(target, { email: staff[1].email, password: staff[1].password, totpCode: '000000' }, transport), LoginError);
  await nextTotpStep(); // a code is accepted once; wait for the next one
  const twoFactor = await openLiveSession(target, { email: staff[1].email, password: staff[1].password, totpCode: totp(setup.data.secret) }, transport);
  assert.equal(twoFactor.admin, staff[1].name);
  await twoFactor.api.logout();
  pass('sign-in: wrong password and a non-Admin are refused; a two-factor account needs its current code and then signs in');

  const session = { target, ...(await openLiveSession(target, { email: staff[0].email, password: staff[0].password }, transport)) };
  const admin = new PilotApi(ORIGIN); // a second, ordinary staff session for test fixtures
  await admin.login(staff[0]);

  // ── Plan-only is the default and writes nothing ──
  const SMALL = ['1048', '1163', '3866'];
  const plan = await runLiveImport(session, { only: SMALL });
  assert.equal(plan.executed, false);
  assert.deepEqual([...plan.plan.wouldCreate].sort(), [...SMALL].sort());
  assert.deepEqual(plan.plan.entitiesToCreate, { sports: ['rodeo'], authorProfiles: ['jamie', 'sergio-j-bynum'] });
  assert.deepEqual(plan.plan.refused, []); assert.deepEqual(plan.plan.alreadyImported, []);
  assert.equal(plan.plan.confirmation, `IMPORT 3 POSTS INTO 127.0.0.1:${PORT}`);
  assert.deepEqual(await counts(), baseline, 'a plan changes nothing');
  await assert.rejects(session.api.request('POST', '/api/sports', { name: 'X', slug: 'x-sport' }), PilotIsolationError, 'the client itself refuses to write while plan-only');
  await assert.rejects(session.api.request('DELETE', `/api/articles/${existing.articles[0]}`), PilotIsolationError);
  await assert.rejects(runLiveImport(session, { only: ['999999'] }), /Not WordPress post IDs/);
  pass('plan-only by default: lists 3 posts, 1 hidden sport and 2 author profiles to create; nothing is written');

  // ── A separate confirmation is required ──
  await assert.rejects(runLiveImport(session, { only: SMALL, execute: true }), /Not confirmed/);
  await assert.rejects(runLiveImport(session, { only: SMALL, execute: true, confirm: 'yes' }), /Not confirmed/);
  await assert.rejects(runLiveImport(session, { only: SMALL, execute: true, confirm: 'IMPORT 3 POSTS INTO sportingspy.com' }), /Not confirmed/);
  await assert.rejects(runLiveImport(session, { only: SMALL, execute: true, confirm: `IMPORT 50 POSTS INTO 127.0.0.1:${PORT}` }), /Not confirmed/);
  assert.deepEqual(await counts(), baseline);
  pass('--execute alone, a wrong phrase, another site\'s phrase or another count are all refused; nothing is written');

  // ── A small confirmed import ──
  const lines: string[] = [];
  const done = await runLiveImport(session, { only: SMALL, execute: true, confirm: plan.plan.confirmation, batchSize: 2, onProgress: (l) => lines.push(l) });
  assert.equal(done.executed, true);
  assert.deepEqual([...done.import!.created].sort(), [...SMALL].sort()); assert.deepEqual(done.import!.refused, []);
  assert.deepEqual(done.entities!.sportsCreated, ['rodeo']);
  assert(done.verification!.ok, done.verification!.problems.join(' | '));
  assert.equal(done.verification!.checked, 3); assert.equal(done.verification!.drafts, 3); assert.equal(done.verification!.reviewRequired, 3); assert.equal(done.verification!.importRecords, 3); assert.equal(done.verification!.faq, 20);
  assert(lines.some((l) => /^Batch 1\/2/.test(l)) && lines.some((l) => /post 1163 created/.test(l)), 'progress is reported per post and per batch');
  assert.equal(session.api.readOnly, true, 'the client is read-only again after the run');
  const rodeo = await one(`select "isVisible", tagline, description from "Sport" where slug = 'rodeo'`);
  assert.equal(rodeo.isVisible, false, 'a new sport is created hidden'); assert.equal(rodeo.tagline, ''); assert.equal(rodeo.description, '');
  assert.equal(await session.api.pageStatus('/rodeo/'), 404, 'a hidden sport has no public page');
  assert.equal((await one(`select count(*)::int as n from "Sport" where slug = any($1)`, [NEW_SPORTS.map((s) => s.slug)])).n, 1, 'only the sport this batch needs is created');
  const profiles = (await db.query(`select slug, "roleTitle", "userId", email, avatar from "Author" where slug in ('jamie', 'sergio-j-bynum') order by slug`)).rows;
  assert.deepEqual(profiles, [{ slug: 'jamie', roleTitle: 'Contributor', userId: null, email: null, avatar: '' }, { slug: 'sergio-j-bynum', roleTitle: 'Contributor', userId: null, email: null, avatar: '' }]);
  const imported = (await db.query(`select a.status, a."reviewStatus", a."scheduledFor", i."sourceId", i.source, i."sourceTitle" = a.title as "sameTitle" from "Article" a join "ArticleImport" i on i."articleId" = a.id order by i."sourceId"`)).rows;
  assert.deepEqual(imported.map((r) => [r.sourceId, r.source, r.status, r.reviewStatus, r.scheduledFor, r.sameTitle]), [['1048', 'wordpress', 'draft', 'draft', null, true], ['1163', 'wordpress', 'draft', 'draft', null, true], ['3866', 'wordpress', 'draft', 'draft', null, true]]);
  const masters = await one(`select "eventSlug", "editionYear" from "Article" a join "ArticleImport" i on i."articleId" = a.id where i."sourceId" = '3866'`);
  assert.deepEqual(masters, { eventSlug: 'the-masters', editionYear: 2026 });
  const media = (await db.query('select "storageKey", "copyrightReview", url from "MediaItem" where id <> all($1)', [existing.media])).rows;
  assert(media.length >= 5 && media.every((m) => m.copyrightReview === 'pending' && m.url.startsWith('/media/') && fs.existsSync(path.join(env.MEDIA_LOCAL_DIR, m.storageKey))), 'media is in the local test folder only');
  const manifest = loadManifest(ORIGIN, path.join(target.dir, 'manifest.json'));
  assert.deepEqual(Object.keys(manifest.posts).sort(), [...SMALL].sort()); assert(Object.values(manifest.posts).every((p) => p.complete === true));
  assert(manifest.history.some((h) => h.includes(`run started by ${staff[0].name}: IMPORT 3 POSTS INTO`)), 'the manifest records who ran what');
  assert(!JSON.stringify(manifest).includes(staff[0].password) && !JSON.stringify(manifest).includes(staff[0].email), 'no credentials in the manifest');
  pass('confirmed import of 3 posts: drafts with review required, import records, hidden sport, unlinked profiles, edition link, local media, audited manifest');

  // ── Re-run: nothing twice ──
  const afterFirst = await counts();
  const again = await runLiveImport(session, { only: SMALL });
  assert.deepEqual(again.plan.wouldCreate, []); assert.deepEqual([...again.plan.alreadyImported].sort(), [...SMALL].sort()); assert.equal(again.plan.confirmation, `IMPORT 0 POSTS INTO 127.0.0.1:${PORT}`);
  assert.equal((await runLiveImport(session, { only: SMALL, execute: true, confirm: again.plan.confirmation })).executed, false);
  assert.deepEqual(await counts(), afterFirst);
  const dup = await admin.request('POST', '/api/articles', { title: 'Second copy', slug: 'second-copy-of-1163', sportSlug: 'tennis', articleType: 'Event Guide', content: 'x', authorId: existing.authors[0], requireReview: true, importSource: { source: 'wordpress', sourceId: '1163' } });
  assert.equal(dup.status, 409, 'the CMS itself refuses a second import of the same WordPress ID');
  pass('duplicate re-run: 0 to create, 3 already imported; the CMS refuses a second article for the same WordPress ID');

  // ── An occupied address is never overwritten ──
  const occupied = await admin.request('POST', '/api/articles', { title: 'An unrelated article', slug: 'bnp-paribas-nordic-open-tennis-2025', sportSlug: 'tennis', articleType: 'Event Guide', content: 'Written in the CMS, not imported.', authorId: existing.authors[0] });
  assert.equal(occupied.status, 201);
  const blocked = await runLiveImport(session, { only: ['105'] });
  assert.deepEqual(blocked.plan.wouldCreate, []); assert.equal(blocked.plan.refused.length, 1); assert.match(blocked.plan.refused[0].reason, /did not create already uses/);
  assert.equal((await runLiveImport(session, { only: ['105'], execute: true, confirm: blocked.plan.confirmation })).executed, false);
  const still = await one('select title, content, to_char("updatedAt", \'YYYY-MM-DD HH24:MI:SS.MS\') as stamp from "Article" where id = $1', [occupied.data.id]);
  assert.equal(still.title, 'An unrelated article'); assert.equal(still.content, 'Written in the CMS, not imported.');
  assert.equal(await count('ArticleImport'), 3);
  pass('an address already used by another article is refused and that article is left exactly as it was');

  // ── Failure after the server stored the article (answer lost) → the next run adopts it ──
  fault = (u, init) => (init.method === 'POST' && u.pathname === '/api/articles' ? 'lose-answer' : null);
  const p240 = await runLiveImport(session, { only: ['240'] });
  await assert.rejects(runLiveImport(session, { only: ['240'], execute: true, confirm: p240.plan.confirmation }), /simulated/);
  fault = null;
  assert.equal(session.api.readOnly, true, 'a failed run leaves the client read-only');
  assert.equal((await one(`select count(*)::int as n from "ArticleImport" where "sourceId" = '240'`)).n, 1, 'the article was stored although the answer was lost');
  assert.equal(loadManifest(ORIGIN, path.join(target.dir, 'manifest.json')).posts['240'], undefined);
  const resume240 = await runLiveImport(session, { only: ['240'] });
  assert.deepEqual(resume240.plan.toResume, ['240']); assert.deepEqual(resume240.plan.wouldCreate, []);
  const adopted = await runLiveImport(session, { only: ['240'], execute: true, confirm: resume240.plan.confirmation });
  assert.deepEqual(adopted.import!.resumed, ['240']); assert.deepEqual(adopted.import!.created, []); assert(adopted.verification!.ok, adopted.verification!.problems.join(' | '));
  assert.equal((await one(`select count(*)::int as n from "Article" where slug = 'koori-rugby-league-knockout-carnival'`)).n, 1, 'no second article was created');
  pass('lost answer: the half-recorded article is recognised by its import record, adopted and completed, not duplicated');

  // ── Failure between the article and its FAQ entries → the next run resumes ──
  fault = (u, init) => (init.method === 'POST' && u.pathname === '/api/faq/import' ? 'fail-before' : null);
  const p1186 = await runLiveImport(session, { only: ['1186'] });
  await assert.rejects(runLiveImport(session, { only: ['1186'], execute: true, confirm: p1186.plan.confirmation }), /simulated/);
  fault = null;
  const half = loadManifest(ORIGIN, path.join(target.dir, 'manifest.json')).posts['1186'];
  assert.equal(half.complete, false); assert.equal((await one('select count(*)::int as n from "FaqEntry" where "articleId" = $1', [half.articleId])).n, 0);
  const mediaBeforeResume = await count('MediaItem');
  const resume1186 = await runLiveImport(session, { only: ['1186'] });
  assert.deepEqual(resume1186.plan.toResume, ['1186']);
  const resumed = await runLiveImport(session, { only: ['1186'], execute: true, confirm: resume1186.plan.confirmation });
  assert.deepEqual(resumed.import!.resumed, ['1186']); assert.equal(resumed.import!.media.uploaded, 0);
  assert.equal((await one('select count(*)::int as n from "FaqEntry" where "articleId" = $1 and status = \'draft\'', [half.articleId])).n, 8);
  assert.equal(await count('MediaItem'), mediaBeforeResume, 'no image is uploaded twice');
  assert.equal(loadManifest(ORIGIN, path.join(target.dir, 'manifest.json')).posts['1186'].complete, true);
  pass('interrupted before the FAQ entries: the next run resumes that post, adds the 8 entries once and uploads nothing again');

  // ── Review restrictions and everything that existed before ──
  const verified = await verifyLive(session);
  assert(verified.ok, verified.problems.join(' | ')); assert.equal(verified.checked, 5); assert.equal(verified.drafts, 5); assert.equal(verified.reviewRequired, 5); assert.equal(verified.published, 0); assert.equal(verified.scheduled, 0); assert.equal(verified.workflowProbed, true);
  for (const id of Object.values(loadManifest(ORIGIN, path.join(target.dir, 'manifest.json')).posts).map((p) => p.articleId)) {
    assert.equal((await admin.request('PUT', `/api/articles/${id}`, { status: 'published' })).status, 409);
    assert.equal((await admin.request('POST', `/api/articles/${id}/review-decision`, { decision: 'approve', version: 0 })).status, 409, 'nothing is approved before it is submitted');
  }
  assert.deepEqual(await fingerprint(), before, 'every article, user, setting, FAQ entry, redirect, sport, event and edition that existed before is byte-for-byte unchanged');
  pass('5 imports are drafts with review required; publishing and scheduling are refused; all pre-existing content is unchanged');

  // ── Rollback: plan first, exact phrase, untouched drafts only ──
  const edited = loadManifest(ORIGIN, path.join(target.dir, 'manifest.json')).posts['3866'].articleId;
  assert.equal((await admin.request('PUT', `/api/articles/${edited}`, { subtitle: 'Edited by a reviewer' })).status, 200);
  const rollPlan = await runLiveRollback(session);
  assert.equal(rollPlan.executed, false); assert.equal(rollPlan.wouldRemove.length, 5); assert.equal(rollPlan.confirmation, `ROLLBACK 5 POSTS FROM 127.0.0.1:${PORT}`);
  assert.equal(await count('ArticleImport'), 5, 'a rollback plan removes nothing');
  await assert.rejects(runLiveRollback(session, { execute: true, confirm: 'ROLLBACK' }), /Not confirmed/);
  const rolled = await runLiveRollback(session, { execute: true, confirm: rollPlan.confirmation });
  assert.deepEqual([...rolled.report!.removedArticles].sort(), ['1048', '1163', '1186', '240']);
  assert.deepEqual(rolled.report!.kept.map((k) => [k.id, k.reason]), [['3866', 'Edited since the import.']]);
  assert.deepEqual(rolled.report!.removedSports, ['rodeo'], 'the hidden sport is removed once nothing belongs to it');
  assert.equal(rolled.report!.keptAuthors.length, 2, 'author profiles are kept: the CMS has no way to delete them and this mode has no database access');
  assert.equal(await count('ArticleImport'), 1); assert.equal((await one('select count(*)::int as n from "Article" where id = $1', [edited])).n, 1);
  assert.equal((await one('select count(*)::int as n from "Article" where id = $1', [occupied.data.id])).n, 1, 'the unrelated article is still there');
  assert.deepEqual(await fingerprint(), before, 'pre-existing content is unchanged after the rollback too');
  pass('rollback: plan-only by default, exact phrase required, 4 untouched drafts removed, the edited draft and every other article kept');

  // ── Stop rule: a failed readiness check during a batch stops the run before its next write ──
  // While the image of the first post (22) is being stored, the site's readiness answers 503.
  const STOPPED = ['22', '59'];
  const stopPlan = await runLiveImport(session, { only: STOPPED });
  assert.deepEqual([...stopPlan.plan.wouldCreate].sort(), STOPPED); assert.deepEqual(stopPlan.plan.refused, []);
  const beforeStop = await counts();
  const sent: string[] = [];
  let sick = false; let sawNotReady: () => void = () => undefined;
  const notReadySeen = new Promise<void>((resolve) => { sawNotReady = resolve; });
  let writesWhenSeen = -1;
  const writes = () => sent.filter((r) => !r.startsWith('GET ')).length;
  fault = (u, init) => {
    const method = String(init.method ?? 'GET').toUpperCase();
    sent.push(`${method} ${u.pathname}`);
    if (method === 'POST' && u.pathname === '/api/media/upload') sick = true;
    if (sick && u.pathname === '/api/health/ready') { if (writesWhenSeen < 0) writesWhenSeen = writes(); sawNotReady(); return new Response(JSON.stringify({ status: 'not_ready', checks: { database: 'fail', storage: 'ok' } }), { status: 503, headers: { 'Content-Type': 'application/json' } }); }
    return null;
  };
  // The upload that is already on its way finishes; its answer is held until the monitor has seen the 503.
  beforeAnswer = async (u, init) => { if (init.method === 'POST' && u.pathname === '/api/media/upload') await notReadySeen; };
  const stopLines: string[] = [];
  const stopped = await runLiveImport(session, { only: STOPPED, execute: true, confirm: stopPlan.plan.confirmation, healthCheckSeconds: 0.05, onProgress: (l) => stopLines.push(l) }).then(() => null, (e) => e);
  fault = null; beforeAnswer = null;
  assert(stopped instanceof DestinationUnavailable, `the run must stop with DestinationUnavailable (got ${stopped})`);
  assert.match(stopped.message, /readiness check .* answered HTTP 503 \(application: database fail, storage ok\)\. The run stopped before creating the article of post 22. /);
  assert(stopLines.some((l) => l.startsWith('STOP SIGNAL: ')), 'the stop signal is reported as soon as it is raised');
  assert.equal(writesWhenSeen, 1, 'the 503 arrived while the first image upload was on its way');
  assert.deepEqual(sent.filter((r) => !r.startsWith('GET ')), ['POST /api/media/upload'], 'after the 503 no further image, article or FAQ request was started');
  assert.equal(session.api.readOnly, true); assert.equal(session.api.onAnswer, null, 'the monitor is switched off after the run');
  const stoppedManifest = loadManifest(ORIGIN, path.join(target.dir, 'manifest.json'));
  assert.equal(stoppedManifest.posts['22'], undefined); assert.equal(stoppedManifest.posts['59'], undefined);
  assert(stoppedManifest.history.some((h) => /run stopped: The readiness check/.test(h)), 'the manifest records why the run stopped');
  const afterStop = await counts();
  assert.deepEqual({ ...afterStop, MediaItem: 0 }, { ...beforeStop, MediaItem: 0 }, 'no article, import record or FAQ entry was written');
  assert.equal(afterStop.MediaItem, beforeStop.MediaItem + 1, 'only the image that was already being stored exists');
  // The next run picks up where it stopped: nothing twice.
  const afterStopPlan = await runLiveImport(session, { only: STOPPED });
  assert.deepEqual([...afterStopPlan.plan.wouldCreate].sort(), STOPPED);
  const recovered = await runLiveImport(session, { only: STOPPED, execute: true, confirm: afterStopPlan.plan.confirmation, healthCheckSeconds: 0.05 });
  assert.deepEqual([...recovered.import!.created].sort(), STOPPED); assert.deepEqual(recovered.import!.refused, []);
  assert.deepEqual(recovered.import!.media, { uploaded: 2, reused: 1 }, 'the image stored before the stop is reused, not uploaded again');
  assert(recovered.verification!.ok, recovered.verification!.problems.join(' | '));
  assert.equal(await count('MediaItem'), beforeStop.MediaItem + 3); assert.equal(await count('ArticleImport'), beforeStop.ArticleImport + 2);
  pass('stop rule: readiness 503 during a batch stops the run before the article is created; no image, article or FAQ request follows; the next run completes both posts and reuses the stored image');

  // ── Stop rule: a 5xx answer to any importer request stops the run before the next post ──
  const AFTER_5XX = ['130', '2702'];
  const fivePlan = await runLiveImport(session, { only: AFTER_5XX });
  assert.deepEqual([...fivePlan.plan.wouldCreate].sort(), AFTER_5XX);
  let failedOnce = false; const sentAfter: string[] = [];
  fault = (u, init) => {
    const method = String(init.method ?? 'GET').toUpperCase();
    if (failedOnce && method !== 'GET') sentAfter.push(`${method} ${u.pathname}`);
    // The read-back of post 130's stored article answers 502 once (a gateway error); nothing is lost by it.
    if (!failedOnce && method === 'GET' && /^\/api\/articles\/art-[^/]+$/.test(u.pathname)) { failedOnce = true; return new Response('Bad Gateway', { status: 502 }); }
    return null;
  };
  const five = await runLiveImport(session, { only: AFTER_5XX, execute: true, confirm: fivePlan.plan.confirmation }).then(() => null, (e) => e);
  fault = null;
  assert(five instanceof DestinationUnavailable, `a 5xx answer must stop the run (got ${five})`);
  assert.match(five.message, /^\/api\/articles\/art-[^ ]+ answered HTTP 502 at .*The run stopped before post 2702\./);
  assert.deepEqual(sentAfter, [], 'no write was started after the 502');
  assert.equal((await one(`select count(*)::int as n from "ArticleImport" where "sourceId" = '2702'`)).n, 0);
  const fiveAgain = await runLiveImport(session, { only: AFTER_5XX });
  assert.deepEqual(fiveAgain.plan.wouldCreate, ['2702']); assert.equal(fiveAgain.plan.toResume.length + fiveAgain.plan.alreadyImported.length, 1);
  const fiveDone = await runLiveImport(session, { only: AFTER_5XX, execute: true, confirm: fiveAgain.plan.confirmation });
  assert.deepEqual(fiveDone.import!.created, ['2702']); assert(fiveDone.verification!.ok, fiveDone.verification!.problems.join(' | '));
  assert.equal((await one(`select count(*)::int as n from "ArticleImport" where "sourceId" = any($1)`, [AFTER_5XX])).n, 2, 'each post exists exactly once');
  pass('stop rule: a 502 answer stops the run before the next post; the next run finishes without repeating the completed post');

  // ── Where the importer's requests went ──
  const hosts = [...new Set([...contacted, ...session.api.contacted])];
  assert.deepEqual(hosts, [`127.0.0.1:${PORT}`], `every request of the live importer went to the local test server (${contacted.length} requests)`);
  assert(!/aivencloud|r2\.dev|r2\.cloudflarestorage|onrender|sportingspy\.com/i.test(JSON.stringify(Object.entries(env).filter(([k]) => k !== 'PATH'))), 'the test server\'s environment names no hosted database, bucket or site');
  assert.match(server.log(), /environment: development, media storage: local\)/);
  pass(`network: ${contacted.length} importer requests, all to 127.0.0.1:${PORT}; the test server ran on a local database with local media and no outbound settings`);
  await session.api.logout();
} finally {
  await server.stop();
  await deactivatePilotStaff(db).catch(() => undefined);
  await db.end();
}
console.log(`WordPress live-mode verification passed: ${checks} checks (target: local test server on ${TEST_DB}).`);
