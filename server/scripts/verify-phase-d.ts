/** Phase D SEO Intelligence integration verification.
 * Local database only. UUID-scoped fixtures are removed in finally and every
 * pre-existing row is compared by full-row hash after the run.
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

assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe, 'Phase D verification requires a local, non-production database.');
assert(fs.existsSync('.next/BUILD_ID'), 'Run npm run build first.');

const fixture = `phased-${crypto.randomUUID()}`;
const password = `Test-${crypto.randomUUID()}`;
const userIds = { admin: `${fixture}-admin`, editor: `${fixture}-editor`, author: `${fixture}-author-user` };
// Files that must stay byte-identical, where still present (both were moved to the project archive).
const protectedFiles = ['data/db.json', 'PROJECT_BRAIN.md'].filter((file) => fs.existsSync(file));
const digest = (value: string | Buffer) => crypto.createHash('sha256').update(value).digest('hex');
const filesBefore = protectedFiles.map((file) => digest(fs.readFileSync(file)));
const tables = ['sport', 'sportEvent', 'eventEdition', 'article', 'articleMedia', 'author', 'user', 'session', 'comment', 'mediaItem', 'adSlotConfig', 'redirectRule', 'siteSetting', 'seoRule', 'seoScanRun', 'seoIntegrationLog', 'auditLog'] as const;

async function snapshot() {
  const out: Record<string, { count: number; hash: string }> = {};
  for (const table of tables) {
    const rows = await (prisma[table] as any).findMany();
    rows.sort((a: unknown, b: unknown) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    out[table] = { count: rows.length, hash: digest(JSON.stringify(rows)) };
  }
  return out;
}

const before = await snapshot();
const originalTitleRule = await prisma.seoRule.findUniqueOrThrow({ where: { key: 'title-length' } });
const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = (probe.address() as { port: number }).port; await new Promise<void>((resolve) => probe.close(() => resolve()));
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
  cwd: process.cwd(), windowsHide: true,
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production', APP_ENV: 'production', AUTH_MODE: 'production', DEV_LOGIN_BYPASS: 'false', TRUST_PROXY: 'false', ALLOWED_ORIGIN: base, GEMINI_API_KEY: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = ''; child.stdout.on('data', (c) => { output += c; }); child.stderr.on('data', (c) => { output += c; });
let checks = 0; const pass = (s: string) => { checks++; console.log(`PASS ${s}`); };

class Client {
  cookies = new Map<string, string>();
  async request(path: string, method = 'GET', body?: unknown, csrf = true) {
    const headers: Record<string, string> = { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET' && csrf) headers['x-csrf-token'] = this.cookies.get('csrf_token') || '';
    const response = await fetch(base + path, { method, headers, redirect: 'manual', body: body === undefined ? undefined : JSON.stringify(body) });
    for (const raw of response.headers.getSetCookie()) { const pair = raw.split(';')[0]; const i = pair.indexOf('='); this.cookies.set(pair.slice(0, i), pair.slice(i + 1)); }
    const text = await response.text(); let data: any = null; try { data = JSON.parse(text); } catch {}
    return { status: response.status, headers: response.headers, text, data };
  }
  async login(role: keyof typeof userIds) {
    await this.request('/api/auth/me');
    return this.request('/api/auth/login', 'POST', { email: `${fixture}-${role}@example.test`, password });
  }
}
async function expect(client: Client, path: string, code: number, method = 'GET', body?: unknown, csrf = true) {
  const result = await client.request(path, method, body, csrf);
  assert.equal(result.status, code, `${method} ${path}: expected ${code}, got ${result.status}: ${result.text.slice(0, 500)}`);
  return result;
}

try {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server did not start. ${output}`)), 20_000);
    child.stdout.on('data', (c) => { if (String(c).includes('Server running')) { clearTimeout(timer); resolve(); } });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(`Server exited. ${output}`)); });
  });
  for (const [role, id] of Object.entries(userIds)) await prisma.user.create({ data: { id, name: `Phase D ${role}`, email: `${fixture}-${role}@example.test`, role: role[0].toUpperCase() + role.slice(1) as any, avatar: '', joinedAt: new Date(), passwordHash: hashPassword(password) } });

  const anon = new Client(), admin = new Client(), editor = new Client(), author = new Client();
  await anon.request('/api/health');
  assert.equal((await admin.login('admin')).status, 200); assert.equal((await editor.login('editor')).status, 200); assert.equal((await author.login('author')).status, 200);
  await expect(anon, '/api/seo/overview', 401); await expect(author, '/api/seo/overview', 403); await expect(author, '/api/seo/rules', 403);
  await expect(anon, '/api/seo/article-check', 401, 'POST', {}); await expect(editor, '/api/seo/scan', 403, 'POST', {}, false);
  pass('SEO APIs enforce authentication, role boundaries and CSRF');

  const rules = (await expect(editor, '/api/seo/rules', 200)).data;
  assert(rules.length >= 30 && rules.every((r: any) => typeof r.enabled === 'boolean' && r.why && r.fix && r.severity));
  assert(rules.some((r: any) => r.key === 'type-topics') && rules.some((r: any) => r.key === 'freshness') === false);
  await expect(editor, '/api/seo/rules/title-length', 403, 'PUT', { enabled: false });
  const changed = await expect(admin, '/api/seo/rules/title-length', 200, 'PUT', { severity: 'info', config: { min: 25, max: 70 } });
  assert.equal(changed.data.version, originalTitleRule.version + 1);
  await expect(admin, '/api/seo/rules/title-length', 400, 'PUT', { config: { invented: 1 } });
  pass('rules are stored, configurable without rebuild, validated, and Admin-only to mutate');

  const edition = await prisma.eventEdition.findFirstOrThrow({ where: { event: { isVisible: true } } });
  const draft = {
    articleType: 'Schedule', sportSlug: edition.sportSlug, eventSlug: edition.eventSlug, editionYear: edition.year,
    title: 'Schedule', slug: `${fixture}-schedule`, excerpt: 'Times and fixtures.', content: 'The match starts at 10:00. Full fixtures will be confirmed.',
    featuredImage: '', authorId: 'draft-author', seo: { metaTitle: 'Schedule', metaDescription: 'Short.' }, status: 'draft', references: [],
  };
  const checked = (await expect(author, '/api/seo/article-check', 200, 'POST', draft)).data;
  assert(Array.isArray(checked.checklist) && checked.checklist.some((x: any) => x.ruleKey === 'type-topics' && !x.passed));
  assert(checked.checklist.some((x: any) => x.ruleKey === 'timezone-for-times' && !x.passed));
  assert(checked.checklist.some((x: any) => x.category === 'ai-readiness'));
  assert(checked.suggestions.internalLinks.length > 0 && checked.suggestions.internalLinks.every((x: any) => x.url.startsWith('/')));
  assert(Array.isArray(checked.suggestions.coverage) && checked.assistant.configured === false);
  const resultDraft = { ...draft, articleType: 'Results', content: 'The final was completed.', title: 'Results' };
  const resultCheck = (await expect(author, '/api/seo/article-check', 200, 'POST', resultDraft)).data;
  assert(resultCheck.checklist.some((x: any) => x.ruleKey === 'type-topics'));
  pass('draft checks are article-type-aware and return actionable AI-readiness, link and event-coverage suggestions');

  const writesBeforeAi = await prisma.article.count();
  const ai = await expect(author, '/api/seo/assistant', 503, 'POST', draft);
  assert.equal(ai.data.configured, false); assert.match(ai.data.error, /GEMINI_API_KEY/); assert.equal(await prisma.article.count(), writesBeforeAi);
  pass('AI assistant fails clearly when unconfigured and never writes or publishes content');

  const scan = (await expect(editor, '/api/seo/scan', 201, 'POST', {})).data;
  assert.equal(scan.status, 'completed'); assert(scan.summary.rulesEnabled > 20); assert(!('score' in scan.summary));
  assert(scan.findings.every((f: any) => f.message && f.why && f.fix && ['blocking', 'warning', 'info'].includes(f.severity)));
  const overview = (await expect(editor, '/api/seo/overview', 200)).data; assert.equal(overview.latest.id, scan.id);
  assert((await expect(editor, `/api/seo/runs/${scan.id}`, 200)).data.findings.length === scan.findings.length);
  pass('admin-triggered scans are cached as real reports with actionable findings and no fabricated aggregate score');

  const technical = (await expect(editor, '/api/seo/technical', 200)).data;
  assert(technical.sitemap.indexUrl.endsWith('/sitemap.xml')); assert(technical.sitemap.included.length > 0);
  assert.equal(technical.searchConsole.apiConnected, false); assert.equal(technical.bing.apiConnected, false);
  assert.equal(technical.indexNow.configured, false); assert.match(technical.indexNow.reason, /No IndexNow key/);
  assert(!('clicks' in technical.searchConsole) && !('impressions' in technical.searchConsole) && !('visibilityScore' in technical.searchConsole));
  pass('Search Console, Bing and IndexNow expose honest configuration state without fake metrics');

  const sitemap = await expect(anon, '/sitemap.xml', 200); assert(sitemap.text.includes('<sitemapindex'));
  const childPaths = [...sitemap.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
  const pageLocs: string[] = [];
  for (const path of childPaths) { const xml = await expect(anon, path, 200); pageLocs.push(...[...xml.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname)); }
  assert(pageLocs.length > 0 && pageLocs.every((p) => p.endsWith('/'))); assert(!pageLocs.some((p) => p.startsWith('/search') || p.startsWith('/admin')));
  const robots = await expect(anon, '/robots.txt', 200); assert(robots.text.includes('Disallow: /admin/') && robots.text.includes(`Sitemap: ${base}/sitemap.xml`));
  const published = await prisma.article.findFirstOrThrow({ where: { status: 'published', eventSlug: { not: null }, editionYear: { not: null } } });
  const publicPath = `/${published.sportSlug}/${published.eventSlug}/${published.editionYear}/${published.slug}/`;
  const html = await expect(anon, publicPath, 200); assert.equal([...html.text.matchAll(/rel="canonical"/g)].length, 1); assert(html.text.includes('application/ld+json'));
  const search = await expect(anon, '/search/?q=tennis', 200); assert(search.text.match(/noindex/i));
  pass('sitemap index, robots, server canonical/JSON-LD and search noindex behavior are correct over HTTP');

  const source = `/${fixture}-old`;
  await expect(admin, '/api/redirects', 400, 'POST', { sourceUrl: `${source}-broken`, targetUrl: `${source}-missing` });
  await expect(admin, '/api/redirects', 400, 'POST', { sourceUrl: '/sports', targetUrl: '/events' });
  const redirect = await expect(admin, '/api/redirects', 201, 'POST', { sourceUrl: source, targetUrl: '/sports', notes: 'Phase D verifier' });
  const hop = await expect(admin, source, 301); assert.equal(hop.headers.get('location'), '/sports/');
  await expect(anon, `/${fixture}-unknown/`, 404);
  assert.equal(redirect.data.targetUrl, '/sports');
  pass('redirect manager rejects broken targets/live sources, emits one-hop redirects, and preserves real 404s');

  const runs = await expect(editor, '/api/seo/runs', 200); assert(runs.data.some((r: any) => r.id === scan.id));
  const publicHome = await expect(anon, '/', 200); assert(!publicHome.text.includes('/api/seo') && !publicHome.text.includes('SEO Intelligence'));
  pass('reports stay staff-only and SEO tooling/data do not leak into public HTML');
} finally {
  child.kill(); await once(child, 'exit').catch(() => undefined);
  await prisma.seoRule.update({ where: { key: originalTitleRule.key }, data: { enabled: originalTitleRule.enabled, severity: originalTitleRule.severity, articleTypes: originalTitleRule.articleTypes, config: originalTitleRule.config as object, version: originalTitleRule.version, updatedAt: originalTitleRule.updatedAt } }).catch(() => undefined);
  await prisma.redirectRule.deleteMany({ where: { OR: [{ sourceUrl: { contains: fixture } }, { id: { contains: fixture } }] } });
  await prisma.seoScanRun.deleteMany({ where: { triggeredBy: { startsWith: 'Phase D ' } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ userId: { in: Object.values(userIds) } }, { entityId: { contains: fixture } }] } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(userIds) } } });
  const after = await snapshot();
  assert.deepEqual(after, before, 'Database changed outside disposable Phase D fixtures.');
  assert.deepEqual(protectedFiles.map((file) => digest(fs.readFileSync(file))), filesBefore, 'Protected files changed.');
  console.log(`PASS ${checks} Phase D verification groups`);
  console.log('PASS database integrity: all pre-existing rows and protected files unchanged; fixtures removed.');
  await prisma.$disconnect();
}
