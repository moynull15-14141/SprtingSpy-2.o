/**
 * Public CMS page routes (PHASE PAGES). Used by the fixed routes of the
 * system pages (/about/, /contact/, /privacy-policy/, /terms-and-conditions/,
 * /dmca/) and by /[sport]/ for every other page slug, so each URL has one
 * route and one renderer. Unpublished or missing pages are a real 404.
 */

import 'server-only';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CmsPage } from '../views/CmsPage';
import { RumPageType } from '../components/analytics/RumPageType';
import { descriptionFrom, pageMetadata } from './seo';
import { getAnalyticsRetention, getPublishedPage, getRumEnabled } from './data';
import { pagePath, type PublicPage } from './pages';
import { BRANDING } from '../config/branding';
import { trackingConfig } from '../../server/trackingConfig';
import type { PageView } from '../../server/services/public/pages';

export function cmsPageMetadata(page: PublicPage): Promise<Metadata> {
  return pageMetadata({
    title: `${page.title} | ${BRANDING.name}`,
    description: descriptionFrom(page.summary || page.content, page.title),
    path: pagePath(page.slug),
    // Editor-written SEO values are used exactly as written.
    seo: { ...(page.seoTitle ? { metaTitle: page.seoTitle } : {}), ...(page.seoDescription ? { metaDescription: page.seoDescription } : {}), ...(page.noIndex ? { noIndex: true } : {}) },
    image: page.ogImage || undefined,
    imageAlt: page.ogImageAlt || undefined,
  });
}

export async function publishedPageMetadata(slug: string): Promise<Metadata> {
  const view = await getPublishedPage(slug);
  return view ? cmsPageMetadata(view.page) : {};
}

export async function CmsPageBody({ view, preview = false }: { view: PageView; preview?: boolean }) {
  // PHASE F: the Privacy Policy states which optional providers are actually active.
  const privacy = view.page.template === 'privacy'
    ? await Promise.all([trackingConfig(), getRumEnabled(), getAnalyticsRetention()]).then(([config, rumEnabled, retention]) => ({ config, measurement: { rumEnabled, retention } }))
    : undefined;
  return <>{!preview && <RumPageType type="static" />}<CmsPage page={view.page} media={view.media} privacy={privacy} preview={preview} /></>;
}

export async function renderPublishedPage(slug: string) {
  const view = await getPublishedPage(slug);
  if (!view) notFound();
  return <CmsPageBody view={view} />;
}
