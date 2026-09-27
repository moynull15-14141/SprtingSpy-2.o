/**
 * SportingSpy Dynamic SEO Head Component
 * Dynamically updates document title, canonical link, social tags, and JSON-LD structured data.
 */

import React, { useEffect } from 'react';
import { BRANDING } from '../../config/branding';
import { SeoMetadata } from '../../types';

interface SeoHeadProps {
  seo?: SeoMetadata;
  title?: string;
  description?: string;
  canonicalPath?: string;
  structuredData?: Record<string, unknown>;
}

export const SeoHead: React.FC<SeoHeadProps> = ({
  seo,
  title,
  description,
  canonicalPath,
  structuredData,
}) => {
  const pageTitle = seo?.metaTitle || title || `${BRANDING.name} – Multi-Sport Editorial & Event Guides`;
  const pageDesc = seo?.metaDescription || description || BRANDING.description;
  const canonicalUrl = seo?.canonicalUrl || (typeof window !== 'undefined' ? `${window.location.origin}${canonicalPath || window.location.pathname}` : `https://${BRANDING.domain}`);

  useEffect(() => {
    document.title = pageTitle;

    // Update meta description
    let metaDesc = document.querySelector('meta[name="description"]');
    if (!metaDesc) {
      metaDesc = document.createElement('meta');
      metaDesc.setAttribute('name', 'description');
      document.head.appendChild(metaDesc);
    }
    metaDesc.setAttribute('content', pageDesc);

    // Update OpenGraph title and description
    let ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute('content', pageTitle);

    let ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc) ogDesc.setAttribute('content', pageDesc);

    // Update canonical link
    let linkCanonical = document.querySelector('link[rel="canonical"]');
    if (!linkCanonical) {
      linkCanonical = document.createElement('link');
      linkCanonical.setAttribute('rel', 'canonical');
      document.head.appendChild(linkCanonical);
    }
    linkCanonical.setAttribute('href', canonicalUrl);
  }, [pageTitle, pageDesc, canonicalUrl]);

  return (
    <>
      {structuredData && (
        <script
          type="application/ld+json"
          // PHASE 0.1 XSS FIX: JSON.stringify alone does not escape "<", so a
          // title/description containing "</script><script>..." could break
          // out of this tag and execute. Escaping "<" to a unicode sequence
          // neutralizes that without changing the parsed JSON value.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }}
        />
      )}
    </>
  );
};
