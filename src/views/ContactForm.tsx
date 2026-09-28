'use client';

import React, { useState } from 'react';
import { Button } from '../components/ui/Button';

/** Contact form (client-side only; there is no contact backend yet). */
export function ContactForm() {
  const [submitted, setSubmitted] = useState(false);

  return (
    <>
        {submitted ? (
          <div className="p-6 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-sm">
            <h3 className="font-semibold text-base mb-1">Message Received</h3>
            <p>Thank you for contacting the SportingSpy editorial bureau. A desk editor will review your inquiry within one business day.</p>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSubmitted(true);
            }}
            className="p-6 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] space-y-4"
          >
            <div>
              <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">
                Your Full Name
              </label>
              <input
                type="text"
                required
                className="w-full text-sm p-2.5 rounded-lg border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-900 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
                placeholder="e.g. Jane Doe"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">
                Email Address
              </label>
              <input
                type="email"
                required
                className="w-full text-sm p-2.5 rounded-lg border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-900 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
                placeholder="editor@organization.com"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">
                Inquiry Department
              </label>
              <select className="w-full text-sm p-2.5 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-500">
                <option>Editorial Correction / Fact-Check</option>
                <option>Tournament Credential Inquiry</option>
                <option>Licensing & Syndication</option>
                <option>Sponsorship / Direct Partnership</option>
                <option>General Inquiries</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">
                Message / Reference Details
              </label>
              <textarea
                rows={4}
                required
                className="w-full text-sm p-2.5 rounded-lg border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-900 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
                placeholder="Specify tournament, article URL, and primary source citation..."
              />
            </div>
            <Button type="submit" size="md" className="w-full">
              Transmit Editorial Inquiry
            </Button>
          </form>
        )}
    </>
  );
}
