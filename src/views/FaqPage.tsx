/**
 * Public FAQ (PHASE H). Entries come from the CMS (published only, editor order).
 * The accordion is native <details>/<summary>: keyboard operable (Enter/Space),
 * announced as expandable by screen readers, and readable without JavaScript.
 * FAQPage structured data is generated only from the entries shown here.
 */

import React from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { Breadcrumbs } from '../components/ui/Breadcrumbs';
import { JsonLd } from '../components/seo/JsonLd';
import { answerParagraphs, faqPageSchema, validateFaqSchema } from '../lib/faq';
import type { PublicFaq } from '../../server/services/public/faq';

export const FaqPage: React.FC<{ faqs: PublicFaq[]; schemaEnabled: boolean }> = ({ faqs, schemaEnabled }) => {
  // PHASE R: FAQPage markup only when enabled in Settings and the visible entries validate.
  const check = validateFaqSchema(faqs, schemaEnabled);
  const structuredData = check.ok ? faqPageSchema(check.valid) : null;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Breadcrumbs items={[{ label: 'FAQ' }]} />
      {structuredData && <JsonLd data={structuredData} />}

      <header className="border-b border-stone-200 dark:border-stone-800 pb-4">
        <h1 className="font-serif text-3xl sm:text-4xl font-bold text-stone-900 dark:text-stone-100">Frequently Asked Questions</h1>
        <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">Answers to common questions about our coverage, events and the site.</p>
      </header>

      {faqs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-300 dark:border-stone-700 p-8 text-center">
          <h2 className="font-semibold text-stone-800 dark:text-stone-200">No questions have been published yet.</h2>
          <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
            Can&apos;t find what you need? <Link href="/contact/" className="font-semibold text-amber-700 underline hover:no-underline dark:text-amber-400">Contact the editorial team</Link>.
          </p>
        </div>
      ) : (
        <>
          <div className="divide-y divide-stone-200 dark:divide-stone-800 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417]">
            {faqs.map((f) => (
              <details key={f.id} id={f.id} className="group scroll-mt-24">
                <summary className="flex cursor-pointer list-none items-start justify-between gap-4 p-4 sm:p-5 text-left font-semibold text-stone-900 dark:text-stone-100 hover:bg-stone-50 dark:hover:bg-stone-900/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500 [&::-webkit-details-marker]:hidden">
                  <h2 className="min-w-0 break-words font-serif text-base sm:text-lg leading-snug">{f.question}</h2>
                  <ChevronDown aria-hidden="true" size={20} className="mt-0.5 shrink-0 text-amber-700 transition-transform group-open:rotate-180 dark:text-amber-400" />
                </summary>
                <div className="space-y-3 px-4 pb-5 sm:px-5 text-sm leading-relaxed text-stone-700 dark:text-stone-300 break-words">
                  {answerParagraphs(f.answer).map((lines, i) => (
                    <p key={i}>{lines.map((line, j) => <React.Fragment key={j}>{j > 0 && <br />}{line}</React.Fragment>)}</p>
                  ))}
                </div>
              </details>
            ))}
          </div>
          <p className="text-sm text-stone-600 dark:text-stone-400">
            Still have a question? <Link href="/contact/" className="font-semibold text-amber-700 underline hover:no-underline dark:text-amber-400">Contact the editorial team</Link>.
          </p>
        </>
      )}
    </div>
  );
};
