/**
 * robots.txt (PHASE D, Spec v1.1 §18). Blocks only non-public areas; public
 * pages, images (/media) and assets (/_next) stay crawlable. robots.txt is
 * not used instead of noindex: search and filtered listings remain crawlable
 * so crawlers can see their noindex meta tag.
 *
 * PHASE J: a staging copy (APP_ENV=staging) disallows everything and lists no
 * sitemap, so it can never compete with the public site in search results.
 */
export function robotsTxt(origin: string, environment: 'development' | 'staging' | 'production' = 'production', nonCanonicalHost = false): string {
  if (environment === 'staging') {
    return `# Staging environment: not for search engines.
User-agent: *
Disallow: /
`;
  }
  if (nonCanonicalHost) {
    return `# Not the canonical host of this site: not for search engines.
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

/**
 * A request Host in comparable form: lower case, no trailing dot, no default
 * port (80/443). Anything that is not a bare host[:port] gives null.
 */
export function normalizeHost(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let url: URL;
  try { url = new URL(`http://${raw.trim()}`); } catch { return null; }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  const port = url.port === '443' ? '' : url.port; // URL already drops :80 for http
  return host ? (port ? `${host}:${port}` : host) : null;
}

/** The host[:port] of the canonical origin (ALLOWED_ORIGIN), default port omitted. */
export function canonicalHostOf(origin: string | undefined): string | null {
  if (!origin) return null;
  try { const url = new URL(origin); return normalizeHost(url.host); } catch { return null; }
}

/**
 * Whether a response must be kept out of search engines as a whole.
 * Staging: always. Production: unless the request reached the canonical host
 * (the platform's own hostname, e.g. *.onrender.com, serves the same pages).
 * The Host header is used as received, never X-Forwarded-Host, so a forwarded
 * header cannot make another host look canonical. Development: never.
 */
export function indexingBlocked(environment: 'development' | 'staging' | 'production', requestHost: unknown, canonicalHost: string | null): boolean {
  if (environment === 'staging') return true;
  if (environment !== 'production') return false;
  const host = normalizeHost(requestHost);
  return !host || !canonicalHost || host !== canonicalHost;
}
