/** Local-only integration verification. Creates UUID-scoped fixtures, cleans up
 * only those fixtures, then compares every pre-existing row and protected file.
 * Optional browser checks: set PLAYWRIGHT_MODULE to a Playwright module path.
 * Requires a current frontend build. Run: npx tsx server/scripts/verify-phase4.ts
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { prisma } from '../db';
import { checkDatabaseUrlIsLocalDev } from '../dbSafety';
import { hashPassword, verifyPassword } from '../password';
import { sessionReference } from '../account';
import { productionTransport } from './production-transport';
import { verifyProductionBoot, verifyProductionHttp, verifyProductionBrowser } from './production-checks';

assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe, 'Verification requires a local, non-production database.');
assert(fs.existsSync('.next/BUILD_ID'), 'Run npm run build first.');
const fixture = `phase4-${crypto.randomUUID()}`;
const roles = ['Reader', 'Author', 'Editor', 'Admin'] as const;
const ids = roles.map(role => `${fixture}-${role}`);
const originalPassword = `Test-${crypto.randomUUID()}`;
const newPassword = `New-${crypto.randomUUID()}`;
// Files that must stay byte-identical, where still present (both were moved to the project archive).
const protectedFiles = ['data/db.json', 'PROJECT_BRAIN.md'].filter((file) => fs.existsSync(file));
const digest = (value: string | Buffer) => crypto.createHash('sha256').update(value).digest('hex');
const filesBefore = protectedFiles.map(file => digest(fs.readFileSync(file)));
const tables = ['sport', 'sportEvent', 'eventEdition', 'article', 'author', 'user', 'session', 'comment', 'mediaItem', 'adSlotConfig', 'redirectRule', 'auditLog'] as const;
async function snapshot() {
  const result: Record<string, { count: number; hash: string }> = {};
  for (const table of tables) {
    const rows = await (prisma[table] as any).findMany({ orderBy: { id: 'asc' } });
    result[table] = { count: rows.length, hash: digest(JSON.stringify(rows)) };
  }
  return result;
}
assert.equal(await prisma.article.count({ where: { status: 'scheduled', scheduledFor: { lte: new Date(Date.now() + 600_000) } } }), 0, 'A scheduled article is due soon; run verification against an isolated copy.');
const before = await snapshot();
console.log('BEFORE row counts:', Object.fromEntries(Object.entries(before).map(([k, v]) => [k, v.count])));
const portProbe = createServer();
portProbe.listen(0, '127.0.0.1'); await once(portProbe, 'listening');
const port = (portProbe.address() as { port: number }).port;
await new Promise<void>(resolve => portProbe.close(() => resolve()));
const httpsMode = process.argv.includes('--https');
if (httpsMode) assert(process.env.PLAYWRIGHT_MODULE, 'HTTPS production verification requires PLAYWRIGHT_MODULE for the available real browser.');
const transport = httpsMode ? await productionTransport(port) : null;
const base = transport?.origin || `http://localhost:${port}`;
const request = transport?.request || fetch;
const child = spawn(process.execPath, ['--import', 'tsx', httpsMode ? 'server/start-production.ts' : 'server.ts'], {
  cwd: process.cwd(), windowsHide: true,
  // This pre-launch suite deliberately exercises Reader accounts/comments;
  // Phase A separately verifies the current launch defaults keep both off.
  env: { ...process.env, ENABLE_READER_ACCOUNTS: 'true', ENABLE_COMMENTS: 'true', PORT: String(port), HOST: '127.0.0.1', TRUST_PROXY: transport ? '127.0.0.1/32' : 'false', NODE_ENV: 'production', APP_ENV: transport ? 'staging' : 'production', AUTH_MODE: 'production', DEV_LOGIN_BYPASS: 'false', ALLOWED_ORIGIN: base },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
child.stdout.on('data', chunk => { serverOutput += chunk; });
child.stderr.on('data', chunk => { serverOutput += chunk; });
const pass = (message: string) => console.log(`PASS ${message}`);
let checks = 0;
const tested = (message: string) => { checks++; pass(message); };
const fixtureArticleIds: string[] = [];
class Client {
  cookies = new Map<string, string>();
  async request(route: string, method = 'GET', body?: unknown, extra: Record<string, string> = {}, csrf: 'valid' | 'missing' | 'wrong' = 'valid') {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '), ...extra };
    if (method !== 'GET' && csrf !== 'missing') headers['x-csrf-token'] = csrf === 'wrong' ? 'invalid' : this.cookies.get('csrf_token') || '';
    const response = await request(base + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';'); const index = pair.indexOf('=');
      this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    const text = await response.text();
    let data: any; try { data = JSON.parse(text); } catch { data = null; }
    return { status: response.status, headers: response.headers, data, text };
  }
  async login(role: typeof roles[number], password = originalPassword) {
    await this.request('/api/auth/me');
    return this.request('/api/auth/login', 'POST', { email: `${fixture}-${role.toLowerCase()}@example.test`, password });
  }
}
async function status(client: Client, route: string, expected: number, method = 'GET', body?: unknown, csrf: 'valid' | 'missing' | 'wrong' = 'valid') {
  const result = await client.request(route, method, body, {}, csrf);
  assert.equal(result.status, expected, `${method} ${route}: expected ${expected}, got ${result.status}`);
  return result;
}

try {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Test server did not start.')), 20_000);
    child.stdout.on('data', chunk => { if (String(chunk).includes('Server running')) { clearTimeout(timeout); resolve(); } });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error(`Test server exited before startup.
${serverOutput.slice(-2000)}`)); });
  });
  if (httpsMode) { await verifyProductionBoot(); tested('production startup refusal matrix and untrusted proxy spoof protection'); }
  for (const [index, role] of roles.entries()) await prisma.user.create({ data: {
    id: ids[index], name: `Phase 4 ${role}`, email: `${fixture}-${role.toLowerCase()}@example.test`, role,
    avatar: '/favicon.ico', joinedAt: new Date(), passwordHash: hashPassword(originalPassword),
  } });
  await prisma.author.create({ data: { id: `${fixture}-author`, userId: ids[1], slug: fixture, name: 'Test Byline', roleTitle: 'Correspondent', bio: 'Test biography', avatar: '/favicon.ico' } });
  const anon = new Client(); await anon.request('/api/health');
  await status(anon, '/api/auth/me', 401); await status(anon, '/api/auth/sessions', 401);
  await status(anon, '/api/auth/me', 401, 'PATCH', { name: 'Anonymous' });
  await status(anon, '/api/auth/change-password', 401, 'POST', {});
  await status(anon, '/api/auth/sessions/revoke-others', 401, 'POST', {});
  tested('unauthenticated account operations rejected');
  const reader = new Client(), author = new Client(), editor = new Client(), admin = new Client();
  for (const [index, client] of [reader, author, editor, admin].entries()) assert.equal((await client.login(roles[index])).status, 200);
  const me = await status(reader, '/api/auth/me', 200);
  assert.equal(me.data.user.id, ids[0]); assert.equal(me.data.user.authorProfile, null);
  assert(!me.text.includes('passwordHash') && !me.text.includes(originalPassword));
  assert.equal(me.headers.get('cache-control'), 'no-store');
  tested('all roles log in; account projection excludes credentials and forbids caching');
  const sid = reader.cookies.get('sid')!;
  const sessionRows = (await status(reader, '/api/auth/sessions', 200)).data.sessions;
  assert.equal(sessionRows.length, 1); assert.equal(sessionRows[0].current, true);
  assert(!JSON.stringify(sessionRows).includes(sid));
  const referenceClient = new Client(); referenceClient.cookies.set('sid', sessionRows[0].reference);
  await status(referenceClient, '/api/auth/me', 401);
  tested('session metadata identifies current session without exposing a usable credential');
  for (const csrf of ['missing', 'wrong'] as const) {
    for (const [route, method, body] of [
      ['/api/auth/me', 'PATCH', { name: 'Changed' }],
      ['/api/auth/change-password', 'POST', {}],
      ['/api/auth/sessions/revoke-others', 'POST', {}],
      [`/api/auth/sessions/${sessionRows[0].reference}`, 'DELETE', {}],
      ['/api/auth/logout', 'POST', {}],
    ] as const) await status(reader, route, 403, method, body, csrf);
  }
  tested('missing and invalid CSRF rejected on every account mutation and logout');
  await status(reader, '/api/auth/me', 200, 'PATCH', { name: 'Updated Reader', avatar: '/favicon.ico' });
  await status(author, '/api/auth/me', 200, 'PATCH', { name: 'Updated Author', authorProfile: { name: 'Updated Byline', bio: 'নতুন পরিচিতি', avatar: '/favicon.ico' } });
  assert.equal((await prisma.author.findUniqueOrThrow({ where: { id: `${fixture}-author` } })).bio, 'নতুন পরিচিতি');
  tested('profile and linked public author profile persist with valid CSRF');
  for (const body of [null, [], {}, { name: 1 }, { name: ' ' }, { name: 'x'.repeat(151) }, { avatar: 'javascript:alert(1)' }, { role: 'Admin' }, { status: 'active' }, { passwordHash: 'fake' }, { id: ids[3] }, { userId: ids[3] }, { email: 'changed@example.test' }, { authorProfile: { userId: ids[3] } }]) await status(reader, '/api/auth/me', 400, 'PATCH', body);
  await status(reader, '/api/auth/me', 400, 'PATCH', { authorProfile: { bio: 'Not linked' } });
  for (const body of [{ authorProfile: { bio: null } }, { authorProfile: { bio: 'x'.repeat(3001) } }, { authorProfile: { roleTitle: 'Admin' } }]) await status(author, '/api/auth/me', 400, 'PATCH', body);
  await status(reader, '/api/auth/me', 413, 'PATCH', { name: 'x'.repeat(2 * 1024 * 1024) });
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: ids[0] } })).role, 'Reader');
  tested('invalid types, oversized input, identity changes and privilege escalation rejected');
  const forged = await reader.request('/api/auth/me', 'GET', undefined, { 'x-user-id': ids[3], 'x-user-role': 'Admin' });
  assert.equal(forged.data.user.id, ids[0]);
  await status(reader, `/api/users/${ids[3]}`, 403, 'PUT', { name: 'Intruder' });
  await status(reader, `/api/users/${ids[0]}/role`, 403, 'PUT', { role: 'Admin' });
  const forgedAnon = await anon.request('/api/audit-logs', 'GET', undefined, { 'x-user-id': ids[3], 'x-user-role': 'Admin' });
  assert.equal(forgedAnon.status, 401);
  tested('another-user writes, self role escalation and forged identity headers fail');
  const otherSession = new Client(); assert.equal((await otherSession.login('Reader')).status, 200);
  const pw = { currentPassword: originalPassword, newPassword, confirmPassword: newPassword };
  await status(reader, '/api/auth/change-password', 400, 'POST', { ...pw, currentPassword: 'wrong-password' });
  await status(reader, '/api/auth/change-password', 400, 'POST', { ...pw, currentPassword: '' });
  await status(reader, '/api/auth/change-password', 400, 'POST', { ...pw, newPassword: 'short' });
  await status(reader, '/api/auth/change-password', 400, 'POST', { ...pw, confirmPassword: 'not-matching' });
  const changed = await status(reader, '/api/auth/change-password', 200, 'POST', pw);
  assert(!changed.text.includes('passwordHash')); assert.equal(changed.data.revokedCount, 1);
  await status(otherSession, '/api/auth/me', 401); await status(reader, '/api/auth/me', 200);
  assert.equal((await new Client().login('Reader', originalPassword)).status, 401);
  const newLogin = new Client(); assert.equal((await newLogin.login('Reader', newPassword)).status, 200);
  const updated = await prisma.user.findUniqueOrThrow({ where: { id: ids[0] } });
  assert(verifyPassword(newPassword, updated.passwordHash)); assert(!verifyPassword(originalPassword, updated.passwordHash));
  assert(!JSON.stringify(updated).includes(newPassword));
  tested('password checks, hashing, old/new login behavior and selective revocation');
  const throttled = await status(reader, '/api/auth/change-password', 429, 'POST', pw);
  assert(Number(throttled.headers.get('retry-after')) > 0);
  tested('password rate limit counts failures and success, keyed to account');
  const foreign = (await status(author, '/api/auth/sessions', 200)).data.sessions[0].reference;
  await status(reader, `/api/auth/sessions/${foreign}`, 404, 'DELETE', {});
  await status(reader, `/api/auth/sessions/${'a'.repeat(64)}`, 404, 'DELETE', {});
  await status(author, '/api/auth/me', 200);
  await status(reader, `/api/auth/sessions/${sessionReference(newLogin.cookies.get('sid')!)}`, 200, 'DELETE', {});
  await status(newLogin, '/api/auth/me', 401);
  const another = new Client(); await another.login('Reader', newPassword);
  await status(reader, '/api/auth/sessions/revoke-others', 200, 'POST', {});
  await status(another, '/api/auth/me', 401); await status(reader, '/api/auth/me', 200);
  tested('individual and bulk revocation; foreign-session enumeration protection');
  const revokedCurrent = new Client(); await revokedCurrent.login('Reader', newPassword);
  const revokeCurrentResult = await status(revokedCurrent, `/api/auth/sessions/${sessionReference(revokedCurrent.cookies.get('sid')!)}`, 200, 'DELETE', {});
  assert.equal(revokeCurrentResult.data.current, true); await status(revokedCurrent, '/api/auth/me', 401);
  const loggedOutSid = reader.cookies.get('sid')!;
  const out = await status(reader, '/api/auth/logout', 200, 'POST', {});
  assert(out.headers.getSetCookie().some(cookie => /sid=;.*Path=\/;.*HttpOnly;.*SameSite=Lax;.*Max-Age=0;.*Secure/.test(cookie)));
  reader.cookies.set('sid', loggedOutSid); await status(reader, '/api/auth/me', 401);
  assert.equal(await prisma.session.findUnique({ where: { id: loggedOutSid } }), null);
  tested('current-session revocation and logout invalidate database sessions and clear matching cookie attributes');
  const expiredId = crypto.randomBytes(32).toString('hex');
  await prisma.session.create({ data: { id: expiredId, userId: ids[0], createdAt: new Date(0), expiresAt: new Date(1) } });
  const expired = new Client(); expired.cookies.set('sid', expiredId); await status(expired, '/api/auth/me', 401);
  const inactive = new Client(); await inactive.login('Reader', newPassword);
  await prisma.user.update({ where: { id: ids[0] }, data: { status: 'inactive' } });
  await status(inactive, '/api/auth/me', 401);
  await prisma.user.update({ where: { id: ids[0] }, data: { status: 'active' } });
  tested('expired sessions and inactive users cannot authenticate');
  // PHASE B: the public full-database /api/data is gone; the CMS dataset is staff-only.
  await status(anon, '/api/data', 404);
  await status(anon, '/api/cms/data', 401);
  const readerBoundary = new Client(); assert.equal((await readerBoundary.login('Reader', newPassword)).status, 200);
  await status(readerBoundary, '/api/cms/data', 403);
  const authorData = (await status(author, '/api/cms/data', 200)).data;
  assert.equal(authorData.users.length, 0); assert.equal(authorData.auditLogs.length, 0);
  assert((await status(admin, '/api/cms/data', 200)).data.users.length >= 4);
  const publicHtml = (await status(anon, '/latest/', 200)).text;
  assert(!publicHtml.includes('passwordHash') && !publicHtml.includes('auditLogs'));
  await status(author, '/api/audit-logs', 403); await status(editor, '/api/audit-logs', 200);
  tested('public/staff data boundary and audit RBAC');
  const health = await anon.request('/api/health', 'GET', undefined, { Origin: base });
  assert.equal(health.headers.get('access-control-allow-origin'), base);
  assert.equal(health.headers.get('access-control-allow-credentials'), 'true');
  assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(health.headers.get('x-frame-options'), 'DENY');
  assert(health.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"));
  if (httpsMode) assert.equal(health.headers.get('strict-transport-security'), 'max-age=31536000');
  else assert.equal(health.headers.get('strict-transport-security'), null);
  const hostile = await anon.request('/api/health', 'GET', undefined, { Origin: 'https://hostile.example' });
  assert.equal(hostile.status, 403);
  assert.equal(hostile.headers.get('access-control-allow-origin'), null);
  await status(anon, '/api/health', 204, 'OPTIONS');
  tested('production security headers, allowed and denied CORS, preflight');
  const sport = await prisma.sport.findFirstOrThrow();
  const article = await status(author, '/api/articles', 201, 'POST', { title: 'Phase 4 Test Article', slug: fixture, sportSlug: sport.slug, content: 'Fixture content', status: 'draft', seo: {} });
  fixtureArticleIds.push(article.data.id);
  await status(author, `/api/articles/${article.data.id}`, 200, 'PUT', { title: 'Updated fixture article' });
  await status(author, `/api/articles/${article.data.id}`, 400, 'PUT', { author: { update: { user: { update: { role: 'Admin' } } } } });
  await status(editor, `/api/authors/${fixture}-author`, 400, 'PUT', { user: { update: { role: 'Admin' } } });
  await status(editor, `/API/AUTHORS/${fixture}-author/`, 400, 'PUT', { user: { update: { role: 'Admin' } } });
  for (const [resource, relation] of [['sports', 'events'], ['events', 'sport'], ['editions', 'articles'], ['comments', 'article']] as const) {
    await status(editor, `/api/${resource}/fixture`, 400, 'PUT', { [relation]: { update: { id: 'malicious' } } });
  }
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: ids[1] } })).role, 'Author');
  tested('nested CMS relation writes cannot change account privileges');
  await status(inactive, `/api/articles/${article.data.id}`, 403, 'PUT', { title: 'Reader cannot edit' });
  // PHASE H: the article list API is staff-only, so anonymous visitors cannot list anything (drafts included).
  await status(anon, '/api/articles', 401);
  await status(admin, `/api/articles/${article.data.id}`, 200, 'DELETE', {});
  tested('author article create/edit, Reader RBAC, draft privacy and Admin deletion');
  for (const [resource, table, field] of [
    ['sports', 'sport', 'name'], ['events', 'sportEvent', 'name'], ['editions', 'eventEdition', 'title'],
    ['comments', 'comment', 'status'], ['redirects', 'redirectRule', 'isActive'], ['media', 'mediaItem', 'title'], ['ads', 'adSlotConfig', 'enabled'],
  ] as const) {
    const row = await (prisma[table] as any).findFirstOrThrow();
    await status(admin, `/api/${resource}/${row.id}`, 200, 'PUT', { [field]: row[field] });
  }
  await status(editor, `/api/authors/${fixture}-author`, 200, 'PUT', { bio: 'নতুন পরিচিতি' });
  tested('legitimate updates still work across all nine hardened CMS resources');
  const racingLogin = new Client(); await racingLogin.request('/api/health');
  const racePassword = `Race-${crypto.randomUUID()}`;
  const [raceChange, raceLogin] = await Promise.all([
    editor.request('/api/auth/change-password', 'POST', { currentPassword: originalPassword, newPassword: racePassword, confirmPassword: racePassword }),
    racingLogin.login('Editor'),
  ]);
  assert.equal(raceChange.status, 200); assert([200, 401].includes(raceLogin.status));
  await status(racingLogin, '/api/auth/me', 401);
  const simultaneous = await Promise.all(['a', 'b'].map(suffix => author.request('/api/auth/change-password', 'POST', { currentPassword: originalPassword, newPassword: racePassword + suffix, confirmPassword: racePassword + suffix })));
  assert.deepEqual(simultaneous.map(result => result.status).sort(), [200, 400]);
  tested('concurrent login/password change leaves no old-credential session; simultaneous password changes serialize');
  let profileLimited = false;
  for (let i = 0; i < 31; i++) { const result = await author.request('/api/auth/me', 'PATCH', { name: 'Limit test' }); if (result.status === 429) { profileLimited = true; break; } assert.equal(result.status, 200); }
  assert(profileLimited);
  let revokeLimited = false;
  for (let i = 0; i < 21; i++) { const result = await author.request('/api/auth/sessions/revoke-others', 'POST', {}); if (result.status === 429) { revokeLimited = true; break; } assert.equal(result.status, 200); }
  assert(revokeLimited);
  const failures = new Client(); await failures.request('/api/health');
  for (let i = 0; i < 8; i++) assert.equal((await failures.login('Editor', 'incorrect-password')).status, 401);
  assert.equal((await failures.login('Editor', 'incorrect-password')).status, 429);
  tested('profile, session-revocation and existing login rate limits');
  const logs = await prisma.auditLog.findMany({ where: { userId: { in: ids } } });
  for (const action of ['Profile Updated', 'Password Changed', 'Password Change Failed', 'Session Revoked', 'Other Sessions Revoked', 'Logout']) assert(logs.some(log => log.action === action), `Missing audit event ${action}`);
  const serializedLogs = JSON.stringify(logs);
  for (const secret of [originalPassword, newPassword, updated.passwordHash, sid, reader.cookies.get('csrf_token')!]) assert(!serializedLogs.includes(secret));
  for (const secret of [originalPassword, newPassword, updated.passwordHash, sid]) assert(!serverOutput.includes(secret));
  tested('security audit events exist; passwords, hashes and tokens absent from audits and server logs');

  if (httpsMode) {
    const freshReader = new Client(); await freshReader.login('Reader', newPassword);
    await verifyProductionHttp({ base, request, anon, admin, reader: freshReader, fixture, ids, password: newPassword, status, tested });
  }

  if (process.env.PLAYWRIGHT_MODULE) {
    const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
    const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'chrome', headless: true, args: transport?.browserArgs || [] });
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      const browserErrors: string[] = [];
      page.on('pageerror', (error: Error) => browserErrors.push(error.message));
      if (httpsMode) await verifyProductionBrowser({ page, context, browser, chromium, transport, base, fixture, originalPassword, newPassword, tested });
      await page.goto(base + '/account');
      await page.getByRole('heading', { name: 'Sign in to your account', exact: true }).waitFor();
      await page.getByLabel('Email', { exact: true }).fill(`${fixture}-admin@example.test`);
      await page.getByLabel('Password', { exact: true }).fill(originalPassword);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.getByRole('heading', { name: 'My account & settings', exact: true }).waitFor();
      await page.getByLabel('Display name', { exact: true }).fill('Browser Verified Admin');
      await page.getByRole('button', { name: 'Save profile', exact: true }).click();
      await page.getByText('Profile saved.', { exact: true }).waitFor();
      await page.reload();
      assert.equal(await page.getByLabel('Display name', { exact: true }).inputValue(), 'Browser Verified Admin');
      await page.getByLabel('Theme', { exact: true }).selectOption('dark');
      await page.getByLabel('Account language', { exact: true }).selectOption('bn');
      await page.getByRole('heading', { name: 'আমার অ্যাকাউন্ট ও সেটিংস', exact: true }).waitFor();
      await page.reload();
      assert.equal(await page.getByLabel('অ্যাকাউন্টের ভাষা', { exact: true }).inputValue(), 'bn');
      assert.equal(await page.getByLabel('থিম', { exact: true }).inputValue(), 'dark');
      await page.getByLabel('অ্যাকাউন্টের ভাষা', { exact: true }).selectOption('en');
      await page.getByLabel('Theme', { exact: true }).selectOption('light');
      await page.route('**/api/auth/logout', (route: any) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Service temporarily unavailable."}' }));
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await page.getByText('Logout could not be completed. Please try again.', { exact: true }).waitFor();
      assert(await page.getByRole('heading', { name: 'My account & settings', exact: true }).isVisible());
      await page.unroute('**/api/auth/logout');
      await page.getByRole('button', { name: 'Revoke session', exact: true }).click();
      await page.getByText('Selected sessions signed out.', { exact: true }).waitFor();
      await status(admin, '/api/auth/me', 401);
      tested('failed logout preserves authenticated UI; browser session revocation invalidates other device');
      const dismiss = page.getByRole('button', { name: 'Dismiss notification', exact: true });
      if (await dismiss.isVisible()) await dismiss.click();
      await page.evaluate(() => window.scrollTo(0, 0));
      if (!httpsMode) {
        fs.mkdirSync('verification', { recursive: true });
        await page.screenshot({ path: 'verification/phase4-account-desktop.png', fullPage: true });
      }
      await page.setViewportSize({ width: 390, height: 844 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      if (!httpsMode) await page.screenshot({ path: 'verification/phase4-account-mobile.png', fullPage: true });
      tested('browser login/profile save/reload, theme and Bangla preference persistence, mobile overflow');
      await page.goto(base + '/admin');
      await page.getByRole('heading', { name: 'Content Management System', exact: true }).waitFor();
      await page.getByRole('button', { name: 'My account', exact: true }).click();
      await page.getByRole('heading', { name: 'My account & settings', exact: true }).waitFor();
      const secondTab = await context.newPage();
      await secondTab.goto(base + '/admin');
      await secondTab.getByRole('heading', { name: 'Content Management System', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await secondTab.getByRole('heading', { name: 'Staff Sign In Required', exact: true }).waitFor();
      await page.goto(base + '/admin');
      await page.getByRole('heading', { name: 'Staff Sign In Required', exact: true }).waitFor();
      tested('Admin gate, account navigation, logout and cross-tab stale-state clearing');
      await page.goto(base + '/account');
      await page.getByLabel('Email', { exact: true }).fill(`${fixture}-reader@example.test`);
      await page.getByLabel('Password', { exact: true }).fill(newPassword);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.getByRole('heading', { name: 'My account & settings', exact: true }).waitFor();
      await page.goto(base + '/admin');
      await page.getByRole('heading', { name: 'Access Denied', exact: true }).waitFor();
      await page.goto(base + '/account');
      await page.getByRole('heading', { name: 'My account & settings', exact: true }).waitFor();
      // Simulate revocation by another device, then trigger a protected request.
      const browserSid = (await context.cookies()).find((cookie: any) => cookie.name === 'sid')!.value;
      await prisma.session.deleteMany({ where: { id: browserSid, userId: ids[0] } });
      await page.getByRole('button', { name: 'Refresh sessions', exact: true }).click();
      await page.getByRole('heading', { name: 'Sign in to your account', exact: true }).waitFor();
      assert.equal(await page.locator('header a[href="/admin"], footer a[href="/admin"]').count(), 0);
      assert.deepEqual(browserErrors, []);
      tested('Reader admin denial, revoked-session UX, no public Admin links or browser runtime errors');
    } finally { await browser.close(); }
  } else console.log('SKIP browser checks: PLAYWRIGHT_MODULE not provided.');
  console.log(`PASS ${checks} verification groups`);
} finally {
  child.kill();
  if (child.exitCode === null) await once(child, 'exit');
  await transport?.close();
  // Exact, generated fixture IDs only. Never remove pre-existing content.
  await prisma.comment.deleteMany({ where: { userId: { in: ids } } });
  await prisma.article.deleteMany({ where: { id: { in: fixtureArticleIds }, authorId: `${fixture}-author` } });
  await prisma.author.deleteMany({ where: { id: `${fixture}-author`, userId: ids[1] } });
  await prisma.session.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ userId: { in: ids } }, { userId: 'unknown', userName: `${fixture}-missing@example.test` }] } });
  const after = await snapshot();
  assert.deepEqual(after, before, 'Pre-existing database rows changed!');
  assert.deepEqual(protectedFiles.map(file => digest(fs.readFileSync(file))), filesBefore);
  console.log('PASS database integrity: all 12 table counts and full-row hashes unchanged; protected files unchanged; fixtures removed.');
  console.log('AFTER row counts:', Object.fromEntries(Object.entries(after).map(([k, v]) => [k, v.count])));
  await prisma.$disconnect();
}
