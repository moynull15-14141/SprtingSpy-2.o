/**
 * WordPress migration: mapping + conversion DRY RUN and pilot preparation.
 *
 * READ-ONLY by construction. This command has no database code path: it does
 * not load .env, does not import server/db (or anything that does) and makes
 * no network request. It never uploads media and creates no Article, Page,
 * FAQ, Author, Sport or redirect. There is no import mode; asking for one is
 * refused.
 *
 * Sources (opened read-only, never extracted or modified):
 *   --wxr <export.xml>          the WordPress export
 *   --uploads-zip <site.zip>    the site-files archive; ONLY entries under
 *                               public_html/wp-content/uploads/ are indexed
 *   --cms <snapshot.json>       the CMS sports/editions/types/authors to map against
 * Defaults: the export and the *public_html* archive in ../backup, and
 * migration-inventory/cms-snapshot.json. The owner's approved mapping
 * decisions are in server/wordpressImport/decisions.ts.
 *
 * Output (in --out, default migration-inventory/wordpress-dry-run, git-ignored;
 * rewritten on every run):
 *   manifest.json           every post: final mapping, planned draft, counts, what blocks it
 *   mapping.csv             the same as a review sheet
 *   conversion-report.md    totals, pending entities, event links, losses, media
 *   link-audit.csv          every link: preserved, rewritten, pending or unresolved
 *   redirect-proposals.csv  old address → new address per post, as a Site Migration sheet (a PROPOSAL; nothing is applied)
 *   media-report.csv        every referenced image: found, size, dimensions, hash, duplicates
 *   pilot-plan.md           the five pilot posts and the isolation requirements
 *   posts/<id>-<slug>.json  the converted document and its full conversion report
 *
 *   npm run migration:wordpress-dry-run [-- --wxr … --uploads-zip … --cms … --out …]
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { MAX_DIMENSION, MAX_UPLOAD_BYTES } from '../media/processing';
import type { RichNode } from '../../src/lib/richText';
import { APPROVED_SPORTS, AUTHOR_PROFILE_SLUGS, CATEGORY_ARCHIVE_SPORT, DECISIONS_APPROVED_ON, EVENT_LINK_CANDIDATES, KEEP_SEPARATE, PILOT_POSTS } from '../wordpressImport/decisions';
import { convertWordPressHtml, type ConversionResult } from '../wordpressImport/htmlToDoc';
import { PILOT_DATABASE_NAME } from '../wordpressImport/isolation';
import { possibleEvent, proposeArticleType, proposeAuthor, proposeKeywords, proposeSport, similarTitles, type CmsSnapshot } from '../wordpressImport/mapping';
import { decodeEntities, parseWxr, videoLinkOf, type WxrItem } from '../wordpressImport/wxr';
import { ZipReader } from '../wordpressImport/zipReader';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i].replace(/^--/, '');
  if (['apply', 'import', 'write', 'no-dry-run', 'execute'].includes(key)) {
    console.error(`[wordpress-dry-run] --${key} is refused: this command only performs a dry run. The import is a later phase and needs separate approval.`);
    process.exit(2);
  }
  args.set(key, process.argv[++i] ?? '');
}
const backupDir = path.resolve('..', 'backup');
const inBackup = (test: RegExp) => { try { const hit = fs.readdirSync(backupDir).find((f) => test.test(f)); return hit ? path.join(backupDir, hit) : ''; } catch { return ''; } };
const wxrFile = args.get('wxr') || inBackup(/\.WordPress\..*\.xml$/i);
const zipFile = args.get('uploads-zip') || inBackup(/public_html.*\.zip$/i);
const cmsFile = path.resolve(args.get('cms') || 'migration-inventory/cms-snapshot.json');
const outDir = path.resolve(args.get('out') || 'migration-inventory/wordpress-dry-run');
for (const [label, file] of [['--wxr', wxrFile], ['--uploads-zip', zipFile], ['--cms', cmsFile]] as const) {
  if (!file || !fs.existsSync(file)) { console.error(`[wordpress-dry-run] ${label} not found${file ? `: ${file}` : ''}. See the header of server/scripts/wordpress-dry-run.ts.`); process.exit(1); }
}

const UPLOADS = 'public_html/wp-content/uploads/';
const SITE_ROOT = 'public_html/';
const IMAGE_EXT = /\.(jpe?g|png|webp|avif)$/i;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const sha256 = (data: Buffer | string) => crypto.createHash('sha256').update(data).digest('hex');
const csvCell = (v: unknown) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const stat = (file: string) => { const s = fs.statSync(file); return { file: path.basename(file), bytes: s.size, modified: s.mtime.toISOString() }; };
const trimSlash = (p: string) => p.replace(/\/+$/, '');

const sourcesBefore = { wxr: stat(wxrFile), uploadsZip: stat(zipFile) };
const xml = fs.readFileSync(wxrFile, 'utf8');
const wxr = parseWxr(xml);
const cms = JSON.parse(fs.readFileSync(cmsFile, 'utf8')) as CmsSnapshot;
const zip = new ZipReader(zipFile, UPLOADS);
const siteHost = new URL(wxr.site || 'https://www.sportingspy.com').hostname.replace(/^www\./, '');

const posts = wxr.items.filter((i) => i.type === 'post');
const attachments = wxr.items.filter((i) => i.type === 'attachment');
const attachmentById = new Map(attachments.map((a) => [a.id, a]));
const attachmentByFile = new Map(attachments.map((a) => [a.filePath, a]));
const itemByPath = new Map(wxr.items.filter((i) => (i.type === 'post' || i.type === 'page') && i.status === 'publish').map((i) => [trimSlash(i.path), i]));

// ── Final mapping: owner decisions over the proposals ──
const sportExists = (slug: string | null) => !!slug && cms.sports.some((s) => s.slug === slug);
const authorExists = (slug: string | null) => !!slug && cms.authors.some((a) => a.slug === slug);

function resolveSport(post: WxrItem) {
  const proposal = proposeSport(post, cms);
  const approved = APPROVED_SPORTS[post.id];
  if (approved) {
    const exists = sportExists(approved);
    return { sportSlug: approved, exists, status: exists ? 'approved' as const : 'approved-pending-creation' as const, confidence: 'approved', rationale: `Approved by the site owner on ${DECISIONS_APPROVED_ON}. ${proposal.rationale}`, decisions: [] as string[] };
  }
  return { sportSlug: proposal.sportSlug, exists: !!proposal.sportSlug, status: proposal.sportSlug ? 'existing-sport' as const : 'unresolved' as const, confidence: proposal.confidence as string, rationale: proposal.rationale, decisions: proposal.decisions };
}

/** Attach to an event edition only when that exact edition is verified to exist; otherwise stay sport-level and say why. */
function resolveEvent(post: WxrItem, sportSlug: string | null) {
  if (!EVENT_LINK_CANDIDATES.includes(post.id)) return null;
  const hint = possibleEvent(post, cms);
  const year = Number(post.title.match(/\b(20\d{2})\b/)?.[1] ?? 0);
  if (!hint) return { decision: 'sport-level' as const, event: null, year: year || null, reason: 'No matching event exists in the CMS.' };
  const [eventSport, eventSlug] = hint.split('/');
  if (eventSport !== sportSlug) return { decision: 'sport-level' as const, event: hint, year: year || null, reason: `The event ${hint} belongs to another sport than the article (${sportSlug}).` };
  if (!year) return { decision: 'sport-level' as const, event: hint, year: null, reason: 'The title names no year, so no edition can be chosen.' };
  if (!(cms.editions ?? []).some((e) => e.sportSlug === eventSport && e.eventSlug === eventSlug && e.year === year)) {
    return { decision: 'sport-level' as const, event: hint, year, reason: `The event ${hint} exists, but no ${year} edition of it is live (checked ${cms.capturedAt}). An article can only be attached to an existing edition.` };
  }
  return { decision: 'link' as const, event: hint, year, eventSlug, reason: `/${eventSport}/${eventSlug}/${year}/ is live (checked ${cms.capturedAt}).` };
}

