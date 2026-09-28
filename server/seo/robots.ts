/**
 * robots.txt (PHASE D, Spec v1.1 §18). Blocks only non-public areas; public
 * pages, images (/media) and assets (/_next) stay crawlable. robots.txt is
 * not used instead of noindex: search and filtered listings remain crawlable
 * so crawlers can see their noindex meta tag.
 */
export function robotsTxt(origin: string): string {
  return `User-agent: *
Allow: /
Disallow: /admin/
Disallow: /account/
Disallow: /api/

Sitemap: ${origin}/sitemap.xml
`;
}
