/**
 * Host-aware indexing protection.
 *
 *   npm run local -- test:indexing-host
 *
 * Staging blocks every host. Production blocks every host except the
 * canonical one (ALLOWED_ORIGIN), e.g. the platform's *.onrender.com name,
 * through X-Robots-Tag and robots.txt. Only the Host header counts, never
 * X-Forwarded-Host. Page-level robots rules are covered by
 * test:discipline-pages, which runs production on its canonical host.
 * Starts two local servers (production, staging); writes nothing.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { canonicalHostOf, indexingBlocked, normalizeHost, robotsTxt } from '../seo/robots';
import { checkDatabaseUrlIsLocalDev } from '../dbSafety';

let checks = 0;
const pass = (m: string) => { checks++; console.log(`PASS ${m}`); };

// ── Host handling ──
assert.equal(normalizeHost('SportingSpy.COM'), 'sportingspy.com');
assert.equal(normalizeHost('sportingspy.com.'), 'sportingspy.com');
assert.equal(normalizeHost('sportingspy.com:443'), 'sportingspy.com');
assert.equal(normalizeHost('sportingspy.com:80'), 'sportingspy.com');
assert.equal(normalizeHost('sportingspy.com:8443'), 'sportingspy.com:8443');
assert.equal(normalizeHost('[::1]:3000'), '[::1]:3000');
for (const bad of [undefined, '', '   ', 'user@sportingspy.com', 'sportingspy.com/path', 'sportingspy.com?x', 'a b']) assert.equal(normalizeHost(bad), null, `rejects ${String(bad)}`);
assert.equal(canonicalHostOf('https://sportingspy.com'), 'sportingspy.com');
assert.equal(canonicalHostOf('http://127.0.0.1:4000'), '127.0.0.1:4000');
assert.equal(canonicalHostOf(undefined), null);
pass('hosts compare without case, trailing dot or default port; anything but host[:port] is rejected');

const C = 'sportingspy.com';
for (const host of [C, 'SPORTINGSPY.com', 'sportingspy.com:443', 'sprtingspy-2-o.onrender.com', undefined]) assert.equal(indexingBlocked('staging', host, C), true, `staging blocks ${host}`);
for (const host of [C, 'SportingSpy.com', 'sportingspy.com:443', 'sportingspy.com.']) assert.equal(indexingBlocked('production', host, C), false, `production allows ${host}`);
for (const host of ['sprtingspy-2-o.onrender.com', 'www.sportingspy.com', 'sportingspy.com:8443', 'sportingspy.com.evil.example', 'evil.example', '', undefined]) assert.equal(indexingBlocked('production', host, C), true, `production blocks ${host}`);
assert.equal(indexingBlocked('production', C, null), true, 'no canonical host configured: blocked');
assert.equal(indexingBlocked('development', 'anything', C), false, 'development unchanged');
pass('decision: staging blocks all hosts; production allows only the canonical host; development unchanged');

const prodRobots = robotsTxt('https://sportingspy.com', 'production');
for (const line of ['Allow: /', 'Disallow: /admin/', 'Disallow: /account/', 'Disallow: /api/', 'Disallow: /reset-password/', 'Sitemap: https://sportingspy.com/sitemap.xml']) assert(prodRobots.split('\n').includes(line), `production robots.txt keeps "${line}"`);
for (const text of [robotsTxt('https://sportingspy.com', 'staging'), robotsTxt('https://sportingspy.com', 'production', true)]) {
  assert(text.split('\n').includes('Disallow: /'), 'blocked robots.txt disallows everything');
  assert(!text.includes('Sitemap:') && !text.includes('Allow: /'), 'blocked robots.txt names no sitemap and allows nothing');
}
pass('robots.txt: production keeps its private paths and sitemap; staging and non-canonical hosts disallow everything with no sitemap');

// ── Running servers ──
assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe, 'Verification requires a local, non-production database.');
assert(fs.existsSync('.next/BUILD_ID'), 'Run npm run build first.');

async function freePort() {
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}
async function start(appEnv: 'production' | 'staging') {
  const port = await freePort();
  // TRUST_PROXY trusts this machine, so Express itself would believe X-Forwarded-Host.
  const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', TRUST_PROXY: '127.0.0.1/32', NODE_ENV: 'production', APP_ENV: appEnv, AUTH_MODE: 'production', DEV_LOGIN_BYPASS: 'false', ALLOWED_ORIGIN: `http://localhost:${port}`, INDEXNOW_ENDPOINT: '', SHOW_AD_PLACEHOLDERS: 'false' } as NodeJS.ProcessEnv,
  });
  let output = '';
  child.stdout!.on('data', (c) => { output += c; }); child.stderr!.on('data', (c) => { output += c; });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${appEnv} server did not start.\n${output}`)), 90_000);
    child.stdout!.on('data', (c) => { if (String(c).includes('Server running')) { clearTimeout(t); resolve(); } });
    child.once('exit', () => { clearTimeout(t); reject(new Error(`${appEnv} server exited.\n${output}`)); });
  });
  return { port, child };
}
/** A GET with an exact Host header (fetch cannot set one). */
function get(port: number, path: string, headers: Record<string, string>) {
  return new Promise<{ status: number; robots: string | undefined; body: string }>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
      let body = ''; res.setEncoding('utf8'); res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, robots: res.headers['x-robots-tag'] as string | undefined, body }));
    });
    req.on('error', reject); req.end();
  });
}

