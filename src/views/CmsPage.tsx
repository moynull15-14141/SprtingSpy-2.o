/**
 * CMS page (PHASE PAGES): About, Contact, Privacy Policy, Terms, DMCA and any
 * page created in Admin → Pages. The body is the validated rich-text document
 * rendered by the same component as article bodies (React text only, no HTML
 * strings). A template adds the one non-text part a page may need.
 */

import React from 'react';
import { Breadcrumbs } from '../components/ui/Breadcrumbs';
import { RichText } from '../components/editorial/RichText';
import { ContactForm } from './ContactForm';
import { PrivacyDisclosures, type PrivacyMeasurement } from './PrivacyDisclosures';
import type { PublicPage } from '../lib/pages';
import type { MediaAsset } from '../lib/media';
import type { PrivacyConfig } from '../lib/consent';

export interface CmsPageProps {
  page: PublicPage;
  media: Record<string, MediaAsset>;
  /** Only for template "privacy": the live provider configuration. */
  privacy?: { config: PrivacyConfig; measurement: PrivacyMeasurement };
  preview?: boolean;
}

/** A template page may have no body text (e.g. Contact is just the form); skip empty paragraphs. */
const hasBody = (page: PublicPage) => !!page.content.trim() || page.body.content.some((n) => n.type !== 'paragraph' || !!n.content?.length);

export function CmsPage({ page, media, privacy, preview }: CmsPageProps) {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {preview && (
        <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          Staff preview — {page.status === 'published' ? 'this page is published' : 'this draft is not public'}. Not indexed.
        </p>
      )}
      <Breadcrumbs items={[{ label: page.shortTitle || page.title }]} />
      <header className="border-b border-stone-200 pb-4 dark:border-stone-800">
        <h1 className="font-serif text-3xl font-bold text-stone-900 sm:text-4xl dark:text-stone-100">{page.title}</h1>
        {page.summary && <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">{page.summary}</p>}
      </header>
      {hasBody(page) && (
        <div className="prose prose-stone max-w-none space-y-4 text-sm leading-relaxed text-stone-800 sm:text-base dark:prose-invert dark:text-stone-200">
          {/* Articles default to a drop cap; informational pages do not. */}
          <RichText doc={{ ...page.body, attrs: { dropCap: false, ...page.body.attrs } }} media={media} />
        </div>
      )}
      {page.template === 'privacy' && privacy && <PrivacyDisclosures config={privacy.config} measurement={privacy.measurement} />}
      {page.template === 'contact' && <ContactForm />}
    </div>
  );
}
