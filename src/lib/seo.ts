/**
 * Server-side page metadata (PHASE B). Produces the <title>, description,
 * canonical, Open Graph / Twitter and robots tags that are present in the
 * initial HTML response, replacing the old browser-only client-side head updates.
 *
 * PHASE H: the site name, default social image and X/Twitter handle come from
 * Admin → Settings (getSiteIdentity), falling back to the built-in branding.
 * Page-provided default titles/descriptions use the configured site name;
 * editor-written SEO values (seo.metaTitle etc.) are used exactly as written.
 */

import type { Metadata } from 'next';
import type { SeoMetadata } from '../types';
import { BRANDING } from '../config/branding';
import { absoluteUrl, siteOrigin } from './paths';
import { canonicalElsewhere } from './indexability';
import { getSiteIdentity } from './data';

interface PageMetadataInput {
  title: string;
  description: string;
  /** Canonical path (trailing slash) of this page. */
  path: string;
  seo?: SeoMetadata;
  /** Fallback social image (e.g. the featured image). */
  image?: string;
  /** Factual description from the selected Media Library item, when available. */
  imageAlt?: string;
  /** Force noindex (search results, filtered listings, private areas). */
  noindex?: boolean;
  /** Private areas: noindex AND nofollow. */
  private?: boolean;
  openGraph?: Metadata['openGraph'];
}

/**
 * PHASE E5: a page-default meta description from editor prose — whitespace
 * collapsed and cut at a word boundary within the 160-character guideline the
 * SEO scanner uses. Falls back when the prose is empty. Editor SEO overrides
 * (seo.metaDescription) are never shortened.
 */
export function descriptionFrom(text: string | null | undefined, fallback: string, max = 160): string {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return fallback;
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const atWord = cut.slice(0, Math.max(cut.lastIndexOf(' '), Math.floor(max * 0.6))).replace(/[\s,;:.\-–—]+$/, '');
  return `${atWord}…`;
}

/** Replaces the built-in brand name in page-default text with the configured site name. */
export const withSiteName = (text: string, siteName: string) => (siteName === BRANDING.name ? text : text.split(BRANDING.name).join(siteName));

export async function pageMetadata({ title, description, path, seo, image, imageAlt, noindex, private: isPrivate, openGraph }: PageMetadataInput): Promise<Metadata> {
  const identity = await getSiteIdentity();
  const pageTitle = seo?.metaTitle || withSiteName(title, identity.name);
  const pageDescription = seo?.metaDescription || withSiteName(description, identity.name);
  const canonical = seo?.canonicalUrl || absoluteUrl(path);
  // Social metadata (Phase A) falls back to the SEO title/description/image, then the site default image.
  const socialTitle = seo?.ogTitle || pageTitle;
  const socialDescription = seo?.ogDescription || pageDescription;
  const socialImage = seo?.ogImage || image || identity.defaultOgImage || undefined;
  const images = socialImage ? [{ url: new URL(socialImage, absoluteUrl('/')).toString(), ...(imageAlt && !seo?.ogImage ? { alt: imageAlt } : {}) }] : undefined;

  return {
    title: { absolute: pageTitle },
    description: pageDescription,
    alternates: { canonical },
    robots: isPrivate
      ? { index: false, follow: false }
      : seo?.noIndex || noindex || canonicalElsewhere(seo, path, siteOrigin())
        ? { index: false, follow: true }
        : { index: true, follow: true },
    openGraph: {
      type: 'website',
      siteName: identity.name,
      title: socialTitle,
      description: socialDescription,
      url: canonical,
      ...(images ? { images } : {}),
      ...openGraph,
    },
    twitter: {
      card: 'summary_large_image',
      title: socialTitle,
      description: socialDescription,
      ...(identity.twitterHandle ? { site: identity.twitterHandle } : {}),
      ...(images ? { images } : {}),
    },
  };
}
