/**
 * XML sitemaps (PHASE D, Spec v1.1 §18).
 *
 *   /sitemap.xml                 sitemap index
 *   /sitemaps/pages.xml          static pages, sports, events, editions, authors
 *   /sitemaps/articles-<n>.xml   published articles, in chunks
 *
 * Only indexable URLs are listed (see src/lib/indexability.ts): no drafts,
 * hidden/private or thin pages, search, redirected URLs, noindex pages or
 * non-self-canonical duplicates. `lastmod` is emitted only where it reflects
 * a meaningful content change (articles).
 */

import { loadSiteIndex, type IndexedPage } from './siteIndex';

export const ARTICLES_PER_SITEMAP = 5000;

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const day = (d: Date) => d.toISOString().slice(0, 10);

function urlset(origin: string, pages: IndexedPage[]) {
  const body = pages
    .map((p) => `  <url>\n    <loc>${xmlEscape(origin + p.path)}</loc>${p.lastmod ? `\n    <lastmod>${day(p.lastmod)}</lastmod>` : ''}\n  </url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

export async function sitemapFiles(origin: string) {
  const index = await loadSiteIndex(origin);
  const included = index.pages.filter((p) => p.status.indexable);
  const pages = included.filter((p) => p.kind !== 'article');
  const articles = included.filter((p) => p.kind === 'article').sort((a, b) => a.path.localeCompare(b.path));
  const articleChunks: IndexedPage[][] = [];
  for (let i = 0; i < articles.length; i += ARTICLES_PER_SITEMAP) articleChunks.push(articles.slice(i, i + ARTICLES_PER_SITEMAP));
  if (!articleChunks.length) articleChunks.push([]);

  const files = new Map<string, string>();
  files.set('pages.xml', urlset(origin, pages));
  articleChunks.forEach((chunk, i) => files.set(`articles-${i + 1}.xml`, urlset(origin, chunk)));

  const newest = (list: IndexedPage[]) => list.reduce<Date | undefined>((max, p) => (p.lastmod && (!max || p.lastmod > max) ? p.lastmod : max), undefined);
  const entries = [
    { name: 'pages.xml', lastmod: undefined as Date | undefined },
    ...articleChunks.map((chunk, i) => ({ name: `articles-${i + 1}.xml`, lastmod: newest(chunk) })),
  ];
  const indexXml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries
    .map((e) => `  <sitemap>\n    <loc>${xmlEscape(`${origin}/sitemaps/${e.name}`)}</loc>${e.lastmod ? `\n    <lastmod>${day(e.lastmod)}</lastmod>` : ''}\n  </sitemap>`)
    .join('\n')}\n</sitemapindex>\n`;

  return {
    index: indexXml,
    files,
    /** For the SEO report: what is listed and what is excluded (with reasons). */
    report: {
      included: included.map((p) => ({ path: p.path, kind: p.kind })),
      excluded: index.pages.filter((p) => !p.status.indexable).map((p) => ({ path: p.path, kind: p.kind, title: p.title, reason: (p.status as { reason: string }).reason })),
    },
  };
}
