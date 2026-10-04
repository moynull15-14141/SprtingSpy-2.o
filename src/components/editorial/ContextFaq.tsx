/**
 * Contextual FAQ section (PHASE R, v2.2 FAQ & Reader Questions).
 *
 * Shows the published, editor-approved questions of one page (an Article, an
 * Event Edition, an Event or a Sport guide) as a native <details> accordion:
 * keyboard operable, announced as expandable, readable without JavaScript and
 * responsive. FAQPage structured data is emitted only when the editor turned
 * it on for this page AND the visible entries pass validation, and it always
 * describes exactly the visible entries.
 */

import React from 'react';
import { ChevronDown } from 'lucide-react';
import { JsonLd } from '../seo/JsonLd';
import { answerParagraphs, faqPageSchema, validateFaqSchema } from '../../lib/faq';

export interface ContextFaqItem { id: string; question: string; answer: string }

export const ContextFaq: React.FC<{ items: ContextFaqItem[]; heading: string; eyebrow?: string; schemaEnabled: boolean; headingLevel?: 'h2' | 'h3' }> = ({ items, heading, eyebrow = 'FAQ', schemaEnabled, headingLevel = 'h2' }) => {
  if (!items.length) return null;
  const check = validateFaqSchema(items, schemaEnabled);
  const Heading = headingLevel;
  const Question = headingLevel === 'h2' ? 'h3' : 'h4';
  return (
    <section aria-labelledby="context-faq-heading" data-faq-count={items.length} data-faq-schema={check.ok ? 'on' : 'off'}>
      {check.ok && <JsonLd data={faqPageSchema(check.valid)} />}
      <div className="mb-4 border-b border-stone-200 pb-3 dark:border-stone-800">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700 dark:text-amber-500">{eyebrow}</p>
        <Heading id="context-faq-heading" className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">{heading}</Heading>
      </div>
      <div className="divide-y divide-stone-200 rounded-2xl border border-stone-200 bg-white dark:divide-stone-800 dark:border-stone-800 dark:bg-[#121417]">
        {items.map((f) => (
          <details key={f.id} id={f.id} className="group scroll-mt-24">
            <summary className="flex cursor-pointer list-none items-start justify-between gap-4 p-4 text-left font-semibold hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500 dark:hover:bg-stone-900/50 sm:p-5 [&::-webkit-details-marker]:hidden">
              <Question className="min-w-0 break-words font-serif text-base leading-snug text-stone-900 dark:text-stone-100 sm:text-lg">{f.question}</Question>
              <ChevronDown aria-hidden="true" size={20} className="mt-0.5 shrink-0 text-amber-700 transition-transform group-open:rotate-180 dark:text-amber-400" />
            </summary>
            <div className="space-y-3 break-words px-4 pb-5 text-sm leading-relaxed text-stone-700 dark:text-stone-300 sm:px-5">
              {answerParagraphs(f.answer).map((lines, i) => <p key={i}>{lines.map((line, j) => <React.Fragment key={j}>{j > 0 && <br />}{line}</React.Fragment>)}</p>)}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
};
