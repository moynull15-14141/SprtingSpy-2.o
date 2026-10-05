/**
 * Render staging check (PHASE R deployment). Read-only against a running
 * staging service (APP_ENV=staging behind an HTTPS proxy):
 *
 *   STAGING_BASE_URL=https://<service>.onrender.com npm run verify:render-staging
 *
 * Optional:
 *   STAGING_ORIGIN          the service's ALLOWED_ORIGIN (default: STAGING_BASE_URL's origin)
 *   STAGING_FORWARD_HTTPS=1 local simulation: send X-Forwarded-Proto: https to a plain-HTTP
 *                           server whose TRUST_PROXY includes this machine (as Render's proxy does)
 *   MEDIA_PUBLIC_BASE_URL   expected public media host; also checks that media actually loads
 *
 * Checks health/readiness, HTTPS enforcement and HSTS, staging noindex, pages,
 * media delivery, cookie flags, CORS and CSRF. Never logs in, creates or edits anything.
 */
import assert from 'node:assert/strict';

const base = (process.env.STAGING_BASE_URL || '').replace(/\/+$/, '');
assert(base, 'Set STAGING_BASE_URL.');
const origin = (process.env.STAGING_ORIGIN || new URL(base).origin).replace(/\/+$/, '');
const forwardHttps = process.env.STAGING_FORWARD_HTTPS === '1';
const mediaBase = (process.env.MEDIA_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
let passed = 0;
const pass = (s: string) => { passed++; console.log(`PASS ${s}`); };

async function get(path: string, init: RequestInit & { plain?: boolean } = {}) {
  const headers = new Headers(init.headers);
  if (forwardHttps && !init.plain) headers.set('X-Forwarded-Proto', 'https');
  const res = await fetch(base + path, { redirect: 'manual', ...init, headers });
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, headers: res.headers, text, json, cookies: res.headers.getSetCookie() };
}
const page = async (path: string, status = 200) => { const r = await get(path); assert.equal(r.status, status, `${path}: expected ${status}, got ${r.status}`); return r; };

// ── Health ──
assert.deepEqual((await page('/api/health')).json, { status: 'ok' });
const ready = await get('/api/health/ready');
assert.equal(ready.status, 200, `readiness: ${ready.text}`);
assert.equal(ready.json.status, 'ready');
assert(!/postgres|password|@|\.pem/.test(ready.text), 'readiness leaks nothing');
pass(`health and readiness: ${JSON.stringify(ready.json)}`);

// ── HTTPS / proxy ──
if (forwardHttps) {
  const plain = await get('/', { plain: true });
  assert.equal(plain.status, 426, 'a plain-HTTP request (not from the trusted proxy) is refused');
  pass('requests that did not arrive over HTTPS are refused (426); health checks are exempt');
}
const home = await page('/');
assert.match(home.headers.get('strict-transport-security') || '', /max-age=\d+/, 'HSTS on HTTPS responses');
const csp = home.headers.get('content-security-policy') || '';
assert(csp.includes("script-src 'self' 'nonce-") && csp.includes("frame-ancestors 'none'"), 'strict CSP');
for (const h of ['x-content-type-options', 'referrer-policy', 'x-frame-options', 'x-request-id']) assert(home.headers.get(h), `missing ${h}`);
assert(!home.headers.get('x-powered-by'), 'no X-Powered-By');
pass('HTTPS is recognised through the proxy: HSTS, strict CSP and security headers present');

// ── Staging must not be indexed ──
assert.match(home.headers.get('x-robots-tag') || '', /noindex/, 'X-Robots-Tag noindex on staging');
assert.match((await page('/robots.txt')).text, /Disallow: \/\s*$/m, 'robots.txt disallows everything on staging');
pass('staging is noindex (X-Robots-Tag and robots.txt)');

// ── Pages (from the sitemap) ──
const index = (await page('/sitemap.xml')).text;
const children = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
const urls = (await Promise.all(children.map(async (c) => (await page(c)).text))).flatMap((t) => [...t.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname));
const pick = (re: RegExp) => urls.find((p) => re.test(p));
const samples = ['/', '/sports/', '/events/', '/latest/', '/search/?q=open', pick(/^\/[a-z0-9-]+\/[a-z0-9-]+\/$/), pick(/^\/[a-z0-9-]+\/[a-z0-9-]+\/\d{4}\/$/), pick(/^\/[a-z0-9-]+\/[a-z0-9-]+\/\d{4}\/[a-z0-9-]+\/$/)].filter(Boolean) as string[];
let html = '';
for (const p of samples) html += (await page(p)).text;
await page('/no-such-page-render-check/', 404);
assert.equal((await page('/admin/')).status, 200);
pass(`pages render: ${samples.join(' ')}; unknown URL 404; /admin/ login page`);

// ── Media ──
if (mediaBase) {
  const images = [...new Set([...html.matchAll(/(?:src|srcSet|srcset)="([^"\s]+)/g)].map((m) => m[1].replace(/&amp;/g, '&')).filter((u) => u.startsWith(mediaBase)))];
  assert(images.length, `pages use media from ${mediaBase}`);
  for (const url of images.slice(0, 5)) {
    const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    assert(r.ok && (r.headers.get('content-type') || '').startsWith('image/'), `${url}: ${r.status}`);
  }
  const key = images[0].slice(mediaBase.length + 1);
  const legacy = await get(`/media/${key}`);
  assert(legacy.status === 301 && legacy.headers.get('location') === `${mediaBase}/${key}`, `/media/ redirect: ${legacy.status}`);
  pass(`${images.length} media URLs served from the public bucket and load as images; old /media/ URLs redirect there`);
}

// ── Cookies, CSRF, CORS ──
const me = await get('/api/auth/me');
assert.equal(me.status, 401, 'anonymous /api/auth/me');
const csrf = me.cookies.find((c) => c.startsWith('csrf_token='));
assert(csrf && /;\s*Secure/i.test(csrf) && /SameSite=Lax/i.test(csrf), `CSRF cookie flags: ${csrf}`);
const token = csrf.split(';')[0].split('=')[1];
const noToken = await get('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: '{}' });
assert.equal(noToken.status, 403, 'login without CSRF token is refused');
const logout = await get('/api/auth/logout', { method: 'POST', headers: { Origin: origin, Cookie: `csrf_token=${token}`, 'x-csrf-token': token } });
const cleared = logout.cookies.find((c) => c.startsWith('sid=')) || logout.cookies.join(' | ');
assert(/HttpOnly/i.test(cleared) && /Secure/i.test(cleared) && /SameSite=Lax/i.test(cleared), `session cookie flags: ${cleared}`);
const foreign = await get('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example', Cookie: `csrf_token=${token}`, 'x-csrf-token': token }, body: '{}' });
assert.equal(foreign.status, 403, 'foreign Origin refused even with a valid CSRF pair');
assert(!foreign.headers.get('access-control-allow-origin'), 'no CORS header for a foreign origin');
const own = await get('/api/health', { headers: { Origin: origin } });
assert.equal(own.headers.get('access-control-allow-origin'), origin, 'CORS allows only ALLOWED_ORIGIN');
assert.equal((await get('/api/cms/data')).status, 401, 'CMS data needs a session');
pass('cookies are Secure/SameSite (session HttpOnly); CSRF required; foreign origins refused; CMS needs a session');

console.log(`PASS ${passed} Render staging check groups against ${base}`);
