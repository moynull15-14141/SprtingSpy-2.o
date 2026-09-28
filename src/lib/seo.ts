/**
 * Server-side page metadata (PHASE B). Produces the <title>, description,
 * canonical, Open Graph / Twitter and robots tags that are present in the
 * initial HTML response, replacing the old browser-only client-side head updates.
 */

import type { Metadata } from 'next';
import type { SeoMetadata } from '../types';
import { BRANDING } from '../config/branding';
import { absoluteUrl } from './paths';

interface PageMetadataInput {
  title: string;
  description: string;
  /** Canonical path (trailing slash) of this page. */
  path: string;
  seo?: SeoMetadata;
  /** Fallback social image (e.g. the featured image). */
  image?: string;
  /** Force noindex (search results, filtered listings, private areas). */
  noindex?: boolean;
  /** Private areas: noindex AND nofollow. */
  private?: boolean;
  openGraph?: Metadata['openGraph'];
}

export function pageMetadata({ title, description, path, seo, image, noindex, private: isPrivate, openGraph }: PageMetadataInput): Metadata {
  const pageTitle = seo?.metaTitle || title;
  const pageDescription = seo?.metaDescription || description;
  const canonical = seo?.canonicalUrl || absoluteUrl(path);
  // Social metadata (Phase A) falls back to the SEO title/description/image.
  const socialTitle = seo?.ogTitle || pageTitle;
  const socialDescription = seo?.ogDescription || pageDescription;
  const socialImage = seo?.ogImage || image;
  const images = socialImage ? [new URL(socialImage, absoluteUrl('/')).toString()] : undefined;

  return {
    title: { absolute: pageTitle },
    description: pageDescription,
    alternates: { canonical },
    robots: isPrivate
      ? { index: false, follow: false }
      : seo?.noIndex || noindex
        ? { index: false, follow: true }
        : { index: true, follow: true },
    openGraph: {
      type: 'website',
      siteName: BRANDING.name,
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
      ...(images ? { images } : {}),
    },
  };
}
