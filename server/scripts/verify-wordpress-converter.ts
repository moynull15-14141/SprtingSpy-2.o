/** WordPress migration phase 1 checks: converter, mapping proposals, zip reader and the
 * dry-run command's safety properties. Fixtures only: no database, no network, no backup files.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateRichDoc, type RichNode } from '../../src/lib/richText';
import { convertWordPressHtml, type ConversionResult } from '../wordpressImport/htmlToDoc';
import { proposeArticleType, proposeAuthor, proposeKeywords, proposeSport, similarTitles, type CmsSnapshot } from '../wordpressImport/mapping';
import { parseWxr, videoLinkOf, type WxrItem } from '../wordpressImport/wxr';
import { ZipReader } from '../wordpressImport/zipReader';
import { APPROVED_SPORTS, AUTHOR_PROFILE_SLUGS, CATEGORY_ARCHIVE_SPORT, EVENT_LINK_CANDIDATES, KEEP_SEPARATE, PILOT_POSTS } from '../wordpressImport/decisions';
import { checkPilotIsolation } from '../wordpressImport/isolation';
import { initialReviewStatus, parseImportSource } from '../../src/lib/editorialWorkflow';
import { parseSearchQuery } from '../services/search/params';

let checks = 0;
const pass = (name: string) => { checks++; console.log(`PASS ${name}`); };

const known: Record<string, string> = { 'https://www.sportingspy.com/wp-content/uploads/2024/11/a.jpg': 'wp-att-10', 'https://www.sportingspy.com/wp-content/uploads/2024/11/b-300x200.png': 'wp-att-11' };
const convert = (html: string, videoUrl?: string): ConversionResult => {
  const result = convertWordPressHtml(html, { resolveImage: (src) => (known[src] ? { mediaId: known[src], alt: 'Library alt' } : { missing: 'file is not in the uploads archive' }), videoUrl });
  if (result.ok) assert.equal(validateRichDoc(result.doc).ok, true, 'every converted document passes the CMS validator');
  return result;
};
const blocks = (r: ConversionResult) => r.doc!.content;
const text = (n: RichNode): string => (n.type === 'text' ? n.text! : n.type === 'hardBreak' ? '\n' : (n.content ?? []).map(text).join(''));
const issue = (r: ConversionResult, code: string) => r.issues.find((i) => i.code === code);
const complete = (r: ConversionResult) => assert.equal(r.coverage.missingWords, 0, `no source text may go missing: ${r.coverage.missingSample.join(' ')}`);

// ── Paragraphs, headings, inline marks, links ──
let r = convert('Bare first line\nsecond line\r\n\r\nNew paragraph with <strong>bold</strong>, <em>italic</em> and <a href="https://example.com/x" target="_blank" rel="noopener nofollow">a link</a>.\n<h2 style="text-align: center;">Heading <b>two</b></h2>\n<h5>Small heading</h5><h1>Top</h1>\n<p style="text-align: justify; color: #ff0000;">Justified <span style="font-weight: 700; font-size: 20px;">heavy</span></p>');
assert.deepEqual(blocks(r).map((b) => b.type), ['paragraph', 'paragraph', 'heading', 'heading', 'heading', 'paragraph']);
assert.equal(text(blocks(r)[0]), 'Bare first line\nsecond line');
const inline = blocks(r)[1].content!;
assert.deepEqual(inline.find((n) => n.text === 'bold')!.marks, [{ type: 'bold' }]);
assert.deepEqual(inline.find((n) => n.text === 'a link')!.marks, [{ type: 'link', attrs: { href: 'https://example.com/x', target: '_blank', rel: 'nofollow' } }]);
assert.deepEqual(blocks(r)[2], { type: 'heading', attrs: { level: 2, textAlign: 'center' }, content: [{ type: 'text', text: 'Heading two' }] });
assert.equal(blocks(r)[3].attrs!.level, 4); assert.equal(blocks(r)[4].attrs!.level, 2);
assert.equal(issue(r, 'heading-level-changed')!.count, 2);
assert.equal(blocks(r)[5].attrs!.textAlign, 'left');
assert.equal(issue(r, 'text-justify-flattened')!.count, 1);
assert.deepEqual(issue(r, 'style-flattened')!.samples.sort(), ['color', 'font-size']);
assert.deepEqual(blocks(r)[5].content!.find((n) => n.text === 'heavy')!.marks, [{ type: 'bold' }]);
assert.deepEqual(r.links, [{ href: 'https://example.com/x', originalHref: 'https://example.com/x', text: 'a link' }]);
complete(r);
pass('paragraphs (wpautop), headings H1/H5 remapped and reported, inline marks, links, style losses reported');

r = convert('<p><a href="javascript:alert(1)">bad</a> and <a href="#top">anchor</a> stay as text</p><script>alert(1)</script><iframe src="https://evil.example/x"></iframe><custom-tag>kept text</custom-tag>');
assert.equal(JSON.stringify(r.doc).includes('javascript'), false);
assert.equal(text(blocks(r)[0]), 'bad and anchor stay as text');
assert.equal(issue(r, 'link-dropped')!.count, 2);
assert.equal(issue(r, 'script-or-style-dropped')!.count, 1);
assert.equal(issue(r, 'embedded-media-dropped')!.count, 1);
assert.equal(issue(r, 'unsupported-element')!.samples[0], '<custom-tag>');
assert(blocks(r).some((b) => text(b) === 'kept text'));
pass('unsafe links, scripts, foreign iframes and unknown elements are never stored and always reported');

// ── Lists ──
r = convert('<ul><li>One</li><li>Two<ul><li>Nested</li></ul></li></ul><ol start="3"><li><p>Three</p></li></ol>');
assert.equal(blocks(r)[0].type, 'bulletList');
assert.deepEqual(blocks(r)[0].content![1].content!.map((b) => b.type), ['paragraph', 'bulletList']);
assert.equal(blocks(r)[1].attrs!.start, 3);
complete(r);
pass('bullet, nested and ordered lists');

// ── Tables ──
r = convert('<table style="border-collapse: collapse;"><caption>Caption text</caption><thead><tr><th colspan="2" style="text-align:center">Head</th></tr></thead><tbody><tr style="background:#eee"><td rowspan="2"><h4>Cell heading</h4><div>Line</div></td><td><ul><li>a</li><li>b</li></ul></td></tr><tr><td><strong>x</strong><img src="https://www.sportingspy.com/wp-content/uploads/2024/11/a.jpg" alt="in cell"></td></tr></tbody></table>');
assert.deepEqual(blocks(r).map((b) => b.type), ['paragraph', 'table']);
assert.equal(text(blocks(r)[0]), 'Caption text');
const rows = blocks(r)[1].content!;
assert.deepEqual(rows[0].content![0], { type: 'tableHeader', attrs: { colspan: 2, rowspan: 1 }, content: [{ type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: 'Head' }] }] });
assert.equal(rows[1].content![0].attrs!.rowspan, 2);
assert.deepEqual(rows[1].content![0].content!.map(text), ['Cell heading', 'Line']);
assert.deepEqual(rows[1].content![1].content!.map(text), ['• a', '• b']);
assert(rows.every((row) => row.content!.every((cell) => cell.content!.every((b) => b.type === 'paragraph'))), 'table cells hold paragraphs only');
for (const code of ['table-cell-heading-flattened', 'table-cell-list-flattened', 'table-cell-image-dropped', 'table-style-flattened']) assert(issue(r, code), `${code} is reported`);
assert.equal(issue(r, 'table-caption-moved')!.severity, 'notice');
assert.equal(r.images[0].placed, false);
complete(r);
pass('tables with merged cells; cell headings, lists and images flattened and reported; caption kept');

// ── Images and captions ──
r = convert('[caption id="attachment_10" align="alignnone" width="800"]<img class="size-full" src="https://www.sportingspy.com/wp-content/uploads/2024/11/a.jpg" alt="Own alt" width="800" height="600" /> Caption words[/caption]\n<p>Before <img src="https://www.sportingspy.com/wp-content/uploads/2024/11/b-300x200.png"> after</p><figure><img src="https://www.sportingspy.com/wp-content/uploads/2099/01/gone.jpg" alt="x"><figcaption>Orphan caption</figcaption></figure><img src="https://secure.gravatar.com/avatar/x">');
assert.deepEqual(blocks(r).map((b) => b.type), ['image', 'paragraph', 'image', 'paragraph', 'paragraph']);
assert.deepEqual(blocks(r)[0].attrs, { mediaId: 'wp-att-10', src: null, alt: 'Own alt', title: null, caption: 'Caption words', credit: '', align: 'center', width: 'wide', lightbox: true });
assert.equal(blocks(r)[2].attrs!.alt, 'Library alt');
assert.equal(text(blocks(r)[4]), 'Orphan caption');
assert.equal(issue(r, 'image-missing')!.count, 2);
assert.equal(r.images.filter((i) => !i.mediaId).length, 2);
complete(r);
pass('images use resolved Media ids only; [caption] and figcaption kept; missing images reported, never invented');

// ── FAQ accordions and video ──
r = convert('<p>Intro</p><h2>FAQ</h2><details id="e-1" open><summary>Where is it held? <svg viewBox="0 0 1 1"><path d="M0 0"/></svg></summary>In <a href="https://example.com">Taupo</a>, New Zealand.</details><details><summary>Hm?</summary></details><p>After</p>', 'https://www.youtube.com/watch?v=abc123&t=6s');
assert.deepEqual(blocks(r).map((b) => b.type), ['embed', 'paragraph', 'paragraph']);
assert.deepEqual(blocks(r)[0].attrs, { kind: 'youtube', url: 'https://www.youtube.com/watch?v=abc123&t=6s', title: '' });
assert.deepEqual(r.faqs[0], { question: 'Where is it held?', answer: 'In Taupo, New Zealand.', problems: [] });
assert.equal(r.faqs[1].problems.length, 2);
for (const code of ['faq-invalid', 'faq-answer-link-flattened', 'faq-heading-removed', 'decorative-svg-dropped', 'video-link-added-as-embed']) assert(issue(r, code), `${code} is reported`);
complete(r);
pass('FAQ accordions become FAQ entries checked against the FAQ limits; video link becomes a YouTube embed');

r = convert('   \n<!-- wp:paragraph --><!-- /wp:paragraph -->&nbsp;');
assert.equal(r.ok, false); assert.equal(r.doc, null);
pass('an empty body is a failure, not an empty article');

// ── Link rewriting ──
r = convertWordPressHtml('<p><a href="https://www.sportingspy.com/category/golf/">Golf</a> <a href="https://www.sportingspy.com/category/run/">Run</a> <a href="https://example.com/">Out</a></p>', {
  resolveImage: () => ({ missing: 'n/a' }),
  rewriteLink: (href) => (href.endsWith('/category/golf/') ? '/golf/' : href.endsWith('/category/run/') ? 'javascript:alert(1)' : undefined),
});
assert.deepEqual(r.links.map((l) => [l.originalHref, l.href]), [['https://www.sportingspy.com/category/golf/', '/golf/'], ['https://www.sportingspy.com/category/run/', 'https://www.sportingspy.com/category/run/'], ['https://example.com/', 'https://example.com/']]);
assert.equal(JSON.stringify(r.doc).includes('javascript'), false);
assert.equal(validateRichDoc(r.doc).ok, true);
pass('links are rewritten only to the address the caller verified; an unsafe rewrite is ignored and the original kept');

// ── Mapping proposals ──
const cms: CmsSnapshot = { capturedAt: 'fixture', source: 'fixture', sports: ['tennis', 'athletics', 'boxing', 'nfl', 'hockey', 'netball', 'motorsport'].map((slug) => ({ slug })), events: [], articleTypes: ['Event Guide', 'How to Watch', 'Schedule', 'Players'].map((name) => ({ name })), authors: [{ slug: 'elena-rostova' }], articlePaths: [] };
const post = (title: string, categories: string[], extra: Partial<WxrItem> = {}): WxrItem => ({ id: '1', type: 'post', status: 'publish', title, slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), path: '/x/', dateGmt: '', modifiedGmt: '', creator: 'Sergio', categories: categories.map((slug) => ({ slug, name: slug })), tags: [], excerpt: '', body: '', meta: new Map(), oldSlugs: [], filePath: '', ...extra });
assert.equal(proposeSport(post('Miami Open Tennis 2026', ['latest-news', 'tennis']), cms).sportSlug, 'tennis');
assert.deepEqual(proposeSport(post('Breaking update', ['latest-news']), cms), { sportSlug: null, confidence: 'none', rationale: 'No existing sport matches. WordPress categories: latest-news.', newSportSuggestion: null, decisions: ['Choose an existing sport or approve a new one.'] });
assert.equal(proposeSport(post('BMW Berlin Marathon 2025', ['run']), cms).sportSlug, 'athletics');
for (const [title, category, suggestion] of [['WNFR 2025 Rodeo', 'rodeo', 'rodeo'], ['Melbourne Cup Horse Race 2025', 'racing', 'horse-racing'], ['AMJ Masters Curling', 'curling', 'curling'], ['AFL Grand Final Match 2025', 'nfl', 'australian-football']]) {
  const p = proposeSport(post(title, [category]), cms);
  assert.equal(p.sportSlug, null, `${title} must not be forced into an existing sport`); assert.equal(p.newSportSuggestion, suggestion); assert(p.decisions.length);
}
const triathlon = proposeSport(post('Ironman 70.3 World Championship triathlon 2025', ['athletics']), cms);
assert.equal(triathlon.sportSlug, null, 'triathlon is never classified as athletics'); assert.equal(triathlon.newSportSuggestion, 'triathlon'); assert(triathlon.decisions.length);
assert.equal(proposeSport(post('Golf Open 2026', ['golf']), cms).sportSlug, null, 'a sport missing from the CMS is never proposed');
assert.equal(proposeArticleType(post('How to Watch Davis Cup Final 2024 Live', []), cms).articleType, 'How to Watch');
assert.equal(proposeArticleType(post('Something else entirely', []), cms).confidence, 'low');
assert(cms.articleTypes.some((t) => t.name === proposeArticleType(post('Top 10 footballers to watch: rising stars', []), cms).articleType));
const author = proposeAuthor('Sergio', [{ login: 'Sergio', displayName: 'Sergio J. Bynum' }], cms);
assert.equal(author.sourceName, 'Sergio J. Bynum'); assert.equal(author.authorSlug, null); assert.equal(author.proposedSlug, 'sergio-j-bynum');
assert(!/@/.test(JSON.stringify(author)), 'no e-mail address is ever proposed');
assert.equal(proposeAuthor('x', [{ login: 'x', displayName: 'Elena Rostova' }], cms).authorSlug, 'elena-rostova');
const kw = proposeKeywords(post('t', [], { tags: Array.from({ length: 40 }, (_, i) => ({ slug: `t${i}`, name: i === 0 ? 'Focus' : `Tag ${i}` })), meta: new Map([['rank_math_focus_keyword', 'focus']]) }));
assert.equal(kw.keywords.length, 30); assert.equal(kw.keywords[0], 'focus'); assert.equal(kw.dropped, 10);
assert.equal(similarTitles([post('Japan Cup Horse Race 2024 Viewing Options', []), { ...post('45th Japan Cup Horse Race 2025 Guide', []), id: '2' }, { ...post('Miami Open Tennis', []), id: '3' }]).length, 1);
pass('mapping proposals: Latest News is never a sport, no sport is invented, authors keep source attribution without e-mail');

// ── Owner decisions ──
const NEW_SPORTS = ['rodeo', 'horse-racing', 'curling', 'australian-football', 'triathlon'];
assert.deepEqual([...new Set(Object.values(APPROVED_SPORTS))].sort(), [...NEW_SPORTS, 'boxing', 'hockey'].sort());
for (const id of ['973', '3020', '3023', '3026']) assert.equal(APPROVED_SPORTS[id], 'triathlon');
for (const id of ['86', '243', '2877']) assert.equal(APPROVED_SPORTS[id], 'boxing');
assert.equal(APPROVED_SPORTS['3608'], 'hockey'); assert.equal(APPROVED_SPORTS['142'], 'australian-football');
assert(!Object.values(APPROVED_SPORTS).includes('athletics') && !Object.values(APPROVED_SPORTS).some((sport) => /news/.test(sport)));
assert.deepEqual(AUTHOR_PROFILE_SLUGS, { Jamie: 'jamie', 'Sergio J. Bynum': 'sergio-j-bynum' });
assert.deepEqual(KEEP_SEPARATE, [['118', '3866'], ['1085', '3805'], ['3020', '3023', '3026']]);
assert.deepEqual(EVENT_LINK_CANDIDATES, ['68', '118', '3866', '3906']);
assert.equal(CATEGORY_ARCHIVE_SPORT.run, 'athletics', 'the "run" archive goes to athletics (owner decision)');
assert.equal(CATEGORY_ARCHIVE_SPORT['latest-news'], undefined);
assert.deepEqual(PILOT_POSTS.map((p) => p.covers).sort(), ['caption', 'faq', 'large-table', 'merged-cells', 'video']);
assert.equal(new Set(PILOT_POSTS.map((p) => p.id)).size, 5);
pass('owner decisions: new sports, triathlon apart from athletics, author slugs, kept-separate posts, five distinct pilot posts');

// ── Review requirement for imported articles ──
assert.deepEqual(initialReviewStatus('Admin', {}), { reviewStatus: 'not_required' }, 'staff articles are unchanged');
assert.deepEqual(initialReviewStatus('Editor', { status: 'published' }), { reviewStatus: 'not_required' });
assert.deepEqual(initialReviewStatus('Author', {}), { reviewStatus: 'draft' });
for (const role of ['Admin', 'Editor', 'Author'] as const) {
  assert.deepEqual(initialReviewStatus(role, { requireReview: true }), { reviewStatus: 'draft' });
  assert.deepEqual(initialReviewStatus(role, { requireReview: true, status: 'draft', scheduledFor: null }), { reviewStatus: 'draft' });
  for (const body of [{ requireReview: false }, { requireReview: 'true' }, { requireReview: 1 }, { requireReview: null }, { requireReview: true, status: 'published' }, { requireReview: true, status: 'scheduled', scheduledFor: '2030-01-01T00:00:00Z' }, { requireReview: true, status: 'preview' }, { requireReview: true, status: 'archived' }, { requireReview: true, scheduledFor: '2030-01-01T00:00:00Z' }]) {
    assert('error' in initialReviewStatus(role, body), role + ' ' + JSON.stringify(body) + ' must be refused');
  }
}
const workflowSource = fs.readFileSync('server/editorialWorkflow.ts', 'utf8');
const serverSource = fs.readFileSync('server.ts', 'utf8');
assert(workflowSource.includes('checkArticlePayload(body, !existing)') && workflowSource.includes("!(creating && (key === 'requireReview' || key === 'importSource'))"), 'requireReview is a creation-only field');
assert(!/writeFields = new Set\(\[[^\]]*requireReview/.test(workflowSource), 'requireReview is not a general write field (an update cannot send it)');
assert(workflowSource.includes("protectedFields = new Set(['reviewStatus'"), 'reviewStatus itself stays unwritable');
assert(serverSource.includes('reviewStatus: review.reviewStatus,') && !serverSource.includes("reviewStatus: role === 'Author' ? 'draft' : 'not_required'"), 'the create route takes the review state from initialReviewStatus');
assert(workflowSource.includes("existing.reviewStatus !== 'not_required' && existing.reviewStatus !== 'approved') fail(409"), 'publishing an unreviewed article is still refused');
pass('imported articles: requireReview only tightens (draft, never published/scheduled, creation only); the publish guard is unchanged');

// ── Import record (the "WordPress Import" label) ──
const origin = { source: 'wordpress', sourceId: '1163', sourceTitle: 'Au Open Tennis 2025', sourceUrl: '/au-open-tennis-2025/' };
assert.deepEqual(parseImportSource({}), { importSource: null }, 'an ordinary article carries no import record');
assert.deepEqual(parseImportSource({ requireReview: true, importSource: origin }), { importSource: origin });
assert.deepEqual(parseImportSource({ requireReview: true, importSource: { source: 'wordpress', sourceId: '7' } }), { importSource: { source: 'wordpress', sourceId: '7', sourceTitle: '', sourceUrl: '' } });
for (const body of [{ importSource: origin }, { requireReview: false, importSource: origin }, { requireReview: true, importSource: null }, { requireReview: true, importSource: 'wordpress' }, { requireReview: true, importSource: { ...origin, source: 'other' } },
  { requireReview: true, importSource: { ...origin, sourceId: '' } }, { requireReview: true, importSource: { ...origin, sourceId: '1 or 1=1' } }, { requireReview: true, importSource: { ...origin, sourceUrl: 'https://example.com/x' } },
  { requireReview: true, importSource: { ...origin, sourceUrl: '//example.com' } }, { requireReview: true, importSource: { ...origin, sourceTitle: 'x'.repeat(301) } }, { requireReview: true, importSource: { ...origin, reviewStatus: 'approved' } }]) {
  assert('error' in parseImportSource(body as never), JSON.stringify(body).slice(0, 80) + ' must be refused');
}
assert(workflowSource.includes("creating && (key === 'requireReview' || key === 'importSource')"), 'importSource is a creation-only field');
assert(serverSource.includes("if (imported.importSource && role === 'Author') return res.status(403)"), 'Authors cannot mark an article as imported');
const cmsQuery = (raw: Record<string, unknown>) => parseSearchQuery(raw, { strict: true, defaultLimit: 25, allowStatus: true });
assert.equal((cmsQuery({ origin: 'wordpress' }) as { value: { origin?: string } }).value.origin, 'wordpress'); assert.equal((cmsQuery({ origin: 'original' }) as { value: { origin?: string } }).value.origin, 'original');
assert.equal(cmsQuery({ origin: 'anything' }).ok, false);
assert.equal(parseSearchQuery({ origin: 'wordpress' }, { strict: true, defaultLimit: 12 }).ok, false, 'the origin filter is CMS-only');
pass('import record: staff-only label on review-required drafts, strictly validated, creation-only; origin filter exists in CMS search only');

// ── Pilot isolation guard ──
const isolated: Record<string, string | undefined> = { DOTENV_CONFIG_PATH: 'migration-inventory/pilot.env', DATABASE_URL: 'postgresql://user:pw@localhost:5432/sportingspy_wp_pilot', MEDIA_STORAGE_PROVIDER: 'local', MEDIA_LOCAL_DIR: 'migration-inventory/pilot-media', ALLOWED_ORIGIN: 'http://127.0.0.1:3111' };
assert.deepEqual(checkPilotIsolation(isolated), { safe: true, problems: [] });
for (const patch of [
  { DOTENV_CONFIG_PATH: '' }, { DOTENV_CONFIG_PATH: '.env' }, { DOTENV_CONFIG_PATH: 'D:\\x\\.env' }, { DATABASE_URL: '' },
  { DATABASE_URL: 'postgresql://u:p@pg-1234.aivencloud.com:12345/defaultdb?sslmode=require' }, { DATABASE_URL: 'postgresql://u:p@pg-1234.aivencloud.com:12345/sportingspy_wp_pilot' },
  { DATABASE_URL: 'postgresql://u:p@localhost:5432/sportingspy' }, { DATABASE_URL: 'postgresql://u:p@localhost:5432/defaultdb' }, { DATABASE_URL: 'mysql://u:p@localhost/sportingspy_wp_pilot' },
  { MEDIA_STORAGE_PROVIDER: 'r2' }, { MEDIA_STORAGE_PROVIDER: 's3' }, { MEDIA_LOCAL_DIR: '' }, { MEDIA_S3_BUCKET: 'live' }, { MEDIA_S3_ACCESS_KEY_ID: 'key' }, { MEDIA_S3_ENDPOINT: 'https://r2.example' },
  { NODE_ENV: 'production' }, { APP_ENV: 'staging' }, { ALLOW_DESTRUCTIVE_DB_OPS: 'true' }, { ALLOWED_ORIGIN: 'https://sportingspy.com' }, { INDEXNOW_ENDPOINT: 'https://api.indexnow.org' }, { RESEND_API_KEY: 'k' },
]) {
  const result = checkPilotIsolation({ ...isolated, ...patch });
  assert.equal(result.safe, false, JSON.stringify(patch) + ' must not count as isolated'); assert(result.problems.length);
  assert(!result.problems.join(' ').includes('u:p'), 'credentials never appear in a problem message');
}
pass('pilot isolation guard: only a local sportingspy_wp_pilot database with local media and no outbound settings is accepted');

// ── WXR reader ──
const wxr = parseWxr(`<rss><channel><wp:base_site_url>https://www.sportingspy.com</wp:base_site_url><wp:author><wp:author_login><![CDATA[Sergio]]></wp:author_login><wp:author_email><![CDATA[private@example.test]]></wp:author_email><wp:author_display_name><![CDATA[Sergio J. Bynum]]></wp:author_display_name></wp:author>
<item><title><![CDATA[A &amp; B]]></title><link>https://www.sportingspy.com/a-b/</link><dc:creator><![CDATA[Sergio]]></dc:creator><content:encoded><![CDATA[<p>Body</p>]]></content:encoded><excerpt:encoded><![CDATA[]]></excerpt:encoded><wp:post_id>7</wp:post_id><wp:post_date_gmt><![CDATA[2025-01-02 03:04:05]]></wp:post_date_gmt><wp:post_name><![CDATA[a-b]]></wp:post_name><wp:status><![CDATA[publish]]></wp:status><wp:post_type><![CDATA[post]]></wp:post_type><category domain="post_tag" nicename="tag-one"><![CDATA[Tag One]]></category><category domain="category" nicename="tennis"><![CDATA[Tennis]]></category><wp:postmeta><wp:meta_key><![CDATA[papermag_post_format_meta]]></wp:meta_key><wp:meta_value><![CDATA[a:1:{s:10:"video_link";s:52:"https://www.youtube.com/watch?v=QXhV148EryQ&amp;t=6s";}]]></wp:meta_value></wp:postmeta></item></channel></rss>`);
assert.deepEqual(wxr.authors, [{ login: 'Sergio', displayName: 'Sergio J. Bynum' }]);
assert(!JSON.stringify(wxr, (_k, v) => (v instanceof Map ? [...v] : v)).includes('private@example.test'), 'author e-mail addresses are not read');
assert.equal(wxr.items[0].title, 'A & B'); assert.equal(wxr.items[0].path, '/a-b/'); assert.deepEqual(wxr.items[0].tags, [{ slug: 'tag-one', name: 'Tag One' }]);
assert.equal(videoLinkOf(wxr.items[0]), 'https://www.youtube.com/watch?v=QXhV148EryQ&t=6s');
pass('WXR reader: posts, terms, meta and video link; author e-mail is never read');

// ── Zip reader: only the requested folder, read-only ──
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sportingspy-wpzip-'));
try {
  const files: [string, Buffer][] = [['public_html/wp-content/uploads/2024/11/a.txt', Buffer.from('media bytes')], ['public_html/wp-config.php', Buffer.from('SECRET')], ['mail/inbox/1', Buffer.from('PRIVATE')]];
  const local: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const [name, data] of files) {
    const n = Buffer.from(name); const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    local.push(h, n, data); central.push(c, n); offset += 30 + n.length + data.length;
  }
  const dir = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  const zipFile = path.join(temp, 'site.zip');
  fs.writeFileSync(zipFile, Buffer.concat([...local, dir, end]));
  const before = fs.readFileSync(zipFile);
  const zip = new ZipReader(zipFile, 'public_html/wp-content/uploads/');
  assert.deepEqual([...zip.entries.keys()], ['public_html/wp-content/uploads/2024/11/a.txt']);
  assert.equal(zip.read('public_html/wp-content/uploads/2024/11/a.txt').toString(), 'media bytes');
  assert.throws(() => zip.read('public_html/wp-config.php'), /No such entry/);
  zip.close();
  assert(before.equals(fs.readFileSync(zipFile)), 'the archive is not modified');
  assert.deepEqual(fs.readdirSync(temp), ['site.zip'], 'nothing is extracted next to the archive');
  pass('zip reader indexes the uploads folder only, extracts nothing and leaves the archive unchanged');
} finally {
  assert(path.dirname(temp) === os.tmpdir() && path.basename(temp).startsWith('sportingspy-wpzip-'));
  fs.rmSync(temp, { recursive: true });
}

// ── Dry-run command safety ──
const reachable = new Set<string>();
const follow = (file: string) => {
  if (reachable.has(file)) return;
  reachable.add(file);
  for (const m of fs.readFileSync(file, 'utf8').matchAll(/(?:from|import)\s+'(\.[^']+)'/g)) {
    const base = path.resolve(path.dirname(file), m[1]);
    const target = [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')].find((f) => fs.existsSync(f));
    if (target) follow(target);
  }
};
follow(path.resolve('server/scripts/wordpress-dry-run.ts'));
for (const file of reachable) {
  const source = fs.readFileSync(file, 'utf8');
  assert(!/from '[^']*\/db'|generated\/prisma|@prisma\/|from 'pg'|dotenv|media\/(storage|service|s3)'|node:(http|https|net|tls)'|\bfetch\(/.test(source), `${path.relative(process.cwd(), file)} must stay free of database, .env, storage and network code`);
}
assert(reachable.size >= 6);
const refused = spawnSync(process.execPath, ['--import', 'tsx', 'server/scripts/wordpress-dry-run.ts', '--apply'], { encoding: 'utf8', env: { ...process.env, DATABASE_URL: '' }, windowsHide: true });
assert.equal(refused.status, 2); assert.match(refused.stderr, /only performs a dry run/);
pass(`dry-run command: ${reachable.size} modules, none reaches the database, .env, media storage or the network; --apply is refused`);

console.log(`WordPress converter verification passed: ${checks} checks.`);
