/**
 * PHASE PAGES verification. Runs the production build against a LOCAL
 * development database (refuses anything else) and checks, over HTTP:
 *   draft → edit → preview → publish → public URL → live edit → unpublish →
 *   404 → delete; duplicate/reserved/sport slugs; slug-change 301; SEO
 *   metadata, robots and sitemap; footer link (and the unpublish guard it
 *   creates); the existing About/Contact/Privacy/Terms/DMCA URLs and legacy
 *   redirects; role restrictions and CSRF; XSS-safe content; media delete guard.
 * Fixture rows are removed and the footer row restored afterwards.
 *
 *   npm run build && npm run test:pages
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
import { mediaUsageMap } from '../media/service';

assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe, 'Pages verification requires a local development database.');
assert(fs.existsSync('.next/BUILD_ID'), 'Build before verification (npm run build).');

const fx = `pg${crypto.randomUUID().slice(0, 6)}`;
const password = `Pages-${crypto.randomUUID()}`;
const ids = { admin: `${fx}-admin`, editor: `${fx}-editor`, author: `${fx}-author` };
const footerBefore = await prisma.siteExperience.findUnique({ where: { area: 'footer' } });

const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = (probe.address() as { port: number }).port; await new Promise<void>((resolve) => probe.close(() => resolve()));
const base = `http://127.0.0.1:${port}`;
let output = '';
const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
  cwd: process.cwd(), windowsHide: true,
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', TRUST_PROXY: 'false', NODE_ENV: 'production', APP_ENV: 'production', AUTH_MODE: 'production', DEV_LOGIN_BYPASS: 'false', ALLOWED_ORIGIN: base, SITE_ORIGIN: base, INDEXNOW_ENDPOINT: '', GEMINI_API_KEY: '', MEDIA_STORAGE_PROVIDER: 'local' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (c) => { output += c; }); child.stderr.on('data', (c) => { output += c; });

let checks = 0; const pass = (m: string) => { checks++; console.log(`PASS ${m}`); };
class Client {
  cookies = new Map<string, string>();
  async request(path: string, method = 'GET', body?: unknown, opts: { csrf?: boolean } = {}) {
    const headers: Record<string, string> = { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET' && opts.csrf !== false) headers['x-csrf-token'] = this.cookies.get('csrf_token') ?? '';
    const res = await fetch(base + path, { method, headers, redirect: 'manual', body: body === undefined ? undefined : JSON.stringify(body) });
    for (const raw of res.headers.getSetCookie()) { const [pair] = raw.split(';'); const i = pair.indexOf('='); const v = pair.slice(i + 1); if (v) this.cookies.set(pair.slice(0, i), v); else this.cookies.delete(pair.slice(0, i)); }
    const text = await res.text(); let data: any; try { data = JSON.parse(text); } catch { /* HTML */ }
    return { status: res.status, text, data, location: res.headers.get('location') };
  }
  async ok(path: string, method = 'GET', body?: unknown) {
    const r = await this.request(path, method, body);
    assert(r.status >= 200 && r.status < 300, `${method} ${path}: HTTP ${r.status} ${r.text.slice(0, 300)}`);
    return r.data;
  }
  async status(path: string, method: string, body: unknown, expected: number, contains?: RegExp) {
    const r = await this.request(path, method, body);
    assert.equal(r.status, expected, `${method} ${path}: expected ${expected}, got ${r.status} ${r.text.slice(0, 300)}`);
    if (contains) assert.match(r.data?.error ?? r.text, contains);
    return r;
  }
}
const anon = new Client();
const meta = (html: string, attr: string, key: string) => html.match(new RegExp(`<meta[^>]*${attr}="${key}"[^>]*content="([^"]*)"`))?.[1] ?? html.match(new RegExp(`<meta[^>]*content="([^"]*)"[^>]*${attr}="${key}"`))?.[1];
const canonical = (html: string) => html.match(/<link[^>]*rel="canonical"[^>]*href="([^"]*)"/)?.[1];
const titleOf = (html: string) => html.match(/<title>([^<]*)<\/title>/)?.[1];
const doc = (...paragraphs: string[]) => ({ type: 'doc', content: paragraphs.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })) });

