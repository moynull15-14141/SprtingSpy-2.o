/** PHASE C verification: rich editor content, preview, Media Library,
 * image processing, media relations/usage, slug redirects, redirect safety
 * and CMS settings. Production-mode server (launch flags OFF), UUID-scoped
 * fixtures, full-row integrity check afterwards (including stored media
 * files). Requires `npm run build` and a local database.
 * Run: npm run test:phase-c   (browser checks when PLAYWRIGHT_MODULE is set)
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { prisma } from '../db';
import { checkDatabaseUrlIsLocalDev } from '../dbSafety';
import { hashPassword } from '../password';

assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe, 'Verification requires a local, non-production database.');
assert(fs.existsSync('.next/BUILD_ID'), 'Run npm run build first.');

const fixture = `phasec-${crypto.randomUUID()}`;
const password = `Test-${crypto.randomUUID()}`;
const ids = { admin: `${fixture}-admin`, editor: `${fixture}-editor`, author: `${fixture}-author-user`, author2: `${fixture}-author2-user` };
const userIds = Object.values(ids);
const bylines = { editor: `${fixture}-byline-editor`, author: `${fixture}-byline-author`, author2: `${fixture}-byline-author2` };
const mediaRoot = path.resolve(process.env.MEDIA_LOCAL_DIR || 'storage/media');
// Files that must stay byte-identical, where still present (both were moved to the project archive).
const protectedFiles = ['data/db.json', 'PROJECT_BRAIN.md'].filter((file) => fs.existsSync(file));
const digest = (value: string | Buffer) => crypto.createHash('sha256').update(value).digest('hex');
const filesBefore = protectedFiles.map((file) => digest(fs.readFileSync(file)));
const listMediaFiles = (): string[] => {
  const out: string[] = [];
  const walk = (dir: string) => { if (!fs.existsSync(dir)) return; for (const e of fs.readdirSync(dir, { withFileTypes: true })) e.isDirectory() ? walk(path.join(dir, e.name)) : out.push(path.relative(mediaRoot, path.join(dir, e.name)).replace(/\\/g, '/')); };
  walk(mediaRoot);
  return out.sort();
};
const mediaFilesBefore = listMediaFiles();
const tables = ['sport', 'sportEvent', 'eventEdition', 'article', 'articleMedia', 'author', 'user', 'session', 'comment', 'mediaItem', 'adSlotConfig', 'redirectRule', 'siteSetting', 'auditLog'] as const;
const orderKey: Record<string, object> = { articleMedia: [{ articleId: 'asc' }, { mediaId: 'asc' }], siteSetting: { key: 'asc' } };
async function snapshot() {
  const result: Record<string, { count: number; hash: string }> = {};
  for (const table of tables) {
    const rows = await (prisma[table] as any).findMany({ orderBy: orderKey[table] || { id: 'asc' } });
    result[table] = { count: rows.length, hash: digest(JSON.stringify(rows)) };
  }
  return result;
}
const before = await snapshot();
const redirectIdsBefore = new Set((await prisma.redirectRule.findMany({ select: { id: true } })).map((r) => r.id));
const settingsBefore = await prisma.siteSetting.findMany();
console.log('BEFORE row counts:', Object.fromEntries(Object.entries(before).map(([k, v]) => [k, v.count])), `media files: ${mediaFilesBefore.length}`);

const probe = createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = (probe.address() as { port: number }).port;
await new Promise<void>((resolve) => probe.close(() => resolve()));
const base = `http://localhost:${port}`;
const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
  cwd: process.cwd(),
  windowsHide: true,
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', TRUST_PROXY: 'false', NODE_ENV: 'production', APP_ENV: 'production', AUTH_MODE: 'production', DEV_LOGIN_BYPASS: 'false', ALLOWED_ORIGIN: base, ENABLE_READER_ACCOUNTS: 'false', ENABLE_COMMENTS: 'false' } as NodeJS.ProcessEnv,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
child.stdout.on('data', (c) => { serverOutput += c; });
child.stderr.on('data', (c) => { serverOutput += c; });

let checks = 0;
const tested = (m: string) => { checks++; console.log(`PASS ${m}`); };

class Client {
  cookies = new Map<string, string>();
  private headers(extra: Record<string, string>, method: string, csrf: boolean) {
    const h: Record<string, string> = { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '), ...extra };
    if (method !== 'GET' && method !== 'HEAD' && csrf) h['x-csrf-token'] = this.cookies.get('csrf_token') || '';
    return h;
  }
  private keep(res: Response) {
    for (const c of res.headers.getSetCookie()) { const [pair] = c.split(';'); const i = pair.indexOf('='); this.cookies.set(pair.slice(0, i), pair.slice(i + 1)); }
  }
  async request(route: string, method = 'GET', body?: unknown, csrf = true) {
    const res = await fetch(base + route, { method, redirect: 'manual', headers: this.headers({ 'Content-Type': 'application/json' }, method, csrf), body: body === undefined ? undefined : JSON.stringify(body) });
    this.keep(res);
    const text = await res.text();
    let data: any; try { data = JSON.parse(text); } catch { data = null; }
    return { status: res.status, headers: res.headers, data, text };
  }
  async upload(file: Buffer, name: string, type: string, fields: Record<string, string>, csrf = true) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    form.append('file', new Blob([new Uint8Array(file)], { type }), name);
    const res = await fetch(`${base}/api/media/upload`, { method: 'POST', body: form, headers: this.headers({}, 'POST', csrf) });
    this.keep(res);
    const text = await res.text();
    let data: any; try { data = JSON.parse(text); } catch { data = null; }
    return { status: res.status, data, text };
  }
  async login(email: string) {
    await this.request('/api/auth/me');
    return this.request('/api/auth/login', 'POST', { email, password });
  }
}
async function status(client: Client, route: string, expected: number, method = 'GET', body?: unknown, csrf = true) {
  const r = await client.request(route, method, body, csrf);
  assert.equal(r.status, expected, `${method} ${route}: expected ${expected}, got ${r.status} ${r.text.slice(0, 300)}`);
  return r;
}
async function get(route: string) {
  const res = await fetch(base + route, { redirect: 'manual' });
  return { status: res.status, headers: res.headers, text: await res.text() };
}

const createdMediaIds: string[] = [];
const createdArticleIds: string[] = [];

try {
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Test server did not start.')), 60_000);
    child.stdout.on('data', (c) => { if (String(c).includes('Server running')) { clearTimeout(t); resolve(); } });
    child.once('exit', () => { clearTimeout(t); reject(new Error('Test server exited before startup.')); });
  });

  for (const [key, role] of [['admin', 'Admin'], ['editor', 'Editor'], ['author', 'Author'], ['author2', 'Author']] as const) {
    await prisma.user.create({ data: { id: ids[key], name: `Phase C ${role} ${key}`, email: `${ids[key]}@example.test`, role, avatar: '/favicon.ico', joinedAt: new Date(), passwordHash: hashPassword(password) } });
  }
  for (const [key, userKey] of [['editor', 'editor'], ['author', 'author'], ['author2', 'author2']] as const) {
    await prisma.author.create({ data: { id: bylines[key], userId: ids[userKey], slug: `${fixture}-${key}`, name: `Phase C Byline ${key}`, roleTitle: 'Correspondent', bio: 'Bio', avatar: '/favicon.ico' } });
  }
  const anon = new Client(); const admin = new Client(); const editor = new Client(); const author = new Client(); const author2 = new Client();
  await anon.request('/api/auth/me');
  for (const [c, k] of [[admin, 'admin'], [editor, 'editor'], [author, 'author'], [author2, 'author2']] as const) assert.equal((await c.login(`${ids[k]}@example.test`)).status, 200);

  // ── Test images ──
  const withExif = await sharp({ create: { width: 1800, height: 1200, channels: 3, background: { r: 200, g: 60, b: 20 } } })
    .jpeg().withMetadata({ exif: { IFD0: { Copyright: 'SECRET-EXIF-MARKER', Artist: 'SECRET-EXIF-MARKER' } } }).toBuffer();
  const png = await sharp({ create: { width: 640, height: 400, channels: 4, background: { r: 10, g: 120, b: 200, alpha: 1 } } }).png().toBuffer();
  const webp = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#335533' } }).webp().toBuffer();
  const avif = await sharp({ create: { width: 500, height: 300, channels: 3, background: '#553333' } }).avif().toBuffer();
  const tiny = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } }).png().toBuffer();
  const tooWide = await sharp({ create: { width: 12001, height: 16, channels: 3, background: '#000' } }).png().toBuffer();
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const html = Buffer.from('<html><script>alert(1)</script></html>');
  const huge = Buffer.concat([png, crypto.randomBytes(10 * 1024 * 1024)]);
  const meta = { title: `${fixture} Image`, altText: 'A test image', creationType: 'Original' };

  // ── 1. Upload authorization + CSRF ──
  assert.equal((await anon.upload(png, 'a.png', 'image/png', meta)).status, 401);
  assert.equal((await editor.upload(png, 'a.png', 'image/png', meta, false)).status, 403, 'upload without CSRF token');
  const authorUpload = await author.upload(png, 'author-photo.png', 'image/png', { ...meta, title: `${fixture} Author PNG` });
  assert.equal(authorUpload.status, 201, authorUpload.text); createdMediaIds.push(authorUpload.data.id);
  tested('upload requires a staff session (401 anonymous) and a CSRF token (403); Authors may upload');

  // ── 2. Upload validation (server never trusts name/MIME) ──
  const rejects: [Buffer, string, string, number, RegExp][] = [
    [svg, 'x.svg', 'image/svg+xml', 415, /Unsupported file type/],
    [html, 'x.png', 'image/png', 415, /Unsupported file type/],
    [png, 'x.jpg', 'image/jpeg', 415, /extension/],
    [png, 'x.png', 'image/jpeg', 415, /declared type/],
    [tiny, 'x.png', 'image/png', 400, /at least/],
    [tooWide, 'x.png', 'image/png', 400, /at most/],
    [huge, 'x.png', 'image/png', 413, /larger than/],
    [Buffer.alloc(0), 'x.png', 'image/png', 400, /empty|Choose/],
  ];
  for (const [buf, name, type, code, message] of rejects) {
    const r = await editor.upload(buf, name, type, meta);
    assert.equal(r.status, code, `${name} (${type}): expected ${code}, got ${r.status} ${r.text}`);
    assert.match(r.data.error, message);
  }
  assert.equal((await editor.upload(png, 'x.png', 'image/png', { ...meta, title: '' })).status, 400, 'title required');
  assert.equal((await editor.upload(png, 'x.png', 'image/png', { ...meta, creationType: 'Stolen' })).status, 400, 'creation type enum');
  assert.equal(await prisma.mediaItem.count({ where: { title: meta.title } }), 0, 'no rejected upload created a record');
  tested('rejects SVG, HTML disguised as PNG, extension/MIME mismatches, too-small/too-large dimensions, >10 MB and empty files, and invalid metadata; nothing stored');

  // ── 3. Processing, variants, safe storage, delivery ──
  const jpgUp = await editor.upload(withExif, '../../../etc/passwd.jpg', 'image/jpeg', { ...meta, title: `${fixture} JPEG`, caption: 'Test caption', credit: 'Test credit', creationType: 'AI-assisted', aiTool: 'Test model', humanEditing: 'Cropped' });
  assert.equal(jpgUp.status, 201, jpgUp.text); createdMediaIds.push(jpgUp.data.id);
  const jpg = jpgUp.data;
  assert.equal(jpg.width, 1800); assert.equal(jpg.height, 1200); assert.equal(jpg.mimeType, 'image/jpeg');
  assert.equal(jpg.filename, 'passwd.jpg', 'display filename is a sanitized base name');
  assert.match(jpg.storageKey, /^\d{4}\/\d{2}\/[a-f0-9-]{36}\/original\.jpg$/, 'server-generated storage key');
  assert.equal(jpg.copyrightReview, 'pending'); assert.equal(jpg.aiTool, 'Test model'); assert.equal(jpg.humanEditing, 'Cropped');
  const widths = [...new Set(jpg.variants.map((v: any) => v.width))].sort((a: any, b: any) => a - b);
  assert.deepEqual(widths, [400, 800, 1600, 1800]);
  assert.deepEqual([...new Set(jpg.variants.map((v: any) => v.format))].sort(), ['avif', 'webp']);
  for (const key of [jpg.storageKey, ...jpg.variants.map((v: any) => v.key)]) {
    assert(fs.existsSync(path.join(mediaRoot, key)), `stored ${key}`);
    const r = await fetch(`${base}/media/${key}`);
    assert.equal(r.status, 200, `/media/${key}`);
    const expectedType = key.endsWith('.avif') ? 'image/avif' : key.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    assert.equal(r.headers.get('content-type'), expectedType);
    assert.match(r.headers.get('cache-control') || '', /immutable/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  }
  const storedOriginal = fs.readFileSync(path.join(mediaRoot, jpg.storageKey));
  assert(!storedOriginal.includes(Buffer.from('SECRET-EXIF-MARKER')), 'EXIF metadata stripped');
  const small = jpg.variants.find((v: any) => v.width === 400 && v.format === 'avif');
  assert.equal((await sharp(fs.readFileSync(path.join(mediaRoot, small.key))).metadata()).width, 400);
  for (const [buf, name, type] of [[webp, 'w.webp', 'image/webp'], [avif, 'a.avif', 'image/avif']] as const) {
    const r = await editor.upload(buf, name, type, { ...meta, title: `${fixture} ${name}` });
    assert.equal(r.status, 201, r.text); createdMediaIds.push(r.data.id);
    assert(r.data.variants.every((v: any) => v.width <= r.data.width), 'never upscaled');
  }
  assert.equal((await get('/media/../.env')).status, 404);
  assert.equal((await get(`/media/${jpg.storageKey.replace('original.jpg', 'nope.jpg')}`)).status, 404);
  tested('JPEG/PNG/WebP/AVIF processed: EXIF stripped, safe server keys, 400/800/1600/original-width AVIF+WebP (never upscaled), served with correct type, immutable caching and nosniff; traversal/missing → 404');

  // ── 4. Metadata + copyright review ──
  await status(author, `/api/media/${jpg.id}`, 403, 'PUT', { title: 'Author cannot edit' });
  await status(editor, `/api/media/${jpg.id}`, 400, 'PUT', { copyrightReview: 'cleared' });
  await status(editor, `/api/media/${jpg.id}`, 400, 'PUT', { url: 'https://evil.example/x.jpg' });
  await status(editor, `/api/media/${jpg.id}`, 400, 'PUT', { unknownField: 1 });
  const reviewed = await status(editor, `/api/media/${jpg.id}`, 200, 'PUT', { copyrightReview: 'reviewed', license: 'Owned by SportingSpy', source: 'Test' });
  assert.equal(reviewed.data.copyrightReview, 'reviewed'); assert(reviewed.data.updatedAt);
  const log = await prisma.auditLog.findFirst({ where: { entityId: jpg.id, action: 'Updated Media Metadata' } });
  assert.match(log!.details, /pending -> reviewed/);
  tested('media metadata (license/usage notes, source, AI tool, human editing) and copyright review (pending/reviewed/restricted) editable by Admin/Editor only, validated and audited');

  // ── 5. Rich-text article: create, persist, validate ──
  const sport = await prisma.sport.findFirstOrThrow({ where: { slug: 'tennis' } });
  const edition = await prisma.eventEdition.findFirstOrThrow({ where: { sportSlug: 'tennis', eventSlug: 'french-open', year: 2027 } });
  const text = (t: string, marks?: any[]) => (marks ? { type: 'text', text: t, marks } : { type: 'text', text: t });
  const para = (...content: any[]) => ({ type: 'paragraph', content });
  const cell = (type: string, t: string) => ({ type, content: [para(text(t))] });
  const doc = {
    type: 'doc',
    attrs: { featuredCaption: 'Article-specific caption', featuredCredit: 'Article-specific credit', dropCap: true, dropCapSize: 'large', dropCapColor: 'blue' },
    content: [
      para(text('Opening paragraph with '), text('bold', [{ type: 'bold' }]), text(' and '), text('italic', [{ type: 'italic' }]), text(' text.')),
      { type: 'heading', attrs: { level: 2 }, content: [text(`Section Two ${fixture}`)] },
      para(text('See the '), text('official broadcaster', [{ type: 'link', attrs: { href: 'https://example.com/tv', target: '_blank', rel: 'sponsored' } }]), text(' and '), text('our schedule', [{ type: 'link', attrs: { href: '/tennis/french-open/2027/schedule/', target: null, rel: null } }]), text('.')),
      { type: 'heading', attrs: { level: 3 }, content: [text('Sub three')] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [para(text('Bullet one'))] }, { type: 'listItem', content: [para(text('Bullet two'))] }] },
      { type: 'orderedList', attrs: { start: 1 }, content: [{ type: 'listItem', content: [para(text('Step one'))] }] },
      { type: 'heading', attrs: { level: 4 }, content: [text('Sub four')] },
      { type: 'blockquote', content: [para(text('A quotation.'))] },
      { type: 'horizontalRule' },
      { type: 'table', content: [
        { type: 'tableRow', content: [cell('tableHeader', 'Session'), cell('tableHeader', 'Court'), cell('tableHeader', 'Time')] },
        { type: 'tableRow', content: [cell('tableCell', 'Day 1'), cell('tableCell', `Chatrier-${fixture}`), cell('tableCell', '11:00')] },
      ] },
      { type: 'image', attrs: { mediaId: jpg.id, src: 'https://evil.example/replaced.jpg', alt: 'Inline alt' } },
      para(text('Closing paragraph.')),
      para(text('Styled text', [{ type: 'textAppearance', attrs: { size: 'large', color: 'green' } }])),
    ],
  };
  const articleBase = { title: `${fixture} Rich Article`, sportSlug: 'tennis', eventSlug: 'french-open', editionYear: 2027, articleType: 'Preview', excerpt: 'Rich excerpt.', authorId: bylines.editor };
  const bad: [any, RegExp][] = [
    [{ ...doc, content: [{ type: 'heading', attrs: { level: 1 }, content: [text('H1')] }] }, /H2, H3 or H4/],
    [{ ...doc, content: [{ type: 'script', content: [text('x')] }] }, /not allowed/],
    [{ ...doc, content: [para(text('x', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]))] }, /unsafe/],
    [{ ...doc, content: [para(text('x', [{ type: 'highlight' }]))] }, /unsupported/],
    [{ ...doc, content: [{ type: 'image', attrs: { src: '/x.jpg' } }] }, /Media Library/],
    [{ ...doc, content: [{ type: 'image', attrs: { mediaId: 'media-does-not-exist' } }] }, /Unknown media/],
    ['<p>html</p>', /rich-text document/],
    [{ ...doc, attrs: { dropCap: 'false' } }, /drop cap/],
    [{ ...doc, attrs: { dropCapSize: '999px' } }, /drop cap size/],
    [{ ...doc, attrs: { dropCapColor: 'url(javascript:evil)' } }, /drop cap color/],
    [{ ...doc, attrs: { featuredCaption: 'x'.repeat(501) } }, /featuredCaption/],
    [{ ...doc, content: [para(text('x', [{ type: 'textAppearance', attrs: { size: '999px', color: 'green' } }]))] }, /text size or color/],
    [{ ...doc, content: [para(text('x', [{ type: 'textAppearance', attrs: { size: 'large', color: 'red;background:url(evil)' } }]))] }, /text size or color/],
  ];
  for (const [body, message] of bad) {
    const r = await status(editor, '/api/articles', 400, 'POST', { ...articleBase, slug: `${fixture}-bad`, body, status: 'draft' });
    assert.match(r.data.error, message);
  }
  const created = await status(editor, '/api/articles', 201, 'POST', { ...articleBase, slug: `${fixture}-rich`, body: doc, featuredMediaId: jpg.id, status: 'draft' });
  const rich = created.data; createdArticleIds.push(rich.id);
  assert.match(rich.content, /Opening paragraph with bold and italic text\./); assert.match(rich.content, /Session \| Court \| Time/);
  assert.equal(rich.featuredMediaId, jpg.id); assert.equal(rich.featuredImage, `/media/${jpg.storageKey}`);
  const imageNode = rich.body.content.find((n: any) => n.type === 'image');
  assert.equal(imageNode.attrs.src, `/media/${jpg.storageKey}`, 'image src comes from the library, not the client');
  // PHASE P: the CMS list omits bodies; the editor reloads one article in full.
  const cms = (await status(editor, '/api/cms/data', 200)).data;
  assert(cms.articles.some((a: any) => a.id === rich.id && a.body === undefined && a.content === undefined), 'CMS list carries no article bodies');
  const reloaded = (await status(editor, `/api/articles/${rich.id}`, 200)).data;
  assert.deepEqual(reloaded.body, rich.body, 'rich content persists');
  assert.deepEqual(rich.body.attrs, doc.attrs, 'article appearance survives API and reload');
  assert.equal(await prisma.articleMedia.count({ where: { articleId: rich.id, mediaId: jpg.id } }), 1);
  tested('rich body (H2–H4, bold, italic, links with rel/new tab, lists, quote, rule, table, library image) saved, validated and reloaded identically; unsafe/unknown content rejected; plain-text content derived');

  // ── 6. Preview: staff-only, never publishes, same renderer ──
  const publicPath = `/tennis/french-open/2027/${fixture}-rich/`;
  assert.equal((await get(publicPath)).status, 404, 'draft not public');
  assert.equal((await get(`/admin/preview/${rich.id}/`)).status, 404, 'anonymous preview → 404');
  assert.equal((await author.request(`/admin/preview/${rich.id}/`)).status, 404, 'another author → 404');
  const preview = await status(editor, `/admin/preview/${rich.id}/`, 200);
  for (const fragment of ['PREVIEW', '<h2', '<h3', '<h4', '<blockquote', '<hr', '<ol', '<ul', '<table', `Chatrier-${fixture}`, '<picture', 'type="image/avif"', 'rel="sponsored noopener noreferrer"', 'target="_blank"', 'href="/tennis/french-open/2027/schedule/"', '<strong>bold</strong>', '<em>italic</em>']) {
    assert(preview.text.includes(fragment), `preview contains ${fragment}`);
  }
  assert(/<meta name="robots" content="noindex, nofollow"/.test(preview.text));
  assert(!preview.text.includes('"@type":"NewsArticle"') && !preview.text.includes('"@type":"Article"'), 'preview emits no article JSON-LD');
  assert.equal((await prisma.article.findUniqueOrThrow({ where: { id: rich.id } })).status, 'draft', 'preview did not publish');
  const own = await status(author, '/api/articles', 201, 'POST', { ...articleBase, title: `${fixture} Author Draft`, slug: `${fixture}-authors`, authorId: bylines.author, body: { type: 'doc', content: [para(text('Author draft body.'))] }, status: 'draft' });
  createdArticleIds.push(own.data.id);
  await status(author, `/admin/preview/${own.data.id}/`, 200);
  assert.equal((await author2.request(`/admin/preview/${own.data.id}/`)).status, 404);
  const sitemap = (await get('/sitemap.xml')).text;
  assert(!sitemap.includes(`${fixture}-rich/`) && !sitemap.includes(`${fixture}-authors/`), 'drafts not in sitemap');
  assert(!(await get(`/search/?q=${fixture}`)).text.includes(`${fixture} Rich Article`), 'drafts not in search');
  assert(!(await get('/latest/')).text.includes(fixture), 'drafts not in listings');
  tested('preview: staff session required (anonymous/other author → 404), Authors only their own, noindex/nofollow, same template, status unchanged; drafts absent from public pages, sitemap, search and listings');
  assert(preview.text.includes('Article-specific caption') && preview.text.includes('Article-specific credit'));
  assert(preview.text.includes('data-size="large" data-color="blue"'));
  const hidden = { ...rich.body, attrs: { featuredCaption: '', featuredCredit: '', dropCap: false } };
  await status(editor, `/api/articles/${rich.id}`, 200, 'PUT', { body: hidden });
  const hiddenPreview = await status(editor, `/admin/preview/${rich.id}/`, 200);
  const hiddenFigure = hiddenPreview.text.match(/<figure\b[^>]*>[\s\S]*?<\/figure>/)?.[0] || '';
  assert(hiddenFigure && !hiddenFigure.includes('<figcaption'), 'empty featured caption and credit hide the featured caption bar');
  assert(!/<p[^>]+class="[^"]*dropCap/.test(hiddenPreview.text), `drop cap disabled: ${hiddenPreview.text.match(/<p[^>]+class="[^"]*dropCap[^>]*>/)?.[0] || ''}`);
  const inherited = { ...rich.body }; delete inherited.attrs;
  await status(editor, `/api/articles/${rich.id}`, 200, 'PUT', { body: inherited });
  const inheritedPreview = await status(editor, `/admin/preview/${rich.id}/`, 200);
  assert(inheritedPreview.text.includes('Test caption') && inheritedPreview.text.includes('Test credit'));
  await status(editor, `/api/articles/${rich.id}`, 200, 'PUT', { body: rich.body });
  assert.equal((await prisma.mediaItem.findUniqueOrThrow({ where: { id: jpg.id } })).caption, 'Test caption', 'article overrides do not change shared media');
  tested('article caption/credit overrides, intentional empty text, library fallback and drop cap settings persist in JSON; preview renders them; shared media unchanged; invalid appearance/CSS rejected');

  // ── 7. Publish: identical server-rendered output + media usage ──
  await status(editor, `/api/articles/${rich.id}`, 200, 'PUT', { status: 'published' });
  const pub = await get(publicPath);
  assert.equal(pub.status, 200);
  for (const fragment of ['<h2', '<h3', '<h4', '<table', 'overflow-x-auto', `Chatrier-${fixture}`, 'rel="sponsored noopener noreferrer"', '<strong>bold</strong>']) assert(pub.text.includes(fragment), `public page contains ${fragment}`);
  // This article's own images (related-article cards carry other pictures).
  const folder = jpg.storageKey.split('/').slice(0, 3).join('/');
  const pictures = [...pub.text.matchAll(/<picture>([\s\S]*?)<\/picture>/g)].map((m) => m[1]).filter((pic) => pic.includes(folder));
  assert(pictures.length >= 2, 'featured + inline picture');
  for (const p of pictures) {
    assert(/<source type="image\/avif" srcSet="[^"]+ 400w, [^"]+ 800w/.test(p), 'AVIF srcset');
    assert(/<source type="image\/webp" srcSet="/.test(p), 'WebP srcset');
    assert(/sizes="/.test(p) && /width="1800" height="1200"/.test(p), 'sizes + intrinsic dimensions');
  }
  assert(/<link rel="canonical" href="[^"]+\/tennis\/french-open\/2027\/phasec-/.test(pub.text));
  assert(pub.text.includes('"@type":"NewsArticle"'), 'type-aware JSON-LD still server-rendered (Preview → NewsArticle)');
  assert.equal((await get('/tennis/french-open/2027/')).status, 200);
  const editionHtml = (await get('/tennis/french-open/2027/')).text;
  assert(editionHtml.includes(`${fixture} Rich Article`) && /<picture>/.test(editionHtml), 'listing card uses responsive image');
  const usage = (await status(editor, '/api/cms/data', 200)).data.mediaUsage;
  assert.deepEqual(usage[jpg.id].map((u: any) => u.role).sort(), ['body', 'featured']);
  assert.deepEqual(usage[createdMediaIds[0]], [], 'unused media identified');
  tested('published rich article server-renders the same HTML (semantic headings, responsive table, AVIF/WebP <picture> with srcset/sizes/width/height, sponsored rel); listing card image responsive; usage tracks featured + body, unused media detectable');

  // ── 8. Delete rules, restricted media ──
  await status(admin, `/api/media/${jpg.id}`, 409, 'DELETE', {});
  await status(editor, `/api/media/${createdMediaIds[0]}`, 403, 'DELETE', {});
  const unusedKeys = [authorUpload.data.storageKey, ...authorUpload.data.variants.map((v: any) => v.key)];
  await status(admin, `/api/media/${createdMediaIds[0]}`, 200, 'DELETE', {});
  createdMediaIds.shift();
  assert(unusedKeys.every((k) => !fs.existsSync(path.join(mediaRoot, k))), 'stored files removed with the record');
  const restricted = await editor.upload(png, 'r.png', 'image/png', { ...meta, title: `${fixture} Restricted` });
  createdMediaIds.push(restricted.data.id);
  await status(editor, `/api/media/${restricted.data.id}`, 200, 'PUT', { copyrightReview: 'restricted' });
  const r1 = await status(editor, `/api/articles/${rich.id}`, 400, 'PUT', { featuredMediaId: restricted.data.id });
  assert.match(r1.data.error, /copyright-restricted/);
  tested('used media cannot be deleted (409); Editors cannot delete (403); unused delete removes record + files; copyright-restricted images cannot be attached');

  // ── 9. Legacy /src/assets/images content ──
  const legacy = await prisma.mediaItem.findMany({ where: { url: { startsWith: '/src/assets/images/' } } });
  assert.equal(legacy.length, 5);
  for (const m of legacy) {
    assert(m.storageKey && Array.isArray(m.variants) && (m.variants as any[]).length >= 2, `${m.id} processed`);
    assert.equal((await get(m.url)).status, 200, `${m.url} still served`);
  }
  assert.equal(await prisma.article.count({ where: { featuredMediaId: null, featuredImage: { startsWith: '/src/assets/images/' } } }), 0, 'every legacy featured image linked');
  const legacyArticle = await prisma.article.findFirstOrThrow({ where: { slug: 'schedule', sportSlug: 'tennis' } });
  assert.equal(legacyArticle.body, null, 'legacy body untouched');
  const legacyHtml = (await get('/tennis/french-open/2027/schedule/')).text;
  assert(/<picture>/.test(legacyHtml) && /<h3/.test(legacyHtml) && /<ul/.test(legacyHtml));
  assert(!/\*\*[^*<]+\*\*/.test(legacyHtml.replace(/<script[\s\S]*?<\/script>/g, '')), 'legacy **bold** rendered as bold, not literal asterisks');
  tested('legacy images: all 5 processed (variants + dimensions), original /src/assets URLs still served, every legacy featured image linked; legacy plain-text bodies render through the same renderer');

  // ── 10. Automatic slug redirects + chain flattening ──
  const p = (slug: string) => `/tennis/french-open/2027/${slug}`;
  await status(editor, `/api/articles/${rich.id}`, 200, 'PUT', { slug: `${fixture}-rich-2` });
  let r = await get(`${p(`${fixture}-rich`)}/`);
  assert.equal(r.status, 301); assert.equal(r.headers.get('location'), `${p(`${fixture}-rich-2`)}/`);
  assert.equal((await get(`${p(`${fixture}-rich-2`)}/`)).status, 200);
  await status(editor, `/api/articles/${rich.id}`, 200, 'PUT', { slug: `${fixture}-rich-3` });
  for (const old of [`${fixture}-rich`, `${fixture}-rich-2`]) {
    r = await get(`${p(old)}/`);
    assert.equal(r.status, 301); assert.equal(r.headers.get('location'), `${p(`${fixture}-rich-3`)}/`, `${old} goes straight to the latest URL (no chain)`);
  }
  assert.equal((await get(`${p(`${fixture}-rich`)}`)).headers.get('location'), `${p(`${fixture}-rich-3`)}/`, 'bare old URL also one hop');
  await status(editor, `/api/articles/${rich.id}`, 200, 'PUT', { slug: `${fixture}-rich` }); // move back to the original URL
  assert.equal((await get(`${p(`${fixture}-rich`)}/`)).status, 200, 'original URL live again (its rule retired, no loop)');
  for (const old of [`${fixture}-rich-2`, `${fixture}-rich-3`]) assert.equal((await get(`${p(old)}/`)).headers.get('location'), `${p(`${fixture}-rich`)}/`);
  const rules = await prisma.redirectRule.findMany({ where: { sourceUrl: { contains: fixture } } });
  assert.equal(new Set(rules.map((x) => x.sourceUrl)).size, rules.length, 'no duplicate sources');
  assert(rules.every((x) => x.origin === 'article-slug'));
  assert(rules.filter((x) => x.isActive).every((x) => x.targetUrl === p(`${fixture}-rich`)), 'every active rule points at the final URL');
  await status(editor, `/api/articles/${own.data.id}`, 200, 'PUT', { slug: `${fixture}-authors-renamed` });
  assert.equal(await prisma.redirectRule.count({ where: { sourceUrl: p(`${fixture}-authors`) } }), 0, 'draft URL changes create no redirect');
  const clash = await status(editor, `/api/articles/${rich.id}`, 409, 'PUT', { slug: 'schedule' });
  assert.match(clash.data.error, /already uses/);
  tested('published slug change: old URL 301 → new URL in one hop; repeated moves flatten (no chains); moving back retires the loop rule; unique sources; drafts create no redirects; URL collisions rejected');

  // ── 11. Manual redirect safety ──
  const m = (s: string) => `/${fixture}-${s}`;
  const liveTarget = `/${sport.slug}`;
  await status(editor, '/api/redirects', 403, 'POST', { sourceUrl: m('a'), targetUrl: liveTarget });
  await status(admin, '/api/redirects', 403, 'POST', { sourceUrl: m('a'), targetUrl: liveTarget }, false);
  const ab = await status(admin, '/api/redirects', 201, 'POST', { sourceUrl: m('a'), targetUrl: liveTarget, notes: 'Test note' });
  assert.equal(ab.data.notes, 'Test note'); assert.equal(ab.data.origin, 'manual');
  await status(admin, '/api/redirects', 409, 'POST', { sourceUrl: `${m('a')}/`, targetUrl: m('c') });
  await status(admin, '/api/redirects', 400, 'POST', { sourceUrl: m('x'), targetUrl: `${m('x')}/` });
  await status(admin, '/api/redirects', 400, 'POST', { sourceUrl: m('broken'), targetUrl: m('missing') });
  await status(admin, '/api/redirects', 400, 'POST', { sourceUrl: liveTarget, targetUrl: '/sports' });
  const cToA = await status(admin, '/api/redirects', 201, 'POST', { sourceUrl: m('c'), targetUrl: m('a') });
  assert.equal(cToA.data.targetUrl, liveTarget, 'new rule targets the final live destination');
  r = await get(m('a'));
  assert.equal(r.status, 301); assert.equal(r.headers.get('location'), `${liveTarget}/`);
  await status(admin, `/api/redirects/${ab.data.id}`, 400, 'PUT', { targetUrl: m('a') });
  tested('manual redirects: Admin + CSRF only; notes/origin stored; duplicate, self, live-source and broken-target rules rejected; redirect targets are flattened to a live final URL');

  // ── 12. Settings ──
  await status(anon, '/api/settings', 401);
  await status(editor, '/api/settings', 403);
  await status(editor, '/api/settings', 403, 'PUT', { siteName: 'x' });
  const defs = (await status(admin, '/api/settings', 200)).data;
  assert(defs.definitions.some((d: any) => d.key === 'ga4MeasurementId'));
  await status(admin, '/api/settings', 400, 'PUT', { unknownKey: 'x' });
  await status(admin, '/api/settings', 400, 'PUT', { ga4MeasurementId: 'UA-123' });
  await status(admin, '/api/settings', 400, 'PUT', { googleSiteVerification: 'bad token with spaces' });
  await status(admin, '/api/settings', 403, 'PUT', { siteName: 'x' }, false);
  const token = `phasec${crypto.randomBytes(8).toString('hex')}`;
  await status(admin, '/api/settings', 200, 'PUT', { googleSiteVerification: token, ga4MeasurementId: 'G-PHASEC123', adsensePublisherId: 'ca-pub-1234567890123456' });
  const home = (await get('/')).text;
  assert(home.includes(`<meta name="google-site-verification" content="${token}"/>`), 'verification tag rendered');
  // PHASE F superseded "stored only": a set GA4/AdSense ID now switches that
  // provider on (behind visitor consent), so it is rendered as provider
  // configuration. Both are public identifiers by design; the Phase F suite
  // verifies nothing loads before consent.
  assert(home.includes('G-PHASEC123') && home.includes('ca-pub-1234567890123456'), 'configured provider IDs are delivered as provider configuration');
  tested('settings: Admin only (anonymous 401, Editor 403), CSRF enforced, allow-listed + validated keys; verification token rendered publicly, analytics/ad IDs stored but not exposed');

  // ── 13. Public regression ──
  for (const path of ['/', '/tennis/', '/tennis/french-open/', '/tennis/french-open/2027/', '/tennis/tennis-scoring/', '/sports/', '/latest/']) assert.equal((await get(path)).status, 200, path);
  for (const path of ['/nope/', '/tennis/french-open/2027/nope/', '/admin/preview/nope/']) assert.equal((await get(path)).status, 404, path);
  // The CMS editor (TipTap/ProseMirror) must never ship to public pages.
  const publicScripts = new Set<string>();
  for (const route of ['/', publicPath, '/tennis/']) for (const m of (await get(route)).text.matchAll(/src="(\/_next\/static\/[^"]+\.js)"/g)) publicScripts.add(m[1]);
  let publicBytes = 0;
  for (const src of publicScripts) {
    const js = (await get(src)).text;
    publicBytes += js.length;
    assert(!/prosemirror|@tiptap|tiptap/i.test(js), `public chunk ${src} contains editor code`);
  }
  const adminScripts = [...(await get('/admin/')).text.matchAll(/src="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]);
  assert(adminScripts.length > 0);
  tested(`public pages still 200 and unknown URLs still real 404s; no editor code in ${publicScripts.size} public chunks (${Math.round(publicBytes / 1024)} KB)`);

  // ── 14. Real Chrome: CMS workflow + public rendering ──
  if (process.env.PLAYWRIGHT_MODULE) {
    const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
    const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'chrome', headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e: Error) => errors.push(String(e)));
      await page.goto(`${base}/admin/`);
      await page.getByRole('heading', { name: 'Staff Sign In Required', exact: true }).waitFor();
      await page.locator('main').getByPlaceholder('Email', { exact: true }).fill(`${ids.admin}@example.test`);
      await page.locator('main').getByPlaceholder('Password', { exact: true }).fill(password);
      await page.locator('main').getByRole('button', { name: 'Sign In', exact: true }).click();
      await page.getByRole('heading', { name: 'Content Management System', exact: true }).waitFor();

      // Article editor with rich text, table, library image, then preview.
      await page.getByRole('button', { name: 'Articles', exact: true }).click();
      await page.getByTestId('create-article-button').click();
      await page.getByTestId('create-article-manual').click();
      const uiTitle = `${fixture} Browser Article`;
      await page.getByLabel('Article Title (H1) *', { exact: true }).fill(uiTitle);
      const editorBox = page.getByRole('textbox', { name: 'Article body' });
      await editorBox.click();
      await page.keyboard.type('First browser paragraph.');
      await page.keyboard.press('Enter');
      await page.getByRole('button', { name: 'Heading 2 — Apply a section heading', exact: true }).click();
      await page.keyboard.type('Browser H2 heading');
      await page.keyboard.press('Enter');
      await page.getByRole('button', { name: 'Bold' }).click();
      await page.keyboard.type('Bold words');
      await page.getByRole('button', { name: 'Bold' }).click();
      await page.keyboard.press('Enter');
      await page.getByRole('button', { name: 'Insert Table — Add a three-column data table', exact: true }).click();
      await page.keyboard.type('Cell A1');
      await page.getByRole('button', { name: 'Add Row — Add a row after the current row', exact: true }).click();
      await page.getByRole('button', { name: 'Insert Image — Add an image from Media Library', exact: true }).click();
      await page.getByRole('dialog', { name: 'Choose an image' }).getByText(`${fixture} w.webp`).click();
      await editorBox.locator('h2', { hasText: 'Browser H2 heading' }).waitFor();
      await editorBox.locator('table').waitFor();
      await editorBox.locator('img').first().waitFor();
      await page.getByRole('button', { name: 'Choose from library' }).click();
      await page.getByRole('dialog', { name: 'Choose an image' }).getByText(`${fixture} a.avif`).click();
      await page.getByLabel('Use Media Library text', { exact: true }).nth(0).uncheck();
      await page.getByLabel('Use Media Library text', { exact: true }).nth(1).uncheck();
      await page.getByRole('textbox', { name: 'Featured image caption', exact: true }).fill('Browser caption override');
      await page.getByRole('textbox', { name: 'Featured image credit', exact: true }).fill('Browser photographer');
      await page.getByRole('combobox', { name: 'First letter size', exact: true }).selectOption('large');
      await page.getByRole('combobox', { name: 'First letter color', exact: true }).selectOption('purple');
      await editorBox.locator('p', { hasText: 'First browser paragraph.' }).click();
      await page.keyboard.press('Home'); await page.keyboard.press('Shift+End');
      assert.equal(await page.evaluate(() => getSelection()?.toString()), 'First browser paragraph.', 'select the actual first body paragraph');
      await page.getByRole('combobox', { name: 'Text size', exact: true }).selectOption('large');
      await editorBox.locator('span[data-size="large"]').waitFor();
      await page.getByRole('combobox', { name: 'Text color', exact: true }).selectOption('blue');
      const styled = editorBox.locator('span[data-text-appearance]').first();
      assert.equal(await styled.getAttribute('data-size'), 'large');
      assert.equal(await styled.getAttribute('data-color'), 'blue', 'color keeps the selected text size');
      const [previewTab] = await Promise.all([context.waitForEvent('page'), page.getByRole('button', { name: 'Preview', exact: true }).click()]);
      await previewTab.waitForURL(/\/admin\/preview\/[^/]+\/$/);
      await previewTab.getByText('PREVIEW').first().waitFor();
      await previewTab.locator('main h2', { hasText: 'Browser H2 heading' }).waitFor();
      assert(await previewTab.locator('main table').count() >= 1, 'preview table');
      assert(await previewTab.locator('main picture').count() >= 2, 'preview featured + inline pictures');
      assert(await previewTab.locator('main strong', { hasText: 'Bold words' }).count() === 1);
      const uiArticle = await prisma.article.findFirstOrThrow({ where: { title: uiTitle } });
      createdArticleIds.push(uiArticle.id);
      assert.equal(uiArticle.status, 'draft'); assert(uiArticle.body);
      const savedBody = uiArticle.body as any;
      assert.equal(savedBody.attrs.featuredCaption, 'Browser caption override', 'body editing preserves article appearance');
      assert.equal(savedBody.attrs.featuredCredit, 'Browser photographer');
      assert.equal(savedBody.attrs.dropCapSize, 'large'); assert.equal(savedBody.attrs.dropCapColor, 'purple');
      assert(savedBody.content[0].content.some((n: any) => n.marks?.some((m: any) => m.type === 'textAppearance' && m.attrs.size === 'large' && m.attrs.color === 'blue')));
      await previewTab.locator('main figcaption', { hasText: 'Browser caption override' }).waitFor();
      const first = previewTab.locator('main p[data-size="large"][data-color="purple"]');
      assert.equal(await first.evaluate((el: HTMLElement) => getComputedStyle(el, '::first-letter').fontSize), '64px');
      assert.equal(await first.evaluate((el: HTMLElement) => getComputedStyle(el, '::first-letter').color), 'rgb(126, 34, 206)', 'drop cap color remains independent of blue body text');
      assert(await previewTab.locator('main span[data-size="large"][data-color="blue"]').count());
      fs.mkdirSync('verification/article-appearance', { recursive: true });
      await page.getByRole('group', { name: 'Image caption & article appearance' }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: 'verification/article-appearance/admin-desktop.png' });
      await previewTab.screenshot({ path: 'verification/article-appearance/preview-desktop.png', fullPage: true });
      await previewTab.close();
      tested('Chrome CMS: TipTap editor creates H2, bold, table, library image and featured image; Preview saves the draft and opens the staff preview rendering it');
      tested('Chrome article appearance: caption/credit edited per article; selected text size and color retain selection and each other; first letter size/color preview matches saved output');

      // Media library, settings, redirects screens.
      await page.getByRole('button', { name: 'Media Library', exact: true }).click();
      await page.getByRole('heading', { name: 'Media Library', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Usage: Used and unused', exact: true }).click();
      await page.getByRole('option', { name: 'Unused', exact: true }).click();
      await page.getByText(`${fixture} Restricted`).first().waitFor();
      await page.getByRole('button', { name: 'Usage: Unused', exact: true }).click();
      await page.getByRole('option', { name: 'Used and unused', exact: true }).click();
      await page.getByText(`${fixture} JPEG`).first().click();
      const details = page.getByRole('complementary', { name: 'Media details' });
      await details.getByText('featured image').first().waitFor();
      await details.getByText('in article body').first().waitFor();
      assert.equal(await details.getByLabel('Copyright review').inputValue(), 'reviewed');
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
      assert.equal(await page.locator('input[name="googleSiteVerification"]').inputValue(), token);
      await page.getByRole('button', { name: /^URL Redirects/ }).click();
      await page.getByText('Automatic: article URL changed').first().waitFor();
      tested('Chrome CMS: Media Library filters (unused), usage history and copyright review; Settings shows saved values; Redirects shows automatic article-URL rules');

      // Public: rich article with JS disabled, old slug redirect, 404.
      const noJs = await browser.newContext({ javaScriptEnabled: false });
      const staticPage = await noJs.newPage();
      const resp = await staticPage.goto(`${base}${p(`${fixture}-rich-2`)}/`);
      assert.equal(new URL(staticPage.url()).pathname, `${p(`${fixture}-rich`)}/`, 'old slug redirected in the browser');
      assert.equal(resp.status(), 200);
      await staticPage.locator('main figcaption', { hasText: 'Article-specific caption' }).waitFor();
      const drop = staticPage.locator('main p[data-size="large"][data-color="blue"]');
      assert.equal(await drop.evaluate((el: HTMLElement) => getComputedStyle(el, '::first-letter').fontSize), '64px');
      const colored = staticPage.locator('main span[data-size="large"][data-color="green"]');
      assert.equal(await colored.evaluate((el: HTMLElement) => getComputedStyle(el).color), 'rgb(4, 120, 87)');
      await staticPage.locator('h2', { hasText: `Section Two ${fixture}` }).waitFor();
      await staticPage.locator('table td', { hasText: `Chatrier-${fixture}` }).waitFor();
      const loaded = await staticPage.locator('main picture img').first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0 && img.currentSrc);
      assert(loaded && /\.(avif|webp)$/.test(String(loaded)), `modern format chosen by the browser (${loaded})`);
      await staticPage.setViewportSize({ width: 390, height: 844 });
      assert(await staticPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal page overflow on mobile (table scrolls in its own box)');
      assert.equal((await staticPage.goto(`${base}/tennis/french-open/2027/nope/`)).status(), 404);
      await noJs.close();
      assert.deepEqual(errors, []);
      await context.close();
      tested('Chrome public (JS disabled): old slug → new URL, rich headings/table/images render, browser loads AVIF/WebP, no mobile overflow, real 404; no runtime errors in the CMS');
    } catch (error) {
      fs.mkdirSync('verification/article-appearance', { recursive: true });
      const failedPage = browser.contexts()[0]?.pages()[0];
      await failedPage?.screenshot({ path: 'verification/article-appearance/check-failure.png' }).catch(() => {});
      throw error;
    } finally {
      await browser.close();
    }
  } else console.log('SKIP browser checks: PLAYWRIGHT_MODULE not provided.');

  console.log(`PASS ${checks} Phase C verification groups`);
} finally {
  child.kill();
  if (child.exitCode === null) await once(child, 'exit');
  // Exact fixture cleanup. Never remove pre-existing content.
  const fixtureArticles = await prisma.article.findMany({ where: { OR: [{ id: { in: createdArticleIds } }, { slug: { startsWith: fixture } }] }, select: { id: true } });
  await prisma.article.deleteMany({ where: { id: { in: fixtureArticles.map((a) => a.id) } } });
  const fixtureMedia = await prisma.mediaItem.findMany({ where: { OR: [{ id: { in: createdMediaIds } }, { title: { startsWith: fixture } }] } });
  for (const item of fixtureMedia) {
    for (const key of [item.storageKey, ...(((item.variants as any[]) || []).map((v) => v.key))]) if (key) fs.rmSync(path.join(mediaRoot, key), { force: true });
    if (item.storageKey) fs.rmSync(path.join(mediaRoot, path.dirname(item.storageKey)), { recursive: true, force: true });
  }
  await prisma.mediaItem.deleteMany({ where: { id: { in: fixtureMedia.map((m) => m.id) } } });
  await prisma.redirectRule.deleteMany({ where: { id: { notIn: [...redirectIdsBefore] } } });
  await prisma.siteSetting.deleteMany({});
  for (const s of settingsBefore) await prisma.siteSetting.create({ data: s });
  await prisma.author.deleteMany({ where: { id: { in: Object.values(bylines) } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { userId: 'unknown', userName: { startsWith: fixture } }] } });
  const afterSnap = await snapshot();
  assert.deepEqual(afterSnap, before, 'Pre-existing database rows changed!');
  assert.deepEqual(listMediaFiles(), mediaFilesBefore, 'stored media files differ from before (legacy files must be untouched, fixtures removed)');
  assert.deepEqual(protectedFiles.map((f) => digest(fs.readFileSync(f))), filesBefore);
  assert(!serverOutput.includes(password));
  console.log('PASS database integrity: all 14 table counts and full-row hashes unchanged; stored media files unchanged; protected files unchanged; fixtures removed.');
  await prisma.$disconnect();
}
