'use client';

/**
 * Consent banner and preferences dialog (PHASE F). Accept and reject are
 * equally prominent; the banner never covers or blocks reading; everything
 * works with the keyboard (Escape closes the dialog, focus stays inside it).
 */

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { answerAll, type ConsentCategory, type ConsentChoice, type ConsentState } from '../../lib/consent';

const button =
  'rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-900 hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800';

const DESCRIPTIONS: Record<ConsentCategory, { label: string; text: string }> = {
  analytics: { label: 'Analytics', text: 'Helps us understand which pages and searches are useful, using Google Analytics. No advertising use.' },
  advertising: { label: 'Advertising', text: 'Lets an advertising partner (Google AdSense) show ads and measure them, which may involve its cookies.' },
};

export function ConsentBanner({ onAcceptAll, onRejectOptional, onManage }: { onAcceptAll: () => void; onRejectOptional: () => void; onManage: () => void }) {
  return (
    <section
      role="region"
      aria-labelledby="consent-title"
      className="fixed inset-x-0 bottom-0 z-40 p-3 sm:p-4"
    >
      <div className="mx-auto max-w-3xl rounded-2xl border border-stone-200 bg-white p-4 shadow-2xl dark:border-stone-700 dark:bg-[#121417] sm:p-5">
        <h2 id="consent-title" className="font-serif text-lg font-bold text-stone-900 dark:text-stone-100">Privacy choices</h2>
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
          We use necessary technologies to run SportingSpy. Optional analytics or advertising runs only if you allow it. You can change this at any time from “Privacy choices” in the footer. <Link href="/privacy-policy/" className="font-semibold text-amber-700 underline dark:text-amber-400">Privacy Policy</Link>
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={button} onClick={onAcceptAll}>Accept all</button>
          <button type="button" className={button} onClick={onRejectOptional}>Reject optional</button>
          <button type="button" className={`${button} border-transparent bg-transparent underline hover:bg-transparent dark:bg-transparent`} onClick={onManage}>Manage preferences</button>
        </div>
      </div>
    </section>
  );
}

export function PreferencesDialog({ consent, categories, onSave, onClose }: {
  consent: ConsentState;
  categories: ConsentCategory[];
  onSave: (choice: ConsentChoice) => void;
  onClose: () => void;
}) {
  // Unanswered categories start unchecked; saving records an answer only for offered categories.
  const [choice, setChoice] = useState<ConsentChoice>({ ...answerAll(categories, false), ...Object.fromEntries(categories.filter((c) => consent?.[c] !== undefined).map((c) => [c, consent![c]])) });
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = dialog.current;
    el?.querySelector<HTMLElement>('input:not([disabled]), button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key !== 'Tab' || !el) return;
      const focusable = [...el.querySelectorAll<HTMLElement>('a[href], button, input:not([disabled])')];
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="privacy-dialog-title" className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl dark:bg-[#121417]">
        <h2 id="privacy-dialog-title" className="font-serif text-xl font-bold text-stone-900 dark:text-stone-100">Privacy preferences</h2>
        <ul className="mt-4 space-y-3">
          <li className="rounded-xl border border-stone-200 p-3 dark:border-stone-800">
            <label className="flex items-start gap-3">
              <input type="checkbox" checked disabled className="mt-1" />
              <span><span className="block text-sm font-semibold">Necessary</span><span className="text-xs text-stone-600 dark:text-stone-400">Sign-in session, security token and your display preferences. Always on; the site cannot work without them.</span></span>
            </label>
          </li>
          {categories.map((category) => (
            <li key={category} className="rounded-xl border border-stone-200 p-3 dark:border-stone-800">
              <label className="flex items-start gap-3">
                <input type="checkbox" className="mt-1" checked={choice[category] === true} onChange={(e) => setChoice((c) => ({ ...c, [category]: e.target.checked }))} />
                <span><span className="block text-sm font-semibold">{DESCRIPTIONS[category].label}</span><span className="text-xs text-stone-600 dark:text-stone-400">{DESCRIPTIONS[category].text}</span></span>
              </label>
            </li>
          ))}
        </ul>
        {categories.length === 0 && (
          <p className="mt-3 text-sm text-stone-600 dark:text-stone-400">SportingSpy currently uses only necessary technologies. No analytics or advertising provider is active, so there is nothing optional to choose.</p>
        )}
        <p className="mt-3 text-xs text-stone-500 dark:text-stone-400">Details are in our <Link href="/privacy-policy/" className="underline">Privacy Policy</Link>.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {categories.length > 0 && (
            <>
              <button type="button" className={button} onClick={() => onSave(choice)}>Save choices</button>
              <button type="button" className={button} onClick={() => onSave(answerAll(categories, true))}>Accept all</button>
              <button type="button" className={button} onClick={() => onSave(answerAll(categories, false))}>Reject optional</button>
            </>
          )}
          <button type="button" className={`${button} ml-auto`} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
