/**
 * Read-only verification of imported WordPress posts in the destination.
 * Reads the rows straight from the database and compares them with the
 * import manifest and the dry run; the only API calls are publish/schedule
 * attempts that the workflow must refuse (a refused request changes nothing,
 * and that is checked too).
 */
import fs from 'node:fs';
import path from 'node:path';
import { assertIsolated, loadManifest, type PilotContext } from './pilot';

export interface ImportVerification {
  ok: boolean;
  problems: string[];
  expectedPosts: number;
  articles: number;
  missing: string[];
  drafts: number;
  reviewRequired: number;
  scheduled: number;
  published: number;
  publishRefused: number;
  scheduleRefused: number;
  media: { items: number; copyrightPending: number; filesOnDisk: number };
  faq: { entries: number; expected: number; drafts: number };
  authors: { slug: string; name: string; roleTitle: string; linkedLogin: boolean; email: boolean; picture: boolean; articles: number }[];
  bySport: Record<string, number>;
  eventLinked: string[];
  duplicateAddresses: string[];
  totals: { tables: number; mergedCells: number; inlineImages: number; captions: number; embeds: number; links: number };
}

export async function verifyImport(ctx: PilotContext, dryRunDir: string): Promise<ImportVerification> {
  assertIsolated(ctx.env, 'verify the import');
  const manifest = loadManifest(decodeURIComponent(new URL(ctx.env.DATABASE_URL).pathname.slice(1)), ctx.manifestFile);
  const dry = JSON.parse(fs.readFileSync(path.join(dryRunDir, 'manifest.json'), 'utf8'));
  const problems: string[] = [];
  const check = (condition: unknown, problem: string) => { if (!condition) problems.push(problem); };
  const expectedIds: string[] = (dry.posts as any[]).map((p) => p.wordpressId);
  const missing = expectedIds.filter((id) => !manifest.posts[id]);
  const articleIds = Object.values(manifest.posts).map((p) => p.articleId);
  const rows = (await ctx.db.query(`select a.id, a.slug, a.title, a.status, a."reviewStatus", a."scheduledFor", a."reviewVersion", a."sportSlug", a."eventSlug", a."editionYear", a."articleType", a.body, a.excerpt, a.seo, a."featuredMediaId",
    to_char(a."publishedAt", 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "publishedUtc", to_char(a."updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS') as stamp, au.slug as "authorSlug"
    from "Article" a join "Author" au on au.id = a."authorId" where a.id = any($1)`, [articleIds])).rows;
  const byArticle = new Map(rows.map((r) => [r.id, r]));
  const totals = { tables: 0, mergedCells: 0, inlineImages: 0, captions: 0, embeds: 0, links: 0 };
  const bySport: Record<string, number> = {};
  const eventLinked: string[] = [];
  let expectedFaq = 0;
  const mediaIds = new Set<string>();
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
  let publishRefused = 0, scheduleRefused = 0;

  for (const [id, record] of Object.entries(manifest.posts)) {
    const want = (dry.posts as any[]).find((p) => p.wordpressId === id);
    const a = byArticle.get(record.articleId);
    if (!a) { problems.push(`Post ${id}: article ${record.articleId} is not in the database.`); continue; }
    if (!want) { problems.push(`Post ${id} is not in the dry run.`); continue; }
    check(a.status === 'draft', `Post ${id}: status is ${a.status}.`);
    check(a.reviewStatus === 'draft', `Post ${id}: review status is ${a.reviewStatus}.`);
    check(a.scheduledFor === null, `Post ${id}: has a publication time.`);
    check(a.title === want.title && a.slug === want.slug, `Post ${id}: title or slug differs.`);
    check(a.sportSlug === want.plannedDraft.sportSlug, `Post ${id}: sport is ${a.sportSlug}, expected ${want.plannedDraft.sportSlug}.`);
    check(a.eventSlug === want.plannedDraft.eventSlug && a.editionYear === want.plannedDraft.editionYear, `Post ${id}: event edition differs.`);
    check(a.articleType === want.plannedDraft.articleType, `Post ${id}: article type differs.`);
    check(a.authorSlug === want.plannedDraft.authorSlug, `Post ${id}: author is ${a.authorSlug}.`);
    check(a.publishedUtc === want.plannedDraft.publishedAt, `Post ${id}: publication date ${a.publishedUtc}, expected ${want.plannedDraft.publishedAt}.`);
    check(JSON.stringify(a.seo.keywords) === JSON.stringify(want.seo.keywords) && (a.seo.metaDescription ?? null) === want.seo.metaDescription && a.seo.metaTitle === undefined, `Post ${id}: SEO fields differ.`);
    check(a.excerpt === (want.excerpt ?? ''), `Post ${id}: excerpt differs.`);
    check(want.featuredImage.available ? /^media-/.test(a.featuredMediaId ?? '') : true, `Post ${id}: featured image is missing.`);
    const seen = { tables: 0, rows: 0, merged: 0, images: 0, captions: 0, embeds: 0, links: 0 };
    const walk = (n: any) => {
      if (n.type === 'table') seen.tables++;
      if (n.type === 'tableRow') seen.rows++;
      if ((n.type === 'tableCell' || n.type === 'tableHeader') && (n.attrs.colspan > 1 || n.attrs.rowspan > 1)) seen.merged++;
      if (n.type === 'image') { seen.images++; mediaIds.add(n.attrs.mediaId); if (n.attrs.caption) seen.captions++; }
      if (n.type === 'embed') seen.embeds++;
      for (const m of n.marks ?? []) if (m.type === 'link') seen.links++;
      (n.content ?? []).forEach(walk);
    };
    a.body.content.forEach(walk);
    check(seen.tables === want.counts.tables && seen.rows === want.counts.tableRows && seen.merged === want.counts.mergedCells, `Post ${id}: tables ${seen.tables}/${want.counts.tables}, rows ${seen.rows}/${want.counts.tableRows}, merged cells ${seen.merged}/${want.counts.mergedCells}.`);
    check(seen.images === want.counts.inlineImagesPlaced && seen.captions === want.counts.imageCaptions, `Post ${id}: images ${seen.images}/${want.counts.inlineImagesPlaced}, captions ${seen.captions}/${want.counts.imageCaptions}.`);
    check(seen.embeds === want.counts.embeds && seen.links === want.counts.links, `Post ${id}: embeds ${seen.embeds}/${want.counts.embeds}, links ${seen.links}/${want.counts.links}.`);
    check(!/"wp-(att|file)-/.test(JSON.stringify(a.body)), `Post ${id}: a placeholder media id was stored.`);
    check(record.faq.length === want.counts.faq, `Post ${id}: ${record.faq.length} FAQ entries, expected ${want.counts.faq}.`);
    expectedFaq += want.counts.faq;
    if (a.featuredMediaId) mediaIds.add(a.featuredMediaId);
    totals.tables += seen.tables; totals.mergedCells += seen.merged; totals.inlineImages += seen.images; totals.captions += seen.captions; totals.embeds += seen.embeds; totals.links += seen.links;
    bySport[a.sportSlug] = (bySport[a.sportSlug] ?? 0) + 1;
    if (a.eventSlug) eventLinked.push(`${id} → ${a.sportSlug}/${a.eventSlug}/${a.editionYear}`);
    // The workflow must refuse both; a refused request changes nothing.
    const url = `/api/articles/${a.id}`;
    if ((await ctx.api.request('PUT', url, { status: 'published' })).status === 409) publishRefused++; else problems.push(`Post ${id}: publishing was NOT refused.`);
    if ((await ctx.api.request('PUT', url, { status: 'scheduled', scheduledFor: tomorrow })).status === 409) scheduleRefused++; else problems.push(`Post ${id}: scheduling was NOT refused.`);
  }
  const afterAttempts = (await ctx.db.query(`select id, status, "reviewStatus", "reviewVersion", "scheduledFor", to_char("updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS') as stamp from "Article" where id = any($1)`, [articleIds])).rows;
  for (const r of afterAttempts) { const b = byArticle.get(r.id)!; check(r.status === 'draft' && r.reviewStatus === 'draft' && r.scheduledFor === null && r.reviewVersion === b.reviewVersion && r.stamp === b.stamp, `Article ${r.id} changed during the refused publish attempts.`); }

  const faq = (await ctx.db.query('select status, source, count(*)::int as n from "FaqEntry" where "articleId" = any($1) group by 1, 2', [articleIds])).rows;
  const faqEntries = faq.reduce((n, r) => n + r.n, 0);
  const faqDrafts = faq.filter((r) => r.status === 'draft').reduce((n, r) => n + r.n, 0);
  check(faqEntries === expectedFaq && faqDrafts === faqEntries, `FAQ entries: ${faqEntries} stored (${faqDrafts} drafts), expected ${expectedFaq} drafts.`);
  const media = (await ctx.db.query('select id, "copyrightReview", "storageKey", variants from "MediaItem" where id = any($1)', [[...mediaIds]])).rows;
  check(media.length === mediaIds.size, `Media: ${media.length} of ${mediaIds.size} referenced items exist.`);
  const pending = media.filter((m) => m.copyrightReview === 'pending').length;
  check(pending === media.length, `Media: ${media.length - pending} item(s) are not "pending" copyright review.`);
  const onDisk = media.filter((m) => m.storageKey && fs.existsSync(path.join(ctx.env.MEDIA_LOCAL_DIR, m.storageKey))).length;
  check(onDisk === media.length, `Media: ${media.length - onDisk} file(s) are not in local storage.`);
  check(Object.keys(manifest.media).length === media.length, `Media: the manifest lists ${Object.keys(manifest.media).length} files, the articles use ${media.length} items.`);
  const authors = (await ctx.db.query(`select au.slug, au.name, au."roleTitle", au."userId" is not null as "linkedLogin", au.email is not null as email, au.avatar <> '' as picture, (select count(*)::int from "Article" a where a."authorId" = au.id and a.id = any($1)) as articles from "Author" au where au.slug = any($2) order by au.slug`, [articleIds, [...new Set(rows.map((r) => r.authorSlug))]])).rows;
  for (const au of authors) check(!au.linkedLogin && !au.email && !au.picture, `Author profile ${au.slug} has a login, an e-mail or a picture.`);
  const addresses = (await ctx.db.query('select "sportSlug" || \'/\' || coalesce("eventSlug", \'-\') || \'/\' || coalesce("editionYear"::text, \'-\') || \'/\' || slug as address, count(*)::int as n from "Article" group by 1 having count(*) > 1')).rows.map((r) => r.address);
  check(!addresses.length, `Duplicate article addresses: ${addresses.join(', ')}.`);
  check(!missing.length, `Not imported: ${missing.join(', ')}.`);

  return {
    ok: problems.length === 0, problems, expectedPosts: expectedIds.length, articles: rows.length, missing,
    drafts: rows.filter((r) => r.status === 'draft').length, reviewRequired: rows.filter((r) => r.reviewStatus === 'draft').length, scheduled: rows.filter((r) => r.scheduledFor !== null || r.status === 'scheduled').length, published: rows.filter((r) => r.status === 'published').length,
    publishRefused, scheduleRefused,
    media: { items: media.length, copyrightPending: pending, filesOnDisk: onDisk }, faq: { entries: faqEntries, expected: expectedFaq, drafts: faqDrafts },
    authors, bySport: Object.fromEntries(Object.entries(bySport).sort()), eventLinked, duplicateAddresses: addresses, totals,
  };
}
