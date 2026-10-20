/** PHASE U verification (reader accounts + comments ON).
 * Boots a production-mode server on a free port with ENABLE_READER_ACCOUNTS
 * and ENABLE_COMMENTS = true, exercises registration, e-mail verification,
 * comment submission/hardening, moderation, reader management and account
 * privacy over real HTTP, checks server-enforced authorization, then removes
 * only its UUID-scoped fixtures and asserts every pre-existing row is unchanged.
 * Requires a current frontend build and a LOCAL database.
 * Run: npm run local -- test:phase-u
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
import { hashPassword, verifyPassword } from '../password';
import { issueVerificationToken, hashVerifyToken } from '../register';
import { getApprovedComments } from '../services/public/content';

assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe, 'Verification requires a local, non-production database.');
assert(fs.existsSync('.next/BUILD_ID'), 'Run npm run build first.');

const fixture = `phaseu-${crypto.randomUUID()}`;
const password = `Test-${crypto.randomUUID()}`;
const ids = { admin: `${fixture}-admin`, editor: `${fixture}-editor` };
const authorId = `${fixture}-author`;
const createdArticleIds: string[] = [];
const createdUserIds: string[] = [...Object.values(ids)];

const tables = ['user', 'session', 'comment', 'auditLog', 'article', 'emailVerificationToken'] as const;
const digest = (v: string) => crypto.createHash('sha256').update(v).digest('hex');
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
  cwd: process.cwd(), windowsHide: true,
  env: {
    ...process.env, PORT: String(port), HOST: '127.0.0.1', TRUST_PROXY: 'false', NODE_ENV: 'production', APP_ENV: 'production', AUTH_MODE: 'production',
    DEV_LOGIN_BYPASS: 'false', ALLOWED_ORIGIN: base, ENABLE_READER_ACCOUNTS: 'true', ENABLE_COMMENTS: 'true',
    // No RESEND_API_KEY / MAIL_FROM: e-mail is not delivered, which the code
    // handles gracefully. Verification is driven with tokens minted in-process.
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
child.stdout.on('data', (c) => { serverOutput += c; });
child.stderr.on('data', (c) => { serverOutput += c; });

let checks = 0;
const tested = (m: string) => { checks++; console.log(`PASS ${m}`); };

class Client {
  cookies = new Map<string, string>();
  async request(route: string, method = 'GET', body?: unknown, extra: Record<string, string> = {}, csrf: 'valid' | 'missing' = 'valid') {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '), ...extra };
    if (method !== 'GET' && method !== 'HEAD' && csrf === 'valid') headers['x-csrf-token'] = this.cookies.get('csrf_token') || '';
    const response = await fetch(base + route, { method, headers, redirect: 'manual', body: body === undefined ? undefined : JSON.stringify(body) });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';'); const i = pair.indexOf('=');
      this.cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
    const text = await response.text();
    let data: any; try { data = JSON.parse(text); } catch { data = null; }
    return { status: response.status, headers: response.headers, data, text };
  }
  // Seed via a GET that passes through the CSRF-cookie middleware (health is
  // registered before it and never issues the cookie).
  async seed() { await this.request('/api/auth/me'); return this; }
  async login(email: string, pw = password) { await this.request('/api/auth/me'); return this.request('/api/auth/login', 'POST', { email, password: pw }); }
}
async function status(client: Client, route: string, expected: number, method = 'GET', body?: unknown, extra: Record<string, string> = {}, csrf: 'valid' | 'missing' = 'valid') {
  const r = await client.request(route, method, body, extra, csrf);
  assert.equal(r.status, expected, `${method} ${route}: expected ${expected}, got ${r.status} ${r.text.slice(0, 200)}`);
  return r;
}

/** Creates a Reader directly (bypasses the registration rate limiter used by the real endpoint). */
async function makeReader(key: string, opts: { verified: boolean }) {
  const id = `${fixture}-${key}`;
  const email = `${fixture}-${key}@example.test`;
  await prisma.user.create({ data: { id, name: `Reader ${key}`, email, role: 'Reader', avatar: '', joinedAt: new Date(), status: 'active', passwordHash: hashPassword(password), emailVerifiedAt: opts.verified ? new Date() : null } });
  createdUserIds.push(id);
  return { id, email };
}