let failed = false;
const created: string[] = [];
try {
  // Fixture staff accounts.
  for (const [role, id] of [['Admin', ids.admin], ['Editor', ids.editor], ['Author', ids.author]] as const) {
    await prisma.user.create({ data: { id, name: `${fx} ${role}`, email: `${id}@example.test`, role, avatar: '', joinedAt: new Date(), passwordHash: hashPassword(password) } });
  }
  for (let i = 0; i < 120 && !/Server running/.test(output); i++) await new Promise((r) => setTimeout(r, 500));
  assert.match(output, /Server running/, `server did not start:\n${output.slice(-2000)}`);
  const login = async (id: string) => { const c = new Client(); await c.request('/robots.txt'); assert.equal((await c.request('/api/auth/login', 'POST', { email: `${id}@example.test`, password })).status, 200); return c; };
  const [admin, editor, author] = [await login(ids.admin), await login(ids.editor), await login(ids.author)];

  // ── Existing URLs (13–16) ──
  const sys: [string, RegExp[]][] = [
    ['/about/', [/About SportingSpy/, /Our Conceptual Hierarchy/, /Editorial Independence/, /SPORT → PERMANENT EVENT → EVENT EDITION → ARTICLE/]],
    ['/privacy-policy/', [/What we collect/, /Technical requests:/, /Cookies and storage/, /csrf_token/, /Your choices/]],
    ['/terms-and-conditions/', [/Terms of Service/, /Last Revised: September 2026/, /By accessing SportingSpy.com/]],
    ['/dmca/', [/DMCA Copyright Policy/, /DMCA Policy/, /dmca@sportingspy.com/]],
    ['/contact/', [/Contact Editorial Bureau/, /Direct inquiries for newsroom correspondents/, /<form/]],
  ];
  for (const [path, patterns] of sys) {
    const r = await anon.request(path);
    assert.equal(r.status, 200, `${path}: ${r.status}`);
    for (const p of patterns) assert.match(r.text, p, `${path} missing ${p}`);
    assert.equal(canonical(r.text), `${base}${path}`);
  }
  assert.equal(titleOf((await anon.request('/about/')).text), 'About SportingSpy – Multi-Sport Editorial Standards');
  assert.equal(meta((await anon.request('/terms-and-conditions/')).text, 'name', 'description'), 'Terms of service and reader agreement for SportingSpy.com.');
  pass('existing About, Privacy, Terms, DMCA and Contact URLs serve their content, title, description and canonical');
  for (const [from, to] of [['/terms', '/terms-and-conditions/'], ['/privacy', '/privacy-policy/']]) {
    const r = await anon.request(from); assert.equal(r.status, 301); assert.equal(new URL(r.location!, base).pathname, to);
  }
  assert.equal((await anon.request('/about')).status, 301, 'trailing-slash redirect still applies');
  pass('legacy /terms and /privacy redirects and the trailing-slash policy are unchanged');

  // ── Authorization (17) ──
  assert.equal((await anon.request('/api/pages')).status, 401);
  await author.status('/api/pages', 'GET', undefined, 403);
  await author.status('/api/pages', 'POST', { title: 'Author page', slug: `${fx}-author`, body: doc('x') }, 403);
  const noCsrf = await editor.request('/api/pages', 'POST', { title: 'No CSRF', slug: `${fx}-nocsrf`, body: doc('x') }, { csrf: false });
  assert.equal(noCsrf.status, 403, 'CSRF enforced');
  pass('anonymous 401, Author 403 (read and write), missing CSRF token 403');

  // ── Create / edit draft (1–2) ──
  const slug = `${fx}-editorial-policy`;
  const page = await editor.ok('/api/pages', 'POST', { title: 'Editorial Policy', slug, summary: 'How we work', body: doc('We verify every schedule against primary sources.') });
  created.push(page.id);
  assert.equal(page.status, 'draft'); assert.equal(page.system, false); assert.equal(page.template, 'standard');
  await editor.status('/api/pages', 'POST', { title: 'Sneaky', slug: `${fx}-sneaky`, body: doc('x'), status: 'published' }, 400, /publish/);
  pass('Editor creates a draft; status cannot be set on create');
  const edited = await editor.ok(`/api/pages/${page.id}`, 'PUT', { title: 'Editorial Policy & Standards', body: doc('We verify every schedule against primary sources.', 'Corrections are published openly.'), seoTitle: `Editorial Policy ${fx} | SportingSpy`, seoDescription: `How SportingSpy verifies facts ${fx}.` });
  assert.equal(edited.title, 'Editorial Policy & Standards'); assert.match(edited.content, /Corrections are published openly/);
  pass('draft edited (title, body, SEO fields)');

  // Draft is not public (8).
  assert.equal((await anon.request(`/${slug}/`)).status, 404);
  assert.ok(!(await anon.request('/sitemaps/pages.xml')).text.includes(`/${slug}/`), 'draft not in sitemap');
  pass('draft URL returns 404 and is not in the sitemap');

  // ── Preview (3) ──
  const preview = await editor.request(`/admin/preview/page/${page.id}/`);
  assert.equal(preview.status, 200); assert.match(preview.text, /Corrections are published openly/); assert.match(preview.text, /Staff preview/);
  assert.match(meta(preview.text, 'name', 'robots') || '', /noindex/);
  assert.equal((await anon.request(`/admin/preview/page/${page.id}/`)).status, 404);
  assert.equal((await author.request(`/admin/preview/page/${page.id}/`)).status, 404);
  pass('staff preview renders the draft (noindex); anonymous and Author get 404');

  // ── Publish and public URL (4–5, 11) ──
  const published = await editor.ok(`/api/pages/${page.id}/publish`, 'POST', {});
  assert.equal(published.status, 'published'); assert.ok(published.publishedAt);
  const live = await anon.request(`/${slug}/`);
  assert.equal(live.status, 200); assert.match(live.text, /Editorial Policy &amp; Standards/); assert.match(live.text, /Corrections are published openly/);
  assert.equal(titleOf(live.text), `Editorial Policy ${fx} | SportingSpy`);
  assert.equal(meta(live.text, 'name', 'description'), `How SportingSpy verifies facts ${fx}.`);
  assert.equal(canonical(live.text), `${base}/${slug}/`);
  assert.equal(meta(live.text, 'property', 'og:title'), `Editorial Policy ${fx} | SportingSpy`);
  assert.equal(meta(live.text, 'property', 'og:url'), `${base}/${slug}/`);
  assert.doesNotMatch(meta(live.text, 'name', 'robots') || 'index', /noindex/);
  assert.ok((await anon.request('/sitemaps/pages.xml')).text.includes(`${base}/${slug}/`), 'published page in sitemap');
  pass('published page is public with title, description, canonical, Open Graph, index robots and sitemap entry');

  // ── Edit published (6) ──
  await editor.ok(`/api/pages/${page.id}`, 'PUT', { body: doc('Updated live text.') });
  assert.match((await anon.request(`/${slug}/`)).text, /Updated live text\./);
  pass('editing a published page updates the public page at once (cache invalidated)');

  // noindex
  await editor.ok(`/api/pages/${page.id}`, 'PUT', { noIndex: true });
  assert.match(meta((await anon.request(`/${slug}/`)).text, 'name', 'robots') || '', /noindex/);
  assert.ok(!(await anon.request('/sitemaps/pages.xml')).text.includes(`/${slug}/`));
  await editor.ok(`/api/pages/${page.id}`, 'PUT', { noIndex: false });
  pass('noindex sets robots noindex and removes the page from the sitemap');

  // ── Slug rules (10) and slug change 301 ──
  const other = await editor.ok('/api/pages', 'POST', { title: 'Other', slug: `${fx}-other`, body: doc('Other page.') });
  created.push(other.id);
  await editor.status('/api/pages', 'POST', { title: 'Dup', slug, body: doc('x') }, 409, /already used/);
  await editor.status(`/api/pages/${other.id}`, 'PUT', { slug }, 409, /already used/);
  for (const bad of ['admin', 'search', 'about', 'Bad Slug', '../x', 'a--b']) await editor.status('/api/pages', 'POST', { title: 'Bad', slug: bad, body: doc('x') }, 400);
  const sport = await prisma.sport.findFirst({ select: { slug: true } });
  if (sport) await editor.status('/api/pages', 'POST', { title: 'Sport clash', slug: sport.slug, body: doc('x') }, 409, /sport/);
  const sportClash = await admin.request('/api/sports', 'POST', { name: 'Clash', slug, description: 'x' });
  assert.equal(sportClash.status, 400, `sport create with a page slug: ${sportClash.status}`); assert.match(sportClash.data.error, /page/);
  pass('duplicate, reserved, malformed and sport slugs rejected; a sport cannot take a page slug');
  const newSlug = `${slug}-v2`;
  await editor.ok(`/api/pages/${page.id}`, 'PUT', { slug: newSlug });
  const moved = await anon.request(`/${slug}`);
  assert.equal(moved.status, 301); assert.equal(new URL(moved.location!, base).pathname, `/${newSlug}/`);
  assert.equal((await anon.request(`/${newSlug}/`)).status, 200);
  pass('changing a published slug serves the new URL and 301s the old one');

  // ── System pages are protected ──
  const about = (await editor.ok('/api/pages?q=about')).pages.find((p: any) => p.slug === 'about');
  assert.ok(about?.system);
  await editor.status(`/api/pages/${about.id}`, 'PUT', { slug: 'about-us' }, 400, /fixed/);
  await editor.status(`/api/pages/${about.id}/unpublish`, 'POST', {}, 400, /required/);
  await admin.status(`/api/pages/${about.id}`, 'DELETE', undefined, 400, /cannot be deleted/);
  const aboutFull = await editor.ok(`/api/pages/${about.id}`);
  await editor.ok(`/api/pages/${about.id}`, 'PUT', { summary: `Tagline ${fx}` });
  assert.match((await anon.request('/about/')).text, new RegExp(`Tagline ${fx}`));
  await editor.ok(`/api/pages/${about.id}`, 'PUT', { summary: aboutFull.summary });
  const contact = (await editor.ok('/api/pages?q=contact')).pages.find((p: any) => p.slug === 'contact');
  await editor.ok(`/api/pages/${contact.id}`, 'PUT', { body: { type: 'doc', content: [{ type: 'paragraph' }] } });
  pass('system pages: content editable, but URL fixed and cannot be unpublished or deleted; Contact may have no body text');

  // ── Footer integration (12) ──
  const areas = (await admin.ok('/api/site-experience')).areas;
  const footer = structuredClone(areas.find((a: any) => a.area === 'footer').draft);
  const column = footer.columns.find((c: any) => c.kind === 'links');
  column.links.push({ id: `${fx}link`, label: 'Editorial Policy', href: `/${newSlug}/`, enabled: true, kind: 'link', system: false });
  await admin.ok('/api/site-experience/footer/draft', 'PUT', { document: footer });
  await admin.ok('/api/site-experience/footer/publish', 'POST', {});
  assert.match((await anon.request('/')).text, new RegExp(`href="/${newSlug}/"`));
  await editor.status(`/api/pages/${page.id}/unpublish`, 'POST', {}, 409, /footer/);
  pass('a published page can be linked from the footer; unpublishing a linked page is refused');
  column.links = column.links.filter((l: any) => l.id !== `${fx}link`);
  await admin.ok('/api/site-experience/footer/draft', 'PUT', { document: footer });
  await admin.ok('/api/site-experience/footer/publish', 'POST', {});

  // ── XSS / content safety (18) ──
  await editor.status(`/api/pages/${other.id}`, 'PUT', { body: { type: 'doc', content: [{ type: 'script', content: [{ type: 'text', text: 'alert(1)' }] }] } }, 400);
  await editor.status(`/api/pages/${other.id}`, 'PUT', { body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)', target: null, rel: null } }] }] }] } }, 400);
  await editor.status(`/api/pages/${other.id}`, 'PUT', { body: { type: 'doc', content: [{ type: 'image', attrs: { src: 'https://evil.example/x.png', mediaId: 'nope' } }] } }, 400);
  await editor.ok(`/api/pages/${other.id}`, 'PUT', { title: `<script>alert("${fx}")</script>`, body: doc(`<img src=x onerror=alert(1)> ${fx}`) });
  await editor.ok(`/api/pages/${other.id}/publish`, 'POST', {});
  const xss = (await anon.request(`/${fx}-other/`)).text;
  assert.ok(!xss.includes(`<script>alert("${fx}")`) && !xss.includes('<img src=x onerror'), 'markup rendered as text');
  assert.match(xss, /&lt;script&gt;/); assert.match(xss, /&lt;img src=x onerror=alert\(1\)&gt;/);
  pass('unknown nodes, javascript: links and non-library images rejected; HTML in text is escaped');

  // ── Media delete guard ──
  // A fixture image nothing else uses, so the delete refusal can only come from the page.
  const media = await prisma.mediaItem.create({ data: { id: `${fx}-media`, title: `${fx} social image`, url: `https://images.unsplash.com/photo-${fx}?w=1200`, altText: 'Fixture social image', uploadedAt: new Date(), copyrightReview: 'reviewed' } });
  {
    await editor.ok(`/api/pages/${other.id}`, 'PUT', { ogMediaId: media.id });
    const og = await anon.request(`/${fx}-other/`);
    assert.ok(meta(og.text, 'property', 'og:image'), 'og:image present');
    assert.deepEqual((await mediaUsageMap())[media.id].map((u) => u.kind), ['page']);
    await admin.status(`/api/media/${media.id}`, 'DELETE', undefined, 409, /page/);
    await editor.ok(`/api/pages/${other.id}`, 'PUT', { ogMediaId: null });
    pass('Open Graph image from the Media Library is rendered, and that media item cannot be deleted while a page uses it');
  }

  // ── Unpublish and delete (7–9) ──
  await editor.ok(`/api/pages/${page.id}/unpublish`, 'POST', {});
  assert.equal((await anon.request(`/${newSlug}/`)).status, 404);
  assert.ok(!(await anon.request('/sitemaps/pages.xml')).text.includes(`/${newSlug}/`));
  pass('unpublished page returns 404 and leaves the sitemap');
  await editor.status(`/api/pages/${page.id}`, 'DELETE', undefined, 403);
  await admin.status(`/api/pages/${other.id}`, 'DELETE', undefined, 409, /Unpublish/);
  await admin.ok(`/api/pages/${page.id}`, 'DELETE');
  await admin.status(`/api/pages/${page.id}`, 'GET', undefined, 404);
  const log = await prisma.auditLog.findMany({ where: { entityId: page.id, entityType: 'Page' }, select: { action: true } });
  for (const action of ['Created Page', 'Updated Page', 'Published Page', 'Unpublished Page', 'Deleted Page']) assert.ok(log.some((l) => l.action === action), `audit: ${action}`);
  pass('only Admins delete, only unpublished pages; every step is audit-logged');
} catch (err) {
  failed = true;
  console.error(err);
  console.error(output.slice(-3000));
} finally {
  child.kill();
  await prisma.page.deleteMany({ where: { slug: { startsWith: fx } } });
  await prisma.redirectRule.deleteMany({ where: { sourceUrl: { contains: fx } } });
  await prisma.mediaItem.deleteMany({ where: { id: `${fx}-media` } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: Object.values(ids) } } });
  await prisma.session.deleteMany({ where: { userId: { in: Object.values(ids) } } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
  if (footerBefore) await prisma.siteExperience.update({ where: { area: 'footer' }, data: footerBefore as any });
  else await prisma.siteExperience.deleteMany({ where: { area: 'footer' } });
  await prisma.$disconnect();
}
if (failed) process.exit(1);
console.log(`Pages: ${checks} checks passed.`);
