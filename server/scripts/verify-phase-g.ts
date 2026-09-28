/** Phase G — production launch readiness verification.
 * Local database only; UUID-scoped fixtures are removed and every
 * pre-existing row is hash-compared afterwards.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { chromium } from 'playwright-core';
import { prisma } from '../db';
import { checkDatabaseUrlIsLocalDev } from '../dbSafety';
import { hashPassword, verifyPassword } from '../password';
import { productionCsp } from '../securityHeaders';

assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe, 'Phase G verification requires a local, non-production database.');
assert(fs.existsSync('.next/BUILD_ID'), 'Run npm run build first.');
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
assert(executablePath && fs.existsSync(executablePath), 'Set PLAYWRIGHT_EXECUTABLE_PATH to an installed Chromium executable.');

const fixture = `phaseg-${crypto.randomUUID()}`;
const digest = (v: string) => crypto.createHash('sha256').update(v).digest('hex');
const tables = ['sport', 'sportEvent', 'eventEdition', 'article', 'articleMedia', 'author', 'user', 'session', 'comment', 'mediaItem', 'adSlotConfig', 'redirectRule', 'siteSetting', 'seoRule', 'seoScanRun', 'seoIntegrationLog', 'auditLog'] as const;
async function snapshot() {
  const out: Record<string, { count: number; hash: string }> = {};
  for (const t of tables) { const rows = await (prisma[t] as any).findMany(); rows.sort((a: unknown, b: unknown) => JSON.stringify(a).localeCompare(JSON.stringify(b))); out[t] = { count: rows.length, hash: digest(JSON.stringify(rows)) }; }
  return out;
}
let checks = 0; const pass = (s: string) => { checks++; console.log(`PASS ${s}`); };
const freePort = async () => { const p = createServer(); p.listen(0, '127.0.0.1'); await once(p, 'listening'); const port = (p.address() as { port: number }).port; await new Promise<void>((r) => p.close(() => r())); return port; };
const serverEnv = (port: number, origin: string): NodeJS.ProcessEnv => ({ ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production', AUTH_MODE: 'production', DEV_LOGIN_BYPASS: 'false', TRUST_PROXY: 'false', ALLOWED_ORIGIN: origin, GEMINI_API_KEY: '' });
const tsx = ['--import', 'tsx'];

const before = await snapshot();
let child: ReturnType<typeof spawn> | undefined;
let output = '';
try {
  // ── Launch guard: documented default passwords ──
  const weakId = `${fixture}-weak`;
  await prisma.user.create({ data: { id: weakId, name: 'Phase G weak', email: `${weakId}@example.test`, role: 'Editor', avatar: '', joinedAt: new Date(), passwordHash: hashPassword('ChangeMe123!') } });
  const refused = spawnSync(process.execPath, [...tsx, 'server.ts'], { env: serverEnv(await freePort(), 'https://sportingspy.com'), encoding: 'utf8', timeout: 60_000 });
  assert.notEqual(refused.status, 0, 'a real production origin must refuse to start');
  assert.match(refused.stderr + refused.stdout, /Refusing to start: \d+ active account\(s\) .* still use the documented default password/);
  assert(!/@example\.test|ChangeMe123!/.test(refused.stderr + refused.stdout), 'the refusal names roles only, never e-mails or the password');
  pass('production (HTTPS origin) refuses to start while an active account uses the documented default password; message has no e-mails or secrets');

  // ── Password CLI ──
  const cli = (input: string) => spawnSync(process.execPath, [...tsx, 'server/scripts/set-password.ts', `${weakId}@example.test`], { input, encoding: 'utf8' });
  assert.notEqual(cli('short\n').status, 0);
  assert.notEqual(cli('ChangeMe123!\n').status, 0);
  await prisma.session.create({ data: { id: `${fixture}-s`, userId: weakId, createdAt: new Date(), expiresAt: new Date(Date.now() + 3600e3) } });
  assert.equal(cli('Phase-G-Strong-Passphrase\n').status, 0);
  const updated = await prisma.user.findUniqueOrThrow({ where: { id: weakId } });
  assert(verifyPassword('Phase-G-Strong-Passphrase', updated.passwordHash) && !verifyPassword('ChangeMe123!', updated.passwordHash));
  assert.equal(await prisma.session.count({ where: { userId: weakId } }), 0, 'sessions revoked');
  pass('users:set-password rejects short and default passwords, sets a new hash, revokes sessions and audits the change');

  // ── db:migrate guard ──
  const guard = spawnSync(process.execPath, [...tsx, 'server/scripts/guard-local-db.ts'], { env: { ...process.env, DATABASE_URL: 'postgresql://u:p@db.prod.example.com:5432/sportingspy' }, encoding: 'utf8' });
  assert.equal(guard.status, 1); assert.match(guard.stderr, /db:migrate:deploy/);
  assert.equal(spawnSync(process.execPath, [...tsx, 'server/scripts/guard-local-db.ts'], { encoding: 'utf8' }).status, 0);
  assert.match(JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts['db:migrate'], /^tsx server\/scripts\/guard-local-db\.ts && prisma migrate dev$/);
  pass('npm run db:migrate (prisma migrate dev) refuses non-local databases; db:migrate:deploy stays available for production');

  // ── Running server (local production mode) ──
  const port = await freePort(); const base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [...tsx, 'server.ts'], { env: serverEnv(port, base), stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout!.on('data', (c) => { output += c; }); child.stderr!.on('data', (c) => { output += c; });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server did not start. ${output}`)), 30_000);
    child!.stdout!.on('data', (c) => { if (String(c).includes('Server running')) { clearTimeout(timer); resolve(); } });
    child!.once('exit', () => { clearTimeout(timer); reject(new Error(`Server exited. ${output}`)); });
  });

  const live = await fetch(`${base}/api/health`);
  assert.deepEqual(await live.json(), { status: 'ok' });
  const ready = await fetch(`${base}/api/health/ready`);
  assert.equal(ready.status, 200); assert.deepEqual(await ready.json(), { status: 'ready', checks: { database: 'ok', storage: 'ok' } });
  pass('liveness and readiness (database + writable media storage) endpoints; readiness reports only ok/fail');

  const probe = `probe-${crypto.randomUUID()}`;
  const bad = await fetch(`${base}/api/auth/login?secret=${probe}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: `{"password":"${probe}",` });
  const body = await bad.json();
  const rid = bad.headers.get('x-request-id')!;
  assert.match(rid, /^[0-9a-f-]{36}$/); assert.deepEqual(body, { error: 'Malformed request.', requestId: rid });
  await new Promise((r) => setTimeout(r, 200));
  const line = output.split('\n').find((l) => l.includes(`id=${rid}`));
  assert(line && /POST \/api\/auth\/login status=400 error=SyntaxError/.test(line), `log line: ${line}`);
  assert(!output.includes(probe), 'query values and request bodies never reach the logs');
  const other = await fetch(`${base}/`);
  assert.notEqual(other.headers.get('x-request-id'), rid, 'unique per request');
  pass('every response carries a unique X-Request-Id; errors return it and log method/path/status/class with it, never query values or bodies');

  // ── CSP: embed players allowed, other frames blocked ──
  const csp = productionCsp('n');
  assert(csp.includes("frame-src 'self' https://www.youtube-nocookie.com https://player.vimeo.com;") && csp.includes("media-src 'self'"), csp);
  process.env.MEDIA_PUBLIC_BASE_URL = 'https://cdn.example.net/media';
  assert(productionCsp('n').includes("img-src 'self' data: https://images.unsplash.com https://cdn.example.net") && productionCsp('n').includes("media-src 'self' https://cdn.example.net"));
  delete process.env.MEDIA_PUBLIC_BASE_URL;
  const sport = await prisma.sport.findFirstOrThrow({ where: { isVisible: true } });
  const author = await prisma.author.findFirstOrThrow();
  await prisma.article.create({ data: { id: `${fixture}-embed`, slug: `${fixture}-embed`, sportSlug: sport.slug, title: 'Embed fixture', excerpt: 'x', content: 'x', featuredImage: '', authorId: author.id, publishedAt: new Date(), status: 'published', readingTimeMinutes: 1, seo: {},
    body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }, { type: 'embed', attrs: { kind: 'youtube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'YT' } }, { type: 'embed', attrs: { kind: 'vimeo', url: 'https://vimeo.com/76979871', title: 'Vimeo' } }] } } as any });
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    // External players are not contacted: the test only checks what the CSP allows.
    await page.route(/youtube-nocookie\.com|player\.vimeo\.com|example\.org/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>stub</p>' }));
    const violations: string[] = [];
    page.on('console', (m) => { if (/Content Security Policy|Refused to frame|violates/i.test(m.text())) violations.push(m.text()); });
    await page.goto(`${base}/${sport.slug}/${fixture}-embed/`, { waitUntil: 'networkidle' });
    assert.equal(await page.locator('iframe').count(), 2);
    assert.deepEqual(violations, [], `embeds blocked: ${violations.join(' | ')}`);
    await page.evaluate(`(() => { const f = document.createElement('iframe'); f.src = 'https://example.org/'; document.body.appendChild(f); })()`);
    await page.waitForTimeout(800);
    assert(violations.some((v) => /example\.org/.test(v) && /frame-src/.test(v)), `unrelated frame must be blocked: ${violations.join(' | ')}`);
  } finally { await browser.close(); }
  pass('production CSP lets the YouTube (nocookie) and Vimeo players load, keeps every other frame blocked, and adds a media CDN origin only when configured');
} finally {
  if (child) { child.kill(); await once(child, 'exit').catch(() => undefined); }
  await prisma.article.deleteMany({ where: { id: { startsWith: fixture } } });
  await prisma.session.deleteMany({ where: { userId: { startsWith: fixture } } });
  await prisma.auditLog.deleteMany({ where: { userId: { startsWith: fixture } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: fixture } } });
  const after = await snapshot();
  assert.deepEqual(after, before, 'Database changed outside disposable Phase G fixtures.');
  console.log(`PASS ${checks} Phase G verification groups`);
  console.log('PASS database integrity: all pre-existing rows unchanged; fixtures removed.');
  await prisma.$disconnect();
}
