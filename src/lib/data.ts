/**
 * Request-scoped data loaders for the public App Router pages. React's
 * `cache` dedupes identical calls within one render, so a page and its
 * generateMetadata share a single database query.
 */
import 'server-only';
import { cache } from 'react';
import * as content from '../../server/services/public/content';
import { cached } from '../../server/publicCache';
import { searchPublic } from '../../server/services/public/search';
import { featureFlags } from '../../server/features';
import { cookies } from 'next/headers';
import { getSiteLayout, getHomepageSections } from '../../server/services/public/siteLayout';
import { SITE_PREVIEW_COOKIE } from './siteExperience/preview';
import { BRANDING } from '../config/branding';

// PHASE R (Spec §23, §26.2): two cache levels. `cached` (server/publicCache.ts)
// shares published data across requests and is invalidated by every CMS write;
// React's `cache` dedupes within one render. HTML itself is never shared
// (CSP nonce, consent and preview state are per request).
export const getNavSports = cache(cached('navSports', content.getNavSports));
export const getAdSlots = cache(cached('adSlots', content.getAdSlots));
export const getSportsDirectory = cache(cached('sportsDirectory', content.getSportsDirectory));
export const getSportHub = cache(cached('sportHub', content.getSportHub));
export const getEventsDirectory = cache(cached('eventsDirectory', content.getEventsDirectory));
export const getEventPage = cache(cached('eventPage', content.getEventPage));
export const getEditionPage = cache(cached('editionPage', content.getEditionPage));
export const getArticlePage = cache(cached('articlePage', content.getArticlePage));
export const getLatest = cache(cached('latest', content.getLatest));
export const getAuthorPage = cache(cached('authorPage', content.getAuthorPage));
export const getApprovedComments = cache(content.getApprovedComments);
export const search = cache(searchPublic);
export const getFeatures = featureFlags;
/** PHASE H: published FAQ entries for /faq/. */
export const getFaqs = cache(cached('globalFaqs', async () => (await import('../../server/services/public/faq')).getPublishedFaqs()));
/** PHASE R: whether /faq/ and its FAQPage markup are switched on (Admin → Settings → FAQ). */
export const getGlobalFaqSettings = cache(cached('globalFaqSettings', async () => {
  const { prisma } = await import('../../server/db');
  const rows = await prisma.siteSetting.findMany({ where: { key: { in: ['globalFaqPage', 'globalFaqSchema'] } } }).catch(() => []);
  const get = (key: string) => rows.find((r) => r.key === key)?.value;
  return { pageEnabled: get('globalFaqPage') === 'enabled', schemaEnabled: get('globalFaqSchema') === 'enabled' };
}));
/** PHASE R: real-user monitoring switch (Admin → Settings; on unless disabled). */
export const getRumEnabled = cache(cached('rumEnabled', async () => {
  const { prisma } = await import('../../server/db');
  const row = await prisma.siteSetting.findUnique({ where: { key: 'realUserMonitoring' } }).catch(() => null);
  return row?.value !== 'disabled';
}));
/** PHASE Q: analytics retention choice (Admin → Settings), for the privacy page. */
export const getAnalyticsRetention = cache(cached('analyticsRetention', async () => {
  const { prisma } = await import('../../server/db');
  const row = await prisma.siteSetting.findUnique({ where: { key: 'analyticsRetention' } }).catch(() => null);
  return ['13-months', '25-months', '37-months', 'unlimited'].includes(row?.value ?? '') ? row!.value : '25-months';
}));
/** PHASE R: published FAQ of one context (article / edition / event / sport). */
export const getContextFaqs = cache(async (kind: 'article' | 'edition' | 'event' | 'sport', id: string) =>
  (await import('../../server/services/public/faq')).getPublishedFaqsFor({ kind, id }));

/**
 * PHASE H: site identity from Admin → Settings (site name, description,
 * default social image, X/Twitter handle), falling back to the built-in
 * branding. These values are public by nature.
 */
/** PHASE P: public settings (verification tokens, identity) through the write-invalidated cache. */
export const getPublicSettings = cache(cached('publicSettings', async () => (await import('../../server/settingsRegistry')).publicSettings()));

export const getSiteIdentity = cache(cached('siteIdentity', async (): Promise<SiteIdentity> => {
  let stored: Partial<Record<string, string>> = {};
  try { stored = await (await import('../../server/settingsRegistry')).publicSettings(); } catch { /* database trouble: built-in branding keeps pages up */ }
  return {
    name: stored.siteName || BRANDING.name,
    description: stored.siteDescription || BRANDING.description,
    configuredDescription: stored.siteDescription || null,
    defaultOgImage: stored.defaultOgImage || null,
    twitterHandle: stored.twitterHandle || null,
  };
}));
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
  // Staff previews read drafts live; visitors share the cached published layout.
  return preview ? getSiteLayout({ preview }) : cachedSiteLayout();
});
const cachedSiteLayout = cached('siteLayout', () => getSiteLayout({ preview: false }));
const cachedHomepage = cached('homepage', async () => {
  const layout = await cachedSiteLayout();
  return getHomepageSections(layout.docs, layout);
});

export const getHomepage = cache(async () => {
  const layout = await getSiteLayoutForRequest();
  return layout.preview ? getHomepageSections(layout.docs, layout) : cachedHomepage();
});
