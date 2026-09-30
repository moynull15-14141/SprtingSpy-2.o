/**
 * Request-scoped data loaders for the public App Router pages. React's
 * `cache` dedupes identical calls within one render, so a page and its
 * generateMetadata share a single database query.
 */
import 'server-only';
import { cache } from 'react';
import * as content from '../../server/services/public/content';
import { searchPublic } from '../../server/services/public/search';
import { featureFlags } from '../../server/features';
import { cookies } from 'next/headers';
import { getSiteLayout, getHomepageSections } from '../../server/services/public/siteLayout';
import { SITE_PREVIEW_COOKIE } from './siteExperience/preview';
import { BRANDING } from '../config/branding';

export const getNavSports = cache(content.getNavSports);
export const getAdSlots = cache(content.getAdSlots);
export const getSportsDirectory = cache(content.getSportsDirectory);
export const getSportHub = cache(content.getSportHub);
export const getEventsDirectory = cache(content.getEventsDirectory);
export const getEventPage = cache(content.getEventPage);
export const getEditionPage = cache(content.getEditionPage);
export const getArticlePage = cache(content.getArticlePage);
export const getLatest = cache(content.getLatest);
export const getAuthorPage = cache(content.getAuthorPage);
export const getApprovedComments = cache(content.getApprovedComments);
export const search = cache(searchPublic);
export const getFeatures = featureFlags;
/** PHASE H: published FAQ entries for /faq/. */
export const getFaqs = cache(async () => (await import('../../server/services/public/faq')).getPublishedFaqs());

/**
 * PHASE H: site identity from Admin → Settings (site name, description,
 * default social image, X/Twitter handle), falling back to the built-in
 * branding. These values are public by nature.
 */
export const getSiteIdentity = cache(async (): Promise<SiteIdentity> => {
  let stored: Partial<Record<string, string>> = {};
  try { stored = await (await import('../../server/settingsRegistry')).publicSettings(); } catch { /* database trouble: built-in branding keeps pages up */ }
  return {
    name: stored.siteName || BRANDING.name,
    description: stored.siteDescription || BRANDING.description,
    configuredDescription: stored.siteDescription || null,
    defaultOgImage: stored.defaultOgImage || null,
    twitterHandle: stored.twitterHandle || null,
  };
});
export interface SiteIdentity { name: string; description: string; configuredDescription: string | null; defaultOgImage: string | null; twitterHandle: string | null }
export { LATEST_PAGE_SIZE } from '../../server/services/public/content';

/**
 * PHASE F.1: the Site Experience for this request. Drafts are shown only when
 * the preview cookie is present AND the request has an active Admin/Editor
 * session; everyone else gets the published (or default) configuration.
 */
export const getSiteLayoutForRequest = cache(async () => {
  const store = await cookies();
  let preview = false;
  if (store.get(SITE_PREVIEW_COOKIE)?.value === '1') {
    const { resolveSessionIdentity } = await import('../../server/sessionLookup');
    const viewer = await resolveSessionIdentity(store.get('sid')?.value).catch(() => null);
    preview = !!viewer && ['Admin', 'Editor'].includes(viewer.role);
  }
  return getSiteLayout({ preview });
});

export const getHomepage = cache(async () => {
  const layout = await getSiteLayoutForRequest();
  return getHomepageSections(layout.docs, layout);
});
