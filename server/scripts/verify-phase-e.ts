/** Phase E Search verification.
 * Local database only. Runs the production server on a random port, creates
 * UUID-scoped fixtures (unique nonsense keywords, so existing content cannot
 * interfere), removes them in finally, and compares every pre-existing row by
 * full-row hash afterwards.
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
import { searchArticleIds } from '../services/search/articleSearch';
import { parseSearchQuery } from '../services/search/params';
import { highlightParts } from '../../src/lib/searchText';

assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe, 'Phase E verification requires a local, non-production database.');
assert(fs.existsSync('.next/BUILD_ID'), 'Run npm run build first.');

const fixture = `phasee-${crypto.randomUUID()}`;
const letters = (n: number) => Array.from(crypto.randomBytes(n), (b) => String.fromCharCode(97 + (b % 26))).join('');
const KW = `zq${letters(8)}ab`;   // fixed distinct suffix makes the transposition test a real typo
const KW2 = `zk${letters(8)}`;    // SEO keyword ("tag") only
const KW3 = `zr${letters(8)}`;    // used to verify the search vector follows edits
const KWP = `zp${letters(8)}`;    // phrase test
const password = `Test-${crypto.randomUUID()}`;
const userIds = { admin: `${fixture}-admin`, author: `${fixture}-author-user` };
const digest = (value: string | Buffer) => crypto.createHash('sha256').update(value).digest('hex');
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
  async request(path: string, method = 'GET', body?: unknown) {
    const headers: Record<string, string> = { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET') headers['x-csrf-token'] = this.cookies.get('csrf_token') || '';
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
async function expect(client: Client, path: string, code: number) {
  const result = await client.request(path);
  assert.equal(result.status, code, `GET ${path}: expected ${code}, got ${result.status}: ${result.text.slice(0, 400)}`);
  return result;
}
const ids = (r: { data: any }) => (r.data.results ?? r.data.items).map((x: any) => x.id) as string[];
const enc = encodeURIComponent;

const sport = await prisma.sport.findFirstOrThrow({ where: { isVisible: true }, orderBy: { order: 'asc' } });
const otherSport = await prisma.sport.findFirstOrThrow({ where: { isVisible: true, slug: { not: sport.slug } } });
const existingAuthor = await prisma.author.findFirstOrThrow();
const hiddenSport = `${fixture}-hidden`;
const authorSlug = `${fixture}-writer`;
const A = (suffix: string) => `${fixture}-${suffix}`;
const article = (suffix: string, data: Record<string, unknown>) => ({
  id: A(suffix), slug: A(suffix), sportSlug: sport.slug, articleType: 'Update', title: 'Neutral heading', excerpt: 'Neutral summary text.',
  content: 'Neutral body text.', featuredImage: '', authorId: existingAuthor.id, publishedAt: new Date('2026-01-10T00:00:00Z'),
  status: 'published', readingTimeMinutes: 1, seo: {}, ...data,
});

try {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server did not start. ${output}`)), 30_000);
    child.stdout.on('data', (c) => { if (String(c).includes('Server running')) { clearTimeout(timer); resolve(); } });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(`Server exited. ${output}`)); });
  });

  for (const [role, id] of Object.entries(userIds)) await prisma.user.create({ data: { id, name: `Phase E ${role}`, email: `${fixture}-${role}@example.test`, role: role === 'admin' ? 'Admin' : 'Author', avatar: '', joinedAt: new Date(), passwordHash: hashPassword(password) } });
  await prisma.sport.create({ data: { id: hiddenSport, slug: hiddenSport, name: 'Hidden fixture sport', tagline: '', description: '', order: 9999, isVisible: false, seo: {} } });
  await prisma.author.create({ data: { id: A('writer'), slug: authorSlug, name: 'Phase E Writer', roleTitle: 'Tester', bio: '', avatar: '', userId: userIds.author } });
  await prisma.article.createMany({
    data: [
      article('title', { title: `${KW} final preview`, articleType: 'Analysis', authorId: A('writer'), publishedAt: new Date('2026-01-01T00:00:00Z') }),
      article('excerpt', { excerpt: `A summary that mentions ${KW} once.`, publishedAt: new Date('2026-02-01T00:00:00Z') }),
      article('body', { content: `Long body text. Deep in the body we mention ${KW} a single time.`, publishedAt: new Date('2026-03-01T00:00:00Z') }),
      article('tag', { seo: { keywords: [KW2, 'fixture'] } }),
      article('draft', { title: `${KW} draft status`, status: 'draft' }),
      article('scheduled', { title: `${KW} scheduled status`, status: 'scheduled', scheduledFor: new Date('2099-01-01T00:00:00Z') }),
      article('archived', { title: `${KW} archived status`, status: 'archived' }),
      article('preview', { title: `${KW} preview status`, status: 'preview' }),
      article('hidden-sport', { title: `${KW} hidden sport`, sportSlug: hiddenSport }),
      article('bangla', { title: `বাংলাদেশের ক্রিকেট দল বিশ্বকাপ জিতেছে ${KWP}`, excerpt: 'বাংলা সারাংশ', content: 'ঢাকায় উৎসব।' }),
      article('phrase-exact', { content: `the ${KWP} grand slam final was played` }),
      article('phrase-apart', { content: `a slam in ${KWP} country and one grand stadium` }),
    ] as any,
  });

  const anon = new Client(), admin = new Client(), author = new Client();
  await anon.request('/api/health');
  assert.equal((await admin.login('admin')).status, 200); assert.equal((await author.login('author')).status, 200);

  // ── Keyword, weighting and ranking ──
  const rel = await expect(anon, `/api/search?q=${KW}`, 200);
  assert.deepEqual(ids(rel), [A('title'), A('excerpt'), A('body')], 'title > excerpt > body relevance order');
  assert.equal(rel.data.total, 3); assert.equal(rel.data.mode, 'fulltext');
  assert(!('score' in rel.data.results[0]), 'scores are not exposed');
  const tag = await expect(anon, `/api/search?q=${KW2}`, 200);
  assert.deepEqual(ids(tag), [A('tag')], 'SEO keywords (tags) are searchable');
  pass('keyword search ranks title > excerpt > body, matches SEO keywords, and hides raw scores');

  const multi = await expect(anon, `/api/search?q=${enc(`${KW} preview`)}`, 200);
  assert.deepEqual(ids(multi), [A('title')], 'multi-word queries require every word');
  const prefix = await expect(anon, `/api/search?q=${KW.slice(0, 6)}`, 200);
  assert(ids(prefix).includes(A('title')), 'partial word matches as a prefix');
  const quoted = await expect(anon, `/api/search?q=${enc(`"${KWP} grand slam"`)}`, 200);
  assert.deepEqual(ids(quoted), [A('phrase-exact')], 'quoted phrase requires adjacency');
  const loose = await expect(anon, `/api/search?q=${enc(`${KWP} grand slam`)}`, 200);
  assert.deepEqual(new Set(ids(loose)), new Set([A('phrase-exact'), A('phrase-apart')]), 'unquoted words match anywhere');
  const minus = await expect(anon, `/api/search?q=${enc(`${KW} -preview`)}`, 200);
  assert(!ids(minus).includes(A('title')) && ids(minus).includes(A('body')), '-word excludes');
  const typo = await expect(anon, `/api/search?q=${KW.slice(0, -2)}${KW.slice(-1)}${KW.slice(-2, -1)}`, 200);
  assert.equal(typo.data.mode, 'fuzzy'); assert(ids(typo).includes(A('title')), 'transposed letters find the title via trigram fallback');
  const carried = await expect(anon, `/api/search?q=${enc(`${KW} xv${letters(8)}`)}`, 200);
  assert.equal(carried.data.total, 0, 'one exact word must not carry an unmatched word into fuzzy results');
  assert.equal((await expect(anon, '/api/search?q=the', 200)).data.total, 0, 'stop words alone match nothing');
  assert.equal((await expect(anon, `/api/search?q=${enc(`"${KW.slice(0, -1)}x final"`)}`, 200)).data.total, 0, 'quoted queries never fall back to fuzzy');
  pass('multi-word, prefix, quoted phrase, exclusion and per-word typo-tolerant fallback behave as specified (no stop-word or single-word carry-over)');

  // ── Bangla + mixed ──
  const bn = await expect(anon, `/api/search?q=${enc('বাংলাদেশ ক্রিকেট')}`, 200);
  assert(ids(bn).includes(A('bangla')), 'Bangla stem-prefix query (বাংলাদেশ -> বাংলাদেশের) matches');
  const bnExact = await expect(anon, `/api/search?q=${enc('বিশ্বকাপ')}`, 200);
  assert(ids(bnExact).includes(A('bangla')));
  const mixed = await expect(anon, `/api/search?q=${enc(`ক্রিকেট ${KWP}`)}`, 200);
  assert.deepEqual(ids(mixed), [A('bangla')], 'mixed Bangla + Latin query');
  const bnMulti = await expect(anon, `/api/search?q=${enc('ক্রিকেট দল বিশ্বকাপ')}`, 200);
  assert.deepEqual(ids(bnMulti), [A('bangla')], 'several Bangla words (AND)');
  const bnNone = await expect(anon, `/api/search?q=${enc('হকিমাঠপরিচর্যা')}`, 200);
  assert(!ids(bnNone).includes(A('bangla')) && bnNone.data.total === 0, 'unrelated Bangla word returns nothing');
  const bnTypo = await expect(anon, `/api/search?q=${enc('বিশ্বকপ')}`, 200);
  assert.equal(bnTypo.data.mode, 'fuzzy'); assert(ids(bnTypo).includes(A('bangla')), 'Bangla typo (missing vowel sign) found by trigram fallback');
  const bnParts = highlightParts('বাংলাদেশের ক্রিকেট দল', 'বাংলাদেশ');
  assert.deepEqual(bnParts.filter((p) => p.match).map((p) => p.text), ['বাংলাদেশের'], 'Bangla highlighting keeps vowel signs inside the word');
  pass('Bangla exact, prefix (বাংলাদেশ -> বাংলাদেশের), multi-word, mixed Bangla/English, no-result and typo-fallback queries behave as documented; highlighting is script-aware');

  // ── Visibility ──
  for (const hidden of ['draft', 'scheduled', 'archived', 'preview', 'hidden-sport']) assert(!ids(rel).includes(A(hidden)), `${hidden} must not be public`);
  const staff = await expect(admin, `/api/cms/articles/search?q=${KW}&limit=50`, 200);
  for (const s of ['title', 'excerpt', 'body', 'draft', 'scheduled', 'archived', 'preview', 'hidden-sport']) assert(ids(staff).includes(A(s)), `staff sees ${s}`);
  const drafts = await expect(admin, `/api/cms/articles/search?q=${KW}&status=draft`, 200);
  assert.deepEqual(ids(drafts), [A('draft')]);
  assert.equal(ids(await expect(author, `/api/cms/articles/search?q=${A('title')}`, 200))[0], A('title'), 'staff can find by article id');
  assert.equal(ids(await expect(admin, `/api/cms/articles/search?q=${A('body')}`, 200))[0], A('body'), 'staff can find by slug');
  await expect(anon, `/api/cms/articles/search?q=${KW}`, 401);
  await expect(anon, `/api/search?q=${KW}&status=draft`, 400);
  pass('public search excludes draft/scheduled/archived/preview/hidden-sport content; CMS search is staff-only and sees every status, id and slug');

  // ── Filters, sorting, pagination ──
  assert.deepEqual(ids(await expect(anon, `/api/search?q=${KW}&sort=newest`, 200)), [A('body'), A('excerpt'), A('title')]);
  assert.deepEqual(ids(await expect(anon, `/api/search?q=${KW}&sort=oldest`, 200)), [A('title'), A('excerpt'), A('body')]);
  const p2 = await expect(anon, `/api/search?q=${KW}&limit=1&page=2`, 200);
  assert.deepEqual(ids(p2), [A('excerpt')]); assert.equal(p2.data.totalPages, 3);
  assert.deepEqual(ids(await expect(anon, `/api/search?q=${KW}&type=Analysis`, 200)), [A('title')]);
  assert.deepEqual(ids(await expect(anon, `/api/search?q=${KW}&author=${authorSlug}`, 200)), [A('title')]);
  assert.deepEqual(ids(await expect(anon, `/api/search?q=${KW}&author=${fixture}-nobody`, 200)), []);
  assert.deepEqual(ids(await expect(anon, `/api/search?q=${KW}&from=2026-02-15`, 200)), [A('body')]);
  assert.deepEqual(ids(await expect(anon, `/api/search?q=${KW}&to=2026-01-01`, 200)), [A('title')], 'to is inclusive');
  assert.deepEqual(ids(await expect(anon, `/api/search?q=${KW}&sport=${otherSport.slug}`, 200)), []);
  const browse = await expect(anon, '/api/search?limit=5', 200);
  assert.equal(browse.data.mode, 'browse');
  const dates = browse.data.results.map((r: any) => Date.parse(r.publishedAt));
  assert(dates.every((d: number, i: number) => i === 0 || dates[i - 1] >= d), 'empty query lists newest first');
  const week = parseSearchQuery({ date: 'week' }, { strict: true, defaultLimit: 12 });
  assert(week.ok && week.value.from && Date.now() - week.value.from.getTime() <= 7 * 86400000);
  pass('sport/category/author/date filters, custom ranges, relevance/newest/oldest sorting, pagination and empty-query browsing are correct');

  // ── Validation & safety ──
  for (const bad of ['limit=51', 'limit=0', 'page=0', 'page=501', 'q=a&q=b', 'sport[]=x', 'sort=score', 'date=decade', 'from=2026-13-40', 'type=Nope', 'nonsense=1', `q=${'x'.repeat(201)}`, 'from=2026-03-01&to=2026-01-01']) {
    await expect(anon, `/api/search?${bad}`, 400);
  }
  for (const odd of [`'; DROP TABLE "Article"; --`, '"unclosed phrase', 'a & b | !c :* <->', '%_\\', '   ', '!!!']) {
    await expect(anon, `/api/search?q=${enc(odd)}`, 200);
    await expect(anon, `/api/search/suggestions?q=${enc(odd)}`, 200);
  }
  const punct = await expect(anon, `/api/search?q=${enc('!!! ???')}`, 200);
  assert.equal(punct.data.total, 0, 'a query without searchable words matches nothing (not a silent full listing)');
  assert(await prisma.article.count() > 0, 'Article table intact');
  pass('malformed, oversized, repeated and unknown parameters are rejected; tsquery/SQL/LIKE metacharacters are handled safely');

  // ── Suggestions ──
  const sug = await expect(anon, `/api/search/suggestions?q=${KW.slice(0, 7)}`, 200);
  const sugTitles = sug.data.articles.map((a: any) => a.title);
  assert(sugTitles.includes(`${KW} final preview`), 'suggests the matching title');
  assert(sug.data.articles.length <= 6 && sug.data.sports.length <= 3, 'suggestions are limited');
  assert(!sugTitles.some((t: string) => /status|hidden sport/.test(t)), 'no unpublished/hidden titles suggested');
  assert(sug.data.articles.every((a: any) => a.url.startsWith('/') && !('id' in a)), 'suggestions expose only public fields');
  assert.deepEqual((await expect(anon, '/api/search/suggestions?q=z', 200)).data, { articles: [], sports: [], events: [] }, 'single character does not query'); // E5 added event suggestions
  pass('autocomplete returns a small, public-only, title-weighted suggestion list');

  // ── Public page (URL state, highlighting, states, SEO) ──
  const page = await expect(anon, `/search/?q=${KW}&sort=newest`, 200);
  assert(page.text.includes('<mark'), 'matches are highlighted'); assert(page.text.match(/noindex/i), 'search pages stay noindex (Phase D)');
  assert(page.text.includes(`${KW}</mark> final preview`) || page.text.includes(`>${KW}</mark>`));
  assert(!page.text.includes('draft status') && !page.text.includes('hidden sport'));
  assert(page.text.includes('3</strong> <!-- -->results') || page.text.includes('results for'));
  const none = await expect(anon, `/search/?q=xv${letters(10)}`, 200);
  assert(none.text.includes('No results found for'), 'no-result state');
  await expect(anon, `/search/?q=${KW}&page=abc&limit=999&sort=bogus&sport[]=x`, 200);
  const filtered = await expect(anon, `/search/?q=${KW}&type=Analysis`, 200);
  assert(filtered.text.includes('Clear all filters') && filtered.text.includes('final preview') && !filtered.text.includes('mentions'), 'filters are URL state');
  const canonicals = [...page.text.matchAll(/<link rel="canonical" href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(canonicals, [`${base}/search/`], 'one canonical, pointing at /search/ without the query');
  assert.match(page.text, /<meta name="robots" content="noindex, follow"/);
  const robots = await expect(anon, '/robots.txt', 200);
  assert(!/Disallow:\s*\/search/i.test(robots.text), 'robots does not block /search (crawlers must see noindex)');
  const index = await expect(anon, '/sitemap.xml', 200);
  for (const loc of [...index.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname)) {
    const child = await expect(anon, loc, 200);
    assert(!child.text.includes('/search'), `${loc} lists no search URLs`);
  }
  const empty = await expect(anon, '/search/', 200);
  assert(empty.text.includes('Latest articles') && empty.text.includes('Use quotes for an exact phrase'), 'empty-query state explains search');
  pass('public search page renders URL-driven filters, highlighting and empty/no-result states; stays noindex,follow with a query-free canonical, out of sitemaps and not blocked by robots');

  // ── Index freshness (generated column) ──
  await prisma.article.update({ where: { id: A('title') }, data: { title: `${KW3} renamed headline` } });
  assert.deepEqual(ids(await expect(anon, `/api/search?q=${KW3}`, 200)), [A('title')], 'new title is searchable immediately');
  assert(!ids(await expect(anon, `/api/search?q=${enc(`${KW} final`)}`, 200)).includes(A('title')), 'old title no longer matches');
  await prisma.article.update({ where: { id: A('draft') }, data: { status: 'published' } });
  assert(ids(await expect(anon, `/api/search?q=${KW}`, 200)).includes(A('draft')), 'publishing makes it searchable');
  pass('search vector stays in sync with title edits and publication changes without manual reindexing');

  // ── Synchronisation through the CMS save API (PUT /api/articles/:id) ──
  const t = () => `zs${letters(8)}`;
  // Deterministic choice (row order changes whenever an Edition is updated), and the event word
  // must be a real search word: a stop word such as "the" (the-masters) is ignored by design.
  const edition = await prisma.eventEdition.findFirstOrThrow({ where: { event: { isVisible: true, sport: { isVisible: true } } }, orderBy: { id: 'asc' } });
  const startSport = await prisma.sport.findFirstOrThrow({ where: { isVisible: true, slug: { not: edition.sportSlug } } });
  const eventWord = edition.eventSlug.split('-').find((w) => w.length > 2 && !['the', 'and', 'for'].includes(w) && !edition.sportSlug.includes(w)) ?? edition.eventSlug;
  const sportWord = (slug: string) => slug.split('-')[0];
  const tok = { title: [t(), t()], subtitle: [t(), t()], excerpt: [t(), t()], body: [t(), t()], kw: [t(), t()] };
  const syncId = A('sync');
  await prisma.article.create({ data: article('sync', {
    sportSlug: startSport.slug, status: 'draft', articleType: 'Schedule', title: `${tok.title[0]} headline`, subtitle: `${tok.subtitle[0]} deck`,
    excerpt: `${tok.excerpt[0]} summary`, content: `${tok.body[0]} body`, seo: { keywords: [tok.kw[0]] },
  }) as any });
  const staffHas = async (q: string, extra = '') => ids(await expect(admin, `/api/cms/articles/search?q=${enc(q)}&limit=50${extra}`, 200)).includes(syncId);
  const publicHas = async (q: string) => ids(await expect(anon, `/api/search?q=${enc(q)}&limit=50`, 200)).includes(syncId);
  const save = async (body: Record<string, unknown>) => {
    const r = await admin.request(`/api/articles/${syncId}`, 'PUT', body);
    assert.equal(r.status, 200, `save ${JSON.stringify(body).slice(0, 80)}: ${r.text.slice(0, 300)}`);
  };
  const swap = async (label: string, field: keyof typeof tok, body: Record<string, unknown>) => {
    assert(await staffHas(tok[field][0]) && !(await staffHas(tok[field][1])), `${label}: before`);
    await save(body);
    assert(await staffHas(tok[field][1]), `${label}: new value searchable`);
    assert(!(await staffHas(tok[field][0])), `${label}: old value no longer matches`);
  };
  await swap('title', 'title', { title: `${tok.title[1]} headline` });
  await swap('subtitle', 'subtitle', { subtitle: `${tok.subtitle[1]} deck` });
  await swap('excerpt', 'excerpt', { excerpt: `${tok.excerpt[1]} summary` });
  await swap('body', 'body', { body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `${tok.body[1]} body` }] }] } });
  await swap('SEO keywords', 'kw', { seo: { keywords: [tok.kw[1]] } });
  const title = tok.title[1];
  assert(await staffHas(`${title} schedule`) && !(await staffHas(`${title} results`)), 'category: before');
  await save({ articleType: 'Results' });
  assert(await staffHas(`${title} results`) && !(await staffHas(`${title} schedule`)), 'category change is searchable and the old category is dropped');
  assert(await staffHas(title, `&sport=${startSport.slug}`) && await staffHas(`${title} ${sportWord(startSport.slug)}`), 'sport: before');
  await save({ sportSlug: edition.sportSlug });
  assert(await staffHas(title, `&sport=${edition.sportSlug}`) && !(await staffHas(title, `&sport=${startSport.slug}`)), 'sport filter follows the change');
  assert(await staffHas(`${title} ${sportWord(edition.sportSlug)}`), 'new sport word matches');
  if (!edition.sportSlug.includes(sportWord(startSport.slug))) assert(!(await staffHas(`${title} ${sportWord(startSport.slug)}`)), 'old sport word no longer matches');
  assert(!(await staffHas(`${title} ${eventWord}`)), 'event: before');
  await save({ eventSlug: edition.eventSlug, editionYear: edition.year });
  assert(await staffHas(`${title} ${eventWord}`), 'event assignment is searchable');
  await save({ eventSlug: null, editionYear: null });
  assert(!(await staffHas(`${title} ${eventWord}`)), 'removed event no longer matches');
  assert(!(await publicHas(title)), 'draft is not public');
  await save({ status: 'published' });
  assert(await publicHas(title), 'publishing makes it publicly searchable');
  await save({ status: 'draft' });
  assert(!(await publicHas(title)) && await staffHas(title), 'unpublishing removes it from public search only');
  const removed = await admin.request(`/api/articles/${syncId}`, 'DELETE');
  assert.equal(removed.status, 200, removed.text);
  assert(!(await staffHas(title)) && !(await publicHas(title)), 'deleted article is gone from every search');
  pass('saving through the CMS API keeps search in sync for title, subtitle, excerpt, body, category, sport, event, SEO keywords, publish/unpublish and delete');

  // ── Query plans and timings ──
  const plan = async (sql: string, ...params: unknown[]) => {
    const rows = await prisma.$transaction([
      prisma.$executeRawUnsafe('SET LOCAL enable_seqscan = off'),
      prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(`EXPLAIN ${sql}`, ...params),
    ]);
    return (rows[1] as any[]).map((r) => r['QUERY PLAN']).join('\n');
  };
  const natural = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(`EXPLAIN ANALYZE SELECT id FROM "Article" a WHERE a."searchVector" @@ to_tsquery('english', $1)`, `${KW}:*`);
  console.log(`     natural plan at ${await prisma.article.count()} rows: ${natural[0]['QUERY PLAN'].trim()}`);
  // Diagnostic only (not how the app runs): prove the indexes are eligible.
  const ftsPlan = await plan(`SELECT id FROM "Article" a WHERE a."searchVector" @@ to_tsquery('english', $1)`, `${KW}:*`);
  assert(ftsPlan.includes('Article_searchVector_idx'), ftsPlan);
  const trgmPlan = await plan(`SELECT id FROM "Article" a WHERE $1 <% a."title"`, KW);
  assert(trgmPlan.includes('Article_title_trgm_idx'), trgmPlan);
  const timings: Record<string, number> = {};
  await searchArticleIds({ scope: 'public', q: 'warmup' }); // connection/plan warm-up, not measured
  for (const [label, q, extra] of [
    ['common keyword', 'open', {}], ['rare keyword', KW, {}], ['multi-word', 'french open schedule', {}], ['Bangla', 'বাংলাদেশ ক্রিকেট', {}],
    ['no result', `${KW}qq`, {}], ['filtered', 'open', { sport: sport.slug, type: 'Schedule' }],
  ] as const) {
    const t = performance.now();
    await searchArticleIds({ scope: 'public', q, ...extra });
    timings[label] = Math.round((performance.now() - t) * 10) / 10;
  }
  console.log('     query plans: searchVector GIN and title trigram GIN are usable; timings (ms, in-process):', JSON.stringify(timings));
  pass('full-text and trigram predicates are served by their GIN indexes');

  // ── Rate limiting (last: it exhausts this client IP's budget) ──
  let limited = false;
  for (let i = 0; i < 140 && !limited; i++) limited = (await anon.request(`/api/search?q=${KW}`)).status === 429;
  assert(limited, 'public search is rate limited');
  pass('public search API is rate limited per client');
} finally {
  child.kill(); await once(child, 'exit').catch(() => undefined);
  await prisma.article.deleteMany({ where: { id: { startsWith: fixture } } });
  await prisma.redirectRule.deleteMany({ where: { OR: [{ sourceUrl: { contains: fixture } }, { targetUrl: { contains: fixture } }] } });
  await prisma.sport.deleteMany({ where: { id: hiddenSport } });
  await prisma.author.deleteMany({ where: { id: A('writer') } });
  await prisma.session.deleteMany({ where: { userId: { in: Object.values(userIds) } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ userId: { in: Object.values(userIds) } }, { entityId: { contains: fixture } }] } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(userIds) } } });
  const after = await snapshot();
  assert.deepEqual(after, before, 'Database changed outside disposable Phase E fixtures.');
  console.log(`PASS ${checks} Phase E verification groups`);
  console.log('PASS database integrity: all pre-existing rows unchanged; fixtures removed.');
  await prisma.$disconnect();
}
