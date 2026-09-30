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

/** Public static pages. /search/ is a user tool and is never indexable. */
export const STATIC_INDEXABLE_PATHS = ['/', '/sports/', '/events/', '/latest/', '/about/', '/contact/', '/privacy-policy/', '/terms-and-conditions/', '/dmca/'];
export const STATIC_NON_INDEXABLE_PATHS: Record<string, string> = { '/search/': 'search results are a user tool, not index targets' };
/** PHASE H: indexable only while it has published questions (see server/seo/siteIndex.ts). */
export const FAQ_PATH = '/faq/';

/** An editor canonical override that points somewhere else makes this URL a duplicate. */
function canonicalElsewhere(seo: SeoMetadata | undefined, selfPath: string, origin: string): boolean {
  if (!seo?.canonicalUrl) return false;
  try {
    const url = new URL(seo.canonicalUrl, origin);
    return url.origin !== new URL(origin).origin || canonicalPagePath(url.pathname) !== selfPath;
  } catch {
    return true;
  }
}

export function sportIndexability(s: { isVisible: boolean; seo?: SeoMetadata; publishedArticleCount: number; visibleEventCount: number }): Indexability {
  if (!s.isVisible) return no('sport is hidden');
  if (s.seo?.noIndex) return no('editor set noindex');
  if (s.publishedArticleCount === 0 && s.visibleEventCount === 0) return no('thin: no published articles or events yet');
  return yes;
}

export function eventIndexability(e: { isVisible: boolean; sportVisible: boolean; seo?: SeoMetadata }): Indexability {
  if (!e.isVisible || !e.sportVisible) return no('event or its sport is hidden');
  if (e.seo?.noIndex) return no('editor set noindex');
  return yes;
}

export function editionIndexability(ed: { eventIndexable: boolean; seo?: SeoMetadata }): Indexability {
  if (!ed.eventIndexable) return no('its event is not indexable');
  if (ed.seo?.noIndex) return no('editor set noindex');
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
