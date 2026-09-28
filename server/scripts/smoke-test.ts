/**
 * Post-deploy smoke test (PHASE G). Read-only against any running instance:
 *
 *   SMOKE_BASE_URL=https://sportingspy.com npx tsx server/scripts/smoke-test.ts
 *
 * Optional:
 *   SMOKE_EXPECT_ORIGIN   canonical origin the pages must use (default: SMOKE_BASE_URL's origin)
 *   SMOKE_EMAIL / SMOKE_PASSWORD   a staff account: adds login → CMS → logout checks
 *                          (creates and ends one session, which is audit-logged)
 *   SMOKE_RATE_LIMIT=1     also confirm the public search rate limit (sends ~125 requests)
 *
 * Exits non-zero on the first failure. Never creates, edits or deletes content.
 */
import assert from 'node:assert/strict';

const base = (process.env.SMOKE_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const origin = (process.env.SMOKE_EXPECT_ORIGIN || new URL(base).origin).replace(/\/+$/, '');
const production = base.startsWith('https://') || process.env.SMOKE_PRODUCTION === '1';
let passed = 0;
const ok = (s: string) => { passed++; console.log(`PASS ${s}`); };
const cookies = new Map<string, string>();

async function get(path: string, init: RequestInit & { keepCookies?: boolean } = {}) {
  const headers = new Headers(init.headers);
  if (init.keepCookies) headers.set('Cookie', [...cookies].map(([k, v]) => `${k}=${v}`).join('; '));
  const res = await fetch(base + path, { redirect: 'manual', ...init, headers });
  if (init.keepCookies) for (const raw of res.headers.getSetCookie()) { const p = raw.split(';')[0]; const i = p.indexOf('='); cookies.set(p.slice(0, i), p.slice(i + 1)); }
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, headers: res.headers, text, json };
}
const page = async (path: string, status = 200) => {
  const r = await get(path);
  assert.equal(r.status, status, `${path}: expected ${status}, got ${r.status}`);
  return r;
};

// ── Health & platform ──
assert.deepEqual((await page('/api/health')).json, { status: 'ok' });
const ready = await get('/api/health/ready');
assert.equal(ready.status, 200, `readiness: ${ready.text}`); assert.equal(ready.json.status, 'ready');
assert(!/postgres|password|localhost:\d/.test(ready.text), 'readiness leaks nothing');
ok('liveness and readiness (database + media storage) respond without leaking internals');

const home = await page('/');
for (const h of ['x-content-type-options', 'referrer-policy', 'x-frame-options', 'permissions-policy', 'x-request-id']) assert(home.headers.get(h), `missing header ${h}`);
if (production) {
  const csp = home.headers.get('content-security-policy') || '';
  assert(csp.includes("script-src 'self' 'nonce-") && csp.includes("frame-ancestors 'none'") && !/frame-src[^;]*\*/.test(csp), 'strict CSP');
  assert(csp.includes('https://www.youtube-nocookie.com') && csp.includes('https://player.vimeo.com'), 'embed players allowed');
}
assert(!home.headers.get('x-powered-by'), 'no X-Powered-By');
ok(`security headers present${production ? ', strict CSP with embed players' : ''}; request IDs issued`);

