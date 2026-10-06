/**
 * Indexability rules (PHASE D) — the single definition used by page
 * metadata (robots), the XML sitemap and the SEO scanner, so they can never
 * disagree. A page is indexable only if it is public, not editor-noindexed,
 * self-canonical and not thin (Spec v1.1 §18, §36 rule 12: no thin pages).
 */

import type { SeoMetadata } from '../types';
import { canonicalPagePath } from '../config/urls';

export type Indexability = { indexable: true } | { indexable: false; reason: string };

const yes: Indexability = { indexable: true };
const no = (reason: string): Indexability => ({ indexable: false, reason });

/**
 * Public static pages. /search/ is a user tool and is never indexable.
 * PHASE PAGES: About, Contact, Privacy Policy, Terms and DMCA are CMS pages
 * now and enter the site index from the Page table (see pageIndexability).
 */
export const STATIC_INDEXABLE_PATHS = ['/', '/sports/', '/events/', '/latest/'];
export const STATIC_NON_INDEXABLE_PATHS: Record<string, string> = { '/search/': 'search results are a user tool, not index targets' };
/** PHASE H: indexable only while it has published questions (see server/seo/siteIndex.ts). */
export const FAQ_PATH = '/faq/';

/** An editor canonical override that points somewhere else makes this URL a duplicate. */
export function canonicalElsewhere(seo: SeoMetadata | undefined, selfPath: string, origin: string): boolean {
  if (!seo?.canonicalUrl) return false;
  try {
    const url = new URL(seo.canonicalUrl, origin);
    const self = new URL(selfPath, origin);
    return url.origin !== self.origin || canonicalPagePath(url.pathname) !== canonicalPagePath(self.pathname) || url.search !== self.search || !!url.hash;
  } catch {
    return true;
  }
}

export function sportIndexability(s: { isVisible: boolean; seo?: SeoMetadata; publishedArticleCount: number; visibleEventCount: number }, path?: string, origin?: string): Indexability {
  if (!s.isVisible) return no('sport is hidden');
  if (s.seo?.noIndex) return no('editor set noindex');
  if (path && origin && canonicalElsewhere(s.seo, path, origin)) return no('canonical points to another URL');
  if (s.publishedArticleCount === 0 && s.visibleEventCount === 0) return no('thin: no published articles or events yet');
  return yes;
}

export function eventIndexability(e: { isVisible: boolean; sportVisible: boolean; seo?: SeoMetadata }, path?: string, origin?: string): Indexability {
  if (!e.isVisible || !e.sportVisible) return no('event or its sport is hidden');
  if (e.seo?.noIndex) return no('editor set noindex');
  if (path && origin && canonicalElsewhere(e.seo, path, origin)) return no('canonical points to another URL');
  return yes;
}

export function editionIndexability(ed: { eventIndexable: boolean; seo?: SeoMetadata }, path?: string, origin?: string): Indexability {
  if (!ed.eventIndexable) return no('its event is not indexable');
  if (ed.seo?.noIndex) return no('editor set noindex');
  if (path && origin && canonicalElsewhere(ed.seo, path, origin)) return no('canonical points to another URL');
  return yes;
}

export function articleIndexability(a: { status: string; visible: boolean; seo?: SeoMetadata; path: string }, origin: string): Indexability {
  if (a.status !== 'published') return no(`status is ${a.status}`);
  if (!a.visible) return no('its sport or event is hidden');
  if (a.seo?.noIndex) return no('editor set noindex');
  if (canonicalElsewhere(a.seo, a.path, origin)) return no('canonical points to another URL');
  return yes;
}

export function authorIndexability(publishedArticleCount: number): Indexability {
  return publishedArticleCount > 0 ? yes : no('thin: no published articles');
}

/** PHASE PAGES: a CMS page is public only when published; editors may noindex it. */
export function pageIndexability(p: { status: string; noIndex: boolean }): Indexability {
  if (p.status !== 'published') return no(`status is ${p.status}`);
  if (p.noIndex) return no('editor set noindex');
  return yes;
}
