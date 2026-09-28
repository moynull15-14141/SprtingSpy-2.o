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