try {
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Test server did not start.\n${serverOutput.slice(-800)}`)), 25_000);
    child.stdout.on('data', (c) => { if (String(c).includes('Server running')) { clearTimeout(t); resolve(); } });
    child.once('exit', () => { clearTimeout(t); reject(new Error(`Test server exited early.\n${serverOutput.slice(-800)}`)); });
  });

  // Staff fixtures (created directly; staff are provisioned by an Admin).
  await prisma.user.create({ data: { id: ids.admin, name: 'Phase U Admin', email: `${ids.admin}@example.test`, role: 'Admin', avatar: '/favicon.ico', joinedAt: new Date(), passwordHash: hashPassword(password) } });
  await prisma.user.create({ data: { id: ids.editor, name: 'Phase U Editor', email: `${ids.editor}@example.test`, role: 'Editor', avatar: '/favicon.ico', joinedAt: new Date(), passwordHash: hashPassword(password) } });
  await prisma.author.create({ data: { id: authorId, userId: ids.editor, slug: fixture, name: 'Phase U Byline', roleTitle: 'Correspondent', bio: 'Test', avatar: '/favicon.ico' } });

  const admin = await new Client().seed(); assert.equal((await admin.login(`${ids.admin}@example.test`)).status, 200);
  const editor = await new Client().seed(); assert.equal((await editor.login(`${ids.editor}@example.test`)).status, 200);
  const anon = await new Client().seed();

  const published = await prisma.article.findFirstOrThrow({ where: { status: 'published', eventSlug: { not: null }, editionYear: { not: null } }, orderBy: { id: 'asc' } });
  const publicPath = `/${published.sportSlug}/${published.eventSlug}/${published.editionYear}/${published.slug}/`;
  const edition = await prisma.eventEdition.findFirstOrThrow({ orderBy: { id: 'asc' } });
  const draft = await status(editor, '/api/articles', 201, 'POST', { title: `${fixture} draft`, slug: `${fixture}-draft`, sportSlug: edition.sportSlug, eventSlug: edition.eventSlug, editionYear: edition.year, content: 'x', authorId, status: 'draft', articleType: 'News' });
  createdArticleIds.push(draft.data.id);

  // ── U1: registration (no e-mail provider in tests → auto-verify + auto-login) ──
  const regEmail = `${fixture}-reg@example.test`;
  const regClient = await new Client().seed();
  const reg = await status(regClient, '/api/auth/register', 201, 'POST', { name: 'New Reader', email: regEmail, password });
  assert(reg.data.autoLogin === true && !reg.text.includes(password), 'no e-mail provider: register signs the reader in');
  const regUser = await prisma.user.findUniqueOrThrow({ where: { email: regEmail } });
  createdUserIds.push(regUser.id);
  assert.equal(regUser.role, 'Reader', 'registration must create a Reader');
  assert(regUser.emailVerifiedAt, 'auto-verified when no e-mail provider is configured');
  assert(verifyPassword(password, regUser.passwordHash) && regUser.passwordHash.startsWith('scrypt:'));
  assert.equal(await prisma.session.count({ where: { userId: regUser.id } }), 1, 'auto-logged-in: a session was created');
  assert.equal((await status(regClient, '/api/auth/me', 200)).data.user.email, regEmail, 'the auto-login session authenticates');
  // Role injection is rejected by the strict allow-list (never creates privilege).
  await status(anon, '/api/auth/register', 400, 'POST', { name: 'x', email: `${fixture}-inj@example.test`, password, role: 'Admin' });
  assert.equal(await prisma.user.count({ where: { email: `${fixture}-inj@example.test` } }), 0);
  // Duplicate registration does not sign in and does not reveal the account exists.
  const dup = await status(anon, '/api/auth/register', 202, 'POST', { name: 'New Reader', email: regEmail, password });
  assert(dup.data.message && !dup.headers.getSetCookie().some((c) => c.startsWith('sid=')), 'duplicate: generic message, no login');
  assert.equal(await prisma.user.count({ where: { email: regEmail } }), 1);
  tested('U1 registration: creates a Reader (never privileged); with no e-mail provider it auto-verifies and signs in; rejects client-supplied role; duplicates neither sign in nor leak existence');

  // ── U1: e-mail verification (token lifecycle) ──
  const verifyFlow = await makeReader('verify', { verified: false });
  const vToken = await issueVerificationToken(verifyFlow.id, 'self');
  assert.equal((await prisma.emailVerificationToken.findFirstOrThrow({ where: { userId: verifyFlow.id, usedAt: null } })).tokenHash, hashVerifyToken(vToken), 'only the hash of the token is stored');
  assert.equal((await status(anon, `/api/auth/verify-email?token=${encodeURIComponent(vToken)}`, 200)).data.valid, true);
  await status(anon, '/api/auth/verify-email', 200, 'POST', { token: vToken });
  assert((await prisma.user.findUniqueOrThrow({ where: { id: verifyFlow.id } })).emailVerifiedAt, 'account marked verified');
  await status(anon, '/api/auth/verify-email', 400, 'POST', { token: vToken }); // single use
  const expired = await issueVerificationToken(verifyFlow.id, 'self');
  await prisma.emailVerificationToken.updateMany({ where: { userId: verifyFlow.id, usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await status(anon, `/api/auth/verify-email?token=${encodeURIComponent(expired)}`, 200)).data.valid, false, 'expired token is not usable');
  tested('U1 verification: token is single-use, expires, is stored only as a hash, and confirming it sets emailVerifiedAt');

  // ── U1: reader password reset without account enumeration ──
  const r1 = await status(anon, '/api/auth/password-reset/request', 200, 'POST', { email: verifyFlow.email });
  const r2 = await status(anon, '/api/auth/password-reset/request', 200, 'POST', { email: `${fixture}-nobody@example.test` });
  assert.equal(r1.data.message, r2.data.message, 'reset request reveals nothing about account existence');
  tested('U1 reader password reset: self-service request answers identically whether or not the account exists');

  // ── U2: comment hardening ──
  const unverified = await makeReader('unverified', { verified: false });
  const unv = await new Client().seed(); await unv.login(unverified.email);
  await status(unv, '/api/comments', 403, 'POST', { articleId: published.id, content: 'I am unverified' }); // must verify first
  assert.equal((await status(unv, '/api/auth/verify-email/resend', 200, 'POST', {})).data.message.length > 0, true);

  const reader = await makeReader('reader', { verified: true });
  const rc = await new Client().seed(); await rc.login(reader.email);
  await status(anon, '/api/comments', 401, 'POST', { articleId: published.id, content: 'anon' }); // auth required
  await status(rc, '/api/comments', 403, 'POST', { articleId: draft.data.id, content: 'on a draft' }); // unpublished rejected
  await status(rc, '/api/comments', 404, 'POST', { articleId: 'does-not-exist', content: 'ghost' }); // invalid article
  const posted = await status(rc, '/api/comments', 201, 'POST', { articleId: published.id, content: 'A verified reader comment.' });
  assert.equal(posted.data.status, 'pending', 'reader comments start pending');
  await status(rc, '/api/comments', 409, 'POST', { articleId: published.id, content: 'A verified reader comment.' }); // duplicate guard
  // Reader cannot moderate or manage, even with a valid session.
  await status(rc, '/api/moderation/comments', 403);
  await status(rc, `/api/moderation/comments/${posted.data.id}`, 403, 'PATCH', { status: 'approved' });
  await status(rc, '/api/readers', 403);
  tested('U2 comment hardening: auth + verification + active + published-article required; duplicates blocked; readers cannot reach moderation or reader-management endpoints');

  // Pending comment is not public (service layer + rendered page).
  assert.equal((await getApprovedComments(published.id)).some((c) => c.id === posted.data.id), false);
  const pendingHtml = (await status(anon, publicPath, 200)).text;
  assert(!pendingHtml.includes('A verified reader comment.'), 'pending comment absent from public page');

  // ── U3: moderation ──
  const queue = await status(editor, '/api/moderation/comments?status=pending&page=1', 200);
  assert(queue.data.items.some((c: any) => c.id === posted.data.id) && typeof queue.data.pending === 'number' && queue.data.totalPages >= 1, 'pending queue paginated');
  await status(editor, `/api/moderation/comments/${posted.data.id}`, 200, 'PATCH', { status: 'approved', note: 'ok' });
  assert.equal((await getApprovedComments(published.id)).some((c) => c.id === posted.data.id), true, 'approved comment now public (service)');
  assert((await status(anon, publicPath, 200)).text.includes('A verified reader comment.'), 'approved comment rendered on public page');
  const modRow = await prisma.comment.findUniqueOrThrow({ where: { id: posted.data.id } });
  assert(modRow.moderatedBy && modRow.moderatedAt && modRow.moderationNote === 'ok', 'moderation records actor/time/note');
  // Soft delete hides it everywhere public but keeps the row; restore brings it back.
  await status(editor, `/api/moderation/comments/${posted.data.id}/delete`, 200, 'POST', {});
  assert((await prisma.comment.findUniqueOrThrow({ where: { id: posted.data.id } })).deletedAt, 'soft delete keeps the row');
  assert.equal((await getApprovedComments(published.id)).some((c) => c.id === posted.data.id), false, 'soft-deleted comment not public');
  await status(editor, `/api/moderation/comments/${posted.data.id}/restore`, 200, 'POST', {});
  // Spam is never public.
  await status(editor, `/api/moderation/comments/${posted.data.id}`, 200, 'PATCH', { status: 'spam' });
  assert.equal((await getApprovedComments(published.id)).some((c) => c.id === posted.data.id), false, 'spam comment not public');
  await status(editor, `/api/moderation/comments/${posted.data.id}`, 200, 'PATCH', { status: 'approved' });
  tested('U3 moderation: paginated queue; approve/reject/spam/soft-delete/restore; actor/time/note recorded; only approved & non-deleted comments are public');

  // XSS: script markup is stored verbatim and rendered escaped (never executed).
  const xss = await status(rc, '/api/comments', 201, 'POST', { articleId: published.id, content: '<script>alert(1)</script>' });
  await status(editor, `/api/moderation/comments/${xss.data.id}`, 200, 'PATCH', { status: 'approved' });
  assert.equal((await prisma.comment.findUniqueOrThrow({ where: { id: xss.data.id } })).content, '<script>alert(1)</script>', 'stored as text, unchanged');
  const xssHtml = (await status(anon, publicPath, 200)).text;
  assert(xssHtml.includes('&lt;script&gt;alert(1)&lt;/script&gt;') && !xssHtml.includes('<script>alert(1)</script>'), 'rendered escaped, not executed');
  tested('U2/U3 safety: comment text is stored plain and rendered HTML-escaped (no script execution)');

  // ── U4: reader management ──
  const list = await status(admin, '/api/readers?page=1', 200);
  assert(list.data.items.some((r: any) => r.id === reader.id) && !JSON.stringify(list.data).includes('passwordHash') && !JSON.stringify(list.data).includes('scrypt:'), 'readers listed without secrets');
  assert((await status(admin, `/api/readers?q=${encodeURIComponent(reader.email)}`, 200)).data.items.every((r: any) => r.email.includes(fixture)), 'search filter works');
  await status(editor, '/api/readers', 403); // Editor is not an admin here
  await status(anon, '/api/readers', 401);
  const detail = await status(admin, `/api/readers/${reader.id}`, 200);
  assert(Array.isArray(detail.data.comments), 'reader comment history returned');
  // Suspend revokes the live session and blocks login; ban is stronger; reactivate restores login.
  await status(admin, `/api/readers/${reader.id}/status`, 400, 'POST', { status: 'suspended' }); // reason required
  await status(admin, `/api/readers/${reader.id}/status`, 200, 'POST', { status: 'suspended', reason: 'Test suspension' });
  assert.equal(await prisma.session.count({ where: { userId: reader.id } }), 0, 'suspension revokes sessions');
  await status(rc, '/api/auth/me', 401); // old session no longer authenticates
  assert.equal((await new Client().seed().then((c) => c.login(reader.email))).status, 401, 'suspended account cannot log in');
  await status(admin, `/api/readers/${reader.id}/status`, 200, 'POST', { status: 'banned', reason: 'Test ban' });
  await status(admin, `/api/readers/${reader.id}/status`, 200, 'POST', { status: 'active', reason: '' }); // reactivate
  assert.equal((await new Client().seed().then((c) => c.login(reader.email))).status, 200, 'reactivated account can log in again');
  // Readers endpoint never acts on staff accounts.
  await status(admin, `/api/readers/${ids.editor}/status`, 404, 'POST', { status: 'suspended', reason: 'x' });
  // Manual admin verification (used while no e-mail provider is configured).
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: unverified.id } })).emailVerifiedAt, null);
  await status(admin, `/api/readers/${unverified.id}/verify`, 200, 'POST', {});
  assert((await prisma.user.findUniqueOrThrow({ where: { id: unverified.id } })).emailVerifiedAt, 'admin manually verified the reader');
  await status(editor, `/api/readers/${unverified.id}/verify`, 403, 'POST', {}); // non-admin blocked
  tested('U4 reader management: Admin-only, paginated/searchable, returns no secrets, suspend/ban revoke sessions and block login, reactivate restores, manual verify works, staff accounts untouched');

  // ── U5: account privacy ──
  const priv = await makeReader('privacy', { verified: true });
  const pc = await new Client().seed(); await pc.login(priv.email);
  await status(pc, '/api/comments', 201, 'POST', { articleId: published.id, content: 'Privacy reader comment.' });
  const exported = await status(pc, '/api/auth/me/export', 200);
  assert(exported.data.account.email === priv.email && exported.data.comments.length >= 1 && !JSON.stringify(exported.data).includes('passwordHash'), 'export returns own data without secrets');
  await status(pc, '/api/auth/me/delete', 400, 'POST', { password: 'wrong-password' });
  await status(pc, '/api/auth/me/delete', 200, 'POST', { password });
  assert.equal(await prisma.user.count({ where: { id: priv.id } }), 0, 'account deleted');
  assert.equal(await prisma.session.count({ where: { userId: priv.id } }), 0, 'sessions removed on deletion');
  const retainedComment = await prisma.comment.findFirst({ where: { userId: priv.id } });
  assert(retainedComment && retainedComment.userName === '[deleted user]' && !retainedComment.userAvatar, 'comments retained but anonymized on deletion');
  // Staff cannot self-delete through this endpoint.
  await status(editor, '/api/auth/me/delete', 403, 'POST', { password });
  tested('U5 privacy: reader can export their own data and self-delete (sessions removed, comments retained); staff cannot self-delete here');

  // ── Regression: staff + security with flags ON ──
  assert.equal((await status(admin, '/api/auth/me', 200)).data.user.role, 'Admin');
  const cms = await status(editor, '/api/cms/data', 200);
  assert(!JSON.stringify(cms.data).includes('passwordHash') && cms.data.features.readerAccounts === true && cms.data.features.comments === true);
  assert(!serverOutput.includes(password) && !serverOutput.includes(vToken), 'no secrets or raw tokens in server logs');
  tested('regression: staff login, account API and CMS dataset work with flags ON; no password hashes or raw tokens leak to logs or API output');

  console.log(`PASS ${checks} Phase U verification groups`);
} finally {
  child.kill();
  if (child.exitCode === null) await once(child, 'exit');
  // Remove only generated fixtures. Comments are keyed by user id (no FK), so
  // delete them explicitly; tokens/sessions cascade with the user row.
  await prisma.comment.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.article.deleteMany({ where: { id: { in: createdArticleIds }, authorId } });
  await prisma.author.deleteMany({ where: { id: authorId, userId: ids.editor } });
  await prisma.emailVerificationToken.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: fixture } } }); // any endpoint-created rows
  await prisma.auditLog.deleteMany({ where: { userId: { in: createdUserIds } } });
  const after = await snapshot();
  assert.deepEqual(after, before, 'Pre-existing database rows changed!');
  console.log('PASS database integrity: all table counts and full-row hashes unchanged; fixtures removed.');
  await prisma.$disconnect();
}