const children: ChildProcess[] = [];
try {
  const prod = await start('production'); children.push(prod.child);
  const canonical = `localhost:${prod.port}`;
  for (const host of [canonical, `LOCALHOST:${prod.port}`, `localhost.:${prod.port}`]) {
    for (const path of ['/', '/robots.txt', '/sitemap.xml']) {
      const r = await get(prod.port, path, { Host: host });
      assert.equal(r.status, 200, `${host}${path}`); assert.equal(r.robots, undefined, `production on ${host}${path} sends no X-Robots-Tag`);
    }
    const robots = (await get(prod.port, '/robots.txt', { Host: host })).body;
    assert(robots.includes('Allow: /') && robots.includes('Disallow: /admin/') && robots.includes(`Sitemap: `), `production robots.txt on ${host} allows crawling`);
  }
  const home = (await get(prod.port, '/', { Host: canonical })).body;
  assert.match(home, /<meta name="robots" content="index, follow"/, 'the homepage keeps its own index, follow');
  assert.match(home, new RegExp(`<link rel="canonical" href="http://localhost:${prod.port}/"`), 'canonical URL comes from the configured origin as before');
  pass('production, canonical host (any case, trailing dot): no X-Robots-Tag; robots.txt allows crawling and names the sitemap; page robots and canonical unchanged');

  const spoof = { 'X-Forwarded-Host': canonical, 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '203.0.113.9' };
  for (const [host, extra] of [['sprtingspy-2-o.onrender.com', {}], ['sprtingspy-2-o.onrender.com', spoof], ['evil.example', spoof], [`127.0.0.1:${prod.port}`, {}], [`localhost:${prod.port + 1}`, {}]] as const) {
    for (const path of ['/', '/robots.txt', '/sitemap.xml']) {
      const r = await get(prod.port, path, { Host: host, ...extra });
      assert.equal(r.robots, 'noindex, nofollow', `production on ${host}${path}${'X-Forwarded-Host' in extra ? ' (forwarded canonical host)' : ''} is blocked`);
    }
    const robots = (await get(prod.port, '/robots.txt', { Host: host, ...extra })).body;
    assert(robots.split('\n').includes('Disallow: /') && !robots.includes('Sitemap:'), `robots.txt on ${host} disallows everything and names no sitemap`);
  }
  pass('production, Render and unknown hosts (and another port): X-Robots-Tag noindex and robots.txt Disallow: /, even with a forwarded canonical host from a trusted proxy');

  const stage = await start('staging'); children.push(stage.child);
  for (const host of [`localhost:${stage.port}`, 'sprtingspy-2-o.onrender.com', 'sportingspy.com']) {
    for (const path of ['/', '/robots.txt']) assert.equal((await get(stage.port, path, { Host: host })).robots, 'noindex, nofollow', `staging on ${host}${path}`);
    const robots = (await get(stage.port, '/robots.txt', { Host: host })).body;
    assert(robots.startsWith('# Staging environment') && robots.split('\n').includes('Disallow: /'), `staging robots.txt on ${host}`);
  }
  pass('staging: every host, including its own canonical one, is blocked exactly as before');
} finally {
  for (const child of children) child.kill();
}
console.log(`Indexing host verification passed: ${checks} checks.`);
process.exit(0);