const plans = new Map(posts.map((post) => {
  const sport = resolveSport(post);
  const event = resolveEvent(post, sport.sportSlug);
  const linked = event?.decision === 'link';
  const newPath = sport.sportSlug ? (linked ? `/${sport.sportSlug}/${event.eventSlug}/${event.year}/${post.slug}/` : `/${sport.sportSlug}/${post.slug}/`) : null;
  return [post.id, { sport, event, newPath }];
}));

// ── Links: rewrite only to a verified destination ──
type LinkStatus = 'preserved' | 'rewritten' | 'pending' | 'unresolved';
const WORDPRESS_PAGE_TO_CMS: Record<string, string> = { '/privacy-policy': '/privacy-policy', '/terms-conditions': '/terms-and-conditions', '/about-us': '/about', '/contact-us': '/contact' };
function classifyLink(href: string): { kind: string; status: LinkStatus; finalHref: string; note: string; targetPostId: string | null } {
  const keep = (kind: string, status: LinkStatus, note: string, targetPostId: string | null = null) => ({ kind, status, finalHref: href, note, targetPostId });
  let url: URL;
  try { url = new URL(href, `https://${siteHost}/`); } catch { return keep('invalid', 'unresolved', 'Not a valid URL.'); }
  if (url.protocol === 'mailto:' || url.hostname.replace(/^www\./, '') !== siteHost) return keep('external', 'preserved', 'External link, kept as it is.');
  const pathname = trimSlash(decodeURIComponent(url.pathname));
  if (pathname === '') return { kind: 'homepage', status: 'rewritten', finalHref: '/', note: 'Homepage.', targetPostId: null };
  const target = itemByPath.get(pathname);
  if (target?.type === 'post') {
    const plan = plans.get(target.id)!;
    if (plan.sport.exists && plan.newPath) return { kind: 'post', status: 'rewritten', finalHref: plan.newPath, note: `Migrated post #${target.id}. The destination is a draft until that article is published; no redirect is created before then.`, targetPostId: target.id };
    return keep('post', 'pending', plan.sport.sportSlug ? `Post #${target.id} needs the "${plan.sport.sportSlug}" sport, which is not created yet.` : `Post #${target.id} has no approved sport.`, target.id);
  }
  if (target?.type === 'page') {
    const page = WORDPRESS_PAGE_TO_CMS[pathname];
    if (page && (cms.pages ?? []).includes(page)) return { kind: 'page', status: 'rewritten', finalHref: `${page}/`, note: 'Matching CMS page (verified live).', targetPostId: null };
    return keep('page', 'unresolved', 'No verified CMS page replaces this WordPress page.');
  }
  const category = pathname.match(/^\/category\/([^/]+)$/)?.[1];
  if (category) {
    const sport = CATEGORY_ARCHIVE_SPORT[category];
    if (sport && (cms.sportPages ?? []).includes(sport)) return { kind: 'category archive', status: 'rewritten', finalHref: `/${sport}/`, note: `Category archive "${category}" → the ${sport} hub page (verified live).`, targetPostId: null };
    if (sport) return keep('category archive', 'pending', `Category archive "${category}" → /${sport}/ once the "${sport}" sport is created.`);
    return keep('category archive', 'unresolved', `Category archive "${category}" has no single equivalent page on SportingSpy. An editor removes the link or chooses a target.`);
  }
  if (/^\/tag\//.test(pathname)) return keep('tag archive', 'unresolved', 'Tag archives do not exist on SportingSpy.');
  return keep('unknown', 'unresolved', 'This address is not in the WordPress export and no destination is verified.');
}

// ── Media: locate each referenced file in the archive and inspect it in memory ──
interface MediaInfo { file: string; attachmentId: string; bytes: number; sha256: string; width: number; height: number; format: string; problem: string; resizedFrom: Set<string>; usedBy: Set<string> }
const media = new Map<string, MediaInfo>();

/** The archive file behind an image URL of the old site: the exact file, or the original of a resized copy. */
function locate(src: string): { file: string; resized: boolean } | { missing: string } {
  let url: URL;
  try { url = new URL(decodeEntities(src), `https://${siteHost}/`); } catch { return { missing: 'not a valid URL' }; }
  if (url.hostname.replace(/^www\./, '') !== siteHost) return { missing: `external image on ${url.hostname}: not imported` };
  let file: string;
  try { file = decodeURIComponent(url.pathname).replace(/^\/+/, ''); } catch { return { missing: 'not a valid URL' }; }
  const original = file.replace(/-\d+x\d+(\.[a-z0-9]+)$/i, '$1');
  for (const candidate of [...new Set([original, original.replace(/-scaled(\.[a-z0-9]+)$/i, '$1'), file])]) {
    if (zip.has(SITE_ROOT + candidate)) return { file: candidate, resized: candidate !== file };
  }
  return { missing: 'file is not in the uploads archive' };
}

async function inspect(file: string): Promise<MediaInfo> {
  const known = media.get(file);
  if (known) return known;
  const info: MediaInfo = { file, attachmentId: attachmentByFile.get(file)?.id ?? '', bytes: zip.sizeOf(SITE_ROOT + file), sha256: '', width: 0, height: 0, format: '', problem: '', resizedFrom: new Set(), usedBy: new Set() };
  media.set(file, info);
  if (!IMAGE_EXT.test(file)) { info.problem = `unsupported format (.${file.split('.').pop()}); the Media Library accepts JPEG, PNG, WebP and AVIF`; return info; }
  if (info.bytes > MAX_UPLOAD_BYTES) { info.problem = `larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`; return info; }
  try {
    const data = zip.read(SITE_ROOT + file);
    info.sha256 = sha256(data);
    const meta = await sharp(data, { failOn: 'error' }).metadata();
    info.width = meta.width ?? 0; info.height = meta.height ?? 0; info.format = meta.format ?? '';
    if (!info.width || !info.height) info.problem = 'unreadable image';
    else if (info.width > MAX_DIMENSION || info.height > MAX_DIMENSION) info.problem = `larger than ${MAX_DIMENSION}×${MAX_DIMENSION} pixels`;
  } catch (err) { info.problem = `unreadable image (${err instanceof Error ? err.message.slice(0, 80) : 'error'})`; }
  return info;
}

const featuredOf = (post: WxrItem) => attachmentById.get(post.meta.get('_thumbnail_id') ?? '');
for (const post of posts) {
  const sources = [...post.body.matchAll(/<img\b[^>]*\ssrc=["']([^"']+)["']/gi)].map((m) => m[1]);
  const featured = featuredOf(post);
  for (const located of [...sources.map(locate), ...(featured && zip.has(SITE_ROOT + featured.filePath) ? [{ file: featured.filePath, resized: false }] : [])]) {
    if ('file' in located) await inspect(located.file);
  }
}

const placeholderId = (file: string) => { const a = attachmentByFile.get(file); return a ? `wp-att-${a.id}` : `wp-file-${sha256(file).slice(0, 16)}`; };
function resolveImageFor(post: WxrItem, role: 'inline' | 'featured') {
  return (src: string) => {
    const located = locate(src);
    if ('missing' in located) return located;
    const info = media.get(located.file)!;
    if (info.problem) return { missing: info.problem };
    info.usedBy.add(`${post.id}:${role}`);
    if (located.resized) info.resizedFrom.add(src.split('/').pop() ?? src);
    return { mediaId: placeholderId(located.file), alt: (attachmentByFile.get(located.file)?.meta.get('_wp_attachment_image_alt') ?? '').trim() };
  };
}

// ── Posts ──
const cmsPaths = new Set((cms.articlePaths ?? []).map(trimSlash));
const slugCounts = new Map<string, number>();
for (const p of posts) slugCounts.set(p.slug, (slugCounts.get(p.slug) ?? 0) + 1);
const pathCounts = new Map<string, number>();
for (const plan of plans.values()) if (plan.newPath) pathCounts.set(plan.newPath, (pathCounts.get(plan.newPath) ?? 0) + 1);
const similar = similarTitles(posts);
const keptSeparate = (a: string, b: string) => KEEP_SEPARATE.some((group) => group.includes(a) && group.includes(b));

function shape(doc: ConversionResult['doc']) {
  let largestTableRows = 0, mergedCells = 0, imageCaptions = 0;
  const walk = (n: RichNode) => {
    if (n.type === 'table') largestTableRows = Math.max(largestTableRows, n.content?.length ?? 0);
    if ((n.type === 'tableCell' || n.type === 'tableHeader') && (Number(n.attrs?.colspan) > 1 || Number(n.attrs?.rowspan) > 1)) mergedCells++;
    if (n.type === 'image' && n.attrs?.caption) imageCaptions++;
    (n.content ?? []).forEach(walk);
  };
  (doc?.content ?? []).forEach(walk);
  return { largestTableRows, mergedCells, imageCaptions };
}

type Entry = ReturnType<typeof buildEntry>;
function buildEntry(post: WxrItem, conversion: ConversionResult) {
  const { sport, event, newPath } = plans.get(post.id)!;
  const type = proposeArticleType(post, cms);
  const authorProposal = proposeAuthor(post.creator, wxr.authors, cms);
  const profileSlug = AUTHOR_PROFILE_SLUGS[authorProposal.sourceName] ?? authorProposal.authorSlug;
  const author = { wordpressLogin: post.creator, sourceName: authorProposal.sourceName, profileSlug: profileSlug ?? null, exists: authorExists(profileSlug ?? null), status: !profileSlug ? 'unresolved' : authorExists(profileSlug) ? 'existing-profile' : 'approved-pending-creation', linkedLogin: false, email: null };
  const { keywords, dropped } = proposeKeywords(post);
  const metaDescription = decodeEntities(post.meta.get('rank_math_description') || post.meta.get('_aioseo_description') || '').trim();
  const excerpt = decodeEntities(post.excerpt).replace(/<[^>]+>/g, '').trim();
  const featuredAttachment = featuredOf(post);
  const featured = featuredAttachment ? resolveImageFor(post, 'featured')(`https://${siteHost}/${featuredAttachment.filePath}`) : { missing: 'no featured image set' };
  const links = conversion.links.map((l) => { const c = classifyLink(l.originalHref); return { text: l.text, originalHref: l.originalHref, kind: c.kind, status: c.status, finalHref: l.href, note: c.note, targetPostId: c.targetPostId }; });

  const duplicates: { note: string; decision: string | null }[] = [];
  if ((slugCounts.get(post.slug) ?? 0) > 1) duplicates.push({ note: 'Another WordPress post has the same slug.', decision: null });
  if (newPath && cmsPaths.has(trimSlash(newPath))) duplicates.push({ note: `A published CMS article already lives at ${newPath}`, decision: null });
  if (newPath && (pathCounts.get(newPath) ?? 0) > 1) duplicates.push({ note: `Another migrated post gets the same address ${newPath}`, decision: null });
  for (const pair of similar) if (pair.a === post.id || pair.b === post.id) {
    const other = pair.a === post.id ? pair.b : pair.a;
    duplicates.push({ note: `Similar subject to WordPress post #${other} (title overlap ${pair.score}).`, decision: keptSeparate(post.id, other) ? `Keep both as separate articles (owner decision, ${DECISIONS_APPROVED_ON}).` : null });
  }

  // Needs the owner: nothing below is decided by the tool.
  const unresolved: string[] = [...sport.decisions];
  if (author.status === 'unresolved') unresolved.push(`No Author profile is decided for "${author.sourceName}".`);
  if (!SLUG_PATTERN.test(post.slug) || post.slug.length > 120) unresolved.push('The slug is not valid in the CMS; choose a new one.');
  if (post.title.length > 300) unresolved.push('The title is longer than 300 characters.');
  if (metaDescription.length > 500) unresolved.push('The meta description is longer than 500 characters.');
  if (excerpt.length > 1000) unresolved.push('The excerpt is longer than 1000 characters.');
  if (conversion.faqs.some((q) => q.problems.length)) unresolved.push('One or more FAQ entries do not fit the FAQ limits; see the post report.');
  for (const l of links.filter((x) => x.status === 'unresolved')) unresolved.push(`Link "${l.text}" → ${l.originalHref}: ${l.note}`);
  for (const d of duplicates.filter((x) => !x.decision)) unresolved.push(`Possible duplicate: ${d.note}`);

  // For the editor reviewing the draft; does not block the import.
  const editorialTodo: string[] = [`Confirm the article type (provisional: ${type.articleType ?? 'none'}).`];
  if (!metaDescription) editorialTodo.push('Write a meta description (the old site had none; none is invented).');
  if (!excerpt) editorialTodo.push('Write an excerpt (the old site had none; none is invented).');
  if ('missing' in featured) editorialTodo.push(`Choose a featured image (${featured.missing}).`);
  if (dropped) editorialTodo.push(`${dropped} keyword(s) over the limit of 30 were not carried over.`);
  if (conversion.issues.some((i) => i.severity === 'loss')) editorialTodo.push('Check the formatting that could not be kept (see the post report).');
  if (links.some((l) => l.status === 'pending')) editorialTodo.push('Some internal links wait for a sport or article that does not exist yet; they keep their old address until then.');

  const blockedBy: string[] = [];
  if (!conversion.ok) blockedBy.push(`Conversion failed: ${conversion.error}`);
  if (!sport.sportSlug) blockedBy.push('No sport is decided.');
  else if (!sport.exists) blockedBy.push(`The "${sport.sportSlug}" sport must be created by an Admin first.`);
  if (!type.articleType) blockedBy.push('No article type.');
  if (!author.profileSlug) blockedBy.push('No Author profile is decided.');
  else if (!author.exists) blockedBy.push(`The Author profile "${author.profileSlug}" must be created by an Admin first.`);
  if (unresolved.some((u) => /slug is not valid|longer than|same slug|already lives|same address/.test(u))) blockedBy.push('A field does not fit the CMS limits or collides; see unresolvedDecisions.');

  return {
    wordpressId: post.id, title: post.title, slug: post.slug, oldPath: post.path, publishedAtGmt: post.dateGmt, modifiedAtGmt: post.modifiedGmt,
    wordpressCategories: post.categories.map((c) => c.slug), oldSlugs: post.oldSlugs,
    sport, articleType: { ...type, provisional: true }, author, eventLink: event,
    proposedPath: newPath,
    seo: { keywords, keywordsDropped: dropped, metaDescription: metaDescription || null, metaDescriptionSource: post.meta.get('rank_math_description') ? 'Rank Math' : post.meta.get('_aioseo_description') ? 'All in One SEO' : null },
    excerpt: excerpt || null,
    featuredImage: 'missing' in featured ? { available: false, reason: featured.missing } : { available: true, file: featuredAttachment!.filePath, placeholderMediaId: featured.mediaId, alt: featured.alt || null, caption: decodeEntities(featuredAttachment!.excerpt).trim() || null },
    videoLink: videoLinkOf(post) || null,
    counts: {
      inlineImages: conversion.images.length, inlineImagesPlaced: conversion.images.filter((i) => i.placed).length, inlineImagesMissing: conversion.images.filter((i) => !i.mediaId).length,
      tables: conversion.stats.table ?? 0, tableRows: conversion.stats.tableRow ?? 0, ...shape(conversion.doc), links: links.length, internalLinks: links.filter((l) => l.kind !== 'external').length, faq: conversion.faqs.length,
      headings: conversion.stats.heading ?? 0, paragraphs: conversion.stats.paragraph ?? 0, embeds: conversion.stats.embed ?? 0,
    },
    links: { preserved: links.filter((l) => l.status === 'preserved').length, rewritten: links.filter((l) => l.status === 'rewritten').length, pending: links.filter((l) => l.status === 'pending').length, unresolved: links.filter((l) => l.status === 'unresolved').length },
    conversion: { ok: conversion.ok, error: conversion.error ?? null, losses: conversion.issues.filter((i) => i.severity === 'loss').reduce((n, i) => n + i.count, 0), notices: conversion.issues.filter((i) => i.severity === 'notice').reduce((n, i) => n + i.count, 0), lossCodes: conversion.issues.filter((i) => i.severity === 'loss').map((i) => `${i.code}×${i.count}`), coverage: conversion.coverage, textCarriedOver: conversion.coverage.missingWords === 0 },
    duplicateCandidates: duplicates,
    unresolvedDecisions: unresolved,
    editorialTodo,
    readyForImport: blockedBy.length === 0,
    blockedBy,
    // What the later importer would create. Never published, never scheduled, always reviewed.
    plannedDraft: { status: 'draft', requireReview: true, reviewStatus: 'draft', scheduledFor: null, sportSlug: sport.sportSlug, eventSlug: event?.decision === 'link' ? event.eventSlug : null, editionYear: event?.decision === 'link' ? event.year : null, articleType: type.articleType, authorSlug: author.profileSlug, sourceAttribution: author.sourceName, publishedAt: post.dateGmt ? `${post.dateGmt.replace(' ', 'T')}Z` : null },
    linkAudit: links,
  };
}

fs.mkdirSync(path.join(outDir, 'posts'), { recursive: true });
for (const old of fs.readdirSync(path.join(outDir, 'posts'))) if (/^\d+-[a-z0-9-]*\.json$/.test(old)) fs.rmSync(path.join(outDir, 'posts', old));

const entries: Entry[] = [];
const conversions: ConversionResult[] = [];
const issueTotals = new Map<string, { severity: string; count: number; posts: number }>();
for (const post of posts) {
  const conversion = convertWordPressHtml(post.body, {
    resolveImage: resolveImageFor(post, 'inline'),
    rewriteLink: (href) => { const c = classifyLink(href); return c.status === 'rewritten' ? c.finalHref : undefined; },
    videoUrl: videoLinkOf(post) || undefined,
  });
  const entry = buildEntry(post, conversion);
  entries.push(entry);
  conversions.push(conversion);
  for (const i of conversion.issues) { const t = issueTotals.get(i.code) ?? { severity: i.severity, count: 0, posts: 0 }; t.count += i.count; t.posts++; issueTotals.set(i.code, t); }
  fs.writeFileSync(path.join(outDir, 'posts', `${post.id}-${post.slug.slice(0, 80)}.json`), JSON.stringify({ mapping: entry, issues: conversion.issues, images: conversion.images, faqs: conversion.faqs, document: conversion.doc }, null, 2));
}
const entryById = new Map(entries.map((e) => [e.wordpressId, e]));

// ── Pending entities (never created by this tool) ──
const pendingSports = [...new Set(entries.filter((e) => e.sport.status === 'approved-pending-creation').map((e) => e.sport.sportSlug!))].sort().map((slug) => ({ slug, status: 'pending creation by an Admin', posts: entries.filter((e) => e.sport.sportSlug === slug).map((e) => e.wordpressId) }));
const authorsUsed = [...new Set(entries.map((e) => e.author.sourceName))].map((name) => { const e = entries.find((x) => x.author.sourceName === name)!; return { sourceName: name, profileSlug: e.author.profileSlug, status: e.author.status, linkedLogin: false, email: null, posts: entries.filter((x) => x.author.sourceName === name).length }; });
const pendingAuthors = authorsUsed.filter((a) => a.status === 'approved-pending-creation').map((a) => ({ ...a, status: 'pending creation by an Admin (unlinked profile: no login, no e-mail)' }));
const eventLinks = entries.filter((e) => e.eventLink).map((e) => ({ wordpressId: e.wordpressId, slug: e.slug, ...e.eventLink!, proposedPath: e.proposedPath }));

// ── Pilot: five posts, each verified to contain the feature it stands for ──
const FEATURE: Record<(typeof PILOT_POSTS)[number]['covers'], (e: Entry) => { ok: boolean; evidence: string }> = {
  'large-table': (e) => ({ ok: e.counts.largestTableRows >= 30, evidence: `largest table ${e.counts.largestTableRows} rows (${e.counts.tables} tables)` }),
  faq: (e) => ({ ok: e.counts.faq >= 5, evidence: `${e.counts.faq} FAQ entries` }),
  caption: (e) => ({ ok: e.counts.imageCaptions >= 1, evidence: `${e.counts.imageCaptions} image caption(s)` }),
  video: (e) => ({ ok: e.counts.embeds >= 1 && !!e.videoLink, evidence: `${e.counts.embeds} video embed(s)` }),
  'merged-cells': (e) => ({ ok: e.counts.mergedCells >= 1, evidence: `${e.counts.mergedCells} merged table cells` }),
};
const pilotPosts = PILOT_POSTS.map((p) => {
  const e = entryById.get(p.id);
  if (!e) return { wordpressId: p.id, covers: p.covers, why: p.why, found: false as const };
  const check = FEATURE[p.covers](e);
  return { wordpressId: p.id, covers: p.covers, why: p.why, found: true as const, featureVerified: check.ok, evidence: check.evidence, title: e.title, slug: e.slug, sportSlug: e.sport.sportSlug, sportExists: e.sport.exists, authorProfile: e.author.profileSlug, proposedPath: e.proposedPath, eventLink: e.eventLink?.decision ?? null, converted: e.conversion.ok, faq: e.counts.faq, inlineImages: e.counts.inlineImages, featuredImage: e.featuredImage.available, losses: e.conversion.losses, blockedBy: e.blockedBy };
});
const pilot = {
  status: 'prepared, not run',
  posts: pilotPosts,
  allFeaturesVerified: pilotPosts.every((p) => p.found && p.featureVerified && p.converted),
  prerequisitesInThePilotDatabaseOnly: [...new Set(pilotPosts.flatMap((p) => (p.found ? [`Author profile "${p.authorProfile}" (unlinked)`, ...(p.sportExists ? [] : [`Sport "${p.sportSlug}"`])] : [])))],
  isolation: {
    database: `A new local PostgreSQL database whose name matches ${PILOT_DATABASE_NAME.source} on localhost; never the database in .env.`,
    environment: 'Started with DOTENV_CONFIG_PATH pointing at a pilot-only env file, so the project .env is not loaded at all.',
    media: 'MEDIA_STORAGE_PROVIDER=local with its own MEDIA_LOCAL_DIR; every MEDIA_S3_* value empty.',
    guard: 'server/wordpressImport/isolation.ts checkPilotIsolation() must report no problems before any write.',
  },
};

// ── Media report ──
const byHash = new Map<string, string[]>();
for (const m of media.values()) if (m.sha256) byHash.set(m.sha256, [...(byHash.get(m.sha256) ?? []), m.file]);
const usedMedia = [...media.values()].filter((m) => m.usedBy.size || m.problem);
const missingImages = entries.flatMap((e, i) => [
  ...conversions[i].images.filter((img) => !img.mediaId).map((img) => ({ post: e.wordpressId, role: 'inline', src: img.src, reason: img.reason ?? '' })),
  ...(e.featuredImage.available ? [] : [{ post: e.wordpressId, role: 'featured', src: '', reason: (e.featuredImage as { reason: string }).reason }]),
]);
const mediaRows = [['File', 'WordPress attachment ID', 'Placeholder media ID', 'Usable', 'Problem', 'Bytes', 'Width', 'Height', 'Format', 'SHA-256', 'Same file as', 'Alt text on attachment', 'Used by (post:role)', 'Referenced as resized copy'].join(','),
  ...usedMedia.sort((a, b) => a.file.localeCompare(b.file)).map((m) => [m.file, m.attachmentId, placeholderId(m.file), m.problem ? 'no' : 'yes', m.problem, m.bytes, m.width || '', m.height || '', m.format, m.sha256, (byHash.get(m.sha256) ?? []).filter((f) => f !== m.file).join(' | '), (attachmentByFile.get(m.file)?.meta.get('_wp_attachment_image_alt') ?? '').trim(), [...m.usedBy].join(' | '), [...m.resizedFrom].join(' | ')].map(csvCell).join(',')),
  ...missingImages.map((m) => [m.src || '(featured image)', '', '', 'no', m.reason, '', '', '', '', '', '', '', `${m.post}:${m.role}`, ''].map(csvCell).join(','))];

// ── Redirect proposals: a sheet for CMS → Site Migration, to be imported by an Admin AFTER the articles are published ──
// A post keeps its content and gets a new address, so its old address (and its older slugs) can only point at that article.
// Everything else (category and tag archives, unknown addresses) is listed without a decision: the owner decides.
const redirectRows: { oldUrl: string; category: string; title: string; decision: string; newUrl: string; notes: string }[] = [];
const claimed = new Map<string, number>();
for (const e of entries) for (const p of [e.oldPath, ...e.oldSlugs.map((s) => `/${s}/`)]) claimed.set(trimSlash(p), (claimed.get(trimSlash(p)) ?? 0) + 1);
for (const e of entries) {
  const ready = !!e.proposedPath && e.sport.exists;
  const note = ready ? 'Apply only after this article is published (the Site Migration check requires a live page).' : `No decision yet: ${e.proposedPath ? `the "${e.sport.sportSlug}" sport does not exist in the CMS` : 'no sport is decided'}.`;
  redirectRows.push({ oldUrl: e.oldPath, category: e.wordpressCategories.join(' | '), title: e.title, decision: ready ? 'KEEP' : '', newUrl: ready ? e.proposedPath! : '', notes: `WordPress post #${e.wordpressId}. ${note}` });
  for (const slug of e.oldSlugs) {
    const old = `/${slug}/`;
    if (trimSlash(old) === trimSlash(e.oldPath)) continue;
    const unique = claimed.get(trimSlash(old)) === 1;
    redirectRows.push({ oldUrl: old, category: e.wordpressCategories.join(' | '), title: e.title, decision: ready && unique ? 'KEEP' : '', newUrl: ready && unique ? e.proposedPath! : '', notes: `Older slug of WordPress post #${e.wordpressId}. ${unique ? note : 'More than one post used this address; the owner decides.'}` });
  }
}
for (const c of wxr.categories) {
  const sport = CATEGORY_ARCHIVE_SPORT[c.slug];
  redirectRows.push({ oldUrl: `/category/${c.slug}/`, category: 'Category archive', title: c.name, decision: '', newUrl: '', notes: sport ? `No decision. Links to this archive inside articles point at /${sport}/; whether the archive address itself redirects there is the owner's call.` : 'No decision and no equivalent page.' });
}
for (const l of entries.flatMap((e) => e.linkAudit.filter((x) => x.status === 'unresolved' && x.kind !== 'category archive').map((x) => ({ ...x, post: e.wordpressId })))) {
  let old = ''; try { old = new URL(l.originalHref, `https://${siteHost}/`).pathname; } catch { continue; }
  if (!redirectRows.some((r) => trimSlash(r.oldUrl) === trimSlash(old))) redirectRows.push({ oldUrl: old, category: 'Unresolved link', title: '', decision: '', newUrl: '', notes: `Linked from WordPress post #${l.post}. No destination is verified; no redirect.` });
}
const redirects = { rows: redirectRows.length, proposedForPosts: redirectRows.filter((r) => r.decision && /^WordPress post/.test(r.notes)).length, proposedForOlderSlugs: redirectRows.filter((r) => r.decision && /^Older slug/.test(r.notes)).length, withoutDecision: redirectRows.filter((r) => !r.decision).length, applied: 0 };

// ── Outputs ──
const sum = (f: (e: Entry) => number) => entries.reduce((n, e) => n + f(e), 0);
const tally = (f: (e: Entry) => string) => Object.fromEntries([...entries.reduce((m, e) => m.set(f(e), (m.get(f(e)) ?? 0) + 1), new Map<string, number>())].sort((a, b) => a[0].localeCompare(b[0])));
const allLinks = entries.flatMap((e) => e.linkAudit.map((l) => ({ post: e.wordpressId, ...l })));
const linkTotals = { total: allLinks.length, preserved: sum((e) => e.links.preserved), rewritten: sum((e) => e.links.rewritten), pending: sum((e) => e.links.pending), unresolved: sum((e) => e.links.unresolved) };
const summary = {
  posts: entries.length, converted: entries.filter((e) => e.conversion.ok).length, failed: entries.filter((e) => !e.conversion.ok).length,
  readyForImport: entries.filter((e) => e.readyForImport).length,
  blockedOnlyByPendingEntities: entries.filter((e) => !e.readyForImport && e.blockedBy.every((b) => /must be created by an Admin/.test(b))).length,
  withUnresolvedDecisions: entries.filter((e) => e.unresolvedDecisions.length).length,
  sports: tally((e) => `${e.sport.sportSlug ?? '(none)'} [${e.sport.status}]`),
  articleTypesProvisional: tally((e) => e.articleType.articleType ?? '(none)'),
  authors: authorsUsed,
  pendingEntities: { sports: pendingSports.length, authorProfiles: pendingAuthors.length },
  eventLinks: { linked: eventLinks.filter((e) => e.decision === 'link').length, keptSportLevel: eventLinks.filter((e) => e.decision !== 'link').length },
  links: linkTotals,
  redirects,
  totals: { inlineImages: sum((e) => e.counts.inlineImages), inlineImagesMissing: sum((e) => e.counts.inlineImagesMissing), featuredImagesAvailable: entries.filter((e) => e.featuredImage.available).length, tables: sum((e) => e.counts.tables), faqEntries: sum((e) => e.counts.faq), embeds: sum((e) => e.counts.embeds), losses: sum((e) => e.conversion.losses), notices: sum((e) => e.conversion.notices), postsWithAllTextCarriedOver: entries.filter((e) => e.conversion.textCarriedOver).length, postsWithoutMetaDescription: entries.filter((e) => !e.seo.metaDescription).length, postsWithoutExcerpt: entries.filter((e) => !e.excerpt).length },
  media: { filesReferenced: usedMedia.length, usable: usedMedia.filter((m) => !m.problem).length, unusable: usedMedia.filter((m) => m.problem).length, missingReferences: missingImages.length, duplicateFileGroups: [...byHash.values()].filter((f) => f.length > 1).length },
  issues: Object.fromEntries([...issueTotals].sort((a, b) => (a[1].severity === b[1].severity ? b[1].count - a[1].count || a[0].localeCompare(b[0]) : a[1].severity === 'loss' ? -1 : 1))),
  pilot: { posts: pilotPosts.map((p) => p.wordpressId), allFeaturesVerified: pilot.allFeaturesVerified },
};
const sourcesAfter = { wxr: stat(wxrFile), uploadsZip: stat(zipFile) };
const sourcesUnchanged = JSON.stringify(sourcesBefore) === JSON.stringify(sourcesAfter) && sha256(fs.readFileSync(wxrFile)) === sha256(Buffer.from(xml, 'utf8'));

const manifest = {
  generatedAt: new Date().toISOString(),
  mode: 'dry-run',
  wrote: { database: false, mediaStorage: false, cmsRecords: false, redirects: false, sourceFiles: false, outputDirectory: path.relative(process.cwd(), outDir).replace(/\\/g, '/') },
  sources: { ...sourcesBefore, wxrSha256: sha256(xml), uploadsPrefixRead: UPLOADS, unchangedAfterRun: sourcesUnchanged },
  cmsSnapshot: { file: path.relative(process.cwd(), cmsFile).replace(/\\/g, '/'), capturedAt: cms.capturedAt, source: cms.source, existingArticlesChecked: cms.articlePaths ? cms.articlePaths.length : 'not captured' },
  decisions: {
    approvedOn: DECISIONS_APPROVED_ON,
    resolved: [
      `Sport approved for ${Object.keys(APPROVED_SPORTS).length} posts (new: rodeo, horse-racing, curling, australian-football, triathlon; confirmed: boxing, hockey).`,
      'Triathlon / IRONMAN posts are not classified as athletics.',
      '"Latest News" is never a sport.',
      'Author attribution "Jamie" → profile slug "jamie"; "Sergio J. Bynum" → "sergio-j-bynum". Unlinked profiles, no e-mail.',
      `Similar posts stay separate articles: ${KEEP_SEPARATE.map((g) => g.join(' + ')).join('; ')}.`,
      'Article types stay provisional until an editor confirms them.',
      'Missing meta descriptions and excerpts stay empty.',
      'No redirect is created before its destination article is published.',
    ],
  },
  pendingEntities: { note: 'Approved as proposals only. Nothing is created by this tool; an Admin creates each one in the CMS before its posts can be imported.', sports: pendingSports, authorProfiles: pendingAuthors },
  eventLinks,
  importPolicy: {
    status: 'draft',
    requireReview: true,
    reviewStatus: 'draft',
    rules: [
      'Every migrated article is created through POST /api/articles with status "draft" and requireReview: true, which stores reviewStatus "draft"; "not_required" is never assigned.',
      'requireReview is accepted on creation only, only as true, and is refused together with any status other than "draft" or with a scheduledFor value; an update cannot send it, so review cannot be switched off again.',
      'Publishing stays with the existing workflow: submit for review, then approval by a different Admin/Editor (server/editorialWorkflow.ts blocks publishing or scheduling while reviewStatus is neither "not_required" nor "approved").',
      'FAQ entries are created as article-scoped drafts through the existing FAQ import; media enters the Media Library with copyright review "pending".',
      'Sports and Author profiles are created by an Admin beforehand; the importer creates neither and skips any post whose sport or author profile does not exist.',
      'Redirects from old addresses are added only after the destination article is published.',
    ],
  },
  pilot,
  mediaFiles: usedMedia.filter((m) => !m.problem).sort((a, b) => a.file.localeCompare(b.file)).map((m) => { const a = attachmentByFile.get(m.file); return { file: m.file, placeholderMediaId: placeholderId(m.file), wordpressAttachmentId: m.attachmentId || null, title: a?.title || m.file.split('/').pop()!, alt: (a?.meta.get('_wp_attachment_image_alt') ?? '').trim(), caption: a ? decodeEntities(a.excerpt).trim() : '', sha256: m.sha256, bytes: m.bytes, usedBy: [...m.usedBy].sort() }; }),
  summary,
  posts: entries,
};
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

const pilotIds = new Set(PILOT_POSTS.map((p) => p.id));
const sheet = [['WordPress ID', 'Title', 'Slug', 'Published (GMT)', 'WordPress categories', 'Sport', 'Sport status', 'Article type (provisional)', 'Source author', 'Author profile', 'Author profile status', 'Event link', 'Proposed URL', 'Keywords', 'Meta description', 'Excerpt', 'Featured image', 'Inline images', 'Tables', 'FAQ', 'Links preserved', 'Links rewritten', 'Links pending', 'Links unresolved', 'Converted', 'Losses', 'Pilot', 'Ready', 'Blocked by', 'Unresolved decisions', 'Sport rationale'].join(','),
  ...entries.map((e) => [e.wordpressId, e.title, e.slug, e.publishedAtGmt, e.wordpressCategories.join(' | '), e.sport.sportSlug ?? '', e.sport.status, e.articleType.articleType ?? '', e.author.sourceName, e.author.profileSlug ?? '', e.author.status, e.eventLink ? (e.eventLink.decision === 'link' ? `linked: ${e.eventLink.event}/${e.eventLink.year}` : `sport-level: ${e.eventLink.reason}`) : '', e.proposedPath ?? '', e.seo.keywords.length, e.seo.metaDescription ? 'yes' : 'no', e.excerpt ? 'yes' : 'no', e.featuredImage.available ? 'yes' : 'no', e.counts.inlineImages, e.counts.tables, e.counts.faq, e.links.preserved, e.links.rewritten, e.links.pending, e.links.unresolved, e.conversion.ok ? 'yes' : `FAILED: ${e.conversion.error}`, e.conversion.lossCodes.join(' | '), pilotIds.has(e.wordpressId) ? 'yes' : '', e.readyForImport ? 'yes' : 'no', e.blockedBy.join(' | '), e.unresolvedDecisions.join(' || '), e.sport.rationale].map(csvCell).join(','))];
fs.writeFileSync(path.join(outDir, 'mapping.csv'), sheet.join('\r\n'));
fs.writeFileSync(path.join(outDir, 'media-report.csv'), mediaRows.join('\r\n'));
fs.writeFileSync(path.join(outDir, 'redirect-proposals.csv'), [['Old URL', 'Old Category', 'Old Title', 'Decision', 'New Category', 'New Title', 'New URL', 'Notes'].join(','), ...redirectRows.map((r) => [r.oldUrl, r.category, r.title, r.decision, '', '', r.newUrl, r.notes].map(csvCell).join(','))].join('\r\n'));
fs.writeFileSync(path.join(outDir, 'link-audit.csv'), [['WordPress ID', 'Link text', 'Original address', 'Kind', 'Status', 'Address in the converted article', 'Target post ID', 'Note'].join(','), ...allLinks.map((l) => [l.post, l.text, l.originalHref, l.kind, l.status, l.finalHref, l.targetPostId ?? '', l.note].map(csvCell).join(','))].join('\r\n'));

const linkRows = (status: LinkStatus) => allLinks.filter((l) => l.status === status && l.kind !== 'external');
const md = [
  '# WordPress migration: dry-run report', '',
  `Generated ${manifest.generatedAt}. Dry run only: nothing was written to a database, to media storage or to the backup, and no redirect was created.`,
  `CMS state: ${cms.source}`, '',
  '## Totals', '',
  `- Posts: ${summary.posts}; converted and validated: ${summary.converted}; failed: ${summary.failed}`,
  `- Ready for import now: ${summary.readyForImport}; waiting only for a sport or Author profile to be created: ${summary.blockedOnlyByPendingEntities}; with decisions still open: ${summary.withUnresolvedDecisions}`,
  `- All source text carried over: ${summary.totals.postsWithAllTextCarriedOver} of ${summary.posts} posts`,
  `- Tables ${summary.totals.tables}, FAQ entries ${summary.totals.faqEntries}, video embeds ${summary.totals.embeds}`,
  `- Inline images ${summary.totals.inlineImages} (${summary.totals.inlineImagesMissing} missing); featured images available ${summary.totals.featuredImagesAvailable} of ${summary.posts}`,
  `- Media files referenced ${summary.media.filesReferenced}: usable ${summary.media.usable}, unusable ${summary.media.unusable}; identical-file groups ${summary.media.duplicateFileGroups}`,
  `- Left empty on purpose: meta description on ${summary.totals.postsWithoutMetaDescription} posts, excerpt on ${summary.totals.postsWithoutExcerpt} posts`, '',
  '## Sports', '', '| Sport | Status | Posts | WordPress IDs |', '| --- | --- | --- | --- |',
  ...[...new Set(entries.map((e) => `${e.sport.sportSlug ?? '(none)'}|${e.sport.status}`))].sort().map((k) => { const [slug, status] = k.split('|'); const ids = entries.filter((e) => (e.sport.sportSlug ?? '(none)') === slug && e.sport.status === status).map((e) => e.wordpressId); return `| ${slug} | ${status} | ${ids.length} | ${ids.join(', ')} |`; }), '',
  '## Pending entities (not created)', '', '| Kind | Slug | Posts |', '| --- | --- | --- |', ...pendingSports.map((s) => `| Sport | ${s.slug} | ${s.posts.join(', ')} |`), ...pendingAuthors.map((a) => `| Author profile (unlinked, no e-mail) | ${a.profileSlug} — "${a.sourceName}" | ${a.posts} posts |`), '',
  '## Event links', '', '| Post | Decision | Event / year | Why |', '| --- | --- | --- | --- |', ...eventLinks.map((e) => `| ${e.wordpressId} ${e.slug} | ${e.decision === 'link' ? 'attach to edition' : 'keep sport-level'} | ${e.event ?? '-'}${e.year ? ` / ${e.year}` : ''} | ${e.reason} |`), '',
  '## Links', '',
  `Total ${linkTotals.total}: preserved ${linkTotals.preserved} (external), rewritten ${linkTotals.rewritten}, pending ${linkTotals.pending}, unresolved ${linkTotals.unresolved}. Full list: link-audit.csv.`, '',
  '### Rewritten (verified destination)', '', '| Kind | Count |', '| --- | --- |', ...Object.entries(linkRows('rewritten').reduce<Record<string, number>>((o, l) => { o[l.kind] = (o[l.kind] ?? 0) + 1; return o; }, {})).map(([k, n]) => `| ${k} | ${n} |`), '',
  '### Pending (destination does not exist yet)', '', '| Post | Original address | Note |', '| --- | --- | --- |', ...linkRows('pending').map((l) => `| ${l.post} | ${l.originalHref} | ${l.note} |`), '',
  '### Unresolved (needs a decision)', '', '| Post | Original address | Note |', '| --- | --- | --- |', ...linkRows('unresolved').map((l) => `| ${l.post} | ${l.originalHref} | ${l.note} |`), '',
  '## Conversion issues (all posts)', '', '| Issue | Kind | Occurrences | Posts |', '| --- | --- | --- | --- |', ...Object.entries(summary.issues).map(([code, t]) => `| ${code} | ${t.severity} | ${t.count} | ${t.posts} |`), '',
  '## Missing or unusable images', '', ...(missingImages.length ? ['| Post | Role | Source | Reason |', '| --- | --- | --- | --- |', ...missingImages.map((m) => `| ${m.post} | ${m.role} | ${m.src || '-'} | ${m.reason} |`)] : ['None.']), '',
  '## Posts', '', '| ID | Slug | Sport | Type (provisional) | Converted | Losses | Blocked by |', '| --- | --- | --- | --- | --- | --- | --- |',
  ...entries.map((e) => `| ${e.wordpressId} | ${e.slug} | ${e.sport.sportSlug ?? '-'}${e.sport.exists ? '' : ' (pending)'} | ${e.articleType.articleType ?? '-'} | ${e.conversion.ok ? 'yes' : 'FAILED'} | ${e.conversion.losses} | ${e.blockedBy.join(' ') || '-'} |`), '',
].join('\n');
fs.writeFileSync(path.join(outDir, 'conversion-report.md'), md);

const pilotMd = [
  '# WordPress migration: pilot plan (prepared, not run)', '',
  'Five posts, each standing for one feature. Nothing has been imported.', '',
  '| Post | Covers | Evidence in the dry run | Sport | Author profile | Proposed address | FAQ | Images | Losses |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...pilotPosts.map((p) => (p.found ? `| ${p.wordpressId} ${p.slug} | ${p.covers} | ${p.featureVerified ? p.evidence : `NOT VERIFIED: ${p.evidence}`} | ${p.sportSlug}${p.sportExists ? '' : ' (pending)'} | ${p.authorProfile} | ${p.proposedPath ?? '-'} | ${p.faq} | ${p.inlineImages} inline + ${p.featuredImage ? 1 : 0} featured | ${p.losses} |` : `| ${p.wordpressId} | ${p.covers} | NOT IN THE EXPORT | | | | | | |`)), '',
  '## Isolation requirements', '',
  `- Database: ${pilot.isolation.database}`, `- Environment: ${pilot.isolation.environment}`, `- Media: ${pilot.isolation.media}`, `- Guard: ${pilot.isolation.guard}`,
  '- No Docker, no R2, no outbound integrations (IndexNow, e-mail, AI keys stay empty).', '',
  '## Needed inside the pilot database only', '', ...pilot.prerequisitesInThePilotDatabaseOnly.map((p) => `- ${p}`), '',
  '## What the pilot must show', '',
  '- Each article is created as a draft with review status "draft"; publishing or scheduling it is refused until it has been submitted and approved by a second reviewer.',
  '- Images are in the local Media Library with copyright review "pending"; FAQ entries are article-scoped drafts.',
  '- A second run creates no duplicate article, image or FAQ entry.',
  '- Removing the pilot content leaves the database as it was before the run.', '',
].join('\n');
fs.writeFileSync(path.join(outDir, 'pilot-plan.md'), pilotMd);
zip.close();

console.log(JSON.stringify(summary, null, 2));
console.log(`[wordpress-dry-run] Source files unchanged: ${sourcesUnchanged ? 'yes' : 'NO'}. Database: not connected (this command has no database code path). Media storage: not touched.`);
console.log(`[wordpress-dry-run] Wrote manifest.json, mapping.csv, conversion-report.md, link-audit.csv, redirect-proposals.csv, media-report.csv, pilot-plan.md and ${entries.length} post reports to ${outDir}.`);
if (!sourcesUnchanged) process.exit(1);

