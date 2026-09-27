import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { prisma } from '../db';

async function freePort() {
  const listener = http.createServer();
  await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>(resolve => listener.close(() => resolve()));
  return port;
}

export async function verifyProductionBoot() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sportingspy-boot-'));
  const loader = import.meta.resolve('tsx');
  const entry = path.resolve('server/start-production.ts');
  const baseline = { ...process.env, NODE_ENV: 'development', AUTH_MODE: 'development', DEV_LOGIN_BYPASS: 'false', HOST: '127.0.0.1', TRUST_PROXY: 'false', ALLOWED_ORIGIN: 'https://sportingspy.test' };
  try {
    for (const test of [
      { env: { DATABASE_URL: '' }, message: 'DATABASE_URL' },
      { env: { ALLOWED_ORIGIN: '' }, message: 'ALLOWED_ORIGIN' },
      { env: { ALLOWED_ORIGIN: '*' }, message: 'ALLOWED_ORIGIN' },
      { env: { ALLOWED_ORIGIN: 'http://public.example' }, message: 'HTTPS' },
      { env: { ALLOWED_ORIGIN: 'https://example.com/path' }, message: 'ALLOWED_ORIGIN' },
      { env: { DEV_LOGIN_BYPASS: 'true' }, message: 'DEV_LOGIN_BYPASS' },
      { env: { TRUST_PROXY: 'true' }, message: 'TRUST_PROXY' },
      { env: { TRUST_PROXY: '1' }, message: 'TRUST_PROXY' },
      { env: { TRUST_PROXY: '0.0.0.0/0' }, message: 'TRUST_PROXY' },
      { env: { PORT: '3000oops' }, message: 'PORT' },
      { env: {}, message: 'Production build missing', cwd: temp },
    ]) {
      const child = spawn(process.execPath, ['--import', loader, entry], { cwd: test.cwd || process.cwd(), env: { ...baseline, ...test.env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
      const timer = setTimeout(() => child.kill(), 12_000);
      const [code] = await once(child, 'exit'); clearTimeout(timer);
      assert.equal(code, 1, `Startup case ${test.message} must exit 1`);
      assert(output.includes(test.message), `Startup must explain ${test.message}`);
      assert(!output.includes(process.env.DATABASE_URL!));
      assert(!output.includes('Server running'));
    }
    const port = await freePort();
    const child = spawn(process.execPath, ['--import', loader, entry], { cwd: process.cwd(), env: { ...baseline, PORT: String(port) }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Untrusted-proxy test server did not start.')), 12_000);
        child.stdout.on('data', chunk => { if (String(chunk).includes('Server running')) { clearTimeout(timer); resolve(); } });
        child.once('exit', () => { clearTimeout(timer); reject(new Error('Untrusted-proxy test server exited early.')); });
      });
      const headers = { 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '198.51.100.1' };
      const health = await fetch(`http://127.0.0.1:${port}/api/health`, { headers });
      assert.equal(health.status, 200); assert.equal(health.headers.get('strict-transport-security'), null);
      assert(health.headers.get('content-security-policy')); // Production wrapper overrides NODE_ENV=development.
      assert.equal(health.headers.getSetCookie().length, 0);
      const protectedRequest = await fetch(`http://127.0.0.1:${port}/api/auth/me`, { headers });
      assert.equal(protectedRequest.status, 426);
      assert.equal(protectedRequest.headers.get('strict-transport-security'), null);
    } finally { child.kill(); if (child.exitCode === null) await once(child, 'exit'); }
  } finally {
    assert(path.dirname(temp) === os.tmpdir() && path.basename(temp).startsWith('sportingspy-boot-'));
    fs.rmSync(temp, { recursive: true });
  }
}

export async function verifyProductionHttp({ base, request, anon, admin, reader, fixture, ids, password, status, tested }: any) {
  const health = await request(base + '/api/health');
  assert.deepEqual(await health.json(), { status: 'ok' });
  assert.equal(health.headers.get('strict-transport-security'), 'max-age=31536000');
  assert.equal(health.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(health.headers.get('permissions-policy'), 'geolocation=(), camera=(), microphone=(), payment=()');
  assert.equal(health.headers.get('x-powered-by'), null);
  assert.equal(health.headers.getSetCookie().length, 0);
  const preflight = await request(base + '/api/auth/me', { method: 'OPTIONS', headers: { Origin: base, 'Access-Control-Request-Method': 'PATCH', 'Access-Control-Request-Headers': 'content-type,x-csrf-token' } });
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), base);
  assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
  assert(preflight.headers.get('content-security-policy'));
  const denied = await request(base + '/api/auth/me', { method: 'OPTIONS', headers: { Origin: 'https://unapproved.example', 'Access-Control-Request-Method': 'PATCH' } });
  assert.equal(denied.status, 403); assert.equal(denied.headers.get('access-control-allow-origin'), null);
  const crossSite = await reader.request('/api/auth/me', 'PATCH', { name: 'Cross-origin change' }, { Origin: 'https://unapproved.example' });
  assert.equal(crossSite.status, 403);
  assert.notEqual((await prisma.user.findUniqueOrThrow({ where: { id: ids[0] } })).name, 'Cross-origin change');
  tested('HTTPS HSTS and full headers, minimal health, allowed/denied preflight and hostile-origin mutations');

  const html = await request(base + '/'); const htmlText = await html.text();
  assert.equal(html.status, 200); assert(html.headers.get('content-type')?.includes('text/html'));
  assert(!htmlText.includes('/@vite/client') && !htmlText.includes('/src/main.tsx'));
  for (const route of ['/account', '/admin', '/sports', '/events']) {
    const response = await request(base + route); assert.equal(response.status, 200); assert.equal(await response.text(), htmlText);
  }
  for (const route of ['/api/not-found', '/assets/not-found.js', '/src/main.tsx', '/.env', '/node_modules/tsx/package.json']) {
    const response = await request(base + route); assert.equal(response.status, 404); assert(!(await response.text()).includes('<html'));
  }
  const scriptPaths = [...htmlText.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(match => match[1]);
  assert(scriptPaths.some(asset => asset.endsWith('.js')) && scriptPaths.some(asset => asset.endsWith('.css')));
  for (const asset of scriptPaths) {
    const response = await request(base + asset); assert.equal(response.status, 200);
    const content = await response.text();
    assert(!content.includes(process.env.DATABASE_URL!) && !content.includes('VITE_DEV_AUTH_TOKEN'));
    if (asset.endsWith('.js')) assert(!/fetch\(["'`]https?:\/\/(localhost|127\.0\.0\.1)/.test(content));
  }
  const siteMap = await (await request(base + '/sitemap.xml')).text(); assert(siteMap.includes(`${base}/sports`));
  tested('production assets and SPA deep links; API/static misses do not return HTML; canonical origin and no secret embedding');

  const malformed = await request(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"password":"private-error-probe",' });
  assert.equal(malformed.status, 400); assert.deepEqual(await malformed.json(), { error: 'Malformed request.' });
  const failure = await admin.request(`/api/authors/${fixture}-author`, 'PUT', { bio: 42 });
  assert.equal(failure.status, 500); assert.deepEqual(failure.data, { error: 'Internal server error.' });
  const noAccount = await anon.request('/api/auth/login', 'POST', { email: `${fixture}-missing@example.test`, password: 'private-error-probe' });
  assert.equal(noAccount.status, 401); assert.deepEqual(noAccount.data, { error: 'Invalid email or password.' });
  const malformedCookie = await request(base + '/api/auth/me', { headers: { Cookie: 'sid=%E0%A4%A' } });
  assert.equal(malformedCookie.status, 401);
  tested('malformed JSON, Prisma validation failure, nonexistent login and malformed cookie reveal no internals');

  const article = await prisma.article.findFirstOrThrow({ where: { status: 'published' } });
  for (let i = 0; i < 5; i++) await status(reader, '/api/comments', 201, 'POST', { articleId: article.id, content: `${fixture} comment ${i}` });
  const commentLimit = await status(reader, '/api/comments', 429, 'POST', { articleId: article.id, content: `${fixture} comment blocked` });
  assert(Number(commentLimit.headers.get('retry-after')) > 0);
  for (let i = 0; i < 20; i++) {
    const created = await status(admin, '/api/users', 201, 'POST', { name: 'Production smoke fixture', email: `${fixture}-staff-${i}@example.test`, role: 'Reader', password });
    ids.push(created.data.id);
  }
  const staffLimit = await status(admin, '/api/users', 429, 'POST', { name: 'Blocked fixture', email: `${fixture}-staff-blocked@example.test`, role: 'Reader', password });
  assert(Number(staffLimit.headers.get('retry-after')) > 0);
  tested('comment limit (sixth submission) and staff creation limit (21st account) enforced in production');
}

export async function verifyProductionBrowser({ page, context, chromium, transport, base, tested }: any) {
  page.productionRequests = [];
  page.cspViolations = [];
  page.on('request', (req: any) => { if (new URL(req.url()).pathname.startsWith('/api/')) page.productionRequests.push(req.url()); });
  page.on('console', (message: any) => { if (/violates.*Content Security Policy|violat.*directive/i.test(message.text())) page.cspViolations.push(message.text()); });
  await page.goto(base + '/');
  await page.locator('h1').waitFor();
  const article = await prisma.article.findFirstOrThrow({ where: { status: 'published' } });
  const articleRoute = article.eventSlug && article.editionYear ? `/${article.sportSlug}/${article.eventSlug}/${article.editionYear}/${article.slug}` : `/${article.sportSlug}/${article.slug}`;
  await page.goto(base + articleRoute);
  await page.getByRole('heading', { name: article.title, exact: true }).waitFor();
  await page.reload(); await page.getByRole('heading', { name: article.title, exact: true }).waitFor();
  await page.goto(base + '/admin');
  await page.getByRole('heading', { name: 'Staff Sign In Required', exact: true }).waitFor();
  await page.reload(); await page.getByRole('heading', { name: 'Staff Sign In Required', exact: true }).waitFor();
  assert(page.productionRequests.every((url: string) => new URL(url).origin === base));
  assert.deepEqual(page.cspViolations, []);
  tested('real Chrome loads HTTPS production home/article/deep refresh/Admin gate with same-origin APIs and no CSP violations');

  // Fresh isolated Chrome avoids HSTS cached by prior HTTPS navigation. Its
  // secure test cookie must not be sent over actual HTTP on a non-loopback host.
  let insecureCookie = '';
  const httpServer = http.createServer((req, res) => { insecureCookie = req.headers.cookie || ''; res.end('Local transport probe'); });
  await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', resolve));
  const httpPort = (httpServer.address() as { port: number }).port;
  const probeBrowser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'chrome', headless: true, args: transport.browserArgs });
  try {
    const probeContext = await probeBrowser.newContext();
    await probeContext.addCookies([{ name: 'sid', value: 'test-cookie-not-a-real-session', domain: 'sportingspy.test', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }]);
    const probe = await probeContext.newPage();
    await probe.goto(`http://sportingspy.test:${httpPort}/`);
    assert(!insecureCookie.includes('sid='));
    assert.equal(await probe.evaluate(() => document.cookie.includes('sid=')), false);
    tested('real browser withholds Secure cookie on HTTP; HttpOnly cookie unavailable to JavaScript');
  } finally {
    await probeBrowser.close(); httpServer.closeAllConnections();
    await new Promise<void>(resolve => httpServer.close(() => resolve()));
  }
}
