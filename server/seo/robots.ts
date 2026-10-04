/**
 * robots.txt (PHASE D, Spec v1.1 §18). Blocks only non-public areas; public
 * pages, images (/media) and assets (/_next) stay crawlable. robots.txt is
 * not used instead of noindex: search and filtered listings remain crawlable
 * so crawlers can see their noindex meta tag.
 *
 * PHASE J: a staging copy (APP_ENV=staging) disallows everything and lists no
 * sitemap, so it can never compete with the public site in search results.
 */
export function robotsTxt(origin: string, environment: 'development' | 'staging' | 'production' = 'production'): string {
  if (environment === 'staging') {
    return `# Staging environment: not for search engines.
User-agent: *
Disallow: /
`;
  }
  return `User-agent: *
Allow: /
Disallow: /admin/
Disallow: /account/
Disallow: /api/
Disallow: /reset-password/

Sitemap: ${origin}/sitemap.xml
`;
}
