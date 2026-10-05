/** Read-only Phase S SEO invariants and local content audit. No fixtures or migrations. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { prisma } from '../db';
import { loadSiteIndex } from '../seo/siteIndex';
import { sitemapFiles } from '../seo/sitemap';
import { robotsTxt } from '../seo/robots';
import { validateSafeUrl } from '../validation';
import { JsonLd } from '../../src/components/seo/JsonLd';
import { canonicalElsewhere, articleIndexability, sportIndexability, eventIndexability, editionIndexability, authorIndexability, STATIC_NON_INDEXABLE_PATHS } from '../../src/lib/indexability';
import { siteOrigin } from '../../src/lib/paths';

const origin = 'https://www.sportingspy.com';
const other = { canonicalUrl: 'https://example.org/original/' };

assert.equal(canonicalElsewhere({ canonicalUrl: '/tennis/' }, '/tennis/', origin), false);
assert.equal(canonicalElsewhere({ canonicalUrl: '/tennis/?variant=1' }, '/tennis/', origin), true);
assert.equal(canonicalElsewhere(other, '/tennis/', origin), true);
assert.equal(sportIndexability({ isVisible: true, publishedArticleCount: 1, visibleEventCount: 0, seo: other }, '/tennis/', origin).indexable, false);
assert.equal(eventIndexability({ isVisible: true, sportVisible: true, seo: other }, '/tennis/open/', origin).indexable, false);
assert.equal(editionIndexability({ eventIndexable: true, seo: other }, '/tennis/open/2027/', origin).indexable, false);
assert.equal(articleIndexability({ status: 'published', visible: true, seo: other, path: '/tennis/story/' }, origin).indexable, false);
for (const status of ['draft', 'scheduled', 'archived']) assert.equal(articleIndexability({ status, visible: true, path: '/tennis/story/' }, origin).indexable, false);
assert.equal(articleIndexability({ status: 'published', visible: true, path: '/tennis/story/' }, origin).indexable, true);
assert.equal(authorIndexability(0).indexable, false);
assert.ok(STATIC_NON_INDEXABLE_PATHS['/search/']);
assert.equal(validateSafeUrl('javascript:alert(1)', 'target').valid, false);
assert.equal(validateSafeUrl('https://example.org/', 'target').valid, true);
assert.match(robotsTxt(origin), /Allow: \/\n/);
assert.match(robotsTxt(origin), /Disallow: \/admin\//);
assert.match(robotsTxt(origin), /Disallow: \/api\//);
assert.match(robotsTxt(origin), /Sitemap: https:\/\/www\.sportingspy\.com\/sitemap\.xml/);
assert.match(robotsTxt(origin, 'staging'), /Disallow: \/\n/);
assert.ok(!robotsTxt(origin, 'staging').includes('Sitemap:'));

const jsonLd = renderToStaticMarkup(React.createElement(JsonLd, { data: { '@context': 'https://schema.org', '@type': 'Article', headline: '</script><script>alert(1)</script>' } }));
assert.ok(jsonLd.includes('\\u003c/script>'));
assert.ok(!jsonLd.includes('</script><script>'));

const index = await loadSiteIndex(origin);
const sitemap = await sitemapFiles(origin);
const included = sitemap.report.included.map(p => p.path);
assert.equal(new Set(included).size, included.length, 'duplicate sitemap URLs');
assert.ok(!included.some(p => p.startsWith('/admin/') || p.startsWith('/api/') || p.startsWith('/search/')));
assert.ok(sitemap.index.includes(`${origin}/sitemaps/pages.xml`));
for (const xml of sitemap.files.values()) {
  assert.ok(!xml.includes('localhost'));
  assert.ok(!xml.includes('http://sportingspy.com'));
  for (const match of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) assert.ok(match[1].startsWith(`${origin}/`), match[1]);
}
for (const page of index.pages) if (!page.status.indexable) assert.ok(!included.includes(page.path), page.path);

const byKind = Object.fromEntries(['static', 'sport', 'event', 'edition', 'article', 'author'].map(kind => [kind, {
  included: index.pages.filter(p => p.kind === kind && p.status.indexable).length,
  excluded: index.pages.filter(p => p.kind === kind && !p.status.indexable).length,
}]));
const [allArticles, allSports, allEvents, allEditions] = await Promise.all([
  prisma.article.findMany({ select: { id: true, status: true, sportSlug: true, eventSlug: true, editionYear: true, title: true, excerpt: true, authorId: true } }),
  prisma.sport.findMany({ select: { slug: true } }),
  prisma.sportEvent.findMany({ select: { sportSlug: true, slug: true } }),
  prisma.eventEdition.findMany({ select: { sportSlug: true, eventSlug: true, year: true } }),
]);
const sportKeys = new Set(allSports.map(s => s.slug));
const eventKeys = new Set(allEvents.map(e => `${e.sportSlug}/${e.slug}`));
const editionKeys = new Set(allEditions.map(e => `${e.sportSlug}/${e.eventSlug}/${e.year}`));
const orphanArticles = allArticles.filter(a => !sportKeys.has(a.sportSlug) || (a.eventSlug && !eventKeys.has(`${a.sportSlug}/${a.eventSlug}`)) || (a.editionYear && !editionKeys.has(`${a.sportSlug}/${a.eventSlug}/${a.editionYear}`))).length;
const orphanEditions = allEditions.filter(e => !eventKeys.has(`${e.sportSlug}/${e.eventSlug}`)).length;
const duplicateTitles = new Map<string, number>();
for (const a of allArticles.filter(a => a.status === 'published')) {
  const title = a.title.trim().toLocaleLowerCase();
  duplicateTitles.set(title, (duplicateTitles.get(title) || 0) + 1);
}
console.log(JSON.stringify({ originConfig: siteOrigin(), byKind, articlesByStatus: Object.fromEntries([...new Set(allArticles.map(a => a.status))].map(status => [status, allArticles.filter(a => a.status === status).length])), orphanArticles, orphanEditions, duplicatePublishedTitleGroups: [...duplicateTitles.values()].filter(count => count > 1).length, publishedArticlesWithoutExcerpt: allArticles.filter(a => a.status === 'published' && !a.excerpt?.trim()).length }, null, 2));
console.log('Phase S read-only SEO assertions passed.');
await prisma.$disconnect();
