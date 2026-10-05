/**
 * PHASE N (v2.2 §25 step 1 "Inventory old URLs and content"): builds a DRAFT
 * migration sheet from the old WordPress site's own exports. READ-ONLY: it
 * never connects to the database and never writes outside --out.
 *
 * Every row comes from a real source — the WordPress export (posts, pages,
 * attachment pages, categories, tags, authors, old slugs), optionally Rank
 * Math's redirect table from the SQL dump and an access log. Decisions and
 * New URLs are left EMPTY (UNDECIDED): they are the owner's/editor's call,
 * never guessed here. E-mail addresses in the export are never copied.
 *
 *   npm run migration:inventory -- --wxr <export.xml> [--rankmath-sql <dump.sql>] [--access-log <log[.gz]>] [--out <dir>]
 *
 * Output (in --out, default ./migration-inventory):
 *   url-inventory.csv    the migration sheet (importable in CMS → Site Migration)
 *   media-inventory.csv  attachments: file URL, alt, caption, size, usage, hits
 *   summary.json         counts per source/type
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import zlib from 'node:zlib';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const wxrFile = args.get('wxr');
if (!wxrFile || !fs.existsSync(wxrFile)) {
  console.error('Usage: npm run migration:inventory -- --wxr <wordpress-export.xml> [--rankmath-sql <dump.sql>] [--access-log <log[.gz]>] [--out <dir>]');
  process.exit(1);
}
const outDir = path.resolve(args.get('out') || 'migration-inventory');

// ── Minimal WXR reading (the export is a flat, well-known RSS dialect) ──
const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s: string) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => (e[0] === '#' ? String.fromCodePoint(parseInt(e[1].toLowerCase() === 'x' ? e.slice(2) : e.slice(1), e[1].toLowerCase() === 'x' ? 16 : 10)) : entities[e] ?? m));
const cdata = (s: string) => s.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1').replace(/\]\]\]\]><!\[CDATA\[>/g, ']]>');
const tag = (xml: string, name: string) => { const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)); return m ? cdata(m[1].trim()) : ''; };
const text = (xml: string, name: string) => decode(tag(xml, name)).trim();
const metas = (xml: string) => {
  const out = new Map<string, string>();
  for (const m of xml.matchAll(/<wp:postmeta>\s*<wp:meta_key>([\s\S]*?)<\/wp:meta_key>\s*<wp:meta_value>([\s\S]*?)<\/wp:meta_value>\s*<\/wp:postmeta>/g)) {
    const key = cdata(m[1].trim());
    if (!out.has(key)) out.set(key, cdata(m[2].trim()));
  }
  return out;
};
const pathOf = (url: string) => { try { return new URL(url).pathname; } catch { return ''; } };

const xml = fs.readFileSync(wxrFile, 'utf8');
const channel = xml.slice(0, xml.indexOf('<item>'));
const terms = {
  category: [...channel.matchAll(/<wp:category>([\s\S]*?)<\/wp:category>/g)].map((m) => ({ id: tag(m[1], 'wp:term_id'), slug: tag(m[1], 'wp:category_nicename'), name: text(m[1], 'wp:cat_name') })),
  tag: [...channel.matchAll(/<wp:tag>([\s\S]*?)<\/wp:tag>/g)].map((m) => ({ id: tag(m[1], 'wp:term_id'), slug: tag(m[1], 'wp:tag_slug'), name: text(m[1], 'wp:tag_name') })),
};
// Public bylines only: login (URL slug) and display name. E-mail is never read.
const authors = [...channel.matchAll(/<wp:author>([\s\S]*?)<\/wp:author>/g)].map((m) => ({ login: tag(m[1], 'wp:author_login'), name: text(m[1], 'wp:author_display_name') }));

type Item = { id: string; type: string; status: string; title: string; link: string; slug: string; date: string; modified: string; parent: string; creator: string; categories: string[]; tags: string[]; meta: Map<string, string>; oldSlugs: string[]; body: string; excerpt: string; attachmentUrl: string };
const items: Item[] = xml.split('<item>').slice(1).map((raw) => {
  const x = raw.slice(0, raw.indexOf('</item>'));
  const domain = (d: string) => [...x.matchAll(new RegExp(`<category domain="${d}" nicename="([^"]+)">`, 'g'))].map((m) => decodeURIComponent(m[1]));
  return {
    id: tag(x, 'wp:post_id'), type: tag(x, 'wp:post_type'), status: tag(x, 'wp:status'), title: text(x, 'title'), link: text(x, 'link'), slug: tag(x, 'wp:post_name'),
    date: tag(x, 'wp:post_date'), modified: tag(x, 'wp:post_modified'), parent: tag(x, 'wp:post_parent'), creator: tag(x, 'dc:creator'),
    categories: domain('category'), tags: domain('post_tag'), meta: metas(x),
    oldSlugs: [...x.matchAll(/<wp:meta_key><!\[CDATA\[_wp_old_slug\]\]><\/wp:meta_key>\s*<wp:meta_value><!\[CDATA\[([^\]]*)\]\]>/g)].map((m) => m[1]), body: tag(x, 'content:encoded'), excerpt: tag(x, 'excerpt:encoded'), attachmentUrl: text(x, 'wp:attachment_url'),
  };
});
const byId = new Map(items.map((i) => [i.id, i]));
const posts = items.filter((i) => i.type === 'post');
const published = items.filter((i) => (i.type === 'post' || i.type === 'page') && i.status === 'publish');

// ── Optional sources ──
type RankMath = { source: string; comparison: string; target: string; code: string; hits: number; status: string; lastAccessed: string };
const rankMath: RankMath[] = [];
const sqlFile = args.get('rankmath-sql');
if (sqlFile) {
  const sql = fs.readFileSync(sqlFile, 'utf8');
  const block = sql.match(/INSERT INTO `\w*rank_math_redirections` \([^)]*\) VALUES\s*([\s\S]*?);\n/);
  for (const m of block ? block[1].matchAll(/\(\d+, '((?:[^'\\]|\\.)*)', '((?:[^'\\]|\\.)*)', (\d+), (\d+), '(\w+)', '[^']*', '[^']*', '([^']*)'\)/g) : []) {
    const serialized = m[1].replace(/\\"/g, '"');
    for (const p of serialized.matchAll(/s:7:"pattern";s:\d+:"([^"]*)";s:10:"comparison";s:\d+:"(\w+)"/g)) {
      rankMath.push({ source: p[1], comparison: p[2], target: m[2], code: m[3], hits: Number(m[4]), status: m[5], lastAccessed: m[6] });
    }
  }
}
const hits = new Map<string, number>();
const served = new Map<string, number>(); // HTTP 200 only: pages the old site really served
const logFile = args.get('access-log');
if (logFile) {
  const input = fs.createReadStream(logFile).pipe(logFile.endsWith('.gz') ? zlib.createGunzip() : new (await import('node:stream')).PassThrough());
  for await (const line of readline.createInterface({ input })) {
    const m = (line as string).match(/"(?:GET|HEAD) (\S+) HTTP\/[\d.]+" (200|301|304|206) /);
    if (!m) continue;
    const p = m[1].split(/[?#]/)[0];
    hits.set(p, (hits.get(p) ?? 0) + 1);
    if (m[2] === '200' && !m[1].includes('?')) served.set(p, (served.get(p) ?? 0) + 1);
  }
}
const hitCount = (p: string) => (hits.get(p) ?? 0) + (p.endsWith('/') ? hits.get(p.slice(0, -1)) ?? 0 : hits.get(`${p}/`) ?? 0);

// ── URL inventory (one row per old URL; Decision/New URL left empty) ──
type Row = { url: string; category: string; title: string; notes: string };
const rows = new Map<string, Row>();
const add = (url: string, category: string, title: string, notes: string) => {
  if (!url.startsWith('/') || url.length > 1000 || /[\s<>"]/.test(url)) return;
  const key = url.length > 1 ? url.replace(/\/+$/, '') : url;
  const h = hitCount(url);
  const existing = rows.get(key);
  if (existing) { existing.notes += `; ${notes}`; return; }
  rows.set(key, { url, category, title, notes: logFile ? `${notes}; log hits ${h}` : notes });
};
const catName = new Map(terms.category.map((c) => [c.slug, c.name]));
const catById = new Map(terms.category.map((c) => [c.id, c.name]));
const primaryCategory = (i: Item) => catById.get(i.meta.get('rank_math_primary_category') ?? '') ?? catName.get(i.categories[0]) ?? '';
for (const i of published) {
  const extra = i.type === 'post' ? `; categories ${i.categories.join('|') || '-'}; tags ${i.tags.length}; author ${authors.find((a) => a.login === i.creator)?.name ?? i.creator}` : '';
  add(pathOf(i.link), i.type === 'post' ? primaryCategory(i) : 'Page', i.title, `${i.type} #${i.id}; published ${i.date}; modified ${i.modified}${extra}`);
}
for (const p of posts.filter((i) => i.status === 'publish')) {
  for (const slug of p.oldSlugs) add(`/${slug}/`, primaryCategory(p), p.title, `old slug of post #${p.id}; WordPress redirected it to ${pathOf(p.link)}`);
}
for (const c of terms.category) add(`/category/${c.slug}/`, 'Category archive', c.name, `category; ${posts.filter((p) => p.status === 'publish' && p.categories.includes(c.slug)).length} published post(s)`);
for (const t of terms.tag) add(`/tag/${t.slug}/`, 'Tag archive', t.name, `tag; ${posts.filter((p) => p.status === 'publish' && p.tags.includes(t.slug)).length} published post(s)`);
for (const a of authors) add(`/author/${a.login.toLowerCase()}/`, 'Author archive', a.name, `author archive (URL slug assumed = login; check the live site); ${posts.filter((p) => p.status === 'publish' && p.creator === a.login).length} published post(s)`);
const attachments = items.filter((i) => i.type === 'attachment');
for (const a of attachments) add(pathOf(a.link), 'Attachment page', a.title, `attachment page #${a.id}${a.parent !== '0' ? `; parent #${a.parent}` : ''}`);
for (const r of rankMath) {
  if (r.comparison !== 'exact') { console.warn(`[inventory] Rank Math ${r.comparison} rule "${r.source}" needs manual review (not exact).`); continue; }
  add(`/${r.source.replace(/^\/+/, '')}`, 'Rank Math redirect', '', `Rank Math ${r.code} → ${pathOf(r.target) || r.target} (${r.status}; ${r.hits} hits; last ${r.lastAccessed})`);
}
if (logFile) {
  for (const [p] of [...served].sort((x, y) => y[1] - x[1])) {
    // Real page URLs only: no files, WordPress internals, front-controller paths, dot-segments or encoded junk.
    if (p === '/' || p.includes('//') || p.includes('%') || /\/\./.test(p) || /^\/(wp-|wp\/|xmlrpc|cgi-bin|index\.php)/.test(p) || p.slice(p.lastIndexOf('/') + 1).includes('.')) continue;
    const key = p.length > 1 ? p.replace(/\/+$/, '') : p;
    if (!rows.has(key)) add(p, '(access log only)', '', `served with HTTP 200 in the access log only (${served.get(p)} times)`);
  }
}

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const sheet = [['Old URL', 'Old Category', 'Old Title', 'Decision', 'New Category', 'New Title', 'New URL', 'Notes'].join(','), ...[...rows.values()].map((r) => [r.url, r.category, r.title, '', '', '', '', r.notes].map(csvCell).join(','))];

// ── Media inventory ──
const featuredBy = new Map<string, string[]>();
for (const p of posts) { const t = p.meta.get('_thumbnail_id'); if (t) featuredBy.set(t, [...(featuredBy.get(t) ?? []), p.id]); }
const bodies = published.map((p) => p.body).join('\n');
const media = [['Attachment ID', 'File URL', 'Title', 'Alt text', 'Caption', 'Type', 'Width', 'Height', 'Parent ID', 'Parent URL', 'Featured image of', 'Body references', 'Log hits (file)'].join(','), ...attachments.map((a) => {
  const meta = a.meta.get('_wp_attachment_metadata') ?? '';
  const size = meta.match(/s:5:"width";i:(\d+);s:6:"height";i:(\d+)/);
  const file = pathOf(a.attachmentUrl);
  const stem = file.replace(/\.[a-z0-9]+$/i, '');
  return [a.id, a.attachmentUrl, a.title, a.meta.get('_wp_attachment_image_alt') ?? '', decode(a.excerpt), file.split('.').pop() ?? '', size?.[1] ?? '', size?.[2] ?? '', a.parent === '0' ? '' : a.parent, a.parent !== '0' ? pathOf(byId.get(a.parent)?.link ?? '') : '', (featuredBy.get(a.id) ?? []).join('|'), String(stem ? bodies.split(stem).length - 1 : 0), logFile ? String(hitCount(file)) : ''].map(csvCell).join(',');
})];

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'url-inventory.csv'), sheet.join('\r\n'));
fs.writeFileSync(path.join(outDir, 'media-inventory.csv'), media.join('\r\n'));
const KINDS = ['Page', 'Category archive', 'Tag archive', 'Author archive', 'Attachment page', 'Rank Math redirect', '(access log only)'];
const byCategory: Record<string, number> = {};
for (const r of rows.values()) { const k = KINDS.includes(r.category) ? r.category : r.notes.startsWith('old slug') ? 'Old post slug' : 'Post'; byCategory[k] = (byCategory[k] ?? 0) + 1; }
const summary = { generatedAt: new Date().toISOString(), sources: { wxr: path.basename(wxrFile), rankMathSql: sqlFile ? path.basename(sqlFile) : null, accessLog: logFile ? path.basename(logFile) : null }, site: tag(channel, 'wp:base_site_url'), urlRows: rows.size, byType: byCategory, publishedPosts: posts.filter((p) => p.status === 'publish').length, publishedPages: published.length - posts.filter((p) => p.status === 'publish').length, attachments: attachments.length, rankMathRules: rankMath.length, decisions: 'all UNDECIDED (owner input)' };
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log(`[inventory] Wrote ${path.join(outDir, 'url-inventory.csv')} and media-inventory.csv. Nothing was written to the database.`);
