/**
 * CMS Pages (PHASE PAGES): shared rules for the server API, the admin UI and
 * the public routes. A Page is an informational document served at /{slug}/.
 */

export const PAGE_STATUSES = ['draft', 'published'] as const;
export type PageStatus = (typeof PAGE_STATUSES)[number];

/**
 * `standard` is text only. The other two add the one part of a page that is
 * not editorial text: the contact form, or the Privacy Policy disclosures that
 * are generated from the live analytics/advertising configuration.
 */
export const PAGE_TEMPLATES = ['standard', 'contact', 'privacy'] as const;
export type PageTemplate = (typeof PAGE_TEMPLATES)[number];

export const PAGE_LIMITS = { title: 150, shortTitle: 60, summary: 300, seoTitle: 70, seoDescription: 160, slug: 100 };

/** Lower-case words joined by single hyphens. */
export const PAGE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const pagePath = (slug: string) => `/${slug}/`;

/** A URL-safe slug suggestion from a title. */
export function slugifyPageTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, PAGE_LIMITS.slug)
    .replace(/-+$/, '');
}

/** Public shape of a page as rendered (published or staff preview). */
export interface PublicPage {
  id: string;
  slug: string;
  title: string;
  shortTitle: string | null;
  summary: string | null;
  body: import('./richText').RichDoc;
  content: string;
  template: PageTemplate;
  status: PageStatus;
  seoTitle: string | null;
  seoDescription: string | null;
  noIndex: boolean;
  ogImage: string | null;
  ogImageAlt: string | null;
  updatedAt: string;
  publishedAt: string | null;
}

/** Admin list/editor shape. */
export interface AdminPage extends Omit<PublicPage, 'ogImage' | 'ogImageAlt'> {
  system: boolean;
  ogMediaId: string | null;
  createdAt: string;
  createdBy: string;
  updatedBy: string;
}
