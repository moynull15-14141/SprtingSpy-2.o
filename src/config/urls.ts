/**
 * SportingSpy URL policy (Spec v1.1 §10).
 *
 * Canonical public page URLs end with a trailing slash:
 *   /tennis/french-open/2028/   (canonical)
 *   /tennis/french-open/2028    (301 -> canonical)
 *
 * Shared by the Express server (redirects, sitemap) and the React client
 * (navigation, canonical tags) so both apply the same rule.
 */

/** Old static page URLs, permanently redirected to their spec URLs. Keys have no trailing slash. */
export const LEGACY_PAGE_REDIRECTS: Record<string, string> = {
  '/privacy': '/privacy-policy/',
  '/terms': '/terms-and-conditions/',
};

/**
 * True when `pathname` is a public page route the trailing-slash policy
 * applies to. API routes, files (anything with an extension such as
 * sitemap.xml, robots.txt, .js, .css, images, fonts) and Vite dev-server
 * internals are excluded.
 */
export function isPagePath(pathname: string): boolean {
  if (!pathname.startsWith('/')) return false;
  if (/^\/api(?:\/|$)/i.test(pathname)) return false;
  if (/^\/(?:@|src\/|node_modules\/)/.test(pathname)) return false;
  // Next.js internals (assets, image optimizer, dev HMR/overlay endpoints).
  if (/^\/(?:_next|__next)/.test(pathname)) return false;
  const lastSegment = pathname.slice(pathname.lastIndexOf('/') + 1);
  return !lastSegment.includes('.');
}

/** Removes a trailing slash (except for the root). Used for route matching and redirect-rule lookup. */
export function stripTrailingSlash(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.replace(/\/+$/, '') || '/' : pathname;
}

/**
 * Returns the canonical form of an internal URL: page paths gain a trailing
 * slash, query string and hash are preserved, and non-page paths (files,
 * APIs, external URLs) are returned unchanged.
 */
export function canonicalPagePath(url: string): string {
  if (!url.startsWith('/') || url.startsWith('//')) return url;
  const match = url.match(/^([^?#]*)(.*)$/)!;
  const pathname = match[1] || '/';
  const rest = match[2];
  if (!isPagePath(pathname) || pathname.endsWith('/')) return pathname + rest;
  return `${pathname}/${rest}`;
}