const malformed = await get('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"broken":' });
assert(malformed.status === 400 || malformed.status === 403, `malformed body: ${malformed.status}`);
assert(!/at \w+ \(|stack|prisma|SyntaxError/i.test(malformed.text), 'error responses are sanitized');
ok('errors are sanitized (no stack traces or internals)');

// ── Public pages (discovered from the sitemap, so nothing is hard-coded) ──
const index = (await page('/sitemap.xml')).text;
const children = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
assert(children.length && children.every((u) => u.startsWith(`${origin}/`)), `sitemap index uses ${origin}`);
const urls = (await Promise.all(children.map(async (c) => (await page(new URL(c).pathname)).text))).flatMap((t) => [...t.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
assert(urls.length > 0 && urls.every((u) => u.startsWith(`${origin}/`)), 'child sitemaps list canonical URLs only');
assert(!urls.some((u) => /\/(search|admin|account|api)\//.test(u)), 'no private or search URLs in sitemaps');
const pick = (re: RegExp) => urls.map((u) => new URL(u).pathname).find((p) => re.test(p));
const samples = {
  home: '/', sports: '/sports/', events: '/events/', latest: '/latest/',
  sport: pick(/^\/(?!(sports|events|latest|search|about|contact|dmca|privacy-policy|terms-and-conditions)\/$)[a-z0-9-]+\/$/), article: pick(/^\/[a-z0-9-]+\/[a-z0-9-]+\/\d{4}\/[a-z0-9-]+\/$/), edition: pick(/^\/[a-z0-9-]+\/[a-z0-9-]+\/\d{4}\/$/), author: pick(/^\/author\/[a-z0-9-]+\/$/),
};
for (const [name, path] of Object.entries(samples)) {
  assert(path, `no ${name} URL in the sitemap`);
  const r = await page(path);
  const canon = [...r.text.matchAll(/<link rel="canonical" href="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(canon.length, 1, `${path}: one canonical`); assert(canon[0].startsWith(`${origin}/`) && !/localhost|127\.0\.0\.1/.test(canon[0]) === !/localhost|127\.0\.0\.1/.test(origin), `${path}: canonical ${canon[0]}`);
  assert(!/noindex/.test(r.text.match(/<meta name="robots"[^>]*>/)?.[0] || ''), `${path}: indexable`);
}
ok(`sitemap-discovered pages render with one canonical on ${origin}: ${Object.values(samples).join(' ')}`);

const missing = await page('/this-page-does-not-exist-smoke/', 404);
assert(/noindex/.test(missing.text), '404 is noindex');
assert(/Disallow: \/admin\//.test((await page('/robots.txt')).text), 'robots disallows /admin/');
assert(/noindex, ?nofollow/.test((await page('/admin/')).text), 'admin is noindex,nofollow');
assert(/noindex/.test((await page('/search/?q=test')).text), 'search is noindex');
const privacy = await page('/privacy-policy/');
assert(privacy.text.includes('sportingspy_consent') && privacy.text.includes('Privacy choices'), 'privacy page and choices');
ok('404, robots, admin/search noindex and privacy page behave as intended');

// ── Search ──
const s = async (q: string, extra = '') => (await page(`/api/search?q=${encodeURIComponent(q)}${extra}`)).json;
const normal = await s('open'); assert(normal.total >= 0 && Array.isArray(normal.results));
await s('বাংলাদেশ ক্রিকেট'); await s('cricket বাংলাদেশ'); await s('tenis'); await s('open', '&sort=newest&page=2&limit=5');
const none = await s(`zqxv${Date.now()}`); assert.equal(none.total, 0);
assert.equal((await get('/api/search?limit=500')).status, 400, 'search limit bound');
assert(Array.isArray((await page('/api/search/suggestions?q=op')).json.articles));
assert.equal((await get('/api/cms/articles/search?q=x')).status, 401, 'CMS search needs a session');
ok('search: normal, Bangla, mixed, typo, filters/pagination, no-result, validation, suggestions; CMS search protected');

if (process.env.SMOKE_RATE_LIMIT === '1') {
  let limited = false;
  for (let i = 0; i < 130 && !limited; i++) limited = (await get('/api/search?q=smoke')).status === 429;
  assert(limited, 'search rate limit'); ok('public search is rate limited');
}

// ── Authentication & CMS (optional) ──
assert.equal((await get('/api/cms/data')).status, 401, 'CMS data needs a session');
if (process.env.SMOKE_EMAIL && process.env.SMOKE_PASSWORD) {
  await get('/api/auth/me', { keepCookies: true });
  const login = await get('/api/auth/login', { keepCookies: true, method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': cookies.get('csrf_token') || '' }, body: JSON.stringify({ email: process.env.SMOKE_EMAIL, password: process.env.SMOKE_PASSWORD }) });
  assert.equal(login.status, 200, `login: ${login.status}`);
  assert.equal((await get('/api/auth/me', { keepCookies: true })).status, 200);
  assert.equal((await get('/api/cms/data', { keepCookies: true })).status, 200);
  assert.equal((await get('/api/cms/articles/search?q=a&status=draft', { keepCookies: true })).status, 200);
  const logout = await get('/api/auth/logout', { keepCookies: true, method: 'POST', headers: { 'x-csrf-token': cookies.get('csrf_token') || '' } });
  assert.equal(logout.status, 200);
  assert.equal((await get('/api/auth/me', { keepCookies: true })).status, 401, 'session ends on logout');
  ok('staff login, CMS data and article search, logout ends the session');
} else console.log('SKIP authenticated checks (set SMOKE_EMAIL and SMOKE_PASSWORD)');

console.log(`PASS ${passed} smoke-test groups against ${base}`);
