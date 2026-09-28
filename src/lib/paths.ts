/**
 * Canonical public URL builders (Spec v1.1 §10, Phase A trailing-slash policy).
 * Every public page URL ends with "/". Shared by server-rendered pages,
 * metadata, JSON-LD and the sitemap so there is exactly one URL per page.
 */

export const sportPath = (sport: string) => `/${sport}/`;
export const eventPath = (sport: string, event: string) => `/${sport}/${event}/`;
export const editionPath = (sport: string, event: string, year: number) => `/${sport}/${event}/${year}/`;
export const authorPath = (slug: string) => `/author/${slug}/`;

/**
 * Articles attached to an edition live under it; every other article
 * (general sport articles, and event articles with no edition) lives
 * directly under its sport.
 */
export function articlePath(article: { sportSlug: string; eventSlug?: string | null; editionYear?: number | null; slug: string }): string {
  return article.eventSlug && article.editionYear
    ? `/${article.sportSlug}/${article.eventSlug}/${article.editionYear}/${article.slug}/`
    : `/${article.sportSlug}/${article.slug}/`;
}

/** The browser-facing origin used for canonical URLs and JSON-LD. */
export function siteOrigin(): string {
  return (process.env.ALLOWED_ORIGIN || 'https://sportingspy.com').replace(/\/+$/, '');
}

export const absoluteUrl = (path: string) => `${siteOrigin()}${path}`;
